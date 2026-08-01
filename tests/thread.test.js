import { describe, it, expect } from 'vitest'
import {
  toThread,
  openQuestions,
  whoseTurn,
  turnLabel,
  validateAsk,
  validateAnswer,
  ASK_KIND,
  ANSWER_KIND,
} from '../shared/thread.js'

// 되묻기가 틀리면 두 가지가 망가진다. 답을 받았는데 아직 기다리는 것처럼
// 보이거나, 답을 못 받았는데 받은 것처럼 보이거나. 둘 다 담당자가 잘못된
// 것을 다음 할 일로 고르게 만든다.

const ask = (id, at, extra = {}) => ({
  id,
  link_kind: ASK_KIND,
  link_id: id,
  title: 'AX 담당자',
  what: '채널이 몇 개인지 알려주실 수 있을까요?',
  why: '채널 수에 따라 만들 수 있는지가 갈립니다.',
  created_at: at,
  ...extra,
})

const answer = (id, at, answersId, extra = {}) => ({
  id,
  link_kind: ANSWER_KIND,
  link_id: answersId,
  title: '정산 담당자',
  what: '다섯 개입니다.',
  why: '부서가 답했습니다.',
  created_at: at,
  ...extra,
})

// 결정 기록에는 판정·반려 같은 것도 같이 들어 있다.
const verdict = {
  id: 'v1',
  link_kind: null,
  link_id: null,
  title: '수용으로 판정',
  what: '만들기로 했다',
  why: '주 1회 반복이고 다섯 부서가 결과를 쓴다',
  created_at: '2026-07-25 09:00:00',
}

describe('주고받은 것만 골라내기', () => {
  it('질문과 답만 남기고 나머지는 뺀다', () => {
    const t = toThread([verdict, ask('q1', '2026-07-26 09:00:00')])
    expect(t).toHaveLength(1)
    expect(t[0].id).toBe('q1')
  })

  it('누가 말한 것인지 가른다', () => {
    const t = toThread([ask('q1', '2026-07-26 09:00:00'), answer('a1', '2026-07-26 10:00:00', 'q1')])
    expect(t.map((m) => m.side)).toEqual(['담당자', '부서'])
  })

  it('시간 순으로 늘어놓는다', () => {
    // 결정 기록이 어떤 순서로 오든 주고받은 순서대로 읽혀야 한다.
    const t = toThread([
      answer('a1', '2026-07-26 10:00:00', 'q1'),
      ask('q1', '2026-07-26 09:00:00'),
    ])
    expect(t.map((m) => m.id)).toEqual(['q1', 'a1'])
  })

  it('질문에는 왜 묻는지가 붙고 답에는 안 붙는다', () => {
    // 왜 묻는지를 같이 보여 줘야 부서가 무엇을 답해야 하는지 안다.
    const t = toThread([ask('q1', '2026-07-26 09:00:00'), answer('a1', '2026-07-26 10:00:00', 'q1')])
    expect(t[0].note).toContain('채널 수에 따라')
    expect(t[1].note).toBeNull()
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(toThread([])).toEqual([])
    expect(toThread(undefined)).toEqual([])
  })
})

describe('아직 답 못 받은 질문', () => {
  it('답이 안 달린 질문은 기다리는 중이다', () => {
    const t = toThread([ask('q1', '2026-07-26 09:00:00')])
    expect(t[0].waiting).toBe(true)
    expect(openQuestions(t)).toHaveLength(1)
  })

  it('답이 달리면 더는 안 기다린다', () => {
    const t = toThread([ask('q1', '2026-07-26 09:00:00'), answer('a1', '2026-07-26 10:00:00', 'q1')])
    expect(t[0].waiting).toBe(false)
    expect(openQuestions(t)).toHaveLength(0)
  })

  it('다른 질문에 달린 답은 이 질문을 닫지 않는다', () => {
    // 질문이 여럿 쌓였을 때 어느 것에 답한 건지 안 따지면, 하나만 답해도
    // 전부 답한 것처럼 보인다.
    const t = toThread([
      ask('q1', '2026-07-26 09:00:00'),
      ask('q2', '2026-07-26 09:05:00'),
      answer('a1', '2026-07-26 10:00:00', 'q2'),
    ])
    expect(openQuestions(t).map((m) => m.id)).toEqual(['q1'])
  })

  it('답 자체는 기다리는 것이 아니다', () => {
    const t = toThread([ask('q1', '2026-07-26 09:00:00'), answer('a1', '2026-07-26 10:00:00', 'q1')])
    expect(t[1].waiting).toBe(false)
  })
})

describe('지금 누구 차례인가', () => {
  it('답을 기다리면 부서 차례다', () => {
    // 부서 답을 기다리는 건을 내 할 일로 세면 접수함이 늘 밀려 있는
    // 것처럼 보인다.
    expect(whoseTurn(toThread([ask('q1', '2026-07-26 09:00:00')]))).toBe('부서')
  })

  it('답을 다 받았으면 담당자 차례다', () => {
    const t = toThread([ask('q1', '2026-07-26 09:00:00'), answer('a1', '2026-07-26 10:00:00', 'q1')])
    expect(whoseTurn(t)).toBe('담당자')
  })

  it('주고받은 것이 없으면 담당자 차례다', () => {
    expect(whoseTurn([])).toBe('담당자')
  })

  it('접수함에 적을 한 줄을 준다', () => {
    expect(turnLabel(toThread([ask('q1', '2026-07-26 09:00:00')]))).toBe('부서 답을 기다리는 중')
    const two = toThread([ask('q1', '2026-07-26 09:00:00'), ask('q2', '2026-07-26 09:05:00')])
    expect(turnLabel(two)).toContain('2건')
    expect(turnLabel([])).toBeNull()
  })
})

describe('되묻는 말이 쓸 만한지', () => {
  const good = {
    question: '채널이 몇 개인지 알려주실 수 있을까요?',
    why: '채널 수에 따라 규칙으로 풀 수 있는지가 갈립니다.',
    author: 'AX 담당자',
  }

  it('제대로 적었으면 통과한다', () => {
    expect(validateAsk(good)).toEqual({})
  })

  it('물음표만 던지는 것은 막는다', () => {
    // 무엇이 궁금한지 안 적으면 부서는 무엇을 답해야 할지 모른다.
    expect(validateAsk({ ...good, question: '?' }).question).toBeTruthy()
  })

  it('왜 묻는지를 안 적으면 막는다', () => {
    // 판정에 무엇이 걸려 있는지 알면 답이 달라진다.
    expect(validateAsk({ ...good, why: '' }).why).toBeTruthy()
  })

  it('누가 묻는지를 안 적으면 막는다', () => {
    expect(validateAsk({ ...good, author: '  ' }).author).toBeTruthy()
  })
})

describe('답이 쓸 만한지', () => {
  it('짧은 답도 받는다', () => {
    // "다섯요" 한 마디가 답일 수 있다. 부서에게 긴 글을 요구하지 않는다.
    expect(validateAnswer({ answer: '다섯', author: '정산 담당자' })).toEqual({})
  })

  it('빈 답은 막는다', () => {
    expect(validateAnswer({ answer: '', author: '정산 담당자' }).answer).toBeTruthy()
  })

  it('누가 답하는지는 받아 둔다', () => {
    // 로그인이 없어서 증명은 못 하지만, 몇 달 뒤 "누가 답한 거지"에는
    // 답할 수 있어야 한다.
    expect(validateAnswer({ answer: '다섯 개입니다', author: '' }).author).toBeTruthy()
  })
})
