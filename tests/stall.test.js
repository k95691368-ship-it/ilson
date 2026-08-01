import { describe, it, expect } from 'vitest'
import {
  spansOf,
  stallOf,
  stallBoard,
  stageTypical,
  boardLine,
  toMs,
  STALL_RULES,
  ESCALATE,
  HOLD_LIMIT,
  MIN_SAMPLE,
} from '../shared/stall.js'

// 이 화면이 잔소리가 되지 않으려면 두 가지를 지켜야 한다.
//   ① 단계마다 잣대가 달라야 한다 — 검토와 제작에 같은 날짜를 대면
//      제작은 늘 빨간불, 검토는 늘 파란불이라 둘 다 뜻이 없어진다.
//   ② 늦었다고 할 때 누구를 기다리는지 같이 말해야 한다 — 부서가 안 써 본
//      것을 담당자가 자기 잘못으로 받으면 두 번째부터 이 화면을 안 본다.

const DAY = 86400000
const NOW = Date.parse('2026-08-02T00:00:00Z')
const ago = (d) => new Date(NOW - d * DAY).toISOString().replace('T', ' ').slice(0, 19)

const app = (o = {}) => ({
  id: 'a1',
  ticket_no: 'AX-001',
  dept: '재무',
  title: '정산 합치기',
  status: '진행중',
  created_at: ago(20),
  ...o,
})

describe('언제부터 언제까지 어느 단계에 있었나', () => {
  it('기록이 없으면 낸 그대로 신청서 단계다', () => {
    const s = spansOf([], NOW, ago(3))
    expect(s).toHaveLength(1)
    expect(s[0].stage).toBe('신청서')
    expect(s[0].days).toBe(3)
    expect(s[0].open).toBe(true)
  })

  it('첫 기록 전까지의 공백도 신청서 단계로 센다', () => {
    // 부서가 내고 담당자가 처음 손대기까지의 시간. 가장 자주 잊히는 구간이다.
    const s = spansOf([{ stage: '검토', created_at: ago(10) }], NOW, ago(14))
    expect(s[0].stage).toBe('신청서')
    expect(s[0].days).toBe(4)
  })

  it('되돌아간 단계를 하나로 합치지 않는다', () => {
    // 베타에서 떨어져 제작으로 내려간 뒤 다시 만든 기간이 통째로 사라지면 안 된다.
    const s = spansOf(
      [
        { stage: '제작', created_at: ago(20) },
        { stage: '베타테스트', created_at: ago(15) },
        { stage: '제작', created_at: ago(12) },
        { stage: '베타테스트', created_at: ago(4) },
      ],
      NOW,
      ago(20)
    )
    const builds = s.filter((x) => x.stage === '제작')
    expect(builds).toHaveLength(2)
    expect(builds[0].days).toBe(5)
    // 두 번째 제작은 8일 걸렸다. 합쳐 버리면 이 8일이 사라진다.
    expect(builds[1].days).toBe(8)
  })

  it('지난 단계에 뒤늦게 붙인 메모를 되돌아간 것으로 읽지 않는다', () => {
    // 라이브에서 바로 걸린 것이다. 이미 배포까지 간 신청서 넷이 전부
    // "검토 단계에 있음"으로 나왔다 — 접수함 일괄 "봤다고 알리기"가
    // 검토 단계 기록을 하나 붙였기 때문이다.
    const s = spansOf(
      [
        { stage: '배포', created_at: ago(20) },
        { stage: '성과', created_at: ago(12) },
        { stage: '검토', created_at: ago(1) },
      ],
      NOW,
      ago(40)
    )
    expect(s[s.length - 1].stage).toBe('성과')
    expect(s.some((x) => x.stage === '검토')).toBe(false)
  })

  it('중간에 낀 메모도 구간을 만들지 않는다', () => {
    // 내려갔다가 원래 자리보다 더 앞으로 가 버리면 되돌아간 것이 아니다.
    const s = spansOf(
      [
        { stage: '배포', created_at: ago(20) },
        { stage: '검토', created_at: ago(15) },
        { stage: '성과', created_at: ago(10) },
      ],
      NOW,
      ago(30)
    )
    expect(s.map((x) => x.stage)).toEqual(['신청서', '배포', '성과'])
  })

  it('같은 단계 기록이 여러 개여도 한 구간이다', () => {
    const s = spansOf(
      [
        { stage: '제작', created_at: ago(9) },
        { stage: '제작', created_at: ago(7) },
        { stage: '제작', created_at: ago(5) },
      ],
      NOW,
      ago(9)
    )
    expect(s.filter((x) => x.stage === '제작')).toHaveLength(1)
  })

  it('마지막 구간만 열려 있다', () => {
    const s = spansOf(
      [
        { stage: '검토', created_at: ago(8) },
        { stage: '협의안', created_at: ago(3) },
      ],
      NOW,
      ago(9)
    )
    expect(s.filter((x) => x.open)).toHaveLength(1)
    expect(s[s.length - 1].open).toBe(true)
  })

  it('순서가 섞여 들어와도 시각 순으로 본다', () => {
    const s = spansOf(
      [
        { stage: '협의안', created_at: ago(2) },
        { stage: '검토', created_at: ago(6) },
      ],
      NOW,
      ago(6)
    )
    expect(s.map((x) => x.stage)).toEqual(['검토', '협의안'])
  })

  it('모르는 단계 이름과 깨진 시각은 버린다', () => {
    const s = spansOf(
      [
        { stage: '없는단계', created_at: ago(5) },
        { stage: '검토', created_at: '말도 안 되는 값' },
        { stage: '검토', created_at: ago(2) },
      ],
      NOW,
      ago(5)
    )
    expect(s.every((x) => STALL_RULES[x.stage])).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(spansOf(undefined, NOW, null)).toEqual([])
    expect(() => spansOf(null, NOW, ago(1))).not.toThrow()
  })
})

