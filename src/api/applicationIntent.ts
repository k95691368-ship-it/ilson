// Only opaque retry metadata and the last receipt's IDs are retained.
// The draft owns any user-entered text; none is copied into this record.
// One unresolved application per verified scope survives reopening a tab.
export type ApplicationIntent = { digest: string; key: string; startedAt: number; attempts: number; conflicted?: boolean }
type IntentAttempt = { key: string; attempt: number }
export type ApplicationReceipt = { id: string; ticket_no: string }
type ConfirmedIntent = { key: string; digest: string; startedAt: number; receipt: ApplicationReceipt }
type StoredIntent = { version: 1; salt: string; revision: string; pending: ApplicationIntent | null; confirmed?: ConfirmedIntent; reviewRequired?: boolean }
type IntentSnapshot = Pick<StoredIntent, 'salt' | 'revision'>
const PREFIX = 'ilson.application-intent.v1:'
const RETENTION = 7 * 24 * 60 * 60 * 1000
const UUID = /^[a-zA-Z0-9_-]{16,100}$/
const HASH = /^[a-f0-9]{64}$/

export class IntentError extends Error {
  code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}
const unavailable = () => new IntentError('재시도 정보를 안전하게 보관할 수 없습니다. 이 탭의 저장소 설정을 확인한 뒤 다시 시도해주세요.', 'MUTATION_IDENTITY_UNAVAILABLE')
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function isApplicationReceipt(value: unknown): value is ApplicationReceipt {
  return record(value) && typeof value.id === 'string' && value.id.trim().length > 0 && value.id.length <= 128
    && typeof value.ticket_no === 'string' && /^[A-Z0-9-]{3,64}$/.test(value.ticket_no)
}

function confirmedIntent(value: unknown): ConfirmedIntent | undefined {
  if (value === undefined) return undefined
  if (!record(value) || typeof value.key !== 'string' || !UUID.test(value.key)
    || typeof value.digest !== 'string' || !HASH.test(value.digest)
    || typeof value.startedAt !== 'number' || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0
    || !isApplicationReceipt(value.receipt)) throw unavailable()
  return { key: value.key, digest: value.digest, startedAt: value.startedAt, receipt: { id: value.receipt.id, ticket_no: value.receipt.ticket_no } }
}

function read(scope: string): StoredIntent | null {
  try {
    const raw = localStorage.getItem(PREFIX + scope)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (!record(value) || value.version !== 1 || typeof value.salt !== 'string' || !UUID.test(value.salt)
      || typeof value.revision !== 'string' || !UUID.test(value.revision)) throw unavailable()
    if (value.reviewRequired !== undefined && typeof value.reviewRequired !== 'boolean') throw unavailable()
    const confirmed = confirmedIntent(value.confirmed)
    const base = { version: 1 as const, salt: value.salt, revision: value.revision,
      ...(confirmed ? { confirmed } : {}), ...(value.reviewRequired === true ? { reviewRequired: true } : {}) }
    const pending = value.pending
    if (pending === null) return { ...base, pending: null }
    if (!record(pending) || typeof pending.digest !== 'string' || !HASH.test(pending.digest)
      || typeof pending.key !== 'string' || !UUID.test(pending.key)
      || typeof pending.startedAt !== 'number' || !Number.isSafeInteger(pending.startedAt) || pending.startedAt < 0
      || (pending.attempts !== undefined && (typeof pending.attempts !== 'number' || !Number.isSafeInteger(pending.attempts) || pending.attempts < 1))
      || (pending.conflicted !== undefined && typeof pending.conflicted !== 'boolean')) throw unavailable()
    return { ...base, pending: {
      digest: pending.digest, key: pending.key, startedAt: pending.startedAt,
      // Records from an earlier version cannot prove this is the first attempt.
      attempts: typeof pending.attempts === 'number' ? pending.attempts : 2,
      ...(pending.conflicted === true ? { conflicted: true } : {}),
    } }
  } catch { throw unavailable() }
}

function write(scope: string, value: StoredIntent) {
  try {
    const encoded = JSON.stringify(value)
    localStorage.setItem(PREFIX + scope, encoded)
    if (localStorage.getItem(PREFIX + scope) !== encoded) throw unavailable()
  } catch { throw unavailable() }
}

function locked<T>(scope: string, assertCurrent: () => void, action: () => T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return Promise.reject(new IntentError('이 브라우저에서는 신청의 중복 접수를 안전하게 막을 수 없습니다. 최신 브라우저에서 다시 시도해주세요.', 'MUTATION_IDENTITY_UNAVAILABLE'))
  }
  // The lock covers only metadata transactions, never hashing or network I/O.
  return navigator.locks.request(PREFIX + scope, () => { assertCurrent(); return action() })
}

