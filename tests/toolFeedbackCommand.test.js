// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeToolFeedback as normalize } from '../shared/toolFeedbackCommand.ts'
import { mutationFingerprint } from '../functions/_lib/atomicMutation.ts'
const report = changes => ({ code: 'wrong_number', body: '정산 금액이 실제 확인한 값과 다릅니다.', reporter: '재무 담당', ...changes })
const unclear = changes => ({ section: 'upload', body: '어느 파일을 먼저 넣는지 모르겠습니다.', ...changes })
describe('tool feedback commands preserve semantic input without guessing identity', () => {
  it('projects exact trimmed text and preserves interior spacing/newlines without arbitrary/raw keys', () => {
    expect(normalize('report', report({ code: ' wrong_number ', body: '  정산 금액이\n  실제 값과 다릅니다.  ', reporter: '  재무 담당  ', raw: 'LOCAL_ONLY' }), false)).toEqual({
      ok: true, value: { kind: 'report', code: 'wrong_number', body: '정산 금액이\n  실제 값과 다릅니다.', reporter: '재무 담당' },
    })
    expect(normalize('unclear', unclear({ body: '  어느 파일을\n  넣는지 모르겠습니다.  ', raw: 'LOCAL_ONLY' }), false)).toEqual({
      ok: true, value: { kind: 'unclear', section: 'upload', body: '어느 파일을\n  넣는지 모르겠습니다.' },
    })
  })
  it('ignores real reporter values completely but keeps the demo label in the command', async () => {
    const first = normalize('report', report(), true)
    for (const reporter of ['',{},[],null,'x'.repeat(999)]) {
      const next = normalize('report', report({ reporter }), true)
      expect(next).toEqual(first)
      expect(await mutationFingerprint(next)).toBe(await mutationFingerprint(first))
    }
    expect(normalize('report', report(), false).value.reporter).toBe('재무 담당')
  })
  it.each([null,[],true,'text',0])('rejects malformed top-level input %j', value => {
    expect(normalize('report', value, true).ok).toBe(false)
    expect(normalize('unclear', value, true).ok).toBe(false)
  })
  it.each([{},[],true,123,null])('rejects malformed known text %j without stringifying it', value => {
    for (const field of ['code','body','reporter']) expect(normalize('report', report({ [field]: value }), false).ok).toBe(false)
    for (const field of ['section','body']) expect(normalize('unclear', unclear({ [field]: value }), false).ok).toBe(false)
  })
  it.each(['\0','\ud800','\udc00'])('rejects unrepresentable text %j', invalid => {
    expect(normalize('report', report({ body: '정산 금액이 맞지 않습니다.' + invalid }), false).ok).toBe(false)
    expect(normalize('unclear', unclear({ body: '파일을 모르겠습니다.' + invalid }), false).ok).toBe(false)
  })
  it('allows valid Unicode, maximum boundaries and minimum supported lengths without truncating', () => {
    expect(normalize('report', report({ body: '가'.repeat(10), reporter: '가'.repeat(60) }), false).ok).toBe(true)
    expect(normalize('report', report({ body: '가'.repeat(3000) }), false).value.body).toHaveLength(3000)
    expect(normalize('unclear', unclear({ body: '가'.repeat(5) }), false).ok).toBe(true)
    expect(normalize('unclear', unclear({ body: '가'.repeat(1000) }), false).value.body).toHaveLength(1000)
    expect(normalize('report', report({ body: '이것은 😀 유효한 문장입니다.' }), false).ok).toBe(true)
    expect(normalize('report', report({ body: '가'.repeat(3001) }), false).ok).toBe(false)
    expect(normalize('report', report({ reporter: '가'.repeat(61) }), false).ok).toBe(false)
    expect(normalize('unclear', unclear({ body: '가'.repeat(1001) }), false).ok).toBe(false)
  })
  it('uses catalogue membership rather than Object prototype properties', () => {
    for (const value of ['__proto__','constructor','toString']) {
      expect(normalize('report', report({ code: value }), true).ok).toBe(false)
      expect(normalize('unclear', unclear({ section: value }), true).ok).toBe(false)
    }
    expect(normalize('unclear', unclear({ section: ' upload ' }), true).ok).toBe(false)
  })
})
