import { describe, it, expect } from 'vitest'
import { noticesFrom, actionsFrom, newSince, seenKey } from '../shared/notice.js'

// 알림에서 가장 중요한 것은 "아무 일도 안 일어난 것을 알리지 않는 것"이다.
// 대기 중인 단계를 소식으로 만들면 여덟 건이 매번 뜨고, 그러면 사람은
// 알림 자체를 안 보게 된다.

const T = (stage, status, at, summary, extra = {}) => ({ stage, status, at, summary, ...extra })

describe('소식 뽑기', () => {
  it('아직 안 일어난 단계는 소식이 되지 않는다', () => {
    const n = noticesFrom({
      timeline: [
        T('신청서', '완료', '2026-07-21 11:09:00', '재무에서 냈습니다.'),
        T('검토', '대기', null, '담당자가 아직 열람하지 않았습니다.'),
        T('제작', '대기', null, '아직 만들지 않았습니다.'),
      ],
    })
    expect(n).toHaveLength(1)
    expect(n[0].stage).toBe('신청서')
  })

  it('상태가 진행중이어도 날짜가 없으면 소식이 아니다', () => {
    // 날짜 없이 "진행중"만 있으면 언제 그랬는지 못 적는다. 시각 없는
    // 알림은 "지난번 이후 새 것"을 가려낼 수 없어서 쓸모가 없다.
    const n = noticesFrom({ timeline: [T('제작', '진행중', null, '만드는 중')] })
    expect(n).toHaveLength(0)
  })

  it('최근 것이 위로 온다', () => {
    const n = noticesFrom({
      timeline: [
        T('신청서', '완료', '2026-07-21 11:09:00', 'a'),
        T('검토', '완료', '2026-07-25 09:00:00', 'b'),
        T('배포', '진행중', '2026-07-30 10:00:00', 'c'),
      ],
    })
    expect(n.map((x) => x.stage)).toEqual(['배포', '검토', '신청서'])
  })

  it('반려는 만들지 않기로 했다고 적는다', () => {
    const n = noticesFrom({
      timeline: [T('검토', '완료', '2026-07-25 09:00:00', '반려했습니다 — 범위 밖')],
    })
    expect(n[0].headline).toContain('만들지 않기로')
  })

  it('보류는 보류라고 적는다', () => {
    const n = noticesFrom({
      timeline: [T('검토', '완료', '2026-07-25 09:00:00', '보류했습니다')],
    })
    expect(n[0].headline).toContain('보류')
  })

  it('수용은 만들기로 했다고 적는다', () => {
    const n = noticesFrom({
      timeline: [T('검토', '완료', '2026-07-25 09:00:00', '수용했습니다 (임팩트 5 / 난이도 3)')],
    })
    expect(n[0].headline).toContain('만들기로')
  })

  it('시험이 차단이면 고치는 중이라고 적는다', () => {
    const n = noticesFrom({
      timeline: [T('베타테스트', '진행중', '2026-07-28 09:00:00', '1차 시험 — 차단 (통과 4, 실패 1)')],
    })
    expect(n[0].headline).toContain('고치는 중')
  })

  it('배포를 되돌렸으면 내렸다고 적는다', () => {
    const n = noticesFrom({
      timeline: [T('배포', '되돌림', '2026-07-31 10:00:00', '문제가 있어 잠시 내렸습니다.')],
    })
    expect(n[0].headline).toContain('내렸습니다')
  })

  it('판정 이유 같은 자세한 것을 함께 나른다', () => {
    const n = noticesFrom({
      timeline: [
        T('검토', '완료', '2026-07-25 09:00:00', '반려했습니다 — 범위 밖', {
          detail: { 판정_이유: '다른 시스템에 직접 쓰는 일이라 위험합니다.' },
        }),
      ],
    })
    expect(n[0].detail.판정_이유).toContain('직접 쓰는 일')
  })

  it('타임라인이 없어도 터지지 않는다', () => {
    expect(noticesFrom({})).toEqual([])
    expect(noticesFrom(undefined)).toEqual([])
  })
})

describe('해주실 일', () => {
  it('넘겼는데 확인이 없으면 확인해달라고 한다', () => {
    const a = actionsFrom({ needs: [{ code: 'handover_unconfirmed', link: '/t/settlement' }] })
    expect(a).toHaveLength(1)
    expect(a[0].headline).toContain('받으셨는지 확인')
    expect(a[0].link).toBe('/t/settlement')
  })

  it('왜 해야 하는지를 반드시 함께 적는다', () => {
    // 이유 없이 시키면 아무도 안 한다.
    const a = actionsFrom({
      needs: [{ code: 'handover_unconfirmed' }, { code: 'outcome_unconfirmed' }],
    })
    expect(a).toHaveLength(2)
    for (const x of a) expect(x.why).toBeTruthy()
  })

  it('보류 조건은 서버가 준 문장을 그대로 쓴다', () => {
    const a = actionsFrom({
      needs: [{ code: 'hold_condition', body: '원천 파일에 상품코드가 붙으면 다시 봅니다.' }],
    })
    expect(a[0].body).toBe('원천 파일에 상품코드가 붙으면 다시 봅니다.')
  })

  it('모르는 코드는 조용히 버린다', () => {
    // 서버가 새 코드를 먼저 내보내도 화면이 깨지지 않아야 한다.
    const a = actionsFrom({ needs: [{ code: '아직없는것' }, { code: 'beta_feedback' }] })
    expect(a).toHaveLength(1)
    expect(a[0].code).toBe('beta_feedback')
  })

  it('할 일이 없으면 빈 배열이다', () => {
    expect(actionsFrom({ needs: [] })).toEqual([])
    expect(actionsFrom({})).toEqual([])
    expect(actionsFrom(undefined)).toEqual([])
  })
})

describe('지난번 본 뒤로 새로 생긴 것', () => {
  const NOTICES = [
    { key: '배포', at: '2026-07-30 10:00:00' },
    { key: '검토', at: '2026-07-25 09:00:00' },
    { key: '신청서', at: '2026-07-21 11:09:00' },
  ]

  it('마지막으로 본 시각 뒤의 것만 센다', () => {
    expect(newSince(NOTICES, '2026-07-25 09:00:00').map((n) => n.key)).toEqual(['배포'])
  })

  it('처음 열었으면 새 것으로 표시하지 않는다', () => {
    // 처음 온 사람에게 "새 소식 8건"을 띄우면 전부 새 것이라 아무 뜻이 없다.
    expect(newSince(NOTICES, null)).toEqual([])
    expect(newSince(NOTICES, '')).toEqual([])
  })

  it('마지막으로 본 뒤 아무 일도 없었으면 없다', () => {
    expect(newSince(NOTICES, '2026-07-31 00:00:00')).toEqual([])
  })

  it('소식이 없어도 터지지 않는다', () => {
    expect(newSince(undefined, '2026-07-25 09:00:00')).toEqual([])
  })
})

describe('브라우저에 남기는 열쇠', () => {
  it('접수번호마다 다르다', () => {
    expect(seenKey('AX-ABC-123')).not.toBe(seenKey('AX-DEF-456'))
  })

  it('소문자로 쳐도 같은 열쇠다', () => {
    expect(seenKey('ax-abc-123')).toBe(seenKey('AX-ABC-123'))
  })
})
