import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.ts'
import { newId } from '../_lib/ids.js'
import { integrationConfig } from '../_lib/integrationConfig.js'
import { createFeedbackCase } from '../_lib/fieldFeedback.js'
import { hydrateEvent } from '../_lib/overrideEvents.js'
import { overrideMetrics } from '../_lib/overrideMetrics.js'
import { atomicMutation, mutationFingerprint } from '../_lib/atomicMutation.ts'
import { assertOverrideEditVersion, withOverrideEditVersion } from '../_lib/overrideEditVersion.js'
import { isAccessAdmin, scopeEnvironment } from '../_lib/authorization.js'
import { assertClusterClosable } from '../_lib/issueWorkflow.js'
import { validDate } from '../../shared/fieldFeedback.js'
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
  experimentRunTimingError,
  validEvaluationPlan,
  priorityBand,
  priorityScore,
  recommendCluster,
  safeJson,
  suggestCauses,
  roleCan,
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

const optionalNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => value == null || value === '' ? null : number(value,min,max)

function list(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 500)).filter(Boolean)
  return text(value, 3000)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
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
  const utc = value => { const normalized = String(value).replace(' ', 'T'); return /(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : normalized+'Z' }
  const a = new Date(utc(start)).getTime()
  const b = new Date(utc(end)).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round(((b - a) / 86400000) * 10) / 10
}

function average(values) {
  const usable = values.filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite)
  if (usable.length === 0) return null
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10
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
        title: `${experiment.title} 중단 판정 기록`,
        body: `${blocked.phase}에서 가드레일 ${blocked.guardrail_breaches}건을 위반했습니다.`,
        entity_id: experiment.id,
      })
    }
  }
  return alerts
}

function accountRow(row) {
  return { email:row.email, display_name:row.display_name, role:row.role, active:Number(row.active) === 1,
    departments:safeJson(row.departments_json,[]), product_ids:safeJson(row.product_ids_json,[]), edit_version:row.edit_version }
}

function accountCanHandle(account, product) {
  return account.active && roleCan(account.role,'update_cluster') && (isAccessAdmin(account)
    || account.product_ids.includes(product.id) || account.departments.includes(product.owner_team))
}

async function assignmentDirectory(env, actor, products) {
  if (actor.role === 'reviewer') return {candidates:[],actors:[]}
  const rows = (await (env.UNSCOPED_DB ?? env.DB).prepare('SELECT email,display_name,role,active,departments_json,product_ids_json FROM override_actor ORDER BY display_name,email').all()).results
  const accounts = await Promise.all(rows.map(async row => accountRow(await withOverrideEditVersion('actor', row))))
  return {actors:isAccessAdmin(actor) ? accounts : [], candidates:accounts
    .filter(account=>account.active && roleCan(account.role,'update_cluster') && (isAccessAdmin(actor) || products.some(product=>accountCanHandle(account,product))))
    .map(account=>({email:account.email,label:account.display_name,departments:account.departments,product_ids:account.product_ids}))}
}

async function allowedAssignee(env, email, cluster) {
  if (overrideDemoMode(env)) return null
  const directory = env.UNSCOPED_DB ?? env.DB
  const row = await directory.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json FROM override_actor WHERE email=?').bind(email).first()
  if (!row) return null
  const products = (await env.DB.prepare('SELECT * FROM override_product WHERE id=?').bind(cluster.scope_product_id).all()).results
  return products.some(product=>accountCanHandle(accountRow(row),product)) ? row : null
}

