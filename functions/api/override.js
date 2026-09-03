import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { newId } from '../_lib/ids.js'
import {
  ensureOverrideSchema,
  seedOverrideWorkspace,
  resolveOverrideActor,
  overrideDemoMode,
  requireOverridePermission,
  auditOverride,
  isSafeIntegrationUrl,
} from '../_lib/override.js'
import {
  CAUSES,
  DECISION_ACTIONS,
  EXPERIMENT_PHASES,
  OVERRIDE_ROLES,
  actionByKey,
  canExpandExperiment,
  causeByKey,
  compareDecision,
  evaluateExperimentRun,
  priorityBand,
  priorityScore,
  recommendCluster,
  recurringExceptionRate,
  safeJson,
  suggestCauses,
  trendSignal,
} from '../../shared/override.js'

const ALLOWED_ACTIONS = new Set(DECISION_ACTIONS.map((item) => item.key))
const ALLOWED_CAUSES = new Set(CAUSES.map((item) => item.key))
const ALLOWED_PHASES = new Set(EXPERIMENT_PHASES.map((item) => item.key))
const ALLOWED_ROLES = new Set(OVERRIDE_ROLES.map((item) => item.key))

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max)
}

function number(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.min(max, Math.max(min, parsed))
}

function list(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 500)).filter(Boolean)
  return text(value, 3000)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hydrateEvent(row) {
  return {
    ...row,
    changed_fields: safeJson(row.changed_fields_json, []),
    policy_refs: safeJson(row.policy_refs_json, []),
    data_refs: safeJson(row.data_refs_json, []),
    tools: safeJson(row.tools_json, []),
  }
}

function hydrateCluster(row) {
  return {
    ...row,
    cause_candidates: safeJson(row.cause_candidates_json, []),
    policy_refs: safeJson(row.policy_refs_json, []),
    priority_band: priorityBand(row.priority_score),
  }
}

function hydrateExperiment(row, runs, decisions) {
  return {
    ...row,
    guardrails: safeJson(row.guardrails_json, []),
    stop_conditions: safeJson(row.stop_conditions_json, []),
    runs: runs.filter((run) => run.experiment_id === row.id),
    decisions: decisions.filter((decision) => decision.experiment_id === row.id).map((decision) => ({
      ...decision,
      metrics_snapshot: safeJson(decision.metrics_snapshot_json, {}),
    })),
  }
}

function daysBetween(start, end) {
  const a = new Date(String(start).replace(' ', 'T') + 'Z').getTime()
  const b = new Date(String(end).replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round(((b - a) / 86400000) * 10) / 10
}

function average(values) {
  const usable = values.map(Number).filter(Number.isFinite)
  if (usable.length === 0) return null
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10
}

function buildFairness(events, volumes, products) {
  const rows = new Map()
  for (const volume of volumes) {
    const key = `${volume.product_id}::${volume.segment}`
    const current = rows.get(key) ?? {
      product_id: volume.product_id,
      segment: volume.segment,
      applicable: 0,
      overrides: 0,
    }
    current.applicable += Number(volume.applicable_cases) || 0
    rows.set(key, current)
  }
  for (const event of events) {
    if (!Number(event.is_override) || event.validity === 'invalid') continue
    const key = `${event.product_id}::${event.segment || '미분류'}`
    const current = rows.get(key) ?? {
      product_id: event.product_id,
      segment: event.segment || '미분류',
      applicable: 0,
      overrides: 0,
    }
    current.overrides += 1
    rows.set(key, current)
  }

  const productNames = new Map(products.map((product) => [product.id, product.name]))
  return [...rows.values()]
    .map((row) => ({
      ...row,
      product_name: productNames.get(row.product_id) ?? row.product_id,
      rate: recurringExceptionRate(row.overrides, row.applicable),
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
}

function buildPolicyImpact(events) {
  const groups = new Map()
  for (const event of events) {
    for (const policy of event.policy_refs ?? []) {
      const current = groups.get(policy) ?? {
        policy,
        events: 0,
        products: new Set(),
        high_risk: 0,
        cost_krw: 0,
      }
      current.events += Number(event.is_override) || 0
      current.products.add(event.product_id)
      current.high_risk += Number(event.regulatory_risk_score) >= 4 ? 1 : 0
      current.cost_krw += Number(event.operations_cost_krw) || 0
      groups.set(policy, current)
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, products: group.products.size }))
    .sort((a, b) => b.events - a.events)
}

function buildCommonIssues(events, clusters, products) {
  const productNames = new Map(products.map((product) => [product.id, product.name]))
  const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster]))
  const groups = new Map()
  for (const event of events) {
    if (!event.cluster_id || !Number(event.is_override) || event.validity === 'invalid') continue
    const cause = clusterMap.get(event.cluster_id)?.cause_code ?? 'unknown'
    const current = groups.get(cause) ?? { cause_code: cause, events: 0, products: new Set() }
    current.events += 1
    current.products.add(productNames.get(event.product_id) ?? event.product_id)
    groups.set(cause, current)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      cause_label: causeByKey(group.cause_code).label,
      products: [...group.products],
    }))
    .filter((group) => group.products.length > 1)
    .sort((a, b) => b.events - a.events)
}

