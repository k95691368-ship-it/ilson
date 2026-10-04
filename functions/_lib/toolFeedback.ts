import { normalizeToolFeedback, feedbackTextIsStorable, type ToolFeedbackKind } from '../../shared/toolFeedbackCommand.ts'
import { REPORT_KIND, REPORT_BY_CODE, URGENT_CODES } from '../../shared/report.js'
import { UNCLEAR_KIND, SECTION_BY_KEY } from '../../shared/unclear.js'
import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import { canUseBusinessRoute } from './authorization.js'
import { checkRateLimit } from './rateLimit.js'
import { logDecision } from './decisions.js'
import { isTransactionConflict } from './transactionConflict.ts'
import { failUnexpected, jsonError, jsonResponse } from './http.ts'
import type { Database } from './runtimeTypes.ts'

type ScopedDatabase = Database & { actorEmail?: string | null; workspace?: boolean; toolRunScope?: () => Promise<string> }
interface Environment {
  DB: ScopedDatabase; AUTH_ACTOR?: { mode?: string; email?: string | null }; DEMO_WORKSPACE?: boolean; SUPABASE_URL?: string
}
interface Actor {
  email: string; display_name: string; role: string; active: number
  departments_json: string; product_ids_json: string; updated_at: string
}
interface Handover { application_id: string; title: string; handed_to_dept: string; rolled_back_at: string | null }
interface Application { id: string; owner_email: string | null; dept: string; status: string; updated_at: string }
const KEY = /^[a-zA-Z0-9_-]{16,100}$/
const conflict = () => jsonResponse({ code: 'FEEDBACK_CONFLICT',
  error: '같은 제보의 내용·도구 상태·권한이 변경되었습니다. 기록을 확인한 뒤 같은 요청으로 다시 시도해주세요.' }, 409)