export function prepareApplicationIntent(scope: string, assertCurrent: () => void): Promise<IntentSnapshot> {
  return locked(scope, assertCurrent, () => {
    const existing = read(scope)
    if (existing) {
      // Lazy expiry: no background timer or unrelated browser-storage sweep.
      // The expired pending key remains a fail-closed marker, never a new key.
      if (existing.confirmed && Date.now() - existing.confirmed.startedAt >= RETENTION) {
        const { confirmed: _expired, ...rest } = existing
        write(scope, rest)
      }
      return { salt: existing.salt, revision: existing.revision }
    }
    let salt: string, revision: string
    try { salt = crypto.randomUUID(); revision = crypto.randomUUID() } catch { throw unavailable() }
    write(scope, { version: 1, salt, revision, pending: null })
    return { salt, revision }
  })
}

export function beginApplicationIntent(scope: string, snapshot: IntentSnapshot, digest: string, confirmedNewIntent: boolean, assertCurrent: () => void): Promise<IntentAttempt> {
  return locked(scope, assertCurrent, () => {
    const state = read(scope)
    // A concurrent change must not make an already computed digest reusable.
    if (!state || state.salt !== snapshot.salt) throw unavailable()
    if (state.reviewRequired && !confirmedNewIntent) throw changedIntent()
    const prior = state.pending
    if (prior && !confirmedNewIntent) {
      if (prior.conflicted) throw new IntentError('이전 신청과 재시도 정보가 일치하지 않습니다. 접수 내역을 확인해주세요.', 'APPLICATION_INTENT_CONFLICT')
      if (prior.digest !== digest) throw new IntentError('이전 신청의 접수 여부가 확인되지 않았습니다. 접수 내역을 확인한 뒤 새 신청을 선택해주세요.', 'APPLICATION_INTENT_UNRESOLVED')
      if (Date.now() < prior.startedAt || Date.now() - prior.startedAt >= RETENTION) {
        throw new IntentError('이전 신청의 재시도 보관 기간이 지났습니다. 중복 접수를 막기 위해 접수 내역을 먼저 확인해주세요.', 'APPLICATION_INTENT_EXPIRED')
      }
      const attempt = prior.attempts + 1
      if (!Number.isSafeInteger(attempt)) throw unavailable()
      write(scope, { ...state, pending: { ...prior, attempts: attempt } })
      return { key: prior.key, attempt }
    }
    if (state.revision !== snapshot.revision) throw changedIntent()
    let key: string, revision: string
    try { key = crypto.randomUUID(); revision = crypto.randomUUID() } catch { throw unavailable() }
    write(scope, { ...state, revision, reviewRequired: false, pending: { digest, key, startedAt: Date.now(), attempts: 1 } })
    return { key, attempt: 1 }
  })
}

export function settleApplicationIntent(scope: string, key: string, outcome: 'confirmed' | 'not-saved' | 'conflict', assertCurrent: () => void, receipt?: ApplicationReceipt): Promise<boolean> {
  return locked(scope, assertCurrent, () => {
    const state = read(scope)
    if (!state || state.pending?.key !== key) return false
    // A definite rejection describes only this request, not an earlier/later
    // attempt whose response may have been lost. Never discard that old key.
    if (outcome === 'not-saved' && state.pending.attempts !== 1) return false
    if (outcome === 'confirmed' && !isApplicationReceipt(receipt)) throw unavailable()
    write(scope, { ...state, revision: crypto.randomUUID(), pending: outcome === 'conflict' ? { ...state.pending, conflicted: true } : null,
      ...(outcome === 'confirmed' && receipt ? { confirmed: { key, digest: state.pending.digest, startedAt: state.pending.startedAt, receipt: { id: receipt.id, ticket_no: receipt.ticket_no } } } : {}) })
    return true
  })
}

const changedIntent = () => new IntentError('다른 탭에서 신청 상태가 바뀌었습니다. 접수 내역을 확인한 뒤 새 신청 여부를 선택해주세요.', 'APPLICATION_INTENT_CHANGED')

export function recoverApplicationReceipt(scope: string, key: string, digest: string, assertCurrent: () => void): Promise<ApplicationReceipt | null> {
  return locked(scope, assertCurrent, () => {
    const state = read(scope)
    if (!state) throw unavailable()
    const confirmed = state.confirmed
    if (confirmed?.key === key && confirmed.digest === digest && Date.now() >= confirmed.startedAt && Date.now() - confirmed.startedAt < RETENTION) return confirmed.receipt
    if (state.pending?.key === key && state.pending.digest === digest && !state.reviewRequired) return null
    // A newer confirmed intent may have replaced our single cached receipt.
    // Never treat this older uncertain request as permission for a new UUID.
    write(scope, { ...state, reviewRequired: true })
    throw changedIntent()
  })
}