function buildGraph(products, events, clusters, experiments, decisions) {
  const nodes = []
  const edges = []
  for (const product of products) nodes.push({ id: product.id, kind: 'product', label: product.name })
  for (const cluster of clusters) nodes.push({ id: cluster.id, kind: 'cluster', label: cluster.title })
  for (const experiment of experiments) nodes.push({ id: experiment.id, kind: 'experiment', label: experiment.title })
  for (const decision of decisions) {
    nodes.push({ id: decision.id, kind: 'decision', label: decision.decision })
  }

  const seen = new Set()
  for (const event of events) {
    if (!event.cluster_id) continue
    const key = `${event.product_id}:${event.cluster_id}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ from: event.product_id, to: event.cluster_id, kind: '발생' })
  }
  for (const experiment of experiments) {
    edges.push({ from: experiment.cluster_id, to: experiment.id, kind: '개선 실험' })
  }
  for (const decision of decisions) {
    edges.push({ from: decision.experiment_id, to: decision.id, kind: '결정' })
  }
  return { nodes, edges }
}

function buildAlerts(clusters, experiments) {
  const alerts = []
  for (const cluster of clusters) {
    if (priorityBand(cluster.priority_score) === 'P0' && cluster.status !== 'resolved') {
      alerts.push({
        level: 'critical',
        title: `${cluster.title} · P0`,
        body: `규제 ${cluster.regulatory_risk_score}/5 · 반복 ${cluster.recurrence_count}건`,
        entity_id: cluster.id,
      })
    }
    if (cluster.trend?.direction === 'surge') {
      alerts.push({
        level: 'warning',
        title: `${cluster.title} 증가`,
        body: `직전 기간보다 ${cluster.trend.change}% 증가했습니다.`,
        entity_id: cluster.id,
      })
    }
  }
  for (const experiment of experiments) {
    const blocked = experiment.runs?.find((run) => run.status === 'blocked')
    if (blocked) {
      alerts.push({
        level: 'critical',
        title: `${experiment.title} 자동 중단`,
        body: `${blocked.phase}에서 가드레일 ${blocked.guardrail_breaches}건을 위반했습니다.`,
        entity_id: experiment.id,
      })
    }
  }
  return alerts
}

async function loadWorkspace(env) {
  const [productRows, eventRows, clusterRows, experimentRows, runRows, decisionRows, volumeRows, integrationRows, auditRows, aiRows] =
    await Promise.all([
      env.DB.prepare('SELECT * FROM override_product ORDER BY created_at').all(),
      env.DB.prepare(
        `SELECT e.*, p.name AS product_name
         FROM override_event e JOIN override_product p ON p.id = e.product_id
         ORDER BY e.occurred_at DESC LIMIT 500`
      ).all(),
      env.DB.prepare('SELECT * FROM issue_cluster ORDER BY priority_score DESC, last_seen_at DESC').all(),
      env.DB.prepare('SELECT * FROM change_experiment ORDER BY updated_at DESC').all(),
      env.DB.prepare('SELECT * FROM experiment_run ORDER BY created_at').all(),
      env.DB.prepare('SELECT * FROM override_decision_record ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT * FROM override_volume ORDER BY measured_on DESC').all(),
      env.DB.prepare('SELECT * FROM override_integration ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT * FROM override_audit ORDER BY created_at DESC LIMIT 160').all(),
      env.DB.prepare('SELECT * FROM override_ai_call ORDER BY created_at DESC LIMIT 80').all(),
    ])

  const products = productRows.results ?? []
  const events = (eventRows.results ?? []).map(hydrateEvent)
  const rawClusters = (clusterRows.results ?? []).map(hydrateCluster)
  const runs = runRows.results ?? []
  const decisions = decisionRows.results ?? []
  const experiments = (experimentRows.results ?? []).map((row) =>
    hydrateExperiment(row, runs, decisions)
  )
  const volumes = volumeRows.results ?? []

  const now = Date.now()
  const clusters = rawClusters.map((cluster) => {
    const related = events.filter(
      (event) => event.cluster_id === cluster.id && Number(event.is_override) && event.validity !== 'invalid'
    )
    const recent = related.filter((event) => {
      const at = new Date(String(event.occurred_at).replace(' ', 'T') + 'Z').getTime()
      return Number.isFinite(at) && now - at <= 30 * 86400000
    }).length
    const previous = related.filter((event) => {
      const at = new Date(String(event.occurred_at).replace(' ', 'T') + 'Z').getTime()
      return Number.isFinite(at) && now - at > 30 * 86400000 && now - at <= 60 * 86400000
    }).length
    return { ...cluster, trend: trendSignal(recent, previous) }
  })

  const validOverrides = events.filter(
    (event) => Number(event.is_override) && event.validity !== 'invalid'
  )
  const applicableCases = products.reduce(
    (sum, product) => sum + (Number(product.applicable_cases) || 0),
    0
  )
  const confirmedClusters = clusters.filter((cluster) => cluster.cause_confirmed_at)
  const completeEvents = events.filter(
    (event) =>
      event.ai_decision &&
      event.human_decision &&
      event.reason_detail &&
      event.model_version &&
      event.prompt_version &&
      event.policy_refs.length > 0
  )

  const workspace = {
    generated_at: new Date().toISOString(),
    demo_mode: overrideDemoMode(env),
    products,
    events,
    clusters,
    experiments,
    decisions: decisions.map((row) => ({
      ...row,
      metrics_snapshot: safeJson(row.metrics_snapshot_json, {}),
    })),
    volumes,
    integrations: integrationRows.results ?? [],
    audit: (auditRows.results ?? []).map((row) => ({ ...row, detail: safeJson(row.detail_json, {}) })),
    ai_calls: aiRows.results ?? [],
    fairness: buildFairness(events, volumes, products),
    policy_impact: buildPolicyImpact(events),
    common_issues: buildCommonIssues(events, clusters, products),
    graph: buildGraph(products, events, clusters, experiments, decisions),
    metrics: {
      total_decisions: events.length,
      overrides: validOverrides.length,
      recurring_exception_rate: recurringExceptionRate(validOverrides.length, applicableCases),
      capture_completeness: events.length ? Math.round((completeEvents.length / events.length) * 1000) / 10 : null,
      reason_confirmation_rate: events.length
        ? Math.round((events.filter((event) => event.reason_detail).length / events.length) * 1000) / 10
        : null,
      average_recording_seconds: average(events.map((event) => event.recording_seconds)),
      pending_validation: events.filter((event) => event.validity === 'pending').length,
      active_clusters: clusters.filter((cluster) => !['resolved', 'accepted_exception'].includes(cluster.status)).length,
      p0_clusters: clusters.filter(
        (cluster) => priorityBand(cluster.priority_score) === 'P0' && cluster.status !== 'resolved'
      ).length,
      root_cause_days: average(
        confirmedClusters.map((cluster) => daysBetween(cluster.first_seen_at, cluster.cause_confirmed_at))
      ),
      assigned_rate: clusters.length
        ? Math.round((clusters.filter((cluster) => cluster.owner_team).length / clusters.length) * 1000) / 10
        : null,
      experiment_conversion_rate: clusters.length
        ? Math.round((new Set(experiments.map((item) => item.cluster_id)).size / clusters.length) * 1000) / 10
        : null,
      in_experiment: experiments.filter((experiment) => ['approved', 'running'].includes(experiment.status)).length,
      guardrail_breaches: runs.reduce((sum, run) => sum + (Number(run.guardrail_breaches) || 0), 0),
      verified_improvements: experiments.filter((experiment) => experiment.status === 'expanded').length,
      rework_cost_krw: validOverrides.reduce(
        (sum, event) => sum + (Number(event.operations_cost_krw) || 0),
        0
      ),
    },
  }
  workspace.alerts = buildAlerts(clusters, experiments)
  return workspace
}

export async function onRequestGet({ env }) {
  try {
    await ensureOverrideSchema(env)
    await seedOverrideWorkspace(env)
    const workspace = await loadWorkspace(env)
    return jsonResponse(workspace)
  } catch (error) {
    return failUnexpected(error, 'OverrideLoop 운영 자료를 불러오지 못했습니다.')
  }
}

async function refreshCluster(env, clusterId) {
  if (!clusterId) return
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            MIN(occurred_at) AS first_seen,
            MAX(occurred_at) AS last_seen,
            AVG(customer_impact_score) AS customer_score,
            SUM(operations_cost_krw) AS cost_krw,
            MAX(regulatory_risk_score) AS regulation_score
     FROM override_event
     WHERE cluster_id = ? AND is_override = 1 AND validity != 'invalid'`
  )
    .bind(clusterId)
    .first()
  if (!stats || Number(stats.n) === 0) return
  const score = priorityScore({
    customerImpact: stats.customer_score,
    operationsCost: stats.cost_krw,
    regulatoryRisk: stats.regulation_score,
    recurrence: stats.n,
  })
  await env.DB.prepare(
    `UPDATE issue_cluster
     SET recurrence_count = ?, customer_impact_score = ?, operations_cost_krw = ?,
         regulatory_risk_score = ?, priority_score = ?, first_seen_at = ?, last_seen_at = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      Number(stats.n),
      Number(stats.customer_score) || 0,
      Number(stats.cost_krw) || 0,
      Number(stats.regulation_score) || 0,
      score,
      stats.first_seen,
      stats.last_seen,
      clusterId
    )
    .run()
}

async function captureEvent(env, actor, body) {
  requireOverridePermission(actor, 'capture_event')
  const fields = {}
  const productId = text(body.productId, 100)
  const decisionAction = text(body.decisionAction, 40)
  const aiDecision = text(body.aiDecision)
  const humanDecision = text(body.humanDecision)
  const reasonDetail = text(body.reasonDetail, 2000)
  const reviewerLabel = text(body.reviewerLabel || actor.label, 60)
  if (!productId) fields.productId = 'AI 제품을 선택해주세요.'
  if (!ALLOWED_ACTIONS.has(decisionAction)) fields.decisionAction = '최종 판단을 선택해주세요.'
  if (!aiDecision) fields.aiDecision = 'AI의 원래 판단을 적어주세요.'
  if (!humanDecision) fields.humanDecision = '사람의 최종 판단을 적어주세요.'
  if (!reasonDetail) fields.reasonDetail = '판단을 확인할 수 있는 이유를 적어주세요.'
  if (!reviewerLabel) fields.reviewerLabel = '검토자를 적어주세요.'
  if (Object.keys(fields).length) return failFields(fields)

  const product = await env.DB.prepare('SELECT * FROM override_product WHERE id = ?')
    .bind(productId)
    .first()
  if (!product) return jsonError('선택한 AI 제품을 찾지 못했습니다.', 404)

  const action = actionByKey(decisionAction)
  const policyRefs = list(body.policyRefs)
  const eventShape = {
    reasonDetail,
    aiDecision,
    humanDecision,
    changedFields: list(body.changedFields).join(' '),
    policyRefs: policyRefs.join(' '),
  }
  const candidates = suggestCauses(eventShape)
  const suggestedCause = candidates[0]?.key ?? 'unknown'
  let clusterId = null

  if (action.isOverride) {
    const { results: openClusters } = await env.DB.prepare(
      `SELECT * FROM issue_cluster WHERE status NOT IN ('resolved', 'accepted_exception')`
    ).all()
    const hydrated = (openClusters ?? []).map(hydrateCluster)
    const recommendation = recommendCluster(
      { ...eventShape, causeKey: suggestedCause },
      hydrated
    )
    if (recommendation && recommendation.score >= 0.36) {
      clusterId = recommendation.cluster.id
    } else {
      clusterId = newId('olc')
      const owner = causeByKey(suggestedCause).owner
      const initialPriority = priorityScore({
        customerImpact: number(body.customerImpact, 0, 5),
        operationsCost: number(body.operationsCost, 0),
        regulatoryRisk: number(body.regulatoryRisk, 0, 5),
        recurrence: 1,
      })
      await env.DB.prepare(
        `INSERT INTO issue_cluster
         (id, title, summary, sample_text, cause_code, cause_status, cause_candidates_json,
          policy_refs_json, affected_workflow, affected_customer_count, customer_impact_score,
          operations_cost_krw, regulatory_risk_score, recurrence_count, owner_team,
          priority_score, status)
         VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, 'open')`
      )
        .bind(
          clusterId,
          text(body.clusterTitle || reasonDetail, 72),
          reasonDetail,
          `${reasonDetail} ${aiDecision} ${humanDecision}`,
          suggestedCause,
          JSON.stringify(candidates),
          JSON.stringify(policyRefs),
          text(body.workflow || product.domain, 120),
          number(body.customerImpact, 0, 5),
          number(body.operationsCost, 0),
          number(body.regulatoryRisk, 0, 5),
          owner,
          initialPriority
        )
        .run()
    }
  }

  const id = newId('ole')
  const diff = compareDecision(aiDecision, humanDecision)
  const changedFields = list(body.changedFields)
  const actualChanged = changedFields.length ? changedFields : [...diff.removed, ...diff.added]
  const externalRef = text(body.externalRef, 160) || null
  try {
    await env.DB.prepare(
      `INSERT INTO override_event
       (id, product_id, cluster_id, external_ref, source_kind, occurred_at, reviewer_label,
        reviewer_role, decision_action, is_override, ai_decision, human_decision,
        changed_fields_json, reason_code, reason_detail, policy_refs_json, model_version,
        prompt_version, agent_version, tool_version, data_refs_json, tools_json, segment,
        customer_impact_score, operations_cost_krw, regulatory_risk_score, customer_outcome,
        business_outcome, recording_seconds, validity, validity_reason)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        productId,
        clusterId,
        externalRef,
        ['work_ui', 'api', 'appeal', 'ticket', 'import'].includes(body.sourceKind)
          ? body.sourceKind
          : 'work_ui',
        reviewerLabel,
        actor.role,
        decisionAction,
        action.isOverride ? 1 : 0,
        aiDecision,
        humanDecision,
        JSON.stringify(actualChanged),
        text(body.reasonCode, 80) || suggestedCause,
        reasonDetail,
        JSON.stringify(policyRefs),
        text(body.modelVersion, 120) || product.model_version,
        text(body.promptVersion, 120) || product.prompt_version,
        text(body.agentVersion, 120) || product.agent_version,
        text(body.toolVersion, 120) || product.tool_version,
        JSON.stringify(list(body.dataRefs)),
        JSON.stringify(list(body.tools)),
        text(body.segment, 120) || '미분류',
        number(body.customerImpact, 0, 5),
        number(body.operationsCost, 0),
        number(body.regulatoryRisk, 0, 5),
        text(body.customerOutcome, 1200) || null,
        text(body.businessOutcome, 1200) || null,
        number(body.recordingSeconds, 0, 3600),
        action.isOverride ? 'pending' : 'valid',
        action.isOverride ? null : 'AI 판단 승인'
      )
      .run()
  } catch (error) {
    if (externalRef && /unique|duplicate/i.test(String(error.message))) {
      return jsonError('같은 외부 사건 번호가 이미 저장되어 있습니다.', 409)
    }
    throw error
  }

  await env.DB.prepare(
    `UPDATE override_product
     SET total_cases = total_cases + 1, applicable_cases = applicable_cases + 1,
         updated_at = datetime('now') WHERE id = ?`
  )
    .bind(productId)
    .run()
  await refreshCluster(env, clusterId)
  await auditOverride(env, actor, 'capture_event', 'override_event', id, {
    decision_action: decisionAction,
    cluster_id: clusterId,
    product_id: productId,
  })
  return jsonResponse({ ok: true, id, cluster_id: clusterId }, 201)
}