async function acknowledgeCluster(env, actor, body) {
  const cluster = await env.DB.prepare('SELECT * FROM issue_cluster WHERE id=?').bind(text(body.clusterId,100)).first()
  if (!cluster) return jsonError('그 문제를 찾지 못했습니다.',404)
  const mine = overrideDemoMode(env) ? cluster.assignee_email === 'demo-owner@ilson.invalid' && roleCan(actor.role,'update_cluster') : cluster.assignee_email === actor.email
  if (!mine) return jsonError('배정된 담당자만 접수를 확인할 수 있습니다.',403)
  if (!cluster.acknowledged_at) {
    await env.DB.prepare("UPDATE issue_cluster SET acknowledged_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(cluster.id).run()
    await auditOverride(env,actor,'acknowledge_cluster','issue_cluster',cluster.id,{})
  }
  return jsonResponse({ok:true})
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
      env.DB.prepare('SELECT * FROM experiment_run ORDER BY run_sequence').all(),
      env.DB.prepare('SELECT * FROM override_decision_record ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT * FROM override_volume ORDER BY measured_on DESC').all(),
      env.DB.prepare('SELECT * FROM override_integration ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT * FROM override_audit ORDER BY created_at DESC LIMIT 160').all(),
      env.DB.prepare('SELECT * FROM override_ai_call ORDER BY created_at DESC LIMIT 80').all(),
    ])

  const products = productRows.results ?? []
  const events = await Promise.all((eventRows.results ?? []).map(async row => hydrateEvent(await withOverrideEditVersion('event', row))))
  const rawClusters = await Promise.all((clusterRows.results ?? []).map(async row => hydrateCluster(await withOverrideEditVersion('cluster', row))))
  const runs = runRows.results ?? []
  const decisions = decisionRows.results ?? []
  const experiments = await Promise.all((experimentRows.results ?? []).map(async row =>
    hydrateExperiment(await withOverrideEditVersion('experiment', row), runs, decisions)
  ))
  const volumes = await Promise.all((volumeRows.results ?? []).map(row => withOverrideEditVersion('volume', row)))

  const analytics = await overrideMetrics(env.DB, products)
  const clusters = rawClusters.map(cluster => ({ ...cluster,
    recurrence_count:analytics.clusterCounts.get(cluster.id)||0,
    visible_event_count:analytics.clusterVisibility.get(cluster.id)?.total || 0,
    trend: analytics.trends.get(cluster.id) }))
  const confirmedClusters = clusters.filter(cluster => cluster.cause_confirmed_at)

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
    integrations: await Promise.all((integrationRows.results ?? []).map(row => withOverrideEditVersion('integration', row))),
    audit: (auditRows.results ?? []).map((row) => ({ ...row, detail: safeJson(row.detail_json, {}) })),
    ai_calls: aiRows.results ?? [],
    fairness: analytics.fairness,
    policy_impact: analytics.policy_impact,
    common_issues: analytics.common_issues,
    graph: buildGraph(products, analytics.edges, clusters, experiments, decisions),
    event_list: { limit: 500, total: analytics.metrics.total_decisions, truncated: analytics.metrics.total_decisions > events.length },
    execution: { mode: overrideDemoMode(env) ? 'simulation' : 'manual_evidence', external_rollout: false },
    metrics: {
      ...analytics.metrics,
      totals_scope: overrideDemoMode(env) ? analytics.metrics.totals_scope : '계정에 열람이 허용된 전체 이력 · 유효 판정만 수정 사건에 포함',
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
    },
  }
  workspace.alerts = buildAlerts(clusters, experiments)
  return workspace
}

