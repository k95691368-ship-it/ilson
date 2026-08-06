import { describe, it, expect } from 'vitest'
import { TRY_STEPS, TRY_TERMS, RESET_NOTE, VISITOR_NOTE, tryStep, resetLabel, visitorLabel } from '../shared/tryit.js'

// 이 사이트에는 로그인이 없다. 실수가 아니라 정한 것이다 — 부서 담당자에게
// 계정을 만들게 하면 그 순간부터 아무도 안 쓴다. 그래서 처음 온 사람도
// 판정하고, 반려하고, 도구를 돌려 보고, 성과를 확인할 수 있다.
//
// 그런데 그 사실을 아무 데도 안 적어 뒀다. 화면이 전부 "담당자가 자기 일을
// 하는 중"으로 쓰여 있어서 보러 온 사람은 읽기만 하고 나간다. 할 수 있게
// 만들어 놓고 할 수 있다고 말을 안 한 것이다.

describe('무엇을 해볼 수 있는지', () => {
  it('한 번 누르면 결과가 보이는 것부터 놓는다', () => {
    // 여덟 단계를 처음부터 따라가라고 하면 아무도 안 한다.
    expect(TRY_STEPS[0].key).toBe('review')
  })

  it('갈 곳과 무엇을 할지와 무엇이 드러나는지가 다 있다', () => {
    for (const s of TRY_STEPS) {
      expect(s.to.startsWith('/')).toBe(true)
      expect(s.label.length).toBeGreaterThan(4)
      expect(s.what.length).toBeGreaterThan(10)
      // note 가 이 사이트가 무엇을 요구하는지를 말한다. 이게 없으면
      // 그냥 화면 구경이 된다.
      expect(s.note.length).toBeGreaterThan(20)
    }
  })

  it('판정 안내가 근거를 받는다는 것을 미리 말한다', () => {
    // 눌러 봤더니 서버가 막으면 고장인 줄 안다.
    expect(tryStep('review').note).toContain('근거를 20자')
    expect(tryStep('review').note).toContain('대안')
  })

  it('못 한 것을 보는 자리도 넣는다', () => {
    // 잘된 것만 보여주면 나머지도 못 믿는다.
    expect(tryStep('honesty')).toBeTruthy()
    expect(tryStep('honesty').to).toBe('/honesty')
  })

  it('모르는 것은 없다고 답한다', () => {
    expect(tryStep('없는것')).toBeNull()
    expect(tryStep()).toBeNull()
  })
})

describe('초대하면서 같이 말해야 하는 것', () => {
  const all = TRY_TERMS.join(' ')

  it('누른 것이 기록에 남는다고 말한다', () => {
    // 숨기면 나중에 알았을 때 속은 기분이 든다. 그리고 그게 이 사이트의
    // 요점이라 숨길 이유도 없다.
    expect(all).toContain('결정 기록에 그대로 남습니다')
    expect(all).toContain('지우지 않습니다')
  })

  it('로그인이 없는 것이 실수가 아니라고 말한다', () => {
    expect(all).toContain('실수가 아니라 정한 것')
    expect(all).toContain('계정을 만들게 하면')
  })

  it('되돌릴 수 있다고 말한다', () => {
    // 없으면 망칠까 봐 아무도 안 누른다.
    expect(all).toContain('되돌릴 수 있습니다')
  })
})

describe('되돌리기가 무엇을 하는지', () => {
  it('무엇이 지워지는지 적는다', () => {
    // "초기화"라고만 적으면 무엇이 날아가는지 모른 채 누른다.
    expect(RESET_NOTE.does).toContain('시연용으로 심어 둔 신청서')
    expect(RESET_NOTE.does).toContain('처음 상태로')
  })

  it('직접 낸 것은 안 지운다고 적는다', () => {
    // 자기가 낸 것까지 날아가는 줄 알면 아무도 안 누른다.
    expect(RESET_NOTE.keeps).toContain('직접 내신 신청서는 그대로')
  })

  it('왜 되돌려야 하는지도 적는다', () => {
    expect(RESET_NOTE.why).toContain('다음에 보러 오신 분')
  })
})

describe('단추에 뭐라고 쓰나', () => {
  it('되돌릴 것이 있으면 되돌린다고 쓴다', () => {
    expect(resetLabel(8)).toContain('처음 상태로')
  })

  it('없으면 심는다고 쓴다', () => {
    // 없는 것을 "되돌린다"고 하면 무슨 일이 일어날지 모른다.
    expect(resetLabel(0)).toContain('심기')
    expect(resetLabel(null)).toContain('심기')
    expect(resetLabel()).toContain('심기')
    expect(resetLabel('여덟')).toContain('심기')
  })
})

// 초대해 놓고 나면 새 문제가 생긴다. 면접관 스무 명이 신청서를 한 번씩
// 내 보면 접수함에 스무 건이 쌓이고, 첫 화면은 그걸 "하루 넘게 못 본
// 신청서 20건"이라고 띄운다. 초대한 결과가 초대한 화면을 망친다.
describe('시험 삼아 낸 것을 치울 때', () => {
  it('무엇만 지우는지 규칙을 적는다', () => {
    // "초기화"라고만 적으면 자기가 낸 것도 날아가는 줄 안다.
    expect(VISITOR_NOTE.rule).toContain('판정도 되묻기도 없었던 것만')
    expect(VISITOR_NOTE.rule).toContain('그대로 둡니다')
  })

  it('왜 그 선을 그었는지도 적는다', () => {
    // 가장 값나가는 것이 여덟 단계를 끝까지 밟은 한 건인데, 그건 시연
    // 시드가 아니라 손으로 만든 것이다. 그걸 날리면 시연이 통째로 빈다.
    expect(VISITOR_NOTE.why).toContain('아무 일도 안 일어난 것')
    expect(VISITOR_NOTE.why).toContain('보여드릴 것이 있는 기록')
  })

  it('치울 것이 있을 때만 단추가 뜬다', () => {
    expect(visitorLabel(3)).toContain('3건')
    expect(visitorLabel(0)).toBeNull()
    expect(visitorLabel(null)).toBeNull()
    expect(visitorLabel()).toBeNull()
    expect(visitorLabel('셋')).toBeNull()
  })
})
