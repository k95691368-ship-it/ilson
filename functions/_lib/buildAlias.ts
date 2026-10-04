import { normalizeTeachCommand, type TeachCommand } from '../../shared/teachCommand.ts'
import { SKU_BY_CODE } from '../../shared/master.js'
import { BUILD_ALIAS_KIND } from '../../shared/codes.js'
import { atomicMutation, mutationFingerprint } from './atomicMutation.ts'
import { isTransactionConflict } from './transactionConflict.ts'
import { canUseBusinessRoute } from './authorization.js'
import { logDecision } from './decisions.js'
import { failFields, failUnexpected, jsonError, jsonResponse } from './http.ts'
import type { Database } from './runtimeTypes.ts'

export type BuildAliasCommand = Omit<TeachCommand, 'affected'>
type CommandResult = { ok: true; value: BuildAliasCommand } | { ok: false; fields: Record<string, string> }
type ScopedDatabase = Database & { actorEmail?: string | null; workspace?: boolean }
interface BuildAliasEnvironment {
  DB: ScopedDatabase
  AUTH_ACTOR?: { mode?: string; email?: string | null }
  DEMO_WORKSPACE?: boolean
}
interface ActorRow {
  email: string; display_name: string; role: string; active: number
  departments_json: string; product_ids_json: string; updated_at: string
}
interface ApplicationRow { id: string; owner_email: string | null; dept: string; updated_at: string; status: string }
interface AliasRow { canonical_code: string; taught_by: string | null }

// The build form has snake-case names, but teaching must keep the same exact
// identities and limits. Client product names, ownership and counts are not commands.
export function normalizeBuildAliasCommand(body: unknown, accountMode: boolean): CommandResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: { body: '요청 형식이 올바르지 않습니다.' } }
  }
  const input = body as Record<string, unknown>
  const normalized = normalizeTeachCommand({ externalCode: input.external_code, canonicalCode: input.canonical_code,
    channel: input.channel, note: input.note, teacher: input.taught_by ?? 'AX 담당자' }, accountMode)
  if (!normalized.ok) {
    const names: Record<string, string> = { externalCode: 'external_code', canonicalCode: 'canonical_code', teacher: 'taught_by' }
    return { ok: false, fields: Object.fromEntries(Object.entries(normalized.fields).map(([name, message]) => [names[name] ?? name, message])) }
  }
  const { externalCode, canonicalCode, channel, note, teacher } = normalized.value
  return { ok: true, value: { externalCode, canonicalCode, channel, note, teacher } }
}

const conflict = () => jsonResponse({ code: 'CODE_BUILD_ALIAS_CONFLICT',
  error: '이미 연결된 상품이나 기록·권한이 변경되었습니다. 최신 기록을 확인하고 상품 변경은 /codes에서 정정해주세요.' }, 409)

export async function saveBuildAlias(env: BuildAliasEnvironment, applicationId: string, body: unknown, requestId: string | null): Promise<Response> {
  const normalized = normalizeBuildAliasCommand(body, env.AUTH_ACTOR?.mode === 'access')
  if (!normalized.ok) return failFields(normalized.fields)
  if (!requestId || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 필요합니다.', 400)
  try {
    if (typeof env.DB?.mutationReceipt !== 'function' || typeof env.DB?.commitMutation !== 'function') {
      throw new Error('Atomic build alias storage is unavailable')
    }
    const accountMode = env.AUTH_ACTOR?.mode === 'access'
    const actorEmail = env.AUTH_ACTOR?.email
    if (accountMode) {
      if (!actorEmail || env.DB.actorEmail !== actorEmail || env.DB.workspace !== false) {
        return jsonError('인증된 사내 계정이 필요합니다.', 401)
      }
    } else if (env.DEMO_WORKSPACE !== true || env.DB.workspace !== true || env.AUTH_ACTOR) {
      return jsonError('개인 체험 공간의 데이터 접근 설정이 필요합니다.', 503)
    }
    const command = normalized.value
    const fingerprint = await mutationFingerprint({ kind: 'build-alias', applicationId, command })
    return await atomicMutation(env.DB, requestId, fingerprint, async DB => {
      let teacher = command.teacher
      if (accountMode && actorEmail) {
        const actor = await DB.prepare('SELECT email,display_name,role,active,departments_json,product_ids_json,updated_at FROM override_actor WHERE email=?')
          .bind(actorEmail).first<ActorRow>()
        if (!actor || Number(actor.active) !== 1) return jsonError('현재 계정의 접근 권한을 확인할 수 없습니다.', 401)
        if (!canUseBusinessRoute(actor, '/api/applications/' + encodeURIComponent(applicationId) + '/build', 'POST')) {
          return jsonError('현재 계정에는 이 작업 권한이 없습니다.', 403)
        }
        if (typeof actor.display_name !== 'string' || !actor.display_name.trim()) throw new Error('Current actor attribution is unavailable')
        teacher = actor.display_name
      }
      // The common handler read locates the route. This staged read separately
      // protects the application authority/status at commit, including no-op intents.
      const app = await DB.prepare('SELECT id,owner_email,dept,updated_at,status FROM application WHERE id=?')
        .bind(applicationId).first<ApplicationRow>()
      if (!app) return jsonError('그런 신청서가 없습니다.', 404)
      const { externalCode, canonicalCode, channel, note } = command
      const existing = await DB.prepare('SELECT * FROM sku_alias WHERE external_code = ?').bind(externalCode).first<AliasRow>()
      if (existing && existing.canonical_code !== canonicalCode) return conflict()
      if (existing) {
        // A repeated mapping is not a new lesson: preserve every old field,
        // source and review proof rather than inventing missing legacy history.
        return jsonResponse({ ok: true, external_code: externalCode, canonical_code: canonicalCode, already: true,
          ...(typeof existing.taught_by === 'string' ? { teacher: existing.taught_by } : {}) }, 201)
      }
      if (!teacher) throw new Error('Validated teacher is unavailable')
      const sku = SKU_BY_CODE[canonicalCode]
      // A hidden other-owner PK is a conflict, never an upsert into their alias.
      await DB.prepare('INSERT INTO sku_alias (external_code, canonical_code, channel, product_name, note, taught_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(externalCode, canonicalCode, channel, sku.name_ko, note, teacher).run()
      await logDecision({ DB }, { applicationId: app.id, stage: '제작', actor: 'human', title: teacher,
        what: externalCode + ' 는 ' + sku.name_ko + '(' + canonicalCode + ')입니다.',
        why: app.dept + '의 제작 과정에서 상품 연결을 등록했습니다. 다른 오류가 있는 줄은 계속 격리됩니다.',
        linkKind: BUILD_ALIAS_KIND, linkId: externalCode })
      return jsonResponse({ ok: true, external_code: externalCode, canonical_code: canonicalCode, already: false,
        product_name: sku.name_ko, teacher }, 201)
    })
  } catch (error) {
    if (isTransactionConflict(error) || (error instanceof Error && /\/23505(?:\)|$)/.test(error.message))) return conflict()
    return failUnexpected(error, '상품 연결의 저장 여부를 확인하지 못했습니다. 같은 내용으로 다시 저장해주세요.')
  }
}
