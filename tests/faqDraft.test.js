import { describe, it, expect } from 'vitest'
import {
  faqDrafts,
  alreadyThere,
  hasAnswer,
  draftLine,
  WORTH_ASKING,
} from '../shared/faqDraft.js'

// 자주 묻는 것은 사용법서를 쓴 사람이 손으로 적는다. 그런데 쓴 사람은
// 자기가 무엇을 자주 묻히는지 모른다. 다 아는 사람이 "이건 물어보겠지"를
// 상상해서 적는 것이라, 실제로 오는 질문과 겹치는 일이 별로 없다.
//
// 진짜 자주 묻는 것은 이미 부서가 짚어 준 것들 안에 있다.

const flag = (id, body, fixBody = null) => ({
  id,
  body,
  fix: fixBody ? { body: fixBody, by: 'AX 담당자' } : null,
})

const section = (key, label, flags) => ({ key, label, flags })

describe('무엇을 올리자고 제안하나', () => {
  const secs = [
    section('upload', '어떤 파일을 올리는지', [
      flag('f1', '쿠팡 정산서를 어디서 받나요', '쿠팡 WING > 정산 > 지급내역에서 받으시면 됩니다'),
      flag('f2', '파일 이름을 바꿔도 되나요', '이름은 상관없습니다. 머리글로 알아봅니다'),
    ]),
    section('contact', '막혔을 때 누구에게', [flag('f3', '연락처가 없습니다', '팀 대표번호로 바꿨습니다')]),
  ]

  it('여러 번 막힌 자리만 올린다', () => {
    // 한 번 짚힌 것을 다 올리면 자주 묻는 것이 스무 줄이 되고, 그러면
    // 아무도 안 읽는다.
    const d = faqDrafts({ sections: secs })
    expect(d).toHaveLength(1)
    expect(d[0].section).toBe('upload')
    expect(WORTH_ASKING).toBe(2)
  })

  it('답이 없는 것은 안 올린다', () => {
    // 담당자가 아직 다시 쓰지 않은 것은 답을 모르는 것이다. 답 없는
    // 질문을 올리면 그 목록을 못 믿게 된다.
    const noAnswer = [section('upload', '파일', [flag('a', '모르겠습니다'), flag('b', '저도요')])]
    expect(faqDrafts({ sections: noAnswer })).toEqual([])
    expect(hasAnswer(flag('a', 'x'))).toBe(false)
    expect(hasAnswer(flag('a', 'x', '답'))).toBe(true)
  })

  it('한 자리는 한 줄로 묶는다', () => {
    // 비슷한 질문 세 개가 나란히 있으면 읽는 사람은 무엇이 다른지
    // 찾느라 셋 다 읽게 된다.
    const many = [
      section('upload', '파일', [
        flag('a', '어디서 받나요', '여기서요'),
        flag('b', '이름 바꿔도 되나요', '됩니다'),
        flag('c', '엑셀이어야 하나요', 'csv도 됩니다'),
      ]),
    ]
    const d = faqDrafts({ sections: many })
    expect(d).toHaveLength(1)
    expect(d[0].askedBy).toBe(3)
  })

  it('마지막에 답한 것을 답으로 쓴다', () => {
    // 앞의 답은 그 뒤에 또 짚혔다는 뜻이라 부족했던 것이다.
    expect(faqDrafts({ sections: secs })[0].answer).toContain('머리글로')
  })

  it('질문 칸에는 짧은 쪽을 넣는다', () => {
    // 짧은 쪽이 대개 군더더기가 없다.
    const d = faqDrafts({
      sections: [
        section('upload', '파일', [
          flag('a', '그러니까 제 말은 이 파일을 대체 어디서 받아야 하는 건지 잘 모르겠다는 겁니다', '답'),
          flag('b', '어디서 받나요', '답2'),
        ]),
      ],
    })
    expect(d[0].question).toBe('어디서 받나요')
  })

  it('문장을 자동으로 고쳐 쓰지 않는다', () => {
    // 규칙으로 "어떻게 말할지"까지 만들면 어색한 한국어가 나오고,
    // 그걸 부서가 읽는다.
    const d = faqDrafts({ sections: secs })
    const bodies = secs[0].flags.map((f) => f.body)
    expect(bodies).toContain(d[0].question)
    expect(d[0].answer).toBe(secs[0].flags[1].fix.body)
  })

  it('많이 막힌 자리가 먼저다', () => {
    const two = [
      section('a', 'A', [flag('1', 'q', 'a'), flag('2', 'q', 'a')]),
      section('b', 'B', [flag('3', 'q', 'a'), flag('4', 'q', 'a'), flag('5', 'q', 'a')]),
    ]
    expect(faqDrafts({ sections: two })[0].section).toBe('b')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(faqDrafts({})).toEqual([])
    expect(() => faqDrafts()).not.toThrow()
  })
})

describe('물린 제안은 다시 안 띄운다', () => {
  const secs = [
    section('upload', '파일', [flag('f1', '어디서 받나요', '여기서요'), flag('f2', '또', '답')]),
  ]

  it('물리면 사라진다', () => {
    // 물릴 데가 없으면 안 올릴 제안이 영영 떠 있고, 그러면 담당자는
    // 이 자리를 통째로 안 본다.
    const key = faqDrafts({ sections: secs })[0].key
    expect(faqDrafts({ sections: secs, dismissed: [key] })).toEqual([])
  })
})

describe('이미 적어 둔 것과 겹치는가', () => {
  const faqs = [
    { id: 'q1', question: '정산서 파일은 어디서 받나요', answer: '쿠팡 관리자 화면에서 받습니다' },
  ]

  it('겹치면 어느 것과 겹치는지 알려준다', () => {
    const hit = alreadyThere('정산서 파일은 어디서 받나요', faqs)
    expect(hit?.id).toBe('q1')
  })

  it('안 겹치면 null이다', () => {
    expect(alreadyThere('반품은 어떻게 세나요', faqs)).toBeNull()
  })

  it('적어 둔 것이 없으면 null이다', () => {
    expect(alreadyThere('무엇이든', [])).toBeNull()
    expect(alreadyThere('무엇이든')).toBeNull()
  })

  it('겹쳐도 감추지 않고 같이 보여준다', () => {
    // 담당자가 보고 판단할 일이지, 규칙이 대신 지울 일이 아니다.
    const d = faqDrafts({
      sections: [
        section('upload', '파일', [
          flag('a', '정산서 파일은 어디서 받나요', '답'),
          // 짧은 쪽이 질문 칸에 들어가므로 이쪽을 길게 둔다.
          flag('b', '정산서 파일 받는 데를 아무리 봐도 못 찾겠습니다', '답2'),
        ]),
      ],
      faqs,
    })
    expect(d).toHaveLength(1)
    expect(d[0].duplicateOf?.id).toBe('q1')
  })
})

describe('한 줄 요약', () => {
  it('제안이 없으면 아무 말도 안 한다', () => {
    expect(draftLine([])).toBeNull()
    expect(draftLine()).toBeNull()
  })

  it('몇 가지인지 말한다', () => {
    expect(draftLine([{ key: 'a' }, { key: 'b' }])).toContain('2가지')
  })

  it('겹치는 것이 있으면 그것도 말한다', () => {
    const t = draftLine([{ key: 'a', duplicateOf: { id: 'q1' } }])
    expect(t).toContain('1가지는 이미')
  })
})
