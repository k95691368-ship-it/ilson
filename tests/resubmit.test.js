import { describe, it, expect } from 'vitest'
import {
  retryPlan,
  validateResubmit,
  carryOver,
  resubmitNote,
  RETRY_ADVICE,
  RETRY_KINDS,
  MAX_RESUBMIT,
  MIN_CHANGED,
} from '../shared/resubmit.js'
import { REFUSE_CODES } from '../shared/review.js'

// 반려가 막다른 길이면 부서는 대안을 읽고 끝난다. 그렇다고 다시 내기를
// 그냥 열어 두면 반려가 뜻이 없어진다 — 같은 것이 그대로 다시 오고,
// 담당자는 같은 판정을 두 번 한다.
//
// 그래서 여기서 지켜야 할 것은 "다시 낼 수 있는가"가 아니라
// "헛수고를 시키지 않는가"다.

describe('반려 사유마다 다시 내면 어떻게 되는지 말한다', () => {
  it('모든 반려 사유에 답이 있다', () => {
    // 하나라도 빠지면 그 사유로 반려당한 부서는 아무 안내도 못 받는다.
    for (const code of REFUSE_CODES) {
      expect(RETRY_ADVICE[code]).toBeTruthy()
      expect(RETRY_KINDS[RETRY_ADVICE[code].kind]).toBeTruthy()
    }
  })

  it('무엇을 어떻게 바꾸면 되는지까지 적혀 있다', () => {
    // 대안을 읽는 것과 그 대안대로 신청서를 고치는 것은 다른 일이다.
    for (const code of REFUSE_CODES) {
      expect(RETRY_ADVICE[code].change.length).toBeGreaterThan(25)
    }
  })

  it('안 되는 것은 안 된다고 한다', () => {
    // 헛수고를 시키지 않는 것이 이 화면의 핵심이다.
    expect(retryPlan({ refuseCode: 'media_gen' }).canRetry).toBe(false)
    expect(retryPlan({ refuseCode: 'media_gen' }).cta).toBeNull()
  })

  it('범위를 줄이면 되는 것은 그렇게 말한다', () => {
    const p = retryPlan({ refuseCode: 'external_write' })
    expect(p.canRetry).toBe(true)
    expect(p.change).toContain('파일까지')
  })

  it('사유를 직접 적은 건은 먼저 물어보라고 한다', () => {
    // 규칙으로 정할 수 없는 것을 정한 척하면 안 된다.
    expect(retryPlan({ refuseCode: 'other' }).canRetry).toBe(false)
  })

  it('모르는 사유가 와도 터지지 않는다', () => {
    expect(() => retryPlan({ refuseCode: '없는사유' })).not.toThrow()
    expect(() => retryPlan()).not.toThrow()
  })
})

describe('담당자가 직접 쓴 대안을 앞세운다', () => {
  it('있으면 그것도 같이 준다', () => {
    // 규칙이 만든 일반론보다 이 건을 보고 쓴 한 줄이 언제나 낫다.
    const p = retryPlan({ refuseCode: 'realtime', refuseAlternative: '금요일 저녁에 한 번 돌립시다' })
    expect(p.fromReviewer).toBe('금요일 저녁에 한 번 돌립시다')
  })

  it('없으면 null이다', () => {
    expect(retryPlan({ refuseCode: 'realtime' }).fromReviewer).toBeNull()
    expect(retryPlan({ refuseCode: 'realtime', refuseAlternative: '   ' }).fromReviewer).toBeNull()
  })
})

describe('몇 번까지 다시 낼 수 있나', () => {
  it('처음에는 두 번 남았다고 말한다', () => {
    expect(retryPlan({ refuseCode: 'realtime' }).left).toBe(MAX_RESUBMIT)
  })

  it('한 번 냈으면 한 번 줄어든다', () => {
    expect(retryPlan({ refuseCode: 'realtime', timesResubmitted: 1 }).left).toBe(MAX_RESUBMIT - 1)
  })

  it('다 쓰면 사유와 상관없이 막는다', () => {
    // 두 번을 고쳐 냈는데도 반려됐으면 글로는 안 풀리는 것이다.
    const p = retryPlan({ refuseCode: 'realtime', timesResubmitted: MAX_RESUBMIT })
    expect(p.canRetry).toBe(false)
    expect(p.change).toContain('담당자')
  })

  it('막을 때도 그냥 막지 않고 무엇을 하라고 말한다', () => {
    const p = retryPlan({ refuseCode: 'realtime', timesResubmitted: 5 })
    expect(p.headline).toContain('5번')
    expect(p.change.length).toBeGreaterThan(20)
  })

  it('이상한 횟수가 와도 터지지 않는다', () => {
    expect(retryPlan({ refuseCode: 'realtime', timesResubmitted: null }).left).toBe(MAX_RESUBMIT)
    expect(retryPlan({ refuseCode: 'realtime', timesResubmitted: -3 }).left).toBe(MAX_RESUBMIT)
    expect(retryPlan({ refuseCode: 'realtime', timesResubmitted: '어제' }).left).toBe(MAX_RESUBMIT)
  })
})

