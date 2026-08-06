import { describe, it, expect } from 'vitest'
import { responseRate, responseLine, responseNote, askOf, ASKS } from '../shared/response.js'

// 이 사이트는 부서에게 다섯 가지를 부탁한다. 부탁하는 자리는 회차마다
// 하나씩 만들었는데, 그 부탁이 실제로 먹혔는지는 한 번도 안 셌다.
// 화면마다 "이건 부서가 해줘야 합니다"라고 적어 두고, 정작 부서가 몇 번
// 해줬는지는 아무도 몰랐다.

const rows = (o) => ASKS.map((a) => ({ key: a.key, asked: 0, answered: 0, proxied: 0, ...(o[a.key] ?? {}) }))

describe('몇 번 부탁했고 몇 번 답이 왔는가', () => {
  it('부탁마다 따로 센다', () => {
    const r = responseRate(rows({ accept: { asked: 3, answered: 2 }, outcome: { asked: 2, answered: 1 } }))
    expect(r.asked).toBe(5)
    expect(r.answered).toBe(3)
    expect(r.waiting).toBe(2)
    expect(r.per.find((x) => x.key === 'accept').percent).toBe(67)
  })

  it('안 물어본 것에 비율을 안 매긴다', () => {
    // 0/0을 0%로 적으면 "부서가 안 해줬다"로 읽히는데 사실은 여쭤본 적이 없다.
    const r = responseRate(rows({}))
    for (const x of r.per) {
      expect(x.never).toBe(true)
      expect(x.percent).toBeNull()
    }
    expect(r.show).toBe(false)
  })

  it('아무것도 안 물어봤으면 할 말이 없다', () => {
    const r = responseRate(rows({}))
    expect(responseLine(r)).toBeNull()
    expect(responseNote(r)).toBeNull()
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => responseRate()).not.toThrow()
    expect(responseRate().asked).toBe(0)
    expect(responseRate([{ key: 'accept' }]).asked).toBe(0)
  })
})

describe('대리로 누른 것', () => {
  it('부서 응답과 갈라서 센다', () => {
    // 섞어 세면 "부서가 확인해 줘야 성과다"가 자기 입으로 한 말이 된다.
    const r = responseRate(rows({ accept: { asked: 3, answered: 1, proxied: 2 } }))
    expect(r.answered).toBe(1)
    expect(r.proxied).toBe(2)
    expect(responseLine(r)).toContain('2건은 담당자가 대신 눌러 둔 것')
    expect(responseLine(r)).toContain('부서 응답으로 세지 않았습니다')
  })

  it('대리가 없으면 대리 이야기를 안 꺼낸다', () => {
    const r = responseRate(rows({ accept: { asked: 2, answered: 2 } }))
    expect(responseLine(r)).not.toContain('대신')
  })
})

describe('이 숫자를 어떻게 읽으라고 하는가', () => {
  it('한 건도 답을 못 받았으면 혼자 만든 것이라고 말한다', () => {
    // 여기서 변명하면 이 사이트가 부서에게 요구하는 태도와 어긋난다.
    const r = responseRate(rows({ accept: { asked: 3, answered: 0 } }))
    const note = responseNote(r)
    expect(note).toContain('한 건도 답을 못 받았습니다')
    expect(note).toContain('혼자 만든 것')
  })

  it('전부 답을 받았으면 그렇게 말한다', () => {
    const r = responseRate(rows({ accept: { asked: 2, answered: 2 } }))
    expect(responseNote(r)).toContain('전부 답을 받았습니다')
  })

  it('일부만 왔으면 안 여쭤본 것과 구분해 말한다', () => {
    const r = responseRate(rows({ accept: { asked: 3, answered: 1 } }))
    const note = responseNote(r)
    expect(note).toContain('2건은 아직 답을 못 받았습니다')
    expect(note).toContain('여쭤봤는데 답이 없는 쪽')
  })

  it('목표선을 긋지 않는다', () => {
    // "80% 넘으면 좋음" 같은 선을 그으면 그 선에 맞추게 된다.
    const r = responseRate(rows({ accept: { asked: 10, answered: 9 } }))
    const t = `${responseLine(r)} ${responseNote(r)}`
    expect(t).not.toMatch(/목표|기준치|이상이면|훌륭|양호/)
  })
})

describe('다섯 가지 부탁', () => {
  it('전부 왜 부탁하는지가 적혀 있다', () => {
    for (const a of ASKS) {
      expect(a.label.length).toBeGreaterThan(4)
      expect(a.why.length).toBeGreaterThan(15)
    }
  })

  it('열쇠로 찾을 수 있다', () => {
    expect(askOf('accept').label).toContain('받았다고')
    expect(askOf('없는것')).toBeNull()
    expect(askOf()).toBeNull()
  })

  it('부탁이 다섯 가지다', () => {
    // 화면에 만들어 둔 자리와 같은 수여야 한다 — 하나 만들고 여기 안 넣으면
    // 그 부탁은 영영 안 세어진다.
    expect(ASKS.map((a) => a.key).sort()).toEqual(
      ['accept', 'beta', 'hold', 'outcome', 'signoff'].sort()
    )
  })
})