async function validateEvent(env, actor, body) {
  requireOverridePermission(actor, 'validate_event')
  const eventId = text(body.eventId, 100)
  const validity = text(body.validity, 30)
  const reason = text(body.reason, 1600)
  if (!eventId || !['valid', 'invalid', 'uncertain'].includes(validity) || !reason) {
    return failFields({ reason: '타당성 판정과 근거를 함께 적어주세요.' })
  }
  const event = await env.DB.prepare('SELECT id, cluster_id FROM override_event WHERE id = ?')
    .bind(eventId)
    .first()
  if (!event) return jsonError('그 수정 사건을 찾지 못했습니다.', 404)
  await env.DB.prepare(
    `UPDATE override_event SET validity = ?, validity_reason = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(validity, reason, eventId)
    .run()
  await refreshCluster(env, event.cluster_id)
  await auditOverride(env, actor, 'validate_event', 'override_event', eventId, { validity, reason })
  return jsonResponse({ ok: true })
}

async function updateCluster(env, actor, body) {
  requireOverridePermission(actor, 'update_cluster')
  const clusterId = text(body.clusterId, 100)
  const cluster = await env.DB.prepare('SELECT * FROM issue_cluster WHERE id = ?')
    .bind(clusterId)
    .first()
  if (!cluster) return jsonError('그 문제 군집을 찾지 못했습니다.', 404)
  const causeCode = ALLOWED_CAUSES.has(body.causeCode) ? body.causeCode : cluster.cause_code
  const causeStatus = ['candidate', 'confirmed', 'disputed'].includes(body.causeStatus)
    ? body.causeStatus
    : cluster.cause_status
  const ownerTeam = text(body.ownerTeam, 120) || causeByKey(causeCode).owner
  const reason = text(body.reason, 1600)
  if (!reason) return failFields({ reason: '원인 판정 또는 배정의 근거를 적어주세요.' })
  const customer = number(body.customerImpact ?? cluster.customer_impact_score, 0, 5)
  const cost = number(body.operationsCost ?? cluster.operations_cost_krw, 0)
  const regulation = number(body.regulatoryRisk ?? cluster.regulatory_risk_score, 0, 5)
  const score = priorityScore({
    customerImpact: customer,
    operationsCost: cost,
    regulatoryRisk: regulation,
    recurrence: cluster.recurrence_count,
  })
  const status = ['open', 'experiment', 'monitoring', 'resolved', 'accepted_exception'].includes(
    body.status
  )
    ? body.status
    : cluster.status
  await env.DB.prepare(
    `UPDATE issue_cluster
     SET title = ?, summary = ?, cause_code = ?, cause_status = ?, owner_team = ?,
         customer_impact_score = ?, operations_cost_krw = ?, regulatory_risk_score = ?,
         priority_score = ?, status = ?, cause_confirmed_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      text(body.title, 160) || cluster.title,
      text(body.summary, 2400) || cluster.summary,
      causeCode,
      causeStatus,
      ownerTeam,
      customer,
      cost,
      regulation,
      score,
      status,
      causeStatus === 'confirmed' ? cluster.cause_confirmed_at || new Date().toISOString() : null,
      clusterId
    )
    .run()
  await auditOverride(env, actor, 'update_cluster', 'issue_cluster', clusterId, {
    cause_code: causeCode,
    owner_team: ownerTeam,
    priority_score: score,
    reason,
  })
  return jsonResponse({ ok: true, priority_score: score, priority_band: priorityBand(score) })
}

