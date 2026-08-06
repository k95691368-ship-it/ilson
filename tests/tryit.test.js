import { describe, it, expect } from 'vitest'
import { TRY_STEPS, TRY_TERMS, RESET_NOTE, VISITOR_NOTE, tryStep, resetLabel, visitorLabel } from '../shared/tryit.js'
import { validateReview, MIN_REASON } from '../shared/review.js'

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

// 첫 화면 초대문이 "근거를 20자 안 적으면 서버가 막습니다"라고 적어 뒀다.
// **그런데 서버는 안 막고 있었다.** 막는 것은 임팩트·난이도·판정 셋뿐이었고,
// 근거 열다섯 자에 대안 없는 반려가 실제로 저장돼 있다.
//
// 면접관이 그 문장을 읽고 빈칸으로 눌러 보면 그대로 저장된다 — 평가하러
// 온 사람에게 사이트가 거짓말을 하는 셈이다. 그래서 서버를 문장에 맞췄고,
// 여기서 둘이 다시 갈라지지 않게 묶어 둔다.
describe('초대문이 서버와 같은 말을 하는가', () => {
  it('초대문이 말한 글자 수가 서버가 요구하는 것과 같다', () => {
    expect(tryStep('review').note).toContain(`${MIN_REASON}자`)
  })

  it('반려에 대안을 받는다는 것도 서버가 실제로 막는다', () => {
    expect(tryStep('review').note).toContain('대안')
    const bad = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '반려',
      verdict_reason: '범위 밖이라 못 만듭니다 정말로 그렇습니다',
      alternatives_considered: '사람이 계속 하는 안을 견줬습니다 그것뿐입니다',
      refuse_alternative: '',
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.refuse_alternative).toBeTruthy()
  })

  it('근거가 짧으면 막는다', () => {
    const bad = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '수용',
      verdict_reason: '자동화할 자료가 아직 없습니다.',
      alternatives_considered: '사람이 계속 하는 안을 견줬습니다 그것뿐입니다',
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.verdict_reason).toBeTruthy()
  })

  it('보류는 다시 볼 조건을 받는다', () => {
    // 조건이 없으면 부서는 언제까지 기다려야 하는지 모른다. 그리고 보류는
    // 아무도 안 움직이면 영원히 그대로인 유일한 상태다.
    const bad = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '보류',
      verdict_reason: '지금은 재료가 없어서 만들 수가 없습니다',
      alternatives_considered: '그냥 진행하는 안을 견줬으나 추측이 됩니다',
      hold_until_condition: '',
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.hold_until_condition).toBeTruthy()
  })

  it('다 적으면 통과한다', () => {
    const ok = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '반려',
      verdict_reason: '외부 시스템에 대신 써 넣는 일은 범위 밖입니다',
      alternatives_considered: '사람이 계속 하는 안과 반쯤 자동화하는 안을 견줬습니다',
      refuse_code: 'external_write',
      refuse_alternative: '올리실 양식 파일까지는 만들어 드립니다',
    })
    expect(ok.ok).toBe(true)
  })
})
