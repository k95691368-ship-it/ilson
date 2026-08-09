import { describe, it, expect } from 'vitest'
import {
  toThread,
  openQuestions,
  validateAsk,
  validateAnswer,
  ASK_KIND,
  ANSWER_KIND,
  DEPT_ASK_KIND,
  STAFF_REPLY_KIND,
  validateDeptAsk,
  waitingOnDept,
  waitingOnStaff,
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

// 여기서 '지금 누구 차례인가'를 확인했었다. whoseTurn·turnLabel 두 함수가
// 그 답을 냈는데, **화면도 서버도 그 둘을 한 번도 안 불렀다.** 접수함은
// src/lib/inbox.js 가 미리 세어 둔 칸(waiting_answers)으로 같은 판단을 한다.
//
// 같은 규칙이 두 벌 있으면 한쪽만 고치는 날이 오고, 그날 두 화면이 다른
// 말을 한다. 안 쓰이는 쪽을 지웠다. 확인하려던 뜻은 아래 '두 방향이 서로
// 안 섞인다'에서 살아 있는 waitingOnStaff·waitingOnDept 로 그대로 본다.

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

// 부서가 **먼저** 묻는 길.
//
// 여기가 오랫동안 한쪽으로만 열려 있었다. 담당자는 되묻고 부서는 답할 수만
// 있었다. 그런데 화면은 부서에게 물어보라고 시키고 있었다 — 뒤로 밀린
// 신청서 안내가 "납득이 안 되시면 아래 되묻기로 물어봐 주세요"라고 하고,
// 순서 안내가 "급하시면 알려주세요 — 그것도 판단 재료입니다"라고 한다.
// 둘 다 갈 데가 없었다.
//
// 더 나빴던 것: 담당자가 먼저 물어본 적이 없으면 부서 화면에서 그 칸 자체가
// 사라졌다. 뒤로 밀린 부서는 대개 그 경우다.
describe('부서가 먼저 묻는다', () => {
  const deptAsk = (id, at) => ({
    id,
    link_kind: DEPT_ASK_KIND,
    title: '정산 담당자',
    what: '언제쯤 시작될지 알 수 있을까요?',
    why: '재무의 정산 담당자님이 먼저 물었습니다.',
    created_at: at,
  })
  const staffReply = (id, qid, at) => ({
    id,
    link_kind: STAFF_REPLY_KIND,
    link_id: qid,
    title: 'AX 담당자',
    what: '이번 주 안에 착수합니다.',
    created_at: at,
  })

  it('부서 질문이 실에 들어온다', () => {
    const t = toThread([deptAsk('q1', '2026-01-01')])
    expect(t).toHaveLength(1)
    expect(t[0].side).toBe('부서')
    expect(t[0].asking).toBe(true)
    // 답이 없으니 기다리는 중이다.
    expect(t[0].waiting).toBe(true)
  })

  it('담당자가 답하면 닫힌다', () => {
    const t = toThread([deptAsk('q1', '2026-01-01'), staffReply('r1', 'q1', '2026-01-02')])
    expect(t.find((m) => m.id === 'q1').waiting).toBe(false)
    expect(t.find((m) => m.id === 'r1').side).toBe('담당자')
    expect(openQuestions(t)).toHaveLength(0)
  })

  it('누구를 기다리는지 갈라 센다', () => {
    // 이걸 안 가르면 배지가 반대로 뜬다 — 담당자가 답할 차례인데
    // "부서 답을 기다리는 중"이라고 적힌다.
    const rows = [
      { id: 'a1', link_kind: ASK_KIND, title: 'AX 담당자', what: '채널이 몇 개입니까', why: '판정에 걸립니다', created_at: '2026-01-01' },
      deptAsk('q1', '2026-01-03'),
    ]
    const t = toThread(rows)
    expect(waitingOnDept(t).map((m) => m.id)).toEqual(['a1'])
    expect(waitingOnStaff(t).map((m) => m.id)).toEqual(['q1'])
  })

  it('부서가 물었으면 담당자 차례다', () => {
    // 담당자가 물어 놓고 부서 답을 기다리는 중이어도, 부서 질문이 와 있으면
    // 공은 담당자에게 있다. 부서는 재촉할 길이 없다.
    const rows = [
      { id: 'a1', link_kind: ASK_KIND, title: 'AX 담당자', what: '채널이 몇 개입니까', why: '판정에 걸립니다', created_at: '2026-01-01' },
      deptAsk('q1', '2026-01-03'),
    ]
    // 부서가 물어 온 것이 있으면 공은 담당자 쪽에 있다. 담당자가 물어 놓고
    // 부서 답을 기다리는 중이어도 마찬가지다 — 부서 질문이 먼저다.
    expect(waitingOnStaff(toThread(rows))).toHaveLength(1)
  })

  it('부서 질문이 없으면 예전 그대로다', () => {
    // 이미 있던 동작이 바뀌면 안 된다.
    const rows = [
      { id: 'a1', link_kind: ASK_KIND, title: 'AX 담당자', what: '채널이 몇 개입니까', why: '판정에 걸립니다', created_at: '2026-01-01' },
    ]
    expect(waitingOnStaff(toThread(rows))).toHaveLength(0)
    expect(waitingOnDept(toThread(rows))).toHaveLength(1)
  })

  it('부서에게 "왜 묻는지"까지 적으라고 하지 않는다', () => {
    // 그건 판정하는 사람의 말이다. 부서에게 그걸 적으라고 하면 물어보려다 만다.
    expect(validateDeptAsk({ question: '언제쯤 시작될지 알 수 있을까요', author: '정산 담당자' })).toEqual({})
    // 담당자 쪽은 여전히 받는다.
    expect(validateAsk({ question: '채널이 몇 개입니까', author: 'AX 담당자' }).why).toBeTruthy()
  })

  it('한 글자만 던지는 것은 막는다', () => {
    const f = validateDeptAsk({ question: '왜요', author: '정산 담당자' })
    expect(f.question).toContain('10자')
  })

  it('누가 묻는지는 받는다', () => {
    // 로그인이 없어서 증명은 못 하지만, 몇 달 뒤 "이건 누가 물은 거지"에는
    // 답할 수 있어야 한다.
    expect(validateDeptAsk({ question: '언제쯤 시작될지 알 수 있을까요', author: '' }).author).toBeTruthy()
  })
})

describe('두 방향이 서로 안 섞인다', () => {
  it('종류 이름이 겹치지 않는다', () => {
    const kinds = [ASK_KIND, ANSWER_KIND, DEPT_ASK_KIND, STAFF_REPLY_KIND]
    expect(new Set(kinds).size).toBe(4)
  })

  it('담당자 답이 부서 답으로 세어지지 않는다', () => {
    // 종류가 섞이면 "부서가 답했다"고 화면이 말하는데 실제로는 담당자가
    // 자기 질문에 답한 것이 된다.
    const t = toThread([
      { id: 'q1', link_kind: DEPT_ASK_KIND, title: '정산 담당자', what: '언제 시작하나요', created_at: '2026-01-01' },
      { id: 'r1', link_kind: STAFF_REPLY_KIND, link_id: 'q1', title: 'AX 담당자', what: '이번 주', created_at: '2026-01-02' },
    ])
    expect(t.map((m) => m.side)).toEqual(['부서', '담당자'])
  })
})
