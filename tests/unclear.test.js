import { describe, it, expect } from 'vitest'
import {
  validateUnclear,
  validateFix,
  unclearBoard,
  boardLine,
  sectionNote,
  MANUAL_SECTIONS,
  SECTION_KEYS,
  ASKS_NAME,
  MANY,
  MIN_BODY,
} from '../shared/unclear.js'

// 사용법서의 목적은 만든 사람이 없어도 부서가 계속 쓸 수 있게 하는 것이다.
// 그런데 쓴 사람만 읽어 보고 넘긴다. 쓴 사람은 다 안다 — 모르는 데가
// 어디인지는 실제로 읽는 사람만 안다.
//
// 그래서 여기서 지켜야 할 것은 "짚을 수 있는가"가 아니라
// "짚은 것이 문서로 돌아가는가"다.

const flag = (id, section) => ({ id, section, body: `${id} 모르겠습니다` })

describe('어디를 짚을 수 있나', () => {
  it('자리마다 왜 짚는지가 적혀 있다', () => {
    // 어디를 말하는지 서로 다르게 알면 담당자는 어느 대목을 고칠지 모른다.
    for (const s of MANUAL_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(3)
      expect(s.hint.length).toBeGreaterThan(10)
      expect(s.where).toBeTruthy()
    }
  })

  it('없는 자리는 막는다', () => {
    expect(validateUnclear({ section: '아무데나', body: '모르겠습니다' }).section).toBeTruthy()
    expect(validateUnclear({ body: '모르겠습니다' }).section).toBeTruthy()
  })

  it('무엇이 모르겠는지 안 적으면 막는다', () => {
    // "모르겠어요"만 오면 담당자는 무엇을 고칠지 모르고 결국 전화를 건다.
    // 그러면 짚기가 전화를 한 번 더 만든 셈이 된다.
    expect(validateUnclear({ section: SECTION_KEYS[0], body: '' }).body).toBeTruthy()
    expect(validateUnclear({ section: SECTION_KEYS[0], body: 'ㅇ'.repeat(MIN_BODY) }).body).toBeUndefined()
  })

  it('이름은 안 받는다', () => {
    // 모르겠다고 말하는 일에 이름을 붙이라고 하면, 모르는 것을 밝히는 것
    // 자체가 부담이 되어 아무도 안 짚는다.
    expect(ASKS_NAME).toBe(false)
    expect(validateUnclear({ section: SECTION_KEYS[0], body: '모르겠습니다' })).toEqual({})
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateUnclear()).not.toThrow()
  })
})

describe('담당자가 고쳤다고 남길 때', () => {
  const good = { body: '어느 파일을 어디서 받는지 예시로 적었습니다', by: 'AX 담당자' }

  it('제대로 적었으면 통과한다', () => {
    expect(validateFix(good)).toEqual({})
  })

  it('어떻게 고쳤는지 안 적으면 막는다', () => {
    // 이 문장이 그 자리에 그대로 붙는다.
    expect(validateFix({ ...good, body: '' }).body).toBeTruthy()
  })

  it('누가 고쳤는지 안 적으면 막는다', () => {
    expect(validateFix({ ...good, by: '' }).by).toBeTruthy()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateFix()).not.toThrow()
  })
})

describe('지금 어느 자리가 안 읽히나', () => {
  const flags = [
    flag('f1', 'when_to_run'),
    flag('f2', 'when_to_run'),
    flag('f3', 'upload'),
    flag('f4', 'contact'),
  ]
  const fixes = [{ flag_id: 'f4', body: '연락처를 팀으로 바꿨습니다', by: 'AX 담당자' }]

  it('짚힌 자리만 올린다', () => {
    const b = unclearBoard({ flags, fixes })
    expect(b.sections.map((s) => s.key)).toEqual(['when_to_run', 'upload', 'contact'])
  })

  it('여러 번 짚힌 자리가 먼저다', () => {
    // 한 번 짚힌 것 열 개보다 세 번 짚힌 것 하나를 먼저 고치는 편이
    // 전화를 더 많이 줄인다.
    expect(unclearBoard({ flags, fixes }).sections[0].key).toBe('when_to_run')
  })

  it('두 사람이 같은 자리에서 막히면 문서 문제로 본다', () => {
    // 한 사람이 모르는 것은 처음이라 그럴 수 있다.
    const b = unclearBoard({ flags, fixes })
    expect(b.sections.find((s) => s.key === 'when_to_run').mustFix).toBe(true)
    expect(b.sections.find((s) => s.key === 'upload').mustFix).toBe(false)
    expect(MANY).toBe(2)
  })

  it('고친 것은 안 푼 것에서 뺀다', () => {
    const b = unclearBoard({ flags, fixes })
    expect(b.sections.find((s) => s.key === 'contact').open).toBe(0)
    expect(b.summary.openTotal).toBe(3)
    expect(b.summary.fixedTotal).toBe(1)
  })

  it('고친 뒤에 또 짚히면 다시 올라온다', () => {
    // 고쳤는데 또 막혔다면 그건 아직 안 고쳐진 것이다.
    const b = unclearBoard({
      flags: [...flags, flag('f5', 'contact')],
      fixes,
    })
    expect(b.sections.find((s) => s.key === 'contact').open).toBe(1)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(unclearBoard({}).sections).toEqual([])
    expect(() => unclearBoard()).not.toThrow()
  })
})

describe('담당자 화면 한 줄', () => {
  it('짚힌 것이 없으면 그렇게 말한다', () => {
    expect(boardLine({ openTotal: 0, fixedTotal: 0 })).toContain('없습니다')
  })

  it('다 고쳤으면 몇 곳을 고쳤는지 말한다', () => {
    expect(boardLine({ openTotal: 0, fixedTotal: 3 })).toContain('3곳')
  })

  it('두 사람 이상 막힌 곳은 따로 말한다', () => {
    const t = boardLine({ openTotal: 4, mustFix: 1 })
    expect(t).toContain('4곳')
    expect(t).toContain('잘못 쓰인')
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(() => boardLine()).not.toThrow()
  })
})

describe('부서가 보는 자리에 붙는 말', () => {
  it('짚혀 있으면 고치는 중이라고 알린다', () => {
    // 짚고 나서 아무 표시가 없으면 "말해 봐야 소용없다"가 된다.
    const n = sectionNote({ key: 'upload', open: 2, flags: [] })
    expect(n.tone).toBe('open')
    expect(n.text).toContain('2분')
  })

  it('고쳤으면 무엇을 고쳤는지 보여준다', () => {
    const n = sectionNote({
      key: 'contact',
      open: 0,
      flags: [{ id: 'f4', fix: { body: '연락처를 팀으로 바꿨습니다' } }],
    })
    expect(n.tone).toBe('fixed')
    expect(n.text).toContain('연락처를 팀으로')
    expect(n.text).toContain('또 짚어')
  })

  it('아무 일도 없으면 아무 말도 안 한다', () => {
    expect(sectionNote({ key: 'intro', open: 0, flags: [] })).toBeNull()
    expect(sectionNote(null)).toBeNull()
  })
})
