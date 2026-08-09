import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
import { waitLine, unrankedPressure, UNRANKED_LIMIT, leadGuess } from '../shared/waitline.js'

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

// decision_log의 what과 why는 다른 것이 들어간다.
//
// what = 담당자가 이 건에 대해 적은 말, why = "왜 이런 기록을 남기는가"라는
// 설계 취지(대개 코드에 박힌 고정 문장). 부서에게 보여야 하는 것은 앞엣것인데
// why를 읽어서, 화면에 "무엇을 먼저 할지 고른 것이 이 일에서 가장 사람다운
// 판단이다"가 떴다. 담당자가 적은 말이 아니라 기능 소개문이다.
describe('부서에게 보이는 이유는 담당자가 적은 말이다', () => {
  it('기능 설계 취지가 아니라 이 건의 이유가 온다', () => {
    const s = waitLine({
      mine: { id: 'app_me', status: '수용' },
      picked: [
        {
          application_id: 'app_a',
          dept: 'SCM',
          title: '재고 소진일',
          status: '수용',
          why: '재고가 떨어지면 그날 매출이 통째로 빈다',
          at: '2026-08-05 00:00:00',
        },
      ],
      running: [],
    })
    const shown = s.aheadPicked[0].why
    expect(shown).toBe('재고가 떨어지면 그날 매출이 통째로 빈다')
    // 설계 취지 문구가 새어 나오면 안 된다.
    expect(shown).not.toContain('가장 사람다운 판단')
  })

  it('이유가 비어 있어도 터지지 않는다', () => {
    const s = waitLine({
      mine: { id: 'app_me', status: '수용' },
      picked: [{ application_id: 'app_a', dept: 'SCM', title: 'x', status: '수용', why: null }],
      running: [],
    })
    expect(s.aheadPicked[0].why).toBeNull()
    expect(s.phase).toBe('behind')
  })
})

// "그래서 언제쯤 됩니까"
//
// 부서가 제일 먼저 묻는 것이 이것인데 이 화면은 순서만 말했다. "앞에 1건
// 있습니다"는 몇째냐는 답이지 언제냐는 답이 아니다.
//
// 날짜를 약속하지 않는다. 지금까지 실제로 걸린 날수를 보여 준다.
describe('언제쯤 되는지 답하는가', () => {
  it('끝까지 간 것이 없으면 지어내지 않는다', () => {
    // 여기서 아무 숫자나 적으면 그 화면은 그 뒤로 안 읽힌다.
    const g = leadGuess({ count: 0, medianDays: null })
    expect(g.text).toContain('지어내지 않겠습니다')
    expect(g.shaky).toBe(true)
  })

  it('값이 깨져 있어도 지어내지 않는다', () => {
    expect(leadGuess(null).shaky).toBe(true)
    expect(leadGuess({ count: 3, medianDays: null }).shaky).toBe(true)
  })

  it('한두 건뿐이면 그 사실을 먼저 말한다', () => {
    // 한 건 넘겨 놓고 "보통 9일 걸립니다"라고 하면 통계가 아니라 우연이다.
    const g = leadGuess({ count: 2, medianDays: 9 })
    expect(g.text).toContain('9일')
    expect(g.text).toContain('크게 달라질 수 있습니다')
    expect(g.shaky).toBe(true)
  })

  it('쌓이면 그대로 말한다', () => {
    const g = leadGuess({ count: 5, medianDays: 12.5 })
    expect(g.text).toContain('5건')
    expect(g.text).toContain('12.5일')
    expect(g.shaky).toBe(false)
  })

  it('앞에 놓인 것이 있으면 더 걸린다고 말한다', () => {
    // 가운데값만 적으면 뒤에 선 부서가 그 날수를 자기 것으로 읽는다.
    expect(leadGuess({ count: 5, medianDays: 12 }).text).toContain('앞에 놓인 건이 있으면')
  })

  it('화면이 그 값을 그린다', () => {
    const page = readFileSync(join(ROOT, 'src', 'pages', 'TrackPage.jsx'), 'utf8')
    expect(page).toContain('lead?.show')
    expect(page).toContain('언제쯤 되나')
    // 서버가 보내 주는 것을 실제로 받아 둬야 한다.
    expect(page).toContain('setLead(r.lead')
  })

  it('첫 화면과 같은 방식으로 센다', () => {
    // 두 화면이 다른 날수를 말하면 둘 다 못 믿는다.
    const route = readFileSync(
      join(ROOT, 'functions', 'api', 'track', '[ticket]', 'waitline.js'),
      'utf8'
    )
    expect(route).toContain('h.rolled_back_at IS NULL')
    expect(route).toContain('julianday(h.handed_at) - julianday(a.created_at)')
  })
})