async function createProduct(env, actor, body) {
  requireOverridePermission(actor, 'create_product')
  const required = ['name', 'domain', 'ownerTeam', 'modelName', 'modelVersion', 'promptVersion', 'policyVersion']
  const fields = Object.fromEntries(
    required.filter((key) => !text(body[key], 200)).map((key) => [key, '필수 항목입니다.'])
  )
  if (Object.keys(fields).length) return failFields(fields)
  const id = newId('olp')
  await env.DB.prepare(
    `INSERT INTO override_product
     (id, name, domain, owner_team, model_name, model_version, prompt_version,
      agent_version, policy_version, tool_version, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      text(body.name, 160),
      text(body.domain, 160),
      text(body.ownerTeam, 120),
      text(body.modelName, 120),
      text(body.modelVersion, 120),
      text(body.promptVersion, 120),
      text(body.agentVersion, 120) || null,
      text(body.policyVersion, 120),
      text(body.toolVersion, 120) || null,
      ['시험', '운영', '중단'].includes(body.status) ? body.status : '시험'
    )
    .run()
  await auditOverride(env, actor, 'create_product', 'override_product', id, { name: body.name })
  return jsonResponse({ ok: true, id }, 201)
}

async function createExperiment(env, actor, body) {
  requireOverridePermission(actor, 'create_experiment')
  const required = [
    'clusterId',
    'title',
    'changeTarget',
    'hypothesis',
    'scope',
    'comparator',
    'successMetric',
    'approver',
    'rollbackPlan',
  ]
  const fields = Object.fromEntries(
    required.filter((key) => !text(body[key], 2400)).map((key) => [key, '필수 항목입니다.'])
  )
  const guardrails = list(body.guardrails)
  const stopConditions = list(body.stopConditions)
  if (!guardrails.length) fields.guardrails = '안전 가드레일을 한 개 이상 적어주세요.'
  if (!stopConditions.length) fields.stopConditions = '중단 조건을 한 개 이상 적어주세요.'
  if (Object.keys(fields).length) return failFields(fields)
  const cluster = await env.DB.prepare('SELECT id FROM issue_cluster WHERE id = ?')
    .bind(body.clusterId)
    .first()
  if (!cluster) return jsonError('그 문제 군집을 찾지 못했습니다.', 404)
  const id = newId('olx')
  await env.DB.prepare(
    `INSERT INTO change_experiment
     (id, cluster_id, title, change_target, hypothesis, scope, comparator, success_metric,
      metric_direction, target_improvement, guardrails_json, stop_conditions_json, approver,
      rollback_plan, risk_level, current_phase, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft')`
  )
    .bind(
      id,
      body.clusterId,
      text(body.title, 180),
      text(body.changeTarget, 800),
      text(body.hypothesis, 2000),
      text(body.scope, 800),
      text(body.comparator, 800),
      text(body.successMetric, 400),
      body.metricDirection === 'higher' ? 'higher' : 'lower',
      number(body.targetImprovement, 0, 1000),
      JSON.stringify(guardrails),
      JSON.stringify(stopConditions),
      text(body.approver, 120),
      text(body.rollbackPlan, 2000),
      ['low', 'medium', 'high'].includes(body.riskLevel) ? body.riskLevel : 'medium'
    )
    .run()
  await env.DB.prepare(
    `UPDATE issue_cluster SET status = 'experiment', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(body.clusterId)
    .run()
  await auditOverride(env, actor, 'create_experiment', 'change_experiment', id, {
    cluster_id: body.clusterId,
    risk_level: body.riskLevel,
  })
  return jsonResponse({ ok: true, id }, 201)
}

async function approveExperiment(env, actor, body) {
  requireOverridePermission(actor, 'approve_experiment')
  const experimentId = text(body.experimentId, 100)
  const basis = text(body.basis, 1600)
  if (!basis) return failFields({ basis: '승인 근거를 적어주세요.' })
  const experiment = await env.DB.prepare('SELECT * FROM change_experiment WHERE id = ?')
    .bind(experimentId)
    .first()
  if (!experiment) return jsonError('그 실험을 찾지 못했습니다.', 404)
  if (experiment.risk_level === 'high' && !['policy', 'audit', 'executive'].includes(actor.role)) {
    return jsonError('고위험 실험은 정책·감사·사업 책임자만 승인할 수 있습니다.', 403)
  }
  await env.DB.prepare(
    `UPDATE change_experiment
     SET status = 'approved', approved_by = ?, approved_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`
  )
    .bind(actor.label, experimentId)
    .run()
  await auditOverride(env, actor, 'approve_experiment', 'change_experiment', experimentId, { basis })
  return jsonResponse({ ok: true })
}

async function recordRun(env, actor, body) {
  requireOverridePermission(actor, 'record_run')
  const experimentId = text(body.experimentId, 100)
  const phase = text(body.phase, 40)
  if (!ALLOWED_PHASES.has(phase)) return failFields({ phase: '실험 단계를 선택해주세요.' })
  const experiment = await env.DB.prepare('SELECT * FROM change_experiment WHERE id = ?')
    .bind(experimentId)
    .first()
  if (!experiment) return jsonError('그 실험을 찾지 못했습니다.', 404)
  if (!experiment.approved_at) return jsonError('사람의 승인을 받은 뒤에 실험을 시작할 수 있습니다.', 409)
  if (['expanded', 'rolled_back'].includes(experiment.status)) {
    return jsonError('이미 최종 결정된 실험에는 새 실행을 넣을 수 없습니다.', 409)
  }

  const phaseIndex = EXPERIMENT_PHASES.findIndex((item) => item.key === phase)
  if (phaseIndex > 0) {
    const prior = EXPERIMENT_PHASES[phaseIndex - 1].key
    const passed = await env.DB.prepare(
      `SELECT id FROM experiment_run
       WHERE experiment_id = ? AND phase = ? AND status = 'passed'
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(experimentId, prior)
      .first()
    if (!passed) return jsonError(`${EXPERIMENT_PHASES[phaseIndex - 1].label}를 먼저 통과해야 합니다.`, 409)
  }

  const evaluation = evaluateExperimentRun({
    direction: experiment.metric_direction,
    controlValue: body.controlValue,
    variantValue: body.variantValue,
    targetImprovement: experiment.target_improvement,
    guardrailBreaches: body.guardrailBreaches,
    sampleSize: body.sampleSize,
  })
  const id = newId('olr')
  await env.DB.prepare(
    `INSERT INTO experiment_run
     (id, experiment_id, phase, status, control_value, variant_value, improvement_percent,
      sample_size, guardrail_breaches, cost_before_krw, cost_after_krw, notes, run_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      experimentId,
      phase,
      evaluation.status,
      number(body.controlValue, -1000000000, 1000000000),
      number(body.variantValue, -1000000000, 1000000000),
      evaluation.improvement,
      number(body.sampleSize, 0, 1000000000),
      evaluation.guardrailBreaches,
      number(body.costBefore, 0),
      number(body.costAfter, 0),
      text(body.notes, 2000) || null,
      actor.label
    )
    .run()

  const nextStatus =
    evaluation.status === 'blocked'
      ? 'stopped'
      : ['failed', 'insufficient'].includes(evaluation.status)
        ? 'held'
        : 'running'
  await env.DB.prepare(
    `UPDATE change_experiment
     SET current_phase = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(phase, nextStatus, experimentId)
    .run()
  await env.DB.prepare(
    `UPDATE issue_cluster SET status = 'monitoring', updated_at = datetime('now') WHERE id = ?`
  )
    .bind(experiment.cluster_id)
    .run()
  await auditOverride(env, actor, 'record_run', 'experiment_run', id, {
    experiment_id: experimentId,
    phase,
    status: evaluation.status,
    improvement: evaluation.improvement,
    guardrail_breaches: evaluation.guardrailBreaches,
  })
  return jsonResponse({ ok: true, id, ...evaluation }, 201)
}

async function decideExperiment(env, actor, body) {
  requireOverridePermission(actor, 'decide_experiment')
  const experimentId = text(body.experimentId, 100)
  const decision = text(body.decision, 30)
  const basis = text(body.basis, 2400)
  if (!['expand', 'hold', 'stop', 'rollback'].includes(decision) || !basis) {
    return failFields({ basis: '결정과 근거를 함께 적어주세요.' })
  }
  const experiment = await env.DB.prepare('SELECT * FROM change_experiment WHERE id = ?')
    .bind(experimentId)
    .first()
  if (!experiment) return jsonError('그 실험을 찾지 못했습니다.', 404)
  const { results: runs } = await env.DB.prepare(
    'SELECT * FROM experiment_run WHERE experiment_id = ? ORDER BY created_at'
  )
    .bind(experimentId)
    .all()
  if (decision === 'expand') {
    const gate = canExpandExperiment(experiment, runs)
    if (!gate.ok) {
      return jsonError(
        gate.needsApproval
          ? '고위험 변경 승인이 없습니다.'
          : gate.missing.length
            ? `${gate.missing.join(' · ')} 결과가 필요합니다.`
            : `통과하지 못한 단계가 있습니다: ${gate.blocked.join(' · ')}`,
        409
      )
    }
  }
  if (experiment.risk_level === 'high' && !['policy', 'audit', 'executive'].includes(actor.role)) {
    return jsonError('고위험 변경의 최종 결정은 정책·감사·사업 책임자만 할 수 있습니다.', 403)
  }

  const id = newId('old')
  const snapshot = {
    runs: runs.map((run) => ({
      phase: run.phase,
      status: run.status,
      improvement_percent: run.improvement_percent,
      guardrail_breaches: run.guardrail_breaches,
    })),
    decided_at: new Date().toISOString(),
  }
  await env.DB.prepare(
    `INSERT INTO override_decision_record
     (id, experiment_id, decision, basis, metrics_snapshot_json, decided_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, experimentId, decision, basis, JSON.stringify(snapshot), actor.label)
    .run()

  const statusMap = { expand: 'expanded', hold: 'held', stop: 'stopped', rollback: 'rolled_back' }
  const clusterStatus = decision === 'expand' ? 'monitoring' : decision === 'rollback' ? 'open' : 'experiment'
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE change_experiment
       SET status = ?, current_phase = 'decided', updated_at = datetime('now') WHERE id = ?`
    ).bind(statusMap[decision], experimentId),
    env.DB.prepare(
      `UPDATE issue_cluster SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(clusterStatus, experiment.cluster_id),
  ])
  await auditOverride(env, actor, 'decide_experiment', 'override_decision_record', id, {
    experiment_id: experimentId,
    decision,
    basis,
  })
  return jsonResponse({ ok: true, id })
}

async function recordVolume(env, actor, body) {
  requireOverridePermission(actor, 'record_volume')
  const productId = text(body.productId, 100)
  const measuredOn = text(body.measuredOn, 10)
  const segment = text(body.segment, 120) || '전체'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) {
    return failFields({ measuredOn: '측정일을 YYYY-MM-DD 형식으로 적어주세요.' })
  }
  const totalCases = number(body.totalCases, 0, 1000000000)
  const applicableCases = number(body.applicableCases, 0, totalCases)
  const id = newId('olv')
  await env.DB.prepare(
    `INSERT INTO override_volume
     (id, product_id, measured_on, segment, total_cases, applicable_cases)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, measured_on, segment) DO UPDATE SET
       total_cases = excluded.total_cases, applicable_cases = excluded.applicable_cases`
  )
    .bind(id, productId, measuredOn, segment, totalCases, applicableCases)
    .run()
  await auditOverride(env, actor, 'record_volume', 'override_volume', id, {
    product_id: productId,
    segment,
    total_cases: totalCases,
    applicable_cases: applicableCases,
  })
  return jsonResponse({ ok: true, id })
}

async function saveIntegration(env, actor, body) {
  requireOverridePermission(actor, 'save_integration')
  const endpointUrl = text(body.endpointUrl, 1000)
  const kind = ['mlops', 'policy', 'ticket', 'evaluation', 'webhook'].includes(body.kind)
    ? body.kind
    : null
  const name = text(body.name, 160)
  const secretBinding = text(body.secretBinding, 100) || null
  if (!kind || !name || !isSafeIntegrationUrl(endpointUrl)) {
    return failFields({ endpointUrl: '공개 HTTPS 주소와 연동 종류·이름을 확인해주세요.' })
  }
  if (secretBinding && !/^[A-Z][A-Z0-9_]{2,99}$/.test(secretBinding)) {
    return failFields({ secretBinding: '시크릿 값이 아니라 Cloudflare 바인딩 이름만 적어주세요.' })
  }
  const id = text(body.integrationId, 100) || newId('oli')
  const existing = await env.DB.prepare('SELECT id FROM override_integration WHERE id = ?')
    .bind(id)
    .first()
  if (existing) {
    await env.DB.prepare(
      `UPDATE override_integration
       SET kind = ?, name = ?, endpoint_url = ?, secret_binding = ?, status = 'configured',
           updated_at = datetime('now') WHERE id = ?`
    )
      .bind(kind, name, endpointUrl, secretBinding, id)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO override_integration
       (id, kind, name, endpoint_url, secret_binding, status)
       VALUES (?, ?, ?, ?, ?, 'configured')`
    )
      .bind(id, kind, name, endpointUrl, secretBinding)
      .run()
  }
  await auditOverride(env, actor, 'save_integration', 'override_integration', id, { kind, name })
  return jsonResponse({ ok: true, id })
}