describe('단계마다 잣대가 다르다', () => {
  it('검토는 제작보다 빨리 늦어진다', () => {
    expect(STALL_RULES['검토'].limit).toBeLessThan(STALL_RULES['제작'].limit)
  })

  it('사흘 걸린 검토는 늦은 것이고 사흘 걸린 제작은 아니다', () => {
    const logs = (stage) => [{ stage, created_at: ago(3) }]
    expect(stallOf(app(), logs('검토'), NOW).level).not.toBe('괜찮음')
    expect(stallOf(app(), logs('제작'), NOW).level).toBe('괜찮음')
  })

  it('단계마다 무엇을 하면 되는지가 적혀 있다', () => {
    // 늦었다는 말만 있고 할 일이 없으면 그 화면은 잔소리다.
    for (const rule of Object.values(STALL_RULES)) {
      expect(rule.next.length).toBeGreaterThan(20)
      expect(rule.to).toMatch(/^\//)
      expect(rule.act).toBeTruthy()
    }
  })
})

describe('누구를 기다리는가', () => {
  it('베타 테스트에서 멈춘 것은 부서를 기다리는 것이다', () => {
    const s = stallOf(app(), [{ stage: '베타테스트', created_at: ago(7) }], NOW)
    expect(s.waitingOn).toBe('dept')
    expect(s.mine).toBe(false)
  })

  it('사용법서에서 멈춘 것은 담당자 몫이다', () => {
    const s = stallOf(app(), [{ stage: '사용법서', created_at: ago(7) }], NOW)
    expect(s.mine).toBe(true)
  })

  it('부서를 너무 오래 기다린 것은 담당자 몫이 된다', () => {
    // "부서가 답을 안 준다"는 한 주까지는 사실이다. 3주가 되면 그건
    // 한 번도 안 물어본 사람 몫이다.
    const long = STALL_RULES['베타테스트'].limit * ESCALATE + 2
    const s = stallOf(app(), [{ stage: '베타테스트', created_at: ago(long) }], NOW)
    expect(s.mine).toBe(true)
    expect(s.next).toContain('안 물어본')
  })
})

describe('끝난 것과 미뤄 둔 것', () => {
  it('반려·완료는 늦었다고 세지 않는다', () => {
    const logs = [{ stage: '검토', created_at: ago(30) }]
    expect(stallOf(app({ status: '반려' }), logs, NOW)).toBeNull()
    expect(stallOf(app({ status: '완료' }), logs, NOW)).toBeNull()
  })

  it('보류는 늦은 것이 아니라 미뤄 둔 것이다', () => {
    // 판정을 했고 이유도 적혀 있다. 같은 잣대를 대면 안 된다.
    const logs = [{ stage: '검토', created_at: ago(10) }]
    const s = stallOf(app({ status: '보류' }), logs, NOW)
    expect(s.held).toBe(true)
    expect(s.level).toBe('괜찮음')
  })

  it('한 달 넘게 미뤄 둔 것은 다시 보라고 한다', () => {
    const logs = [{ stage: '검토', created_at: ago(HOLD_LIMIT + 5) }]
    const s = stallOf(app({ status: '보류' }), logs, NOW)
    expect(s.level).toBe('늦음')
    expect(s.next).toContain('다시')
  })
})

describe('보통 며칠 걸리는가', () => {
  const spans = (stage, days) => days.map((d) => ({ stage, days: d, open: false }))

  it('표본이 모자라면 숫자를 안 준다', () => {
    // 한 건 보고 "보통 2일"이라고 하면 그 다음부터 아무도 안 믿는다.
    const t = stageTypical(spans('검토', [2, 3]))
    const row = t.find((x) => x.stage === '검토')
    expect(row.enough).toBe(false)
    expect(row.median).toBeNull()
  })

  it('표본이 차면 가운뎃값을 준다', () => {
    const t = stageTypical(spans('검토', Array(MIN_SAMPLE).fill(0).map((_, i) => i + 1)))
    expect(t.find((x) => x.stage === '검토').median).toBe(2)
  })

  it('아직 안 끝난 구간은 안 센다', () => {
    // 열려 있는 것을 세면 오래 걸리는 단계일수록 짧아 보이는 거꾸로 된
    // 숫자가 나온다.
    const t = stageTypical([
      ...spans('제작', [10, 12, 14]),
      { stage: '제작', days: 1, open: true },
    ])
    expect(t.find((x) => x.stage === '제작').n).toBe(3)
  })

  it('여덟 단계를 다 돌려준다', () => {
    expect(stageTypical([])).toHaveLength(8)
  })
})

describe('목록 세우기', () => {
  const items = [
    // 부서를 기다리는 늦은 건
    { application: app({ id: 'b', ticket_no: 'AX-B' }), logs: [{ stage: '베타테스트', created_at: ago(7) }] },
    // 내가 움직여야 하는 늦은 건
    { application: app({ id: 'c', ticket_no: 'AX-C' }), logs: [{ stage: '사용법서', created_at: ago(6) }] },
    // 제때 가는 건
    { application: app({ id: 'd', ticket_no: 'AX-D' }), logs: [{ stage: '제작', created_at: ago(2) }] },
    // 끝난 건
    { application: app({ id: 'e', ticket_no: 'AX-E', status: '완료' }), logs: [] },
  ]

  it('내가 움직여야 풀리는 것이 위로 온다', () => {
    // 부서 답을 기다리는 건이 맨 위면 담당자는 목록을 보고 할 수 있는 게 없다.
    expect(stallBoard(items, NOW).stalls[0].ticket_no).toBe('AX-C')
  })

  it('제때 가는 것은 늦은 목록에 안 넣는다', () => {
    const b = stallBoard(items, NOW)
    expect(b.stalls.map((s) => s.ticket_no)).not.toContain('AX-D')
    expect(b.onTrack.map((s) => s.ticket_no)).toContain('AX-D')
  })

  it('끝난 것은 어느 쪽에도 안 센다', () => {
    const b = stallBoard(items, NOW)
    expect(b.summary.moving).toBe(3)
  })

  it('내 몫과 부서 몫을 나눠 센다', () => {
    const s = stallBoard(items, NOW).summary
    expect(s.late).toBe(2)
    expect(s.mine).toBe(1)
    expect(s.waitingDept).toBe(1)
  })

  it('앞 두 단계는 첫 화면에 넘기는 수에서 뺀다', () => {
    // 첫 화면의 할 일 목록은 "하루 넘게 못 본 신청서"를 이미 세고 있다.
    // 여기서 또 세면 같은 건이 두 줄에 올라가고, 담당자는 두 배로 밀린 줄 안다.
    const early = [
      { application: app({ id: 'x', ticket_no: 'AX-X' }), logs: [{ stage: '검토', created_at: ago(9) }] },
      { application: app({ id: 'y', ticket_no: 'AX-Y' }), logs: [{ stage: '사용법서', created_at: ago(9) }] },
    ]
    const s = stallBoard(early, NOW).summary
    expect(s.mine).toBe(2)
    expect(s.mineLater).toBe(1)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(stallBoard([], NOW).summary.late).toBe(0)
    expect(() => stallBoard(undefined, NOW)).not.toThrow()
  })
})

describe('한 줄 요약', () => {
  it('진행 중인 것이 없으면 그렇게 말한다', () => {
    expect(boardLine({ moving: 0 })).toContain('없습니다')
  })

  it('다 제때 가면 늦었다는 말을 안 한다', () => {
    expect(boardLine({ moving: 4, late: 0 })).not.toContain('오래')
  })

  it('늦은 것이 있으면 내 몫과 부서 몫을 나눠 말한다', () => {
    const line = boardLine({ moving: 5, late: 3, mine: 2, waitingDept: 1 })
    expect(line).toContain('2건은 제가')
    expect(line).toContain('1건은 부서')
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(() => boardLine()).not.toThrow()
  })
})

describe('시각 읽기', () => {
  it('D1이 주는 모양을 읽는다', () => {
    expect(toMs('2026-08-01 12:00:00')).toBe(Date.parse('2026-08-01T12:00:00Z'))
  })

  it('못 읽는 값은 null이다', () => {
    expect(toMs('')).toBeNull()
    expect(toMs(null)).toBeNull()
    expect(toMs('어제')).toBeNull()
  })
})