export async function saveToolFeedback(env: Environment, slug: string, kind: ToolFeedbackKind, body: unknown, headerKey: string | null, ip: string): Promise<Response> {
  const normalized = normalizeToolFeedback(kind, body, env.AUTH_ACTOR?.mode === 'access')
  if (!normalized.ok) return jsonResponse({ error: '적어주신 것을 다시 확인해주세요.', fields: normalized.fields, notSaved: true }, 400)
  const input = body as Record<string, unknown>, requestId = input.feedback_id ?? headerKey
  if (typeof requestId !== 'string' || !KEY.test(requestId)) return jsonError('제보의 중복 방지 요청 번호가 필요합니다.', 400)
  if (typeof slug !== 'string' || !slug) return jsonError('그 도구를 찾지 못했습니다.', 404)
  try {
    if (typeof env.DB?.mutationReceipt !== 'function' || typeof env.DB?.commitMutation !== 'function') {
      throw new Error('Atomic feedback storage unavailable')
    }
    const actorEmail = env.AUTH_ACTOR?.email
    if (env.AUTH_ACTOR?.mode === 'access') {
      if (!actorEmail || env.DB.actorEmail !== actorEmail || env.DB.workspace !== false) return jsonError('인증된 사내 계정이 필요합니다.', 401)
    } else if (env.AUTH_ACTOR || env.DEMO_WORKSPACE !== true || env.DB.workspace !== true) {
      return jsonError('개인 체험 공간의 데이터 접근 설정이 필요합니다.', 503)
    }
    if (input.feedback_scope !== undefined && (typeof input.feedback_scope !== 'string' || !input.feedback_scope
      || typeof env.DB.toolRunScope !== 'function' || input.feedback_scope !== await env.DB.toolRunScope())) return conflict()

    // This is a separate request-frequency limit, as on teaching. Replays count
    // as requests too; it is not an exactly-once successful-feedback quota.
    // An uncertain commit must not be described/refunded as "not saved".
    if (!await checkRateLimit(env, kind + ':' + ip, 20, kind === 'report' ? 600 : 3600)) {
      return jsonError(kind === 'report' ? '신고 요청은 십 분에 20회까지 가능합니다. 잠시 후 다시 시도해주세요.'
        : '짚기 요청은 시간당 20회까지 가능합니다. 잠시 후 다시 시도해주세요.', 429)
    }
    const command = normalized.value
    // The same slug must still resolve to a visible application before an old
    // receipt can be returned. Actor scope alone is not an application revision.
    const readContext = () => env.DB.prepare('SELECT h.application_id FROM handover h JOIN application a ON a.id=h.application_id WHERE h.slug=?')
      .bind(slug).first<{ application_id: string }>()
    const context = await readContext()
    if (!context) return jsonError('그 도구를 찾지 못했습니다.', 404)
    const fingerprint = await mutationFingerprint({ kind: 'tool-feedback', slug, applicationId: context.application_id, command })
    const response = await atomicMutation(env.DB, requestId, fingerprint, async DB => {
      let reporter: string | null = command.kind === 'report' ? command.reporter : null
      if (actorEmail) {
        const actor = await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?')
          .bind(actorEmail).first<Actor>()
        if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
        if (!canUseBusinessRoute(actor, '/api/tools/' + encodeURIComponent(slug) + '/' + kind, 'POST')) return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
        if (command.kind === 'report') {
          if (typeof actor.display_name !== 'string' || !actor.display_name.trim() || !feedbackTextIsStorable(actor.display_name)) throw new Error('Current actor attribution unavailable')
          reporter = actor.display_name
        }
      }
      const handover = await DB.prepare('SELECT application_id,title,handed_to_dept,rolled_back_at FROM handover WHERE slug=?')
        .bind(slug).first<Handover>()
      if (!handover) return jsonError('그 도구를 찾지 못했습니다.', 404)
      if (handover.application_id !== context.application_id) return conflict()
      if (handover.rolled_back_at) return jsonError('이 도구는 이미 내려간 상태입니다. 담당자에게 알려주세요.', 409)
      const app = await DB.prepare('SELECT id,owner_email,dept,status,updated_at FROM application WHERE id=?')
        .bind(handover.application_id).first<Application>()
      if (!app) return jsonError('그 신청서를 찾지 못했습니다.', 404)

      if (command.kind === 'report') {
        const { code, body } = command, report = REPORT_BY_CODE[code]
        if (!reporter) throw new Error('Validated feedback attribution unavailable')
        const id = await logDecision({ DB }, {
          applicationId: app.id, stage: '배포', actor: 'human', title: reporter,
          what: body, why: handover.handed_to_dept + '에서 "' + report.label + '"로 신고했습니다.',
          linkKind: REPORT_KIND, linkId: code,
        })
        const urgent = URGENT_CODES.includes(code)
        return jsonResponse({ ok: true, id, urgent,
          next: urgent ? '긴급 신고로 기록했습니다. 담당자 검토가 필요합니다.' : '신고를 기록했습니다. 담당자 화면에서 확인할 수 있습니다.' })
      }
      const section = SECTION_BY_KEY[command.section]
      const id = await logDecision({ DB }, {
        applicationId: app.id, stage: '사용법서', actor: 'human',
        title: '사용법서에서 막혔다 — ' + section.label, what: command.body,
        why: '사용법서의 이 대목에 대한 설명 보완을 요청했습니다.',
        linkKind: UNCLEAR_KIND, linkId: section.key,
      })
      // Success is the committed record, not the outcome of a later summary GET.
      return jsonResponse({ ok: true, id, message: '짚어주신 내용을 기록했습니다. 담당자 검토가 필요합니다.' })
    })
    if (response.headers.get('X-Idempotency-Replayed') === '1') {
      // Both the receipt lookup and commit RPC can replay before the action's
      // staged resource reads. Recheck current visibility/slug binding before
      // exposing that reply. This is a latest scoped read, not one DB snapshot
      // shared with receipt retrieval; it does not change the committed record.
      const current = await readContext()
      if (!current) return jsonError('그 도구를 찾지 못했습니다.', 404)
      if (current.application_id !== context.application_id) return conflict()
    }
    return response
  } catch (error) {
    if (isTransactionConflict(error)) return conflict()
    return failUnexpected(error, '제보의 저장 여부를 확인하지 못했습니다. 다시 작성하지 말고 같은 요청으로 확인해주세요.')
  }
}