async function integrationPayload(env, integration) {
  if (['mlops', 'evaluation'].includes(integration.kind)) {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.ai_decision, e.human_decision, e.reason_detail, e.model_version,
              e.prompt_version, e.validity, c.cause_code
       FROM override_event e LEFT JOIN issue_cluster c ON c.id = e.cluster_id
       WHERE e.validity = 'valid' AND e.is_override = 1 AND c.cause_code = 'model'
       ORDER BY e.occurred_at DESC LIMIT 200`
    ).all()
    return { kind: 'evaluation_dataset', generated_at: new Date().toISOString(), rows: results }
  }
  if (integration.kind === 'policy') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, cause_code, policy_refs_json, recurrence_count, priority_score
       FROM issue_cluster WHERE cause_code IN ('policy_retrieval', 'policy_gap')
       ORDER BY priority_score DESC LIMIT 200`
    ).all()
    return { kind: 'policy_impact', generated_at: new Date().toISOString(), rows: results }
  }
  const { results } = await env.DB.prepare(
    `SELECT id, title, cause_code, owner_team, priority_score, status
     FROM issue_cluster WHERE status NOT IN ('resolved', 'accepted_exception')
     ORDER BY priority_score DESC LIMIT 200`
  ).all()
  return { kind: integration.kind === 'ticket' ? 'improvement_tickets' : 'override_summary', rows: results }
}