describe('다시 낼 때 적어야 하는 것', () => {
  const good = {
    changed: '등록까지가 아니라 올릴 파일까지만 해 주시면 됩니다',
    title: '정산 파일 합치기',
    bottleneck: '매주 다섯 채널을 손으로 붙입니다',
    problem: '월요일 오전이 통째로 날아갑니다',
  }

  it('제대로 적었으면 통과한다', () => {
    expect(validateResubmit(good)).toEqual({})
  })

  it('무엇을 바꿨는지 안 적으면 막는다', () => {
    // 안 적으면 같은 신청서가 그대로 다시 온다.
    expect(validateResubmit({ ...good, changed: '' }).changed).toBeTruthy()
    expect(validateResubmit({ ...good, changed: '고쳤음' }).changed).toBeTruthy()
  })

  it('짧아도 최소한은 적어야 한다', () => {
    const barely = 'ㅇ'.repeat(MIN_CHANGED)
    expect(validateResubmit({ ...good, changed: barely }).changed).toBeUndefined()
  })

  it('본문이 비면 막는다', () => {
    expect(validateResubmit({ ...good, title: '' }).title).toBeTruthy()
    expect(validateResubmit({ ...good, bottleneck: '  ' }).bottleneck).toBeTruthy()
    expect(validateResubmit({ ...good, problem: null }).problem).toBeTruthy()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateResubmit()).not.toThrow()
  })
})

describe('앞 신청서에서 가져올 것', () => {
  const prev = {
    dept: '재무',
    applicant_label: '김대리',
    contact: 'kim@x.com',
    title: '정산',
    bottleneck: '손으로 붙임',
    problem: '오래 걸림',
    current_minutes: 90,
    id: 'app_1',
    status: '반려',
  }

  it('부서와 신청자는 다시 묻지 않는다', () => {
    // 같은 사람이 같은 일로 다시 내는 것이라 물어볼 이유가 없고,
    // 물으면 그것만으로 그만두는 사람이 생긴다.
    const c = carryOver(prev)
    expect(c.dept).toBe('재무')
    expect(c.applicant_label).toBe('김대리')
    expect(c.contact).toBe('kim@x.com')
  })

  it('앞 신청서의 id와 상태는 안 가져온다', () => {
    // 가져오면 새 신청서가 반려 상태로 태어난다.
    const c = carryOver(prev)
    expect(c.id).toBeUndefined()
    expect(c.status).toBeUndefined()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => carryOver()).not.toThrow()
    expect(carryOver().dept).toBe('')
  })
})

describe('양쪽 기록에 서로 다른 이름을 쓴다', () => {
  it('새 신청서 쪽과 앞 신청서 쪽이 구분된다', async () => {
    // 둘 다 같은 이름이면, 기록 한 줄만 보고는 이것이 "고쳐서 낸 새
    // 신청서"인지 "고쳐서 다시 내신 앞 신청서"인지 가릴 수 없다. 제목
    // 글자를 뒤져 가리는 방법은 문구를 고치는 날 조용히 틀린다.
    const { RESUBMIT_KIND, RESUBMIT_BACK_KIND } = await import('../shared/resubmit.js')
    expect(RESUBMIT_KIND).not.toBe(RESUBMIT_BACK_KIND)
  })
})

describe('접수함에 보이는 한 줄', () => {
  it('앞 접수번호와 바뀐 점을 같이 적는다', () => {
    // 새 신청서처럼 섞여 들어오면 담당자는 자기가 반려한 것인 줄 모르고
    // 처음부터 다시 읽는다.
    const note = resubmitNote({ previousTicket: 'AX-ABC-123', changed: '범위를 줄였습니다', times: 1 })
    expect(note).toContain('AX-ABC-123')
    expect(note).toContain('범위를 줄였습니다')
  })

  it('두 번째부터는 몇 번째인지 적는다', () => {
    expect(resubmitNote({ previousTicket: 'AX-A', changed: 'x', times: 2 })).toContain('2번째')
    expect(resubmitNote({ previousTicket: 'AX-A', changed: 'x', times: 1 })).not.toContain('1번째')
  })
})
