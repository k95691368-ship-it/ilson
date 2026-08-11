import { describe, it, expect } from 'vitest'
import {
  sideOf,
  sideLabel,
  sideTally,
  sideLine,
  SIDES,
  DEPT_KINDS,
  PROXY_KINDS,
} from '../shared/side.js'

// 결정 기록 화면은 이 사이트가 파는 것 그 자체다. 그런데 56건이 전부
// actor: 'human' 하나로 뭉뚱그려져 있어서 담당자가 판단한 것과 부서가
// 응답한 것을 가를 수가 없었다.
//
// 이게 왜 문제냐면, 이 사이트가 여러 화면에서 되풀이하는 주장을 뒷받침하는
// 가장 강한 숫자가 "부서가 실제로 몇 번 응답했는가"인데 그걸 셀 수가 없기
// 때문이다. 자기 주장의 증거를 자기가 안 세고 있었다.

const row = (kind) => ({ link_kind: kind })

describe('누가 남긴 기록인가', () => {
  it('부서만 누를 수 있는 것은 부서로 센다', () => {
    for (const k of ['수령확인', '성과확인', '기준서명', '보류해제요청', '사용법모름']) {
      expect(sideOf(k)).toBe('dept')
    }
  })

  it('담당자가 대신 누른 것은 따로 센다', () => {
    // 지우지 않는다 — 전화로 확인받고 대신 눌러야 할 때가 실제로 있다.
    // 다만 부서 응답으로 세면 "부서가 확인해 줘야 성과다"가 자기 입으로
    // 한 말이 된다.
    expect(sideOf('수령대리확인')).toBe('proxy')
    expect(sideOf('성과대리확인')).toBe('proxy')
  })

  it('종류가 없는 것은 담당자가 남긴 것이다', () => {
    // 판정·협의안 확정·제작·배포처럼 애초에 담당자만 할 수 있는 일들이다.
    expect(sideOf(null)).toBe('ax')
    expect(sideOf(undefined)).toBe('ax')
    expect(sideOf('')).toBe('ax')
    expect(sideOf('먼저할것')).toBe('ax')
  })

  it('대리와 직접이 겹치지 않는다', () => {
    // 한 종류가 양쪽에 들어 있으면 세는 숫자가 틀어진다.
    for (const k of PROXY_KINDS) expect(DEPT_KINDS.has(k)).toBe(false)
  })

  it('고를 수 있는 것이 판정 결과와 같다', () => {
    expect(SIDES.map((s) => s.key).sort()).toEqual(['ax', 'dept', 'proxy'])
    for (const s of SIDES) expect(sideLabel(s.key)).toBe(s.label)
  })
})

describe('부서가 얼마나 응답했는가', () => {
  it('쪽마다 센다', () => {
    const t = sideTally([row('수령확인'), row('성과확인'), row('수령대리확인'), row(null), row('먼저할것')])
    expect(t.dept).toBe(2)
    expect(t.proxy).toBe(1)
    expect(t.ax).toBe(2)
    expect(t.total).toBe(5)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => sideTally()).not.toThrow()
    expect(sideTally().total).toBe(0)
    expect(sideLine(sideTally())).toBeNull()
  })
})

describe('뭐라고 적는가', () => {
  it('부서 응답이 하나도 없으면 그것부터 말한다', () => {
    // 숨기면 이 화면이 "부서가 참여했다"는 인상만 주고 근거는 안 준다.
    const t = sideTally([row(null), row('먼저할것')])
    const line = sideLine(t)
    expect(line).toContain('전부 담당자가 남긴 것')
    expect(line).toContain('부서가 직접 누른 것은 아직 없습니다')
  })

  it('있으면 몇 건인지 말한다', () => {
    const line = sideLine(sideTally([row('수령확인'), row(null), row(null)]))
    expect(line).toContain('3건 중 1건은 부서가 직접')
  })

  it('대리로 누른 것은 부서 응답과 갈라서 적는다', () => {
    const line = sideLine(sideTally([row('수령확인'), row('성과대리확인'), row(null)]))
    expect(line).toContain('대신 눌러 둔 것은 1건')
    expect(line).toContain('부서 응답으로 세지 않습니다')
  })

  it('대리가 없으면 대리 이야기를 안 꺼낸다', () => {
    const line = sideLine(sideTally([row('수령확인'), row(null)]))
    expect(line).not.toContain('대신')
  })
})

// 부서가 한 일인데 담당자 쪽으로 세어지던 것.
//
// sideOf 는 모르는 종류를 담당자('ax')로 돌린다. 단계를 진행하며 남긴
// 기록은 애초에 담당자만 할 수 있는 일이라 그 기본값이 맞다. 그런데 부서
// 종류를 목록에 안 넣으면 조용히 담당자 쪽으로 넘어간다 — 예외도 안 나고
// 화면도 안 깨진다. 숫자만 틀린다.
//
// 그러면 "부서가 직접 누른 것 N건"이 실제보다 적게 나오고, 이 화면이
// 하려는 말(이 기록은 혼자 만든 것이 아니다)이 약해진다.
describe('부서가 한 일을 빠뜨리지 않는가', () => {
  it('부서가 먼저 물은 것은 부서가 한 것이다', () => {
    expect(sideOf('부서질문')).toBe('dept')
  })

  it('시험판 의견도 부서가 한 것이다', () => {
    // 부서가 하는 일 중 손이 제일 많이 가는 축이다.
    expect(sideOf('시험판의견')).toBe('dept')
  })

  it('담당자가 답한 것은 담당자가 한 것이다', () => {
    // 부서 질문에 담당자가 답한 것까지 부서로 세면 반대로 부풀려진다.
    expect(sideOf('담당자답')).toBe('ax')
  })

  it('부서 쪽 종류를 하나도 안 빠뜨렸는지 센다', () => {
    // 새 부서 행동을 만들 때 이 목록에 넣는 것을 잊기 쉽다. 실제로 두 번
    // 잊었다. 개수를 못 박아 두면 다음에 늘릴 때 여기서 걸린다.
    //
    // 다만 개수만으로는 **뒤바뀐 것**을 못 잡는다. 실제로 '코드확인'(담당자)이
    // 목록에 있고 '코드알림'(부서)이 빠져 있었는데, 개수는 16으로 맞아서
    // 이 검사가 초록이었다. 아래 '이름이 아니라 코드에서 유도한다'가 그
    // 자리를 막는다.
    expect(DEPT_KINDS.size).toBe(15)
  })

  it('담당자가 누르는 코드 확인은 부서 응답이 아니다', () => {
    // /codes 화면에서 담당자가 "맞습니다"를 누른 것이다. 부서가 알려 주는
    // 쪽은 '코드알림'이다. 둘이 정확히 뒤바뀌어 있었다.
    expect(sideOf('코드확인')).toBe('ax')
    expect(sideOf('코드알림')).toBe('dept')
  })

  it('손든 것은 부서, 푸는 것은 담당자다', () => {
    expect(sideOf('같은건손듦')).toBe('dept')
    expect(sideOf('같은건아님')).toBe('ax')
  })
})