async function syncIntegration(env, actor, body) {
  requireOverridePermission(actor, 'sync_integration')
  const id = text(body.integrationId, 100)
  const integration = await env.DB.prepare('SELECT * FROM override_integration WHERE id = ?')
    .bind(id)
    .first()
  if (!integration) return jsonError('그 연동을 찾지 못했습니다.', 404)
  if (!isSafeIntegrationUrl(integration.endpoint_url)) return jsonError('안전하지 않은 연동 주소입니다.', 400)
  const payload = await integrationPayload(env, integration)
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'OverrideLoop/1.0' }
  if (integration.secret_binding) {
    const secret = env[integration.secret_binding]
    if (!secret) return jsonError('연동용 Cloudflare 시크릿 바인딩이 없습니다.', 409)
    headers.Authorization = `Bearer ${secret}`
  }
  let response
  try {
    response = await fetch(integration.endpoint_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    })
  } catch (error) {
    await env.DB.prepare(
      `UPDATE override_integration
       SET status = 'error', last_sync_at = datetime('now'), last_result = ?,
           updated_at = datetime('now') WHERE id = ?`
    )
      .bind(text(error.message, 180), id)
      .run()
    await auditOverride(env, actor, 'sync_integration_failed', 'override_integration', id, {
      error: text(error.message, 180),
    })
    return jsonError('연동 대상이 요청을 받지 못했습니다.', 502)
  }
  const result = `${response.status} ${response.statusText}`.trim()
  await env.DB.prepare(
    `UPDATE override_integration
     SET status = ?, last_sync_at = datetime('now'), last_result = ?,
         updated_at = datetime('now') WHERE id = ?`
  )
    .bind(response.ok ? 'healthy' : 'error', result, id)
    .run()
  await auditOverride(env, actor, 'sync_integration', 'override_integration', id, {
    kind: integration.kind,
    response_status: response.status,
    row_count: payload.rows?.length ?? 0,
  })
  if (!response.ok) return jsonError(`연동 대상이 ${response.status}로 거절했습니다.`, 502)
  return jsonResponse({ ok: true, result, sent: payload.rows?.length ?? 0 })
}

