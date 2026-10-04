import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.ts'
import { atomicMutation, mutationFingerprint } from '../../../_lib/atomicMutation.ts'
import { isTransactionConflict } from '../../../_lib/transactionConflict.ts'
import { canUseBusinessRoute } from '../../../_lib/authorization.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import { normalizeTeachCommand } from '../../../../shared/teachCommand.ts'
import { SKU_BY_CODE } from '../../../../shared/master.js'

const conflict = () => jsonError('같은 요청의 내용이나 기록·권한이 변경되었습니다. 최신 기록을 확인해주세요.', 409)

async function currentTeacher(env, DB, slug, command) {
  if (env.DEMO_WORKSPACE === true && DB.workspace === true) return command.teacher
  if (env.AUTH_ACTOR?.mode !== 'access' || !env.AUTH_ACTOR.email || DB.actorEmail !== env.AUTH_ACTOR.email) {
    return jsonError('인증된 사내 계정이 필요합니다.', 401)
  }
  // Include authority and attribution in CAS. Mid-request role, assignment
  // or name changes must not commit under a stale assertion.
  const actor = await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?')
    .bind(env.AUTH_ACTOR.email).first()
  if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
  if (!canUseBusinessRoute(actor, '/api/tools/' + encodeURIComponent(slug) + '/teach', 'POST')) {
    return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
  }
  if (typeof actor.display_name !== 'string' || !actor.display_name.trim()) throw new Error('Current actor attribution is unavailable')
  return actor.display_name
}

export async function onRequestPost({ env, data: requestData, params, request }) {
  env = requestData?.requestEnv ?? env
  let body
  try { body = await request.json() } catch { return jsonError('보내주신 내용을 읽지 못했습니다.', 400) }
  const normalized = normalizeTeachCommand(body, env.AUTH_ACTOR?.mode === 'access')
  if (!normalized.ok) return failFields(normalized.fields, '알려주신 것을 다시 확인해주세요.')
  const requestId = request.headers.get('X-Idempotency-Key')
  if (!requestId || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 필요합니다.', 400)
  const slug = params.slug
  if (typeof slug !== 'string' || !slug) return jsonError('그 도구를 찾지 못했습니다.', 404)
  const command = normalized.value
  try {
    // Fail closed before any write on an adapter that cannot atomically save
    // the alias, decision evidence and original response receipt.
    if (typeof env.DB?.mutationReceipt !== 'function' || typeof env.DB?.commitMutation !== 'function') {
      throw new Error('Atomic teaching storage is unavailable')
    }
    if (env.AUTH_ACTOR?.mode === 'access') {
      if (!env.AUTH_ACTOR.email || env.DB.actorEmail !== env.AUTH_ACTOR.email || env.DB.workspace === true) {
        return jsonError('인증된 사내 계정이 필요합니다.', 401)
      }
    } else if (env.DEMO_WORKSPACE !== true || env.DB.workspace !== true) {
      return jsonError('개인 체험 공간의 데이터 접근 설정이 필요합니다.', 503)
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (!await checkRateLimit(env, 'teach:' + ip, 60, 600)) {
      return jsonError('한 번에 너무 많이 알려주고 계십니다. 잠시 후 다시 시도해주세요.', 429)
    }
    // Abuse quotas remain separate request limits, not exactly-once charges.
    const fingerprint = await mutationFingerprint({ kind: 'teach', slug, command })
    return await atomicMutation(env.DB, requestId, fingerprint, async DB => {
      const teacher = await currentTeacher(env, DB, slug, command)
      if (teacher instanceof Response) return teacher
      const h = await DB.prepare('SELECT application_id, handed_to_dept, rolled_back_at FROM handover WHERE slug = ?').bind(slug).first()
      if (!h) return jsonError('그 도구를 찾지 못했습니다.', 404)
      if (h.rolled_back_at) return jsonError('이 도구는 이미 내려간 상태입니다.', 409)
      const { externalCode, canonicalCode, channel, note, affected } = command
      const existing = await DB.prepare('SELECT canonical_code, taught_by FROM sku_alias WHERE external_code = ?').bind(externalCode).first()
      if (existing && existing.canonical_code !== canonicalCode) {
        return jsonError('이 코드는 이미 다른 상품으로 이어져 있습니다. 변경이 필요하면 담당자에게 확인해주세요.', 409)
      }
      if (existing) {
        // Do not relabel old aliases or invent missing historical evidence.
        return jsonResponse({ ok: true, already: true, affected: 0, canonicalCode,
          ...(typeof existing.taught_by === 'string' ? { teacher: existing.taught_by } : {}) })
      }
      const sku = SKU_BY_CODE[canonicalCode]
      // A hidden other-owner alias may share the PK. Plain INSERT makes that
      // conflict roll back the entire transaction without exposing its values.
      await DB.prepare('INSERT INTO sku_alias (external_code, canonical_code, channel, product_name, note, taught_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(externalCode, canonicalCode, channel, sku.name_ko, note, teacher).run()
      await logDecision({ DB }, {
        applicationId: h.application_id, stage: '배포', actor: 'human', title: teacher,
        what: externalCode + ' 는 ' + sku.name_ko + '(' + canonicalCode + ')입니다.',
        why: h.handed_to_dept + '의 상품 연결 요청입니다. 요청에서 미등록 ' + affected + '줄을 알려줬습니다. 다른 오류가 있는 줄은 계속 격리됩니다.',
        linkKind: '코드알림', linkId: externalCode,
      })
      return jsonResponse({ ok: true, already: false, canonicalCode, productName: sku.name_ko, affected, teacher,
        next: '다음 계산부터 상품 연결이 반영됩니다. 다른 오류가 있는 줄은 계속 격리됩니다.' })
    })
  } catch (error) {
    if (isTransactionConflict(error) || /\/23505(?:\)|$)/.test(error?.message ?? '')) return conflict()
    return failUnexpected(error, '알려주신 것의 저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 저장해주세요.')
  }
}
