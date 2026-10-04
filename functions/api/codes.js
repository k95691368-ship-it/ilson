import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.ts'
import { atomicMutation, mutationFingerprint } from '../_lib/atomicMutation.ts'
import { isTransactionConflict } from '../_lib/transactionConflict.ts'
import { canUseBusinessRoute, isAccessAdmin } from '../_lib/authorization.js'
import { logDecision } from '../_lib/decisions.js'
import { annotate, sortForReview, summarize, CONFIRM_KIND, CORRECT_KIND } from '../../shared/codes.js'
import {
  normalizeCodeReviewCommand, codeMappingRevision, codeEditVersion, encodeCodeReviewEvidence,
  nextCodeReviewTimestamp, CodeReviewTimestampError,
} from '../../shared/codeReviewEvidence.ts'
import { SKU_BY_CODE, SKUS } from '../../shared/master.js'

const HISTORY_KINDS = ['코드알림', CONFIRM_KIND, CORRECT_KIND]
const HISTORY_COLUMNS = 'id, application_id, title, what, why, alternatives, link_kind, link_id, created_at'
const conflict = () => jsonResponse({ error: '상품 연결이나 검토 근거·권한이 바뀌었습니다. 작성한 내용은 유지하고 최신 연결을 확인해주세요.', code: 'CODE_REVIEW_CONFLICT' }, 409)

async function authority(env, DB) {
  if (env.DEMO_WORKSPACE === true && DB.workspace === true && !env.AUTH_ACTOR) return { admin: true, allowed: true, label: null }
  if (env.AUTH_ACTOR?.mode !== 'access' || !env.AUTH_ACTOR.email || DB.actorEmail !== env.AUTH_ACTOR.email || DB.workspace === true) {
    return jsonError('인증된 사내 계정이 필요합니다.', 401)
  }
  const actor = await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?')
    .bind(env.AUTH_ACTOR.email).first()
  if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
  if (typeof actor.display_name !== 'string' || !actor.display_name.trim()) throw new Error('Current account attribution is unavailable')
  return { admin: isAccessAdmin(actor), allowed: canUseBusinessRoute(actor, '/api/codes', 'POST'), label: actor.display_name }
}

function originOf(history) {
  const origins = [...new Set(history.filter(row => row.link_kind === '코드알림' && typeof row.application_id === 'string' && row.application_id)
    .map(row => row.application_id))].sort()
  return origins.length === 1 ? { state: 'linked', applicationId: origins[0] }
    : { state: origins.length > 1 ? 'ambiguous' : 'unknown', applicationId: null }
}

function reviewReason(alias, origin, who) {
  if (!who.allowed) return 'not_authorized'
  if (typeof alias.external_code !== 'string' || !alias.external_code || alias.external_code.length > 80
    || typeof alias.canonical_code !== 'string' || !alias.canonical_code || alias.canonical_code.length > 40
    || [alias.external_code, alias.canonical_code].some(value => value !== value.trim() || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value))
    || !Object.hasOwn(SKU_BY_CODE, alias.canonical_code)) return 'invalid_mapping'
  if (origin.state === 'ambiguous') return 'origin_ambiguous'
  if (origin.state === 'unknown') return who.admin ? 'origin_unknown_admin' : 'origin_unavailable'
  return null
}
const available = reason => reason === null || reason === 'origin_unknown_admin'

async function historyFor(DB, code) {
  return (await DB.prepare('SELECT ' + HISTORY_COLUMNS + ' FROM decision_log WHERE link_id=? AND link_kind IN (?,?,?) ORDER BY created_at,id')
    .bind(code, ...HISTORY_KINDS).all()).results
}

export async function onRequestGet({ env, data: requestData }) {
  env = requestData?.requestEnv ?? env
  try {
    const who = await authority(env, env.DB)
    if (who instanceof Response) return who
    const aliases = (await env.DB.prepare('SELECT * FROM sku_alias ORDER BY created_at DESC,external_code LIMIT 500').all()).results
    const decisions = aliases.length ? (await env.DB.prepare('SELECT ' + HISTORY_COLUMNS + ' FROM decision_log WHERE link_kind IN (?,?,?) AND link_id IN ('
      + aliases.map(() => '?').join(',') + ') ORDER BY created_at,id').bind(...HISTORY_KINDS, ...aliases.map(row => row.external_code)).all()).results : []
    const byCode = new Map()
    for (const row of decisions) {
      if (!byCode.has(row.link_id)) byCode.set(row.link_id, [])
      byCode.get(row.link_id).push(row)
    }
    const versioned = await Promise.all(aliases.map(async alias => {
      const history = byCode.get(alias.external_code) ?? [], origin = originOf(history)
      const mappingRevision = await codeMappingRevision(alias, history), reason = reviewReason(alias, origin, who)
      return { ...alias, mapping_revision: mappingRevision, edit_version: await codeEditVersion(alias, history, mappingRevision),
        review_available: available(reason), review_reason: reason, provenance: origin }
    }))
    const annotated = annotate(versioned, decisions)
    return jsonResponse({
      codes: sortForReview(annotated).map(alias => ({ ...alias,
        product_name: alias.product_name ?? (Object.hasOwn(SKU_BY_CODE, alias.canonical_code) ? SKU_BY_CODE[alias.canonical_code].name_ko : null) })),
      summary: summarize(annotated),
      catalog: SKUS.map(sku => ({ code: sku.canonical_code, name: sku.name_ko })),
    })
  } catch (error) { return failUnexpected(error, '알려 준 코드를 불러오지 못했습니다.') }
}

