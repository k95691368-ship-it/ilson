import { describe, it, expect } from 'vitest'
import { waitLine, unrankedPressure, UNRANKED_LIMIT } from '../shared/waitline.js'

// 부서가 조회 화면을 여는 이유는 대개 하나다. 낸 지 2주가 됐는데 아무 소식이
// 없어서다. "신청서 단계에 있습니다"는 이미 아는 것이고, 알고 싶은 것은
// 내 앞에 무엇이 있고 왜 그것이 먼저인가다.
//
// 담당자는 우선순위 판에서 무엇을 먼저 할지 고를 때 이유를 반드시 적는다.
// 그 입력칸 안내문이 "뒤로 밀린 부서가 물어볼 때 답할 것이 있어야 합니다"인데,
// 그 답을 부서가 볼 자리에 안 뒀다.

const me = { id: 'app_me', ticket_no: 'AX-ME-001', status: '수용' }
const pick = (id, why, over = {}) => ({
  application_id: id,
  ticket_no: id,
  dept: '마케팅',
  title: '광고비를 손으로 붙입니다',
  status: '수용',
  why,
  at: '2026-08-01 00:00:00',
  ...over,
})

describe('판정 전에는 순서 이야기를 안 한다', () => {
  it('접수면 판정이 먼저라고 말한다', () => {
    // 아직 하기로 한 것도 아닌데 "몇 번째"라고 하면 받아들여진 줄 안다.
    const s = waitLine({ mine: { ...me, status: '접수' }, picked: [], running: [] })
    expect(s.show).toBe(true)
    expect(s.phase).toBe('before')
    expect(s.headline).toContain('판정 전')
  })

  it('반려·완료면 아무 말도 안 한다', () => {
    for (const status of ['반려', '완료']) {
      expect(waitLine({ mine: { ...me, status }, picked: [], running: [] }).show).toBe(false)
    }
  })

  it('보류는 줄에 서 있지도 않다', () => {
    // 순서 문제가 아니라 조건이 안 풀린 것이다.
    const s = waitLine({ mine: { ...me, status: '보류' }, picked: [], running: [] })
    expect(s.show).toBe(false)
    expect(s.phase).toBe('held')
  })
})

describe('순서를 안 정했으면 안 정했다고 한다', () => {
  it('없는 등수를 지어내지 않는다', () => {
    // 규칙으로 등수를 매겨 보여 주면 담당자가 한 판단이 아닌데 판단처럼 보인다.
    const s = waitLine({ mine: me, picked: [], running: [] })
    expect(s.phase).toBe('unranked')
    expect(s.headline).toContain('아직 순서를 정하지 않았습니다')
  })

  it('"곧 하겠습니다" 같은 말을 안 한다', () => {
    const s = waitLine({ mine: me, picked: [], running: [] })
    expect(s.body).not.toContain('곧')
    // 대신 부서가 할 수 있는 것을 알려준다.
    expect(s.body).toContain('급하시면')
  })
})

describe('앞에 무엇이 있는지', () => {
  const picked = [pick('app_a', '재무 정산은 대표 보고에 들어가고 틀리면 정정 공시까지 간다'), pick('app_b', '다섯 부서가 같은 병목에 손을 들었다')]

  it('몇 건인지와 왜 먼저인지를 같이 말한다', () => {
    const s = waitLine({ mine: me, picked, running: [] })
    expect(s.phase).toBe('behind')
    expect(s.headline).toContain('2건')
    expect(s.aheadPicked).toHaveLength(2)
    // 담당자가 적은 이유가 그대로 온다. 다듬으면 부서가 읽는 것과 기록이
    // 달라진다.
    expect(s.aheadPicked[0].why).toContain('정정 공시')
  })

  it('내 것이 먼저 할 것에 들어 있으면 앞이 없다', () => {
    const s = waitLine({
      mine: me,
      picked: [...picked, pick('app_me', '이 부서가 세 번 물어봤고 매주 반복이다')],
      running: [],
    })
    expect(s.mePicked).toBe(true)
    expect(s.phase).toBe('picked')
    expect(s.aheadPicked).toHaveLength(0)
    expect(s.pickWhy).toContain('세 번 물어봤고')
  })

  it('납득이 안 되면 물어보라고 말한다', () => {
    // 순서는 규칙이 아니라 사람이 정한 것이라 바뀔 수 있다.
    const s = waitLine({ mine: me, picked, running: [] })
    expect(s.body).toContain('납득이 안 되시면')
  })
})

describe('지금 만들고 있는 것', () => {
  it('순서보다 앞에 있는 것은 사실 이쪽이다', () => {
    const s = waitLine({
      mine: me,
      picked: [],
      running: [{ id: 'app_x', dept: '재무', title: '채널 정산 통합' }],
    })
    expect(s.aheadRunning).toHaveLength(1)
  })

  it('내 것이 만들어지는 중이면 내 앞에 있다고 안 한다', () => {
    const s = waitLine({
      mine: { ...me, status: '진행중' },
      picked: [],
      running: [{ id: 'app_me', dept: '재무', title: '내 것' }],
    })
    expect(s.aheadRunning).toHaveLength(0)
  })

  it('먼저 할 것에 들어 있어도 만들고 있는 것은 알려준다', () => {
    const s = waitLine({
      mine: me,
      picked: [pick('app_me', '이 부서가 세 번 물어봤다')],
      running: [{ id: 'app_x', dept: '재무', title: '채널 정산 통합' }],
    })
    expect(s.body).toContain('1건이 끝나는 대로')
  })
})

describe('담당자가 순서를 안 정한 채 여럿이 기다리는가', () => {
  it('한둘이면 잘못이 아니다', () => {
    // 한 건만 있으면 정할 것도 없다.
    expect(unrankedPressure({ waiting: 1, picked: [] }).over).toBe(false)
    expect(unrankedPressure({ waiting: UNRANKED_LIMIT - 1, picked: [] }).over).toBe(false)
  })

  it('여럿이 기다리는데 안 정했으면 짚는다', () => {
    expect(unrankedPressure({ waiting: UNRANKED_LIMIT, picked: [] }).over).toBe(true)
  })

  it('하나라도 정해 뒀으면 안 짚는다', () => {
    expect(unrankedPressure({ waiting: 9, picked: [{ application_id: 'a' }] }).over).toBe(false)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => unrankedPressure()).not.toThrow()
    expect(() => waitLine()).not.toThrow()
    expect(waitLine().show).toBe(false)
  })
})
