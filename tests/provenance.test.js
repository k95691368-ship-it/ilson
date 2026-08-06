import { describe, it, expect } from 'vitest'
import {
  isDemo,
  provenanceOf,
  provenanceLine,
  provenanceDetail,
  DEMO_PREFIX,
} from '../shared/provenance.js'

// 첫 화면은 "접수 12건, 완료 1건" 같은 숫자를 크게 보여 주는데 그중 여덟
// 건은 시연을 위해 심은 것이다. 그 사실이 /review 한 군데에만 적혀 있었다.
// 이 사이트가 파는 것이 기록인데 기록의 출처를 안 밝히면 나머지 기록도
// 못 믿는다.

const demo = (n) => ({ ticket_no: `${DEMO_PREFIX}00${n}` })
const real = (n) => ({ ticket_no: `AX-HVR-T3${n}` })

describe('심은 것과 직접 받은 것을 가른다', () => {
  it('접수번호 앞자리로 가른다', () => {
    // 표에 is_demo 같은 칸을 못 만든다. 접수번호는 심을 때 이 앞자리로
    // 찍으므로 그것으로 가른다.
    expect(isDemo('AX-DEM-001')).toBe(true)
    expect(isDemo('AX-HVR-T3Y')).toBe(false)
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(isDemo()).toBe(false)
    expect(isDemo(null)).toBe(false)
    expect(() => provenanceOf()).not.toThrow()
  })

  it('몇 건씩인지 센다', () => {
    const p = provenanceOf([demo(1), demo(2), real(1)])
    expect(p.total).toBe(3)
    expect(p.demo).toBe(2)
    expect(p.real).toBe(1)
  })
})

describe('언제 말하고 언제 잠자코 있는가', () => {
  it('심은 것이 하나도 없으면 아무 말도 안 한다', () => {
    // 할 말이 없는데 띠를 띄우면 그다음부터 그 자리는 안 읽힌다.
    const p = provenanceOf([real(1), real(2)])
    expect(p.show).toBe(false)
    expect(provenanceLine(p)).toBeNull()
    expect(provenanceDetail(p)).toBeNull()
  })

  it('하나라도 있으면 말한다', () => {
    expect(provenanceOf([demo(1), real(1)]).show).toBe(true)
  })

  it('빈 목록에서도 조용하다', () => {
    expect(provenanceOf([]).show).toBe(false)
  })
})

describe('뭐라고 적는가', () => {
  it('전부 심은 것이면 그렇게 말한다', () => {
    const p = provenanceOf([demo(1), demo(2)])
    expect(p.onlyDemo).toBe(true)
    expect(provenanceLine(p)).toContain('시연용으로 심은 신청서 2건 위에')
  })

  it('섞여 있으면 몇 대 몇인지 말한다', () => {
    const p = provenanceOf([demo(1), demo(2), real(1)])
    expect(p.onlyDemo).toBe(false)
    const t = provenanceLine(p)
    expect(t).toContain('2건은 시연용')
    expect(t).toContain('1건은 이 사이트에서 직접 받은')
  })

  it('"가짜"라고 쓰지 않는다', () => {
    // 그러면 실제로 돌아간 파이프라인까지 가짜로 읽힌다.
    const t = provenanceLine(provenanceOf([demo(1)]))
    expect(t).not.toContain('가짜')
    expect(t).not.toContain('거짓')
  })
})

describe('무엇이 심은 것이고 무엇이 진짜인지 가른다', () => {
  const d = provenanceDetail(provenanceOf([demo(1), demo(2)]))

  it('심은 것은 신청서 문장뿐이라고 말한다', () => {
    expect(d.seeded).toContain('신청서')
  })

  it('그 뒤는 실제로 돌아간 것이라고 말한다', () => {
    // 이걸 같이 말하지 않으면 "전부 꾸며 낸 화면"으로 읽힌다.
    expect(d.real).toContain('실제로 돌아간')
    expect(d.real).toContain('미리 적어 둔 답이 없습니다')
  })

  it('원본 파일도 만들어 낸 것이라고 밝힌다', () => {
    expect(d.data).toContain('만들어 낸 것')
    // 어떻게 더럽혔는지까지 공개해 뒀다는 것이 이 사이트의 태도다.
    expect(d.data).toContain('공개')
  })

  it('더 볼 곳을 알려준다', () => {
    expect(d.where).toBe('/honesty')
    expect(d.doc).toContain('시험데이터-설계')
  })
})
