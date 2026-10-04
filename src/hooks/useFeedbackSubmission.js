import { useMemo, useReducer } from 'react'
import { api } from '../api/client.ts'
import { getAccessSession } from '../lib/accessSession.js'
import { useActionLifetime } from './useActionLifetime.js'

const RETRY_WINDOW = 7 * 24 * 60 * 60 * 1000
const text = value => typeof value === 'string' && value.trim().length > 0
export function isFeedbackReceipt(kind, value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.ok === true
    && typeof value.id === 'string' && /^dec_[a-f0-9]{20}$/.test(value.id)
    && (kind === 'report' ? typeof value.urgent === 'boolean' && text(value.next) : kind === 'unclear' && text(value.message)))
}

// One form lifetime owns one immutable text command. Nothing is added to browser
// storage. A transport retry key may expire sooner than the body's server intent.
export function useFeedbackSubmission({ session, slug, kind, section }) {
  const [, redraw] = useReducer(value => value + 1, 0)
  const view = useMemo(() => ({ session, slug, kind, section, pending: null, busy: false, receipt: null, error: '', fields: {}, denied: '' }), [session, slug, kind, section])
  const lifetime = useActionLifetime(view)
  const capture = () => {
    const active = lifetime()
    return () => active() && getAccessSession() === view.session && view.session.status === 'active' && !view.denied
  }
  async function submit(fields) {
    const active = lifetime()
    const current = capture()
    if (!current() || view.busy || view.receipt) return null
    if (!view.pending) {
      const content = view.kind === 'report'
        ? { code: fields.code, body: fields.body, reporter: fields.reporter }
        : { section: view.section, body: fields.body }
      try {
        view.pending = { payload: Object.freeze({ ...content, feedback_id: crypto.randomUUID(), feedback_scope: view.session.scope }), startedAt: Date.now(), uncertain: false, blocked: false }
      } catch {
        view.error = '제보 확인 번호를 만들지 못했습니다. 브라우저 설정을 확인한 뒤 다시 시도해주세요.'
        redraw(); return null
      }
    }
    const pending = view.pending
    const age = Date.now() - pending.startedAt
    if (pending.blocked || !Number.isFinite(age) || age < 0 || age >= RETRY_WINDOW) {
      pending.blocked = true
      view.error = '재시도 확인 기간이 지났거나 브라우저 시간이 바뀌었습니다. 기존 제보 기록을 먼저 확인해주세요.'
      redraw(); return null
    }
    view.busy = true; view.error = ''; view.fields = {}; redraw()
    try {
      const response = await api.post(`/tools/${encodeURIComponent(view.slug)}/${view.kind}`, pending.payload, { validateResponse: value => isFeedbackReceipt(view.kind, value) })
      if (!current()) return null
      view.receipt = view.kind === 'report'
        ? { ok: true, id: response.id, urgent: response.urgent, next: response.next }
        : { ok: true, id: response.id, message: response.message }
      view.pending = null
      return view.receipt
    } catch (error) {
      if (!current()) return null
      view.error = error.message
      view.fields = error.fields ?? {}
      if ([401, 403, 404, 410].includes(error.status)) {
        view.pending = null; view.denied = error.message || '제보 접근 권한을 다시 확인해주세요.'
      } else if (error.status === 400 && error.notSaved === true && !pending.uncertain) {
        // A later validation rejection cannot disprove an earlier uncertain save.
        view.pending = null
      } else {
        pending.uncertain = true
        if (error.status === 429) view.error += ' 요청 횟수 한도입니다. 잠시 뒤 같은 제보로 다시 확인해주세요.'
        if (error.status === 409) view.error += ' 기존 제보와 충돌했습니다. 기록을 확인한 뒤 같은 내용으로 재시도해주세요.'
      }
      return null
    } finally {
      view.busy = false
      // A local denial needs a render even though capture now returns false.
      if (getAccessSession() === view.session && active()) redraw()
    }
  }
  function discard() {
    if (!capture()() || view.busy) return
    view.pending = null; view.receipt = null; view.error = ''; view.fields = {}; redraw()
  }
  return { ...view, submit, discard, capture }
}