export async function onRequestPost({ env, data: requestData, request }) {
  env = requestData?.requestEnv ?? env
  let body
  try { body = await request.json() } catch { return jsonError('보내주신 내용을 읽지 못했습니다.', 400) }
  const normalized = normalizeCodeReviewCommand(body, env.AUTH_ACTOR?.mode === 'access')
  if (!normalized.ok) return failFields(normalized.fields, '적어주신 것을 다시 확인해주세요.')
  const key = request.headers.get('X-Idempotency-Key')
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return jsonError('중복 방지 요청 번호가 필요합니다.', 400)
  const command = normalized.value
  try {
    if (typeof env.DB?.mutationReceipt !== 'function' || typeof env.DB?.commitMutation !== 'function') throw new Error('Atomic code review storage is unavailable')
    // The receipt fast path must not be available on an unscoped adapter.
    const scoped = env.AUTH_ACTOR?.mode === 'access'
      ? env.DB.actorEmail === env.AUTH_ACTOR.email && env.DB.workspace === false
      : env.DEMO_WORKSPACE === true && env.DB.workspace === true && !env.AUTH_ACTOR
    if (!scoped) return jsonError('계정 또는 개인 체험 공간의 데이터 접근 설정을 확인해주세요.', 503)
    return await atomicMutation(env.DB, key, await mutationFingerprint({ kind: 'code-review', command }), async DB => {
      const who = await authority(env, DB)
      if (who instanceof Response) return who
      if (!who.allowed) return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
      const alias = await DB.prepare('SELECT * FROM sku_alias WHERE external_code=?').bind(command.externalCode).first()
      if (!alias) return jsonError('그 코드를 찾지 못했습니다.', 404)
      const history = await historyFor(DB, command.externalCode), origin = originOf(history)
      const mappingRevision = await codeMappingRevision(alias, history)
      if (command.expectedVersion !== await codeEditVersion(alias, history, mappingRevision)) return conflict()
      const reason = reviewReason(alias, origin, who)
      if (!available(reason)) return jsonResponse({ error: '확인 가능한 단일 업무 출처가 없거나 상품 연결의 형식을 확인할 수 없습니다. 담당자에게 원래 업무를 확인해주세요.', code: 'CODE_REVIEW_UNAVAILABLE', review_reason: reason }, 409)
      if (origin.state === 'linked') {
        // Use only the actual scoped teaching event, never a caller app ID or
        // whichever application happens to be latest.
        const application = await DB.prepare('SELECT id,owner_email,dept,updated_at FROM application WHERE id=?').bind(origin.applicationId).first()
        if (!application) return jsonResponse({ error: '원래 업무에 접근할 수 없습니다. 담당자에게 확인해주세요.', code: 'CODE_REVIEW_UNAVAILABLE', review_reason: 'origin_unavailable' }, 409)
      }
      const author = who.label ?? command.author
      const canonicalCode = command.action === 'correct' ? command.canonicalCode : alias.canonical_code
      if (command.action === 'correct' && canonicalCode === alias.canonical_code) return jsonError('지금과 같은 상품입니다. 바꿀 것이 없습니다.', 400)
      const productName = command.action === 'correct' ? SKU_BY_CODE[canonicalCode].name_ko
        : alias.product_name ?? (Object.hasOwn(SKU_BY_CODE, canonicalCode) ? SKU_BY_CODE[canonicalCode].name_ko : null)
      if (command.action === 'correct') {
        // Bind a server-owned advancing writer timestamp. Never claim this is
        // the actual human event time; decision.created_at remains separate.
        const changedAt = nextCodeReviewTimestamp(alias.created_at)
        await DB.prepare('UPDATE sku_alias SET canonical_code=?,product_name=?,taught_by=?,created_at=? WHERE external_code=?')
          .bind(canonicalCode, productName, author, changedAt, command.externalCode).run()
      }
      const alternatives = encodeCodeReviewEvidence({
        version: 1, action: command.action, externalCode: command.externalCode, reviewedMappingRevision: mappingRevision,
        beforeCanonicalCode: alias.canonical_code, afterCanonicalCode: canonicalCode,
        provenance: origin.state === 'linked' ? { state: 'linked', applicationId: origin.applicationId } : { state: 'unknown', applicationId: null },
      })
      const id = await logDecision({ DB }, {
        applicationId: origin.applicationId, stage: '제작', actor: 'human', title: author,
        what: command.action === 'confirm' ? command.externalCode + ' → ' + (productName ?? canonicalCode) + ' 가 맞다고 확인했습니다.'
          : command.externalCode + ' 를 ' + (alias.product_name ?? alias.canonical_code) + ' 에서 ' + productName + '(' + canonicalCode + ') 로 바꿨습니다.',
        why: command.why, alternatives, linkKind: command.action === 'confirm' ? CONFIRM_KIND : CORRECT_KIND, linkId: command.externalCode,
      })
      return jsonResponse({ ok: true, id, action: command.action, externalCode: command.externalCode, canonicalCode,
        ...(typeof productName === 'string' ? { productName } : {}), ...(typeof author === 'string' ? { author } : {}) })
    })
  } catch (error) {
    if (isTransactionConflict(error) || error instanceof CodeReviewTimestampError || /\/23505(?:\)|$)/.test(error?.message ?? '')) return conflict()
    return failUnexpected(error, '상품 연결의 저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 저장해주세요.')
  }
}
