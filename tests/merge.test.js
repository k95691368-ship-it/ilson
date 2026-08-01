import { describe, it, expect } from 'vitest'
import {
  pickPrimary,
  alreadyMerged,
  mergeNotice,
  holdCondition,
  validateMerge,
  MERGE_KIND,
} from '../shared/merge.js'

// 판정만 하고 아무 일도 안 일어나면, 담당자는 끝났다고 생각하고 부서는
// 아무 소식이 없다고 생각한다. 둘 다 상대가 뭘 하고 있는 줄 안다.
//
// 그리고 잘못 묶으면 더 나쁘다. 진행 중인 것을 접수만 된 것에 묶으면
// 그 진행이 통째로 끊긴다.

const app = (id, ticket, created, status = '접수', dept = '재무') => ({
  id,
  ticket_no: ticket,
  dept,
  status,
  created_at: created,
})

describe('어느 쪽을 남기는가', () => {
  it('먼저 낸 쪽을 남긴다', () => {
    // 나중 것을 남기면 이미 검토를 받았거나 만들어지고 있는 진행이 끊긴다.
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    const b = app('b', 'AX-BBB-002', '2026-07-28 09:00:00')
    expect(pickPrimary(a, b).primary.id).toBe('a')
    expect(pickPrimary(a, b).merged.id).toBe('b')
  })

  it('넣는 순서를 바꿔도 같은 답이 나온다', () => {
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    const b = app('b', 'AX-BBB-002', '2026-07-28 09:00:00')
    expect(pickPrimary(b, a).primary.id).toBe('a')
  })

  it('먼저 낸 것이 반려됐으면 그쪽으로 안 묶는다', () => {
    // 반려된 것에 묶으면 부서는 "왜 내 신청서가 반려된 것에 붙었지"가 된다.
    const dead = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '반려')
    const alive = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '접수')
    const r = pickPrimary(dead, alive)
    expect(r.primary.id).toBe('b')
    expect(r.merged.id).toBe('a')
  })

  it('둘 다 반려됐으면 묶을 것이 없다', () => {
    const r = pickPrimary(
      app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '반려'),
      app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '반려')
    )
    expect(r.primary).toBeNull()
    expect(r.blocked).toContain('반려')
  })

  it('나중에 냈어도 더 나아간 쪽을 남긴다', () => {
    // 처음에는 반대로 만들었다. 라이브에서 실제로 묶어 보니 여덟 단계를
    // 다 거쳐 도구까지 배포된 신청서가 접수만 된 신청서에 묶여 보류로
    // 내려갔다. 해 놓은 일이 통째로 선반에 올라갔다.
    const first = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '접수')
    const later = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '진행중')
    expect(pickPrimary(first, later).primary.id).toBe('b')
    expect(pickPrimary(first, later).merged.id).toBe('a')
  })

  it('진행이 같으면 그때 먼저 낸 쪽을 남긴다', () => {
    const first = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '수용')
    const later = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '수용')
    expect(pickPrimary(first, later).primary.id).toBe('a')
  })

  it('모르는 상태는 아는 척하고 위로 올리지 않는다', () => {
    const known = app('a', 'AX-AAA-001', '2026-07-28 09:00:00', '접수')
    const weird = app('b', 'AX-BBB-002', '2026-07-20 09:00:00', '처음 보는 상태')
    expect(pickPrimary(known, weird).primary.id).toBe('a')
  })

  it('같은 신청서끼리는 묶지 않는다', () => {
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    expect(pickPrimary(a, a).blocked).toBeTruthy()
  })

  it('한쪽이 없으면 막는다', () => {
    expect(pickPrimary(app('a', 'AX-AAA-001', '2026-07-20 09:00:00'), null).blocked).toBeTruthy()
    expect(pickPrimary(null, null).blocked).toBeTruthy()
  })
})

describe('이미 묶인 것', () => {
  const decisions = [
    { link_kind: MERGE_KIND, application_id: 'b', link_id: 'a' },
    { link_kind: '질문', application_id: 'c', link_id: 'c' },
  ]

  it('이미 묶였으면 알아본다', () => {
    expect(alreadyMerged(decisions, 'b')).toBe(true)
  })

  it('다른 신청서가 묶인 것은 이 신청서와 상관없다', () => {
    expect(alreadyMerged(decisions, 'c')).toBe(false)
    expect(alreadyMerged(decisions, 'a')).toBe(false)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(alreadyMerged([], 'b')).toBe(false)
    expect(alreadyMerged(undefined, 'b')).toBe(false)
  })
})

describe('부서에게 뭐라고 말하는가', () => {
  const primary = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '진행중', '재무')
  const merged = app('b', 'AX-BBB-002', '2026-07-28 09:00:00')

  it('어느 신청서로 묶였는지 알려 준다', () => {
    const n = mergeNotice(primary, merged)
    expect(n.headline).toContain('AX-AAA-001')
    expect(n.where).toBe('AX-AAA-001')
  })

  it('버린 것이 아니라는 것을 분명히 한다', () => {
    // "중복입니다"로 끝내면 부서는 자기 신청서가 버려진 줄 안다.
    const n = mergeNotice(primary, merged)
    expect(n.why).toContain('안 하는 것이 아닙니다')
    expect(n.body).toContain('함께 처리')
  })

  it('보류 사유도 같은 말로 적는다', () => {
    // 화면마다 다른 말로 적으면 부서가 다른 일인 줄 안다.
    expect(holdCondition(primary)).toContain('AX-AAA-001')
    expect(holdCondition(primary)).toContain('배포되면')
  })
})

describe('묶을 때 받는 것', () => {
  it('제대로 적었으면 통과한다', () => {
    expect(validateMerge({ why: '둘 다 다섯 채널 정산서를 합치는 일입니다', author: 'AX 담당자' })).toEqual({})
  })

  it('근거 없이 묶지 못한다', () => {
    // 부서가 "이거 왜 묶였냐"고 물으면 답해야 하는 자리다.
    expect(validateMerge({ why: '중복', author: 'AX 담당자' }).why).toBeTruthy()
  })

  it('누가 판정하는지 받아 둔다', () => {
    expect(validateMerge({ why: '같은 병목입니다 확인했습니다', author: '' }).author).toBeTruthy()
  })
})