async function saveActor(env, actor, body) {
  requireOverridePermission(actor, 'save_actor')
  const email = text(body.email, 240).toLowerCase()
  const displayName = text(body.displayName, 80)
  const role = text(body.actorRole, 40)
  if (!/^\S+@\S+\.\S+$/.test(email) || !displayName || !ALLOWED_ROLES.has(role)) {
    return failFields({ email: '메일·이름·역할을 확인해주세요.' })
  }
  await env.DB.prepare(
    `INSERT INTO override_actor (email, display_name, role, active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name,
       role = excluded.role, active = 1, updated_at = datetime('now')`
  )
    .bind(email, displayName, role)
    .run()
  await auditOverride(env, actor, 'save_actor', 'override_actor', email, { role, display_name: displayName })
  return jsonResponse({ ok: true })
}

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }
  try {
    await ensureOverrideSchema(env)
    await seedOverrideWorkspace(env)
    const actor = await resolveOverrideActor(env, request, body)
    const action = text(body.action, 80)
    // 각 작업의 비동기 오류까지 이 try/catch 안에서 JSON 응답으로 바꾼다.
    // await 없이 Promise를 그대로 반환하면 권한 오류 같은 reject가 catch 바깥으로
    // 빠져 Cloudflare가 HTML 500을 만들어 버린다.
    if (action === 'capture_event') return await captureEvent(env, actor, body)
    if (action === 'validate_event') return await validateEvent(env, actor, body)
    if (action === 'update_cluster') return await updateCluster(env, actor, body)
    if (action === 'create_product') return await createProduct(env, actor, body)
    if (action === 'create_experiment') return await createExperiment(env, actor, body)
    if (action === 'approve_experiment') return await approveExperiment(env, actor, body)
    if (action === 'record_run') return await recordRun(env, actor, body)
    if (action === 'decide_experiment') return await decideExperiment(env, actor, body)
    if (action === 'record_volume') return await recordVolume(env, actor, body)
    if (action === 'save_integration') return await saveIntegration(env, actor, body)
    if (action === 'sync_integration') return await syncIntegration(env, actor, body)
    if (action === 'save_actor') return await saveActor(env, actor, body)
    return jsonError('지원하지 않는 작업입니다.', 400)
  } catch (error) {
    if (error?.status) return jsonError(error.message, error.status)
    return failUnexpected(error, 'OverrideLoop 작업을 저장하지 못했습니다.')
  }
}