export async function onRequestGet({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  try {
    await ensureOverrideSchema(env)
    await seedOverrideWorkspace(env)
    const actor = await resolveOverrideActor(env, request)
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.',401)
    if (!overrideDemoMode(env)) env = scopeEnvironment(env, actor)
    const params = new URL(request?.url ?? 'https://ilson.invalid/api/override').searchParams
    if (params.has('editKind')) {
      const kind = params.get('editKind')
      const tables = { cluster:'issue_cluster', event:'override_event', experiment:'change_experiment', integration:'override_integration', actor:'override_actor', volume:'override_volume' }
      if (!Object.hasOwn(tables, kind)) return jsonError('조회할 자료 종류를 확인해주세요.',400)
      if (kind === 'actor' && !isAccessAdmin(actor)) return jsonError('계정 설정은 관리자만 조회할 수 있습니다.',403)
      let row
      if (kind === 'volume') {
        row = await env.DB.prepare('SELECT * FROM override_volume WHERE product_id=? AND measured_on=? AND segment=?')
          .bind(text(params.get('productId'),100),text(params.get('measuredOn'),10),text(params.get('segment'),120) || '전체').first()
      } else {
        const id = text(params.get('editId'), kind === 'actor' ? 240 : 100)
        if (!id) return jsonError('조회할 자료 번호를 확인해주세요.',400)
        row = await env.DB.prepare(`SELECT * FROM ${tables[kind]} WHERE ${kind === 'actor' ? 'email' : 'id'}=?`).bind(id).first()
      }
      if (!row) return jsonError('현재 권한으로 이 자료를 찾을 수 없습니다.',404)
      const versioned = await withOverrideEditVersion(kind, row)
      const entity = kind === 'actor' ? accountRow(versioned) : kind === 'event' ? hydrateEvent(versioned) : kind === 'cluster' ? hydrateCluster(versioned)
        : kind === 'experiment' ? hydrateExperiment(versioned,
          (await env.DB.prepare('SELECT * FROM experiment_run WHERE experiment_id=? ORDER BY run_sequence').bind(row.id).all()).results,
          (await env.DB.prepare('SELECT * FROM override_decision_record WHERE experiment_id=? ORDER BY created_at').bind(row.id).all()).results) : versioned
      return jsonResponse({ entity })
    }
    const workspace = await loadWorkspace(env)
    if (!overrideDemoMode(env)) {
      workspace.current_actor = {role:actor.role,label:actor.label,email:actor.email,is_admin:isAccessAdmin(actor)}
      // A product name is enough for the first report; no other team's metadata is exposed.
      workspace.capture_products = (await env.UNSCOPED_DB.prepare('SELECT id, name FROM override_product ORDER BY name').all()).results
      const directory = await assignmentDirectory(env, actor, workspace.products)
      workspace.assignment_candidates = directory.candidates
      workspace.actors = directory.actors
    } else {
      workspace.assignment_candidates = [{email:'demo-owner@ilson.invalid',label:'시연 담당자',departments:[],product_ids:workspace.products.map(item=>item.id)}]
      workspace.actors = []
    }
    return jsonResponse(workspace)
  } catch (error) {
    return failUnexpected(error, 'OverrideLoop 운영 자료를 불러오지 못했습니다.')
  }
}

async function refreshCluster(env, clusterId) {
  if (!clusterId) return
  // Runs after the event write, in the same transaction; no read of staged data.
  // Real users have row-limited event visibility. The protected database helper
  // checks issue access and aggregates every valid event without revealing them.
  const aggregate = env.DB.actorEmail
    ? 'SELECT * FROM ilson_private.scope_cluster_totals(?)'
    : `SELECT count(*) AS n, avg(customer_impact_score) AS customer,
       sum(operations_cost_krw) AS cost, max(regulatory_risk_score) AS regulation,
       min(occurred_at) AS first_seen,max(occurred_at) AS last_seen FROM override_event
       WHERE cluster_id=? AND is_override=1 AND validity='valid'`
  await env.DB.prepare(
    `UPDATE issue_cluster
     SET recurrence_count = s.n, customer_impact_score = s.customer,
         operations_cost_krw = s.cost, regulatory_risk_score = s.regulation,
         priority_score = round((least(5,greatest(0,s.customer))*5
           + least(5,greatest(0,s.regulation))*6
           + least(1,ln(s.n+1)/ln(2)/5)*25
           + least(1,log((greatest(0,s.cost)+1)::numeric)/6)*20)::numeric,1),
         first_seen_at = coalesce(s.first_seen,first_seen_at),
         last_seen_at = coalesce(s.last_seen,last_seen_at), updated_at = datetime('now')
     FROM (${aggregate}) s WHERE id=?`
  )
    .bind(clusterId, clusterId)
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
  const reviewerLabel = text(actor.mode === 'access' ? actor.label : body.reviewerLabel || actor.label, 60)
  if (!productId) fields.productId = 'AI 제품을 선택해주세요.'
  if (!ALLOWED_ACTIONS.has(decisionAction)) fields.decisionAction = '최종 판단을 선택해주세요.'
  if (!aiDecision) fields.aiDecision = 'AI의 원래 판단을 적어주세요.'
  if (!humanDecision) fields.humanDecision = '사람의 최종 판단을 적어주세요.'
  if (!reasonDetail) fields.reasonDetail = '판단을 확인할 수 있는 이유를 적어주세요.'
  if (!reviewerLabel) fields.reviewerLabel = '검토자를 적어주세요.'
  if (Object.keys(fields).length) return failFields(fields)

  const productDb = actor.mode === 'access' && actor.role === 'reviewer' ? env.UNSCOPED_DB : env.DB
  const product = await productDb.prepare('SELECT id, domain, model_version, prompt_version, agent_version, tool_version FROM override_product WHERE id = ?')
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
    const { results: openClusters } = actor.mode === 'access' && actor.role === 'reviewer' ? {results:[]} : await env.DB.prepare(
      `SELECT * FROM issue_cluster WHERE status NOT IN ('resolved', 'accepted_exception') ORDER BY id`
    ).all()
    const hydrated = (openClusters ?? []).filter(item => overrideDemoMode(env) || item.scope_product_id === productId).map(hydrateCluster)
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
          priority_score, status, scope_product_id, created_by_email)
         VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, 'open', ?, ?)`
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
          optionalNumber(body.customerImpact, 0, 5),
          optionalNumber(body.operationsCost, 0),
          optionalNumber(body.regulatoryRisk, 0, 5),
          owner,
          initialPriority,
          productId,
          actor.email
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
        business_outcome, recording_seconds, validity, validity_reason, reporter_email)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        optionalNumber(body.customerImpact, 0, 5),
        optionalNumber(body.operationsCost, 0),
        optionalNumber(body.regulatoryRisk, 0, 5),
        text(body.customerOutcome, 1200) || null,
        text(body.businessOutcome, 1200) || null,
        optionalNumber(body.recordingSeconds, 0, 3600),
        action.isOverride ? 'pending' : 'valid',
        action.isOverride ? null : 'AI 판단 승인',
        actor.email
      )
      .run()
  } catch (error) {
    if (externalRef && /unique|duplicate/i.test(String(error.message))) {
      return jsonError('같은 외부 사건 번호가 이미 저장되어 있습니다.', 409)
    }
    throw error
  }

  if (action.isOverride) await createFeedbackCase(env,actor,id)
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
  const event = await env.DB.prepare('SELECT * FROM override_event WHERE id = ?')
    .bind(eventId)
    .first()
  if (!event) return jsonError('그 수정 사건을 찾지 못했습니다.', 404)
  await assertOverrideEditVersion('event', event, body.expectedVersion)
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
  await assertOverrideEditVersion('cluster', cluster, body.expectedVersion)
  const causeCode = ALLOWED_CAUSES.has(body.causeCode) ? body.causeCode : cluster.cause_code
  const causeStatus = ['candidate', 'confirmed', 'disputed'].includes(body.causeStatus)
    ? body.causeStatus
    : cluster.cause_status
  const ownerTeam = text(body.ownerTeam, 120) || causeByKey(causeCode).owner
  const reason = text(body.reason, 1600)
  if (!reason) return failFields({ reason: '원인 판정 또는 배정의 근거를 적어주세요.' })
  const customer = optionalNumber(Object.hasOwn(body,'customerImpact') ? body.customerImpact : cluster.customer_impact_score, 0, 5)
  const cost = optionalNumber(Object.hasOwn(body,'operationsCost') ? body.operationsCost : cluster.operations_cost_krw, 0)
  const regulation = optionalNumber(Object.hasOwn(body,'regulatoryRisk') ? body.regulatoryRisk : cluster.regulatory_risk_score, 0, 5)
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
  await assertClusterClosable(env.DB, clusterId, status)
  const assigneeEmail = Object.hasOwn(body, 'assigneeEmail') ? text(body.assigneeEmail,240).toLowerCase() || null : cluster.assignee_email
  const nextResponseOn = Object.hasOwn(body, 'nextResponseOn') ? text(body.nextResponseOn,10) || null : cluster.next_response_on
  if (nextResponseOn && !validDate(nextResponseOn)) return failFields({nextResponseOn:'올바른 회신 날짜를 선택해주세요.'})
  if (assigneeEmail && !nextResponseOn) return failFields({nextResponseOn:'담당자를 배정할 때 다음 회신일을 지정해주세요.'})
  if (!assigneeEmail && nextResponseOn) return failFields({assigneeEmail:'회신할 담당자를 먼저 선택해주세요.'})
  let assigneeLabel = null
  if (assigneeEmail) {
    const candidate = overrideDemoMode(env) && assigneeEmail === 'demo-owner@ilson.invalid'
      ? {display_name:'시연 담당자'} : await allowedAssignee(env, assigneeEmail, cluster)
    if (!candidate) return failFields({assigneeEmail:'이 문제를 처리할 권한이 있는 활성 담당자를 선택해주세요.'})
    assigneeLabel = candidate.display_name
  }
  const reassigned = assigneeEmail !== (cluster.assignee_email || null)
  await env.DB.prepare(
    `UPDATE issue_cluster
     SET title = ?, summary = ?, cause_code = ?, cause_status = ?, owner_team = ?,
         customer_impact_score = ?, operations_cost_krw = ?, regulatory_risk_score = ?,
         priority_score = ?, status = ?, cause_confirmed_at = ?, assignee_email = ?, assignee_label = ?,
         assigned_at = ?, acknowledged_at = ?, next_response_on = ?, updated_at = datetime('now')
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
      assigneeEmail, assigneeLabel,
      assigneeEmail ? (reassigned ? new Date().toISOString() : cluster.assigned_at) : null,
      reassigned || !assigneeEmail ? null : cluster.acknowledged_at,
      nextResponseOn,
      clusterId
    )
    .run()
  await auditOverride(env, actor, 'update_cluster', 'issue_cluster', clusterId, {
    cause_code: causeCode,
    owner_team: ownerTeam,
    priority_score: score,
    reason,
    assignee_email: assigneeEmail, next_response_on: nextResponseOn,
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
  const plan = body.evaluationPlan
  if (!validEvaluationPlan(plan)) fields.evaluationPlan = '지표 종류·단계별 최소 표본·측정 기간·선정 근거·데이터/모델/정책 버전을 모두 정해주세요.'
  if (!['number','string'].includes(typeof body.targetImprovement) || !Number.isFinite(Number(body.targetImprovement)) || String(body.targetImprovement ?? '').trim() === '' || Number(body.targetImprovement)<=0) fields.targetImprovement = '목표 개선율은 0보다 큰 유한한 숫자여야 합니다.'
  if (!guardrails.length) fields.guardrails = '안전 가드레일을 한 개 이상 적어주세요.'
  if (!stopConditions.length) fields.stopConditions = '중단 조건을 한 개 이상 적어주세요.'
  if (Object.keys(fields).length) return failFields(fields)
  const cluster = await env.DB.prepare('SELECT * FROM issue_cluster WHERE id = ?')
    .bind(body.clusterId)
    .first()
  if (!cluster) return jsonError('그 문제 군집을 찾지 못했습니다.', 404)
  await assertOverrideEditVersion('cluster', cluster, body.expectedVersion)
  const id = newId('olx')
  await env.DB.prepare(
    `INSERT INTO change_experiment
     (id, cluster_id, title, change_target, hypothesis, scope, comparator, success_metric,
      metric_direction, target_improvement, guardrails_json, stop_conditions_json, approver,
      rollback_plan, risk_level, current_phase, status, evaluation_plan_json, change_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft', ?, ?)`
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
      Number(body.targetImprovement),
      JSON.stringify(guardrails),
      JSON.stringify(stopConditions),
      text(body.approver, 120),
      text(body.rollbackPlan, 2000),
      ['low', 'medium', 'high'].includes(body.riskLevel) ? body.riskLevel : 'medium',
      JSON.stringify(plan), newId('version')
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
  await assertOverrideEditVersion('experiment', experiment, body.expectedVersion)
  if (!['draft','held','stopped'].includes(experiment.status)) return jsonError('초안·보류·중단 상태에서만 새 시험 주기를 승인할 수 있습니다. 종료된 실험은 새 실험으로 이어주세요.', 409)
  if (!validEvaluationPlan(safeJson(experiment.evaluation_plan_json))) return jsonError('사전 측정 계획이 없는 기존 실험입니다. 계획과 원본 버전을 지정한 후속 실험을 만들어주세요.', 409)
  if (experiment.risk_level === 'high' && !['policy', 'audit', 'executive'].includes(actor.role)) {
    return jsonError('고위험 실험은 정책·감사·사업 책임자만 승인할 수 있습니다.', 403)
  }
  await env.DB.prepare(
    `UPDATE change_experiment
     SET status = 'approved', approved_by = ?, approved_at = datetime('now'), approval_id = ?, current_phase = 'draft',
         updated_at = datetime('now'), mutation_version = mutation_version + 1 WHERE id = ?`
  )
    .bind(actor.label, newId('approval'), experimentId)
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
  await assertOverrideEditVersion('experiment', experiment, body.expectedVersion)
  if (!experiment.approved_at || !experiment.approval_id || !['approved','running'].includes(experiment.status)) return jsonError('현재 상태에서는 결과를 추가할 수 없습니다. 중단·보류 후에는 새 시험 주기 승인이 필요합니다.', 409)
  const plan = safeJson(experiment.evaluation_plan_json)
  if (!validEvaluationPlan(plan)) return jsonError('사전 측정 계획이 없습니다. 새 실험을 작성해주세요.', 409)
  if (['controlValue','variantValue','sampleSize','guardrailBreaches'].some(key => !['number','string'].includes(typeof body[key]) || String(body[key]).trim()==='')) return failFields({ sampleSize: '측정값·표본·위반 건수를 모두 입력해주세요.' })
  const evidence = list(body.evidenceRefs)
  const start = Date.parse(body.measurementStart), end = Date.parse(body.measurementEnd)
  if (!evidence.length || !Number.isFinite(start) || !Number.isFinite(end) || end > Date.now()
      || (end-start)/1000 < plan.minimumWindowSeconds) return failFields({ evidenceRefs: '원본 실행·데이터 근거와 사전에 정한 기간 이상의 측정 시작·종료 시각이 필요합니다.' })
  if (['rate','count'].includes(plan.metricType) && [body.controlValue,body.variantValue].some(value =>
      plan.metricType === 'rate' ? Number(value)>100 : !Number.isSafeInteger(Number(value)))) return failFields({ controlValue: '비율은 0~100, 건수는 0 이상의 정수로 입력해주세요.' })

  const phaseIndex = EXPERIMENT_PHASES.findIndex((item) => item.key === phase)
  let previousRun = null
  if (phaseIndex > 0) {
    const prior = EXPERIMENT_PHASES[phaseIndex - 1].key
    const passed = await env.DB.prepare(
      `SELECT id,status,measurement_end FROM experiment_run
       WHERE experiment_id = ? AND phase = ? AND approval_id = ? AND change_version = ?
       ORDER BY run_sequence DESC LIMIT 1`
    )
      .bind(experimentId, prior, experiment.approval_id, experiment.change_version)
      .first()
    if (passed?.status !== 'passed') return jsonError(`현재 승인 주기의 최신 ${EXPERIMENT_PHASES[phaseIndex - 1].label}를 먼저 통과해야 합니다.`, 409)
    previousRun = passed
  }
  const timingError = experimentRunTimingError(experiment, {phase,measurement_start:new Date(start).toISOString(),measurement_end:new Date(end).toISOString()}, previousRun)
  if (timingError) return failFields({measurementStart:timingError})
  const laterPhases = EXPERIMENT_PHASES.slice(phaseIndex+1).map(item=>item.key)
  const later = laterPhases.length ? await env.DB.prepare('SELECT id FROM experiment_run WHERE experiment_id=? AND approval_id=? AND phase IN (' + laterPhases.map(()=>'?').join(',') + ') LIMIT 1')
    .bind(experimentId, experiment.approval_id, ...laterPhases).first() : null
  if (later) return jsonError('후속 단계가 있는 상태에서 이전 결과를 덮어쓸 수 없습니다. 실험을 보류한 뒤 새 시험 주기를 승인해주세요.', 409)

  const evaluation = evaluateExperimentRun({
    direction: experiment.metric_direction,
    controlValue: body.controlValue,
    variantValue: body.variantValue,
    targetImprovement: experiment.target_improvement,
    guardrailBreaches: body.guardrailBreaches,
    sampleSize: body.sampleSize,
    minimumSample: plan.minimumSamples[phase],
  })
  if (evaluation.status === 'invalid') return failFields({ sampleSize: '측정값과 표본·위반 건수를 올바른 숫자로 입력해주세요.' })
  const id = newId('olr')
  await env.DB.prepare(
    `INSERT INTO experiment_run
     (id, experiment_id, phase, status, control_value, variant_value, improvement_percent,
      sample_size, guardrail_breaches, cost_before_krw, cost_after_krw, notes, run_by,
      change_version, approval_id, evidence_refs_json, measurement_start, measurement_end, source_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
  )
    .bind(
      id,
      experimentId,
      phase,
      evaluation.status,
      Number(body.controlValue),
      Number(body.variantValue),
      evaluation.improvement,
      Number(body.sampleSize),
      evaluation.guardrailBreaches,
      number(body.costBefore, 0),
      number(body.costAfter, 0),
      text(body.notes, 2000) || null,
      actor.label, experiment.change_version, experiment.approval_id, JSON.stringify(evidence),
      new Date(start).toISOString(), new Date(end).toISOString()
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
     SET current_phase = ?, status = ?, updated_at = datetime('now'), mutation_version = mutation_version + 1 WHERE id = ?`
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
  await assertOverrideEditVersion('experiment', experiment, body.expectedVersion)
  const { results: runs } = await env.DB.prepare(
    'SELECT * FROM experiment_run WHERE experiment_id = ? ORDER BY run_sequence'
  )
    .bind(experimentId)
    .all()
  if (decision === 'expand') {
    const gate = canExpandExperiment(experiment, runs)
    if (!gate.ok) {
      return jsonError(
        !gate.stateAllowed ? '현재 상태에서 확대 결정을 내릴 수 없습니다.' : gate.needsPlan ? '사전 측정 계획이 없습니다.' : gate.needsApproval
          ? '고위험 변경 승인이 없습니다.'
          : gate.missing.length
            ? `${gate.missing.join(' · ')} 결과가 필요합니다.`
            : gate.timingIssues.length ? `측정 시간 근거를 다시 확인해주세요: ${gate.timingIssues.map(issue=>`${issue.phase} · ${issue.reason}`).join(' / ')}`
              : `통과하지 못한 단계가 있습니다: ${gate.blocked.join(' · ')}`,
        409
      )
    }
  }
  if (experiment.status === 'rolled_back' || (experiment.status === 'expanded' && decision !== 'rollback')) return jsonError('이미 종료된 실험입니다. 확대 후에는 기존 근거를 보존하는 새 롤백 결정만 기록할 수 있습니다.', 409)
  if (experiment.risk_level === 'high' && !['policy', 'audit', 'executive'].includes(actor.role)) {
    return jsonError('고위험 변경의 최종 결정은 정책·감사·사업 책임자만 할 수 있습니다.', 403)
  }

  const id = newId('old')
  const snapshot = {
    approval_id: experiment.approval_id,
    change_version: experiment.change_version,
    evaluation_plan: safeJson(experiment.evaluation_plan_json),
    target_improvement: experiment.target_improvement,
    metric_direction: experiment.metric_direction,
    guardrails: safeJson(experiment.guardrails_json,[]),
    runs: runs.filter(run=>run.approval_id === experiment.approval_id && run.change_version === experiment.change_version).map((run) => ({
      id: run.id,
      phase: run.phase,
      status: run.status,
      sample_size: run.sample_size,
      control_value: run.control_value,
      variant_value: run.variant_value,
      improvement_percent: run.improvement_percent,
      guardrail_breaches: run.guardrail_breaches,
      evidence_refs: safeJson(run.evidence_refs_json,[]),
      measurement_start: run.measurement_start,
      measurement_end: run.measurement_end,
      source_kind: run.source_kind,
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
       SET status = ?, current_phase = 'decided', updated_at = datetime('now'), mutation_version = mutation_version + 1 WHERE id = ?`
    ).bind(statusMap[decision], experimentId),
    env.DB.prepare(
      `UPDATE issue_cluster SET acknowledged_at=CASE WHEN status IN ('resolved','accepted_exception') AND ?='open' THEN NULL ELSE acknowledged_at END,
       status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(clusterStatus, clusterStatus, experiment.cluster_id),
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn) || !Number.isFinite(Date.parse(measuredOn)) || new Date(measuredOn).toISOString().slice(0,10)!==measuredOn || measuredOn>new Date().toISOString().slice(0,10)) {
    return failFields({ measuredOn: '측정일을 YYYY-MM-DD 형식으로 적어주세요.' })
  }
  const totalCases = Number(body.totalCases), applicableCases = Number(body.applicableCases)
  if ([body.totalCases,body.applicableCases].some(value=>!['number','string'].includes(typeof value) || String(value).trim()==='') || !Number.isSafeInteger(totalCases) || !Number.isSafeInteger(applicableCases) || totalCases<0 || applicableCases<0 || applicableCases>totalCases) return failFields({ applicableCases:'전체·적용 가능 건수는 0 이상의 정수이며 적용 가능 건수가 전체를 초과할 수 없습니다.' })
  const product = await env.DB.prepare('SELECT id FROM override_product WHERE id=?').bind(productId).first()
  if (!product) return jsonError('그 제품을 찾지 못했습니다.',404)
  const existingRows = (await env.DB.prepare('SELECT * FROM override_volume WHERE product_id=? AND measured_on=? ORDER BY id').bind(productId,measuredOn).all()).results
  if (existingRows.some(row=>row.segment!==segment && (row.segment==='전체' || segment==='전체'))) return failFields({segment:'같은 제품·날짜에 전체와 세부 고객군의 분모를 중복 등록할 수 없습니다.'})
  const existing = existingRows.find(row=>row.segment===segment)
  if (existing) await assertOverrideEditVersion('volume', existing, body.expectedVersion)
  const id = existing?.id || newId('olv')
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
  if (secretBinding && !/^OVERRIDE_INTEGRATION_[A-Z0-9_]+_TOKEN$/.test(secretBinding)) {
    return failFields({ secretBinding: '시크릿 값이 아니라 Cloudflare 바인딩 이름만 적어주세요.' })
  }
  if (!overrideDemoMode(env) && !integrationConfig(env, { kind, endpoint_url: endpointUrl, secret_binding: secretBinding })) {
    return failFields({ endpointUrl: '서버에서 허용한 주소·전용 자격 증명·중복 방지 지원 설정과 일치해야 합니다.' })
  }
  const id = text(body.integrationId, 100) || newId('oli')
  const existing = await env.DB.prepare('SELECT * FROM override_integration WHERE id = ?')
    .bind(id)
    .first()
  if (existing) {
    await assertOverrideEditVersion('integration', existing, body.expectedVersion)
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

async function syncIntegration(env, actor, body, requestId, fingerprint) {
  requireOverridePermission(actor, 'sync_integration')
  const prior = await env.DB.mutationReceipt(requestId, fingerprint)
  if (prior) return Response.json(prior.body, { status: prior.status })
  const intentKey = 'intent_' + await mutationFingerprint(requestId)
  const intent = await atomicMutation(env.DB, intentKey, fingerprint, async DB => {
    const scoped = { ...env, DB }
    const integration = await DB.prepare('SELECT * FROM override_integration WHERE id = ?').bind(text(body.integrationId,100)).first()
    if (!integration) return jsonError('그 연동을 찾지 못했습니다.',404)
    if (!integrationConfig(env,integration)) return jsonError('허용된 연동 설정과 중복 방지 계약이 필요합니다.',409)
    const payload = await integrationPayload(scoped,integration)
    await auditOverride(scoped,actor,'sync_integration_requested','override_integration',integration.id,{ request_id: requestId, row_count: payload.rows.length })
    return jsonResponse({ integration, payload })
  })
  if (!intent.ok) return intent
  const { integration, payload } = await intent.json()
  const config = integrationConfig(env,integration)
  if (!config) return jsonError('연동 설정이 변경되었습니다. 관리자 확인이 필요합니다.',409)
  let status = 0, ok = false
  try {
    const response = await fetch(config.endpointUrl, { method:'POST', redirect:'manual', signal:AbortSignal.timeout(12000),
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${env[config.secretBinding]}`, 'Idempotency-Key':requestId },
      body:JSON.stringify(payload) })
    status = response.status; ok = response.ok
  } catch { /* The durable intent remains. Retrying uses the identical remote idempotency key. */ }
  if (!status) return jsonError('외부 전송 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.',502)
  // A temporary rejection is not a completed operation. Keep the durable intent
  // and its original payload/key, but allow the next user retry to reach the provider.
  if ([408, 425, 429].includes(status) || status >= 500) {
    return jsonError(`연동 대상의 일시 오류(${status})입니다. 잠시 후 같은 요청으로 다시 시도해주세요.`, 503)
  }
  return atomicMutation(env.DB,requestId,fingerprint,async DB => {
    await DB.prepare(`UPDATE override_integration SET status=?,last_sync_at=datetime('now'),last_result=?,updated_at=datetime('now') WHERE id=?`)
      .bind(ok?'healthy':'error',String(status),integration.id).run()
    await auditOverride({...env,DB},actor,ok?'sync_integration':'sync_integration_failed','override_integration',integration.id,
      {request_id:requestId,response_status:status,row_count:payload.rows.length})
    return ok ? jsonResponse({ok:true,result:String(status),sent:payload.rows.length}) : jsonError(`연동 대상이 ${status}로 거절했습니다.`,502)
  },{commitError:true})
}

async function saveActor(env, actor, body) {
  requireOverridePermission(actor, 'save_actor')
  const email = text(body.email, 240).toLowerCase()
  const displayName = text(body.displayName, 80)
  const role = text(body.actorRole, 40)
  if (!/^\S+@\S+\.\S+$/.test(email) || !displayName || !ALLOWED_ROLES.has(role)) {
    return failFields({ email: '메일·이름·역할을 확인해주세요.' })
  }
  const previous = await env.DB.prepare('SELECT * FROM override_actor WHERE email=?').bind(email).first()
  if (previous) await assertOverrideEditVersion('actor', previous, body.expectedVersion)
  const active = Object.hasOwn(body,'active') ? body.active : previous ? Number(previous.active) === 1 : true
  if (typeof active !== 'boolean') return failFields({active:'계정 활성 여부를 확인해주세요.'})
  const departments = body.departments ?? safeJson(previous?.departments_json,[])
  const productIds = body.productIds ?? safeJson(previous?.product_ids_json,[])
  const validScope = (values,max) => Array.isArray(values) && values.length<=50 && values.every(value=>typeof value==='string' && value.trim().length>0 && value.trim().length<=max)
  if (!validScope(departments,120) || !validScope(productIds,100)) return failFields({departments:'담당 부서와 제품을 올바르게 선택해주세요.'})
  const uniqueDepts = [...new Set(departments.map(value=>value.trim()))]
  const uniqueProducts = [...new Set(productIds.map(value=>value.trim()))]
  if (uniqueProducts.length) {
    const actual = await env.DB.prepare(`SELECT id FROM override_product WHERE id IN (${uniqueProducts.map(()=>'?').join(',')})`).bind(...uniqueProducts).all()
    if (actual.results.length !== uniqueProducts.length) return failFields({productIds:'존재하는 제품을 선택해주세요.'})
  }
  if (actor.email === email && (!active || !['audit','executive'].includes(role))) return jsonError('자신의 관리자 권한을 제거할 수 없습니다. 다른 관리자가 처리해야 합니다.',409)
  if (previous && Number(previous.active) === 1 && isAccessAdmin(previous) && (!active || !['audit','executive'].includes(role))) {
    const admins = await env.DB.prepare("SELECT email FROM override_actor WHERE active=1 AND role IN ('audit','executive') ORDER BY email").all()
    if (admins.results.length <= 1) return jsonError('마지막 활성 관리자 계정은 비활성화할 수 없습니다.',409)
  }
  await env.DB.prepare(
    `INSERT INTO override_actor (email, display_name, role, active, departments_json, product_ids_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name,
       role = excluded.role, active = excluded.active, departments_json=excluded.departments_json,
       product_ids_json=excluded.product_ids_json, updated_at = datetime('now')`
  )
    .bind(email, displayName, role, active?1:0, JSON.stringify(uniqueDepts),JSON.stringify(uniqueProducts))
    .run()
  await auditOverride(env, actor, 'save_actor', 'override_actor', email, { role, active, display_name: displayName, departments:uniqueDepts, product_ids:uniqueProducts })
  return jsonResponse({ ok: true })
}

export async function onRequestPost({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
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
    if (!actor) return jsonError('인증된 사내 계정이 필요합니다.',401)
    if (!overrideDemoMode(env)) env = scopeEnvironment(env, actor)
    const action = text(body.action, 80)
    if (overrideDemoMode(env) && ['sync_integration', 'save_actor'].includes(action)) {
      return jsonError('개인 체험에서는 외부 전송과 실제 계정 설정을 실행하지 않습니다.', 403)
    }
    const suppliedId = request.headers.get('X-Idempotency-Key')
    if (!overrideDemoMode(env) && !suppliedId) return jsonError('중복 방지 요청 번호가 필요합니다.',400)
    const requestId = suppliedId || crypto.randomUUID()
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('요청 식별자가 올바르지 않습니다.', 400)
    const fingerprint = await mutationFingerprint({ body, actor })
    if (action === 'sync_integration') return await syncIntegration(env,actor,body,requestId,fingerprint)
    return await atomicMutation(env.DB, requestId, fingerprint, async DB => {
    env = { ...env, DB, MUTATION_ID: requestId }
    // 각 작업의 비동기 오류까지 이 try/catch 안에서 JSON 응답으로 바꾼다.
    // await 없이 Promise를 그대로 반환하면 권한 오류 같은 reject가 catch 바깥으로
    // 빠져 Cloudflare가 HTML 500을 만들어 버린다.
    if (action === 'capture_event') return await captureEvent(env, actor, body)
    if (action === 'validate_event') return await validateEvent(env, actor, body)
    if (action === 'update_cluster') return await updateCluster(env, actor, body)
    if (action === 'acknowledge_cluster') return await acknowledgeCluster(env, actor, body)
    if (action === 'create_product') return await createProduct(env, actor, body)
    if (action === 'create_experiment') return await createExperiment(env, actor, body)
    if (action === 'approve_experiment') return await approveExperiment(env, actor, body)
    if (action === 'record_run') return await recordRun(env, actor, body)
    if (action === 'decide_experiment') return await decideExperiment(env, actor, body)
    if (action === 'record_volume') return await recordVolume(env, actor, body)
    if (action === 'save_integration') return await saveIntegration(env, actor, body)
    if (action === 'save_actor') return await saveActor(env, actor, body)
    return jsonError('지원하지 않는 작업입니다.', 400)
    })
  } catch (error) {
    if (error.message?.includes('/40001')) return body.expectedVersion
      ? jsonResponse({ error:'다른 요청으로 기록이 변경되었습니다. 작성 내용은 유지되며, 최신 자료를 확인한 뒤 다시 저장할 수 있습니다.', code:'OVERRIDE_EDIT_CONFLICT' },409)
      : jsonError('다른 요청으로 기록이 변경되었습니다. 새로고침 후 다시 확인해 주세요.',409)
    if (error.message?.includes('/23505')) return jsonError('이미 저장된 기록입니다. 새로고침해서 확인해 주세요.', 409)
    if (error?.code === 'OVERRIDE_EDIT_CONFLICT') return jsonResponse({ error: error.message, code: error.code }, error.status)
    if (error?.status) return jsonError(error.message, error.status)
    return failUnexpected(error, 'OverrideLoop 작업을 저장하지 못했습니다.')
  }
}
