import { describe, it, expect } from 'vitest'
import { noticesFrom, actionsFrom, newSince, seenKey, readableWhy } from '../shared/notice.js'

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

// 반려된 신청서를 고쳐서 다시 낸 것은 여섯 단계 타임라인에 안 나온다.
// 한 신청서 안에서 일어난 일이 아니라 두 신청서 사이에서 일어난 일이라서다.
// 안 뽑으면 부서가 앞 접수번호를 다시 열었을 때 "반려했습니다"에서
// 이야기가 끊기고, 자기가 고쳐 낸 것이 어디 갔는지 알 수가 없다.
describe('고쳐서 다시 낸 것', () => {
  const track = (kind, extra = {}) => ({
    timeline: [],
    decisions: [
      {
        id: 'dec_1',
        stage: '신청서',
        title: '무엇',
        what: '즉시가 아니라 하루 한 번으로 바꿨습니다',
        link_kind: kind,
        link_id: 'app_other',
        created_at: '2026-08-02 01:00:00',
        ...extra,
      },
    ],
  })

  it('앞 신청서에서는 어디로 갔는지 알려준다', () => {
    const n = noticesFrom(track('재신청됨', { link_ticket: 'AX-NEW-001' }))[0]
    expect(n.headline).toContain('다시 내셨습니다')
    expect(n.link).toBe('/track?no=AX-NEW-001')
  })

  it('새 신청서에서는 어디서 왔는지 알려준다', () => {
    const n = noticesFrom(track('재신청', { link_ticket: 'AX-OLD-001' }))[0]
    expect(n.headline).toContain('고쳐서 내신 것')
    expect(n.link).toBe('/track?no=AX-OLD-001')
  })

  it('상대 신청서가 없으면 링크를 안 건다', () => {
    // 없는 데로 보내는 버튼보다 버튼이 없는 편이 낫다.
    expect(noticesFrom(track('재신청', { link_ticket: null }))[0].link).toBeNull()
  })

  it('접수 소식과 열쇠가 부딪치지 않는다', () => {
    const t = track('재신청됨', { link_ticket: 'AX-N' })
    t.timeline = [{ stage: '신청서', status: '완료', at: '2026-08-01 00:00:00', summary: '냈습니다' }]
    const keys = noticesFrom(t).map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('기록이 없어도 터지지 않는다', () => {
    expect(() => noticesFrom({ timeline: [] })).not.toThrow()
  })
})

// 부서가 손들면 그 자리에서 고맙다는 말은 나가는데, 그 뒤로 아무것도
// 안 보였다. 손든 부서는 자기가 붙였다는 사실이 남아 있는지도 모르고,
// 담당자가 "이건 다른 건입니다"로 풀어 버려도 알 길이 없다.
describe('손든 것과 풀린 것', () => {
  const join = (extra = {}) => ({
    id: 'dec_j1',
    title: '마케팅 — 우리도 같은 일을 겪는다',
    what: '저희도 매주 채널별로 숫자를 옮겨 적습니다',
    why: JSON.stringify({ dept: '마케팅', by: '이과장', minutes: 60 }),
    link_kind: '같은건손듦',
    link_id: 'app_1',
    created_at: '2026-08-02 01:00:00',
    ...extra,
  })
  const unjoin = {
    id: 'dec_u1',
    title: 'AX 담당자',
    what: '영업은 월말 마감 자료라 원본이 다릅니다',
    why: '',
    link_kind: '같은건아님',
    link_id: 'dec_j1',
    created_at: '2026-08-02 02:00:00',
  }

  it('손든 것이 소식에 뜬다', () => {
    const n = noticesFrom({ timeline: [], decisions: [join()] })[0]
    expect(n.headline).toContain('마케팅')
    expect(n.body).toContain('옮겨 적습니다')
  })

  it('풀렸으면 따로 내시라고 알린다', () => {
    // 안 알리면 그 부서는 이 건이 자기 것도 해결해 줄 줄 알고 계속 기다린다.
    const list = noticesFrom({ timeline: [], decisions: [join(), unjoin] })
    const said = list.find((x) => x.headline.includes('다른 것으로 판정'))
    expect(said).toBeTruthy()
    expect(said.body).toContain('따로 신청서를 내')
    expect(said.link).toBe('/apply')
  })

  it('풀린 손듦은 붙은 채로 안 보인다', () => {
    const list = noticesFrom({ timeline: [], decisions: [join(), unjoin] })
    const first = list.find((x) => x.key.startsWith('join:'))
    expect(first.headline).toContain('다른 건으로 판정')
  })

  it('부서를 못 읽어도 터지지 않는다', () => {
    const broken = join({ why: '깨진 값', title: '' })
    expect(() => noticesFrom({ timeline: [], decisions: [broken] })).not.toThrow()
  })

  it('열쇠가 다른 소식과 안 부딪힌다', () => {
    const t = { timeline: [{ stage: '신청서', status: '완료', at: '2026-08-01 00:00:00', summary: '냈습니다' }], decisions: [join(), unjoin] }
    const keys = noticesFrom(t).map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

// 손들기 기록의 why 칸에 JSON을 넣어 뒀다. 그래서 첫 화면 "최근 결정"과
// /log에 {"dept":"재무",...}가 통째로 찍혔다. 이 사이트가 스스로 핵심
// 증거라고 내세운 자리다.
//
// 쓰는 쪽은 고쳤지만 이미 쌓인 기록은 그대로 있다. decision_log는 일부러
// 못 지우게 만든 표라 지울 수도 없다.
describe('결정 기록의 "왜"', () => {
  it('사람이 읽을 말이면 그대로 준다', () => {
    expect(readableWhy('두 부서가 같은 일을 따로 겪고 있다')).toBe('두 부서가 같은 일을 따로 겪고 있다')
  })

  it('JSON이면 안 그린다', () => {
    expect(readableWhy('{"dept":"재무","minutes":90}')).toBeNull()
    expect(readableWhy('  [1,2,3]  ')).toBeNull()
  })

  it('빈 값이면 안 그린다', () => {
    expect(readableWhy('')).toBeNull()
    expect(readableWhy('   ')).toBeNull()
    expect(readableWhy(null)).toBeNull()
    expect(() => readableWhy()).not.toThrow()
  })

  it('중괄호가 문장 안에 있는 것은 그대로 준다', () => {
    // 여는 괄호로 시작할 때만 JSON으로 본다.
    expect(readableWhy('규칙이 {a}를 본다')).toBe('규칙이 {a}를 본다')
  })
})
