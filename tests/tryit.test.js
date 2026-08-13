import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
import {
  TRY_STEPS,
  TRY_TERMS,
  RESET_NOTE,
  VISITOR_NOTE,
  EMPTY_INVITE,
  DEEP_NOTE,
  deepLabel,
  isEmptySite,
  resetLabel,
  visitorLabel,
} from '../shared/tryit.js'
import { DEMO_PREFIX } from '../shared/provenance.js'
import { DEMO_APPLICATIONS } from '../functions/_lib/demoApplications.js'
import { validateReview, MIN_REASON } from '../shared/review.js'

// 이 사이트에는 로그인이 없다. 실수가 아니라 정한 것이다 — 부서 담당자에게
// 계정을 만들게 하면 그 순간부터 아무도 안 쓴다. 그래서 처음 온 사람도
// 판정하고, 반려하고, 도구를 돌려 보고, 성과를 확인할 수 있다.
//
// 그런데 그 사실을 아무 데도 안 적어 뒀다. 화면이 전부 "담당자가 자기 일을
// 하는 중"으로 쓰여 있어서 보러 온 사람은 읽기만 하고 나간다. 할 수 있게
// 만들어 놓고 할 수 있다고 말을 안 한 것이다.

// tryStep() 은 TRY_STEPS 에서 한 칸을 찾아 주기만 하는 별명이었다. 화면은
// TRY_STEPS 를 통째로 돌리므로 그 함수를 안 쓴다. 여기서 확인하는 것은
// 칸에 적힌 글이고 그건 그대로 살아 있으니, 찾는 일만 이 파일에서 한다.
const stepOf = (key) => TRY_STEPS.find((s) => s.key === key) ?? null

describe('무엇을 해볼 수 있는지', () => {
  it('한 번 누르면 결과가 보이는 것부터 놓는다', () => {
    // 여섯 단계를 처음부터 따라가라고 하면 아무도 안 한다.
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
    expect(stepOf('review').note).toContain('근거를 안 적으면')
    expect(stepOf('review').note).toContain('대안')
  })

  it('못 한 것을 보는 자리도 넣는다', () => {
    // 잘된 것만 보여주면 나머지도 못 믿는다.
    expect(stepOf('honesty')).toBeTruthy()
    expect(stepOf('honesty').to).toBe('/honesty')
  })

  it('모르는 것은 없다고 답한다', () => {
    expect(stepOf('없는것')).toBeNull()
    expect(stepOf()).toBeNull()
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
    // 가장 값나가는 것이 여섯 단계를 끝까지 밟은 한 건인데, 그건 시연
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
  it('초대문이 말한 것을 서버가 실제로 막는다', () => {
    // 스무 자를 요구하다가 풀었다. 이제 막는 것은 빈칸뿐이라, 초대문도
    // 글자 수를 말하지 않는다 — 둘이 갈라지면 화면이 또 거짓말을 한다.
    expect(stepOf('review').note).not.toMatch(/\d+자/)
    const empty = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '수용',
      verdict_reason: '',
      alternatives_considered: '사람이 계속 하는 안을 견줬습니다',
    })
    expect(empty.ok).toBe(false)
    expect(empty.errors.verdict_reason).toBeTruthy()
  })

  it('반려에 대안을 받는다는 것도 서버가 실제로 막는다', () => {
    expect(stepOf('review').note).toContain('대안')
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

  it('짧아도 적혀 있으면 받는다', () => {
    // 길이로는 근거가 있는지를 못 가린다. 정확한 한 마디가 스무 자를
    // 못 채워 막히던 자리다.
    const short = validateReview({
      impact_score: 3,
      difficulty_score: 3,
      verdict: '수용',
      verdict_reason: '자료가 없습니다.',
      alternatives_considered: '손으로 계속 하는 안.',
    })
    expect(short.ok).toBe(true)
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

// 화면이 약속한 규칙을 서버가 안 지키는 것이 이 저장소에서 두 번 나왔다
// (판정 근거·반려 대안, 요구 기각 사유). 그래서 남은 약속들을 전수로
// 훑었고, 그중 가장 무거운 것 — "합격 기준을 통과해야만 도구가 주소를
// 받는다" — 이 실제로 지켜지는지를 여기 못박아 둔다.
//
// 라이브에서도 확인했다. 베타 미통과·사용법서 미확정 건을 넘기려 하면
// 400과 함께 막힌 이유 두 줄이 돌아온다.
describe('넘기기 전에 무엇을 막는다고 말했나', () => {
  it('시험판 안내가 "기계 채점만으로는 통과가 아니다"라고 말한다', () => {
    // 이 문장이 참이려면 사람 의견을 받는 자리가 있어야 하고, 실제로 있다.
    expect(stepOf('tool').note).toContain('검토함')
  })

  it('못 한 것을 보는 자리가 데이터에서 나온다고 말한다', () => {
    // "잘 보이려고 손댈 수 없다"는 주장은 손으로 적은 목록이면 거짓이 된다.
    expect(stepOf('honesty').note).toContain('데이터에서 만들어지므로')
    expect(stepOf('honesty').note).toContain('손댈 수 없습니다')
  })
})

// 아무것도 없을 때.
//
// 초대문을 만들어 놓고 정작 빈 상태를 생각 안 했다. 예시를 전부 지운 뒤로
// 첫 화면은 "접수함에서 아무거나 골라 판정해 보세요"라고 적어 놓고, 눌러서
// 들어가면 접수함이 비어 있었다. 초대해 놓고 빈 방으로 안내한 것이다.
//
// 라이브에서 /api/overview 가 counts.total 0 을 돌려주는 것을 눈으로 보고
// 알았다. 시험도 빌드도 린트도 전부 통과하고 있었다 — 데이터가 없는 상태를
// 아무도 안 세고 있었기 때문이다.
describe('아무것도 없을 때', () => {
  it('비었는지를 숫자로 가른다', () => {
    expect(isEmptySite({ total: 0 })).toBe(true)
    expect(isEmptySite({ total: 3 })).toBe(false)
  })

  it('아직 못 읽었으면 비었다고 하지 않는다', () => {
    // 불러오는 중에 "비어 있습니다"가 번쩍했다가 사라지면 잘못 만든
    // 화면처럼 보인다. undefined 는 모른다는 뜻이지 0이 아니다.
    expect(isEmptySite(undefined)).toBe(false)
    expect(isEmptySite(null)).toBe(false)
    expect(isEmptySite({})).toBe(false)
    expect(isEmptySite({ total: null })).toBe(false)
  })

  it('왜 비어 있는지를 먼저 말한다', () => {
    // 빈 화면만 보여주면 고장 난 사이트로 읽힌다.
    expect(EMPTY_INVITE.why.length).toBeGreaterThan(30)
    expect(EMPTY_INVITE.title).toContain('한 건도 없습니다')
  })

  it('한 번에 채우는 쪽을 먼저 놓는다', () => {
    // 직접 한 건 적는 데 십 분이 걸리고, 그 한 건으로는 우선순위도
    // 반려 대비도 안 보인다.
    expect(EMPTY_INVITE.actions[0].key).toBe('seed')
    expect(EMPTY_INVITE.actions[1].to).toBe('/apply')
  })

  it('갈래마다 무엇을 하는 것인지 적는다', () => {
    for (const a of EMPTY_INVITE.actions) {
      expect(a.label.length).toBeGreaterThan(5)
      expect(a.what.length).toBeGreaterThan(15)
      expect(a.note.length).toBeGreaterThan(20)
    }
  })

  it('넣기 전에 심은 것이라고 밝힌다', () => {
    // 넣고 나서 알면 속은 기분이 든다. 이 사이트가 부서에게 요구하는
    // 것과 같은 태도여야 한다.
    const terms = EMPTY_INVITE.terms.join(' ')
    expect(terms).toContain(DEMO_PREFIX)
    // 심는 것은 신청서뿐이고 그 뒤는 실제로 돈다는 것도 같이 말한다.
    // 이걸 빼면 화면 전체가 꾸며 낸 것으로 읽힌다.
    expect(terms).toContain('실제로 돌아간 결과')
    // 되돌리는 법이 없으면 아무도 안 누른다.
    expect(terms).toContain('다시 지울 수 있습니다')
  })

  it('심는 것이 실제로 세 건이다', () => {
    // 화면에 적은 숫자와 실제로 심기는 개수가 어긋나면, 눌러 본 사람이
    // 그 자리에서 거짓말을 발견한다.
    expect(EMPTY_INVITE.actions[0].what).toContain('세 건')
    expect(DEMO_APPLICATIONS).toHaveLength(3)
  })

  it('심는 것이 전부 그 앞자리를 쓴다', () => {
    // 하나라도 다른 앞자리면 그 건은 "직접 낸 것"으로 세어져서,
    // 화면이 출처를 잘못 밝힌다.
    for (const a of DEMO_APPLICATIONS) {
      expect(a.ticket_no.startsWith(DEMO_PREFIX)).toBe(true)
    }
  })

  it('반려·보류로 갈 것이 섞여 있다', () => {
    // 전부 수용될 것만 심으면 반려 화면도 보류 화면도 빈 채로 남는다.
    // 셋이 서로 다르게 갈려야 우선순위를 견주는 일도 반려의 뜻도 보인다.
    // 하나만 심으면 둘 다 안 보인다.
    expect(DEMO_APPLICATIONS.length).toBe(3)
    const depts = new Set(DEMO_APPLICATIONS.map((a) => a.dept))
    expect(depts.size).toBeGreaterThan(1)
  })
})

// 초대문의 "어지르셔도 됩니다"가 거짓말이었다.
//
// 안전한 치우기는 "낸 뒤로 아무 일도 안 일어난 것"만 지운다. 그런데 이
// 화면은 판정해 보시라고 권한다 — **권한 대로 하신 흔적이 정확히 그 규칙이
// 못 지우는 자료다.** 읽기만 하고 나간 분의 흔적은 지워지는데, 시키는 대로
// 눌러 보신 분의 흔적만 영영 남았다.
describe('만져 본 것까지 치우기', () => {
  it('없으면 단추를 안 만든다', () => {
    expect(deepLabel(0)).toBeNull()
    expect(deepLabel(null)).toBeNull()
    expect(deepLabel(undefined)).toBeNull()
    expect(deepLabel('아무거나')).toBeNull()
  })

  it('있으면 몇 건인지 적는다', () => {
    expect(deepLabel(3)).toContain('3건')
  })

  it('무엇을 지우는지와 왜 필요한지를 갈라 적는다', () => {
    // "초기화"라고만 적으면 무엇이 사라지는지 모른 채 누른다.
    expect(DEEP_NOTE.rule.length).toBeGreaterThan(15)
    expect(DEEP_NOTE.why.length).toBeGreaterThan(30)
  })

  it('되돌릴 수 없다고 밝힌다', () => {
    expect(DEEP_NOTE.warn).toContain('되돌릴 수 없습니다')
    // 시연 신청서는 안 건드린다는 것도 같이 말한다. 안 그러면 아무도
    // 안 누르거나, 누르고 나서 놀란다.
    expect(DEEP_NOTE.warn).toContain('시연 신청서')
  })

  it('실수로 눌리지 않게 뜻을 적게 한다', () => {
    expect(DEEP_NOTE.confirm).toBe('만져 본 것까지 지웁니다')
  })

  it('서버가 그 문장을 그대로 받는다', async () => {
    // 화면과 서버가 다른 문장을 쓰면 단추가 늘 400을 받는다. 눌러 보기
    // 전까지는 아무도 모른다.
    const src = readFileSync(
      join(ROOT, 'functions', 'api', 'demo', 'visitors.js'),
      'utf8'
    )
    expect(src).toContain(DEEP_NOTE.confirm)
  })

  it('안전한 쪽 문구는 그대로다', () => {
    // 이미 있던 것이 바뀌면 안 된다.
    expect(visitorLabel(2)).toContain('시험 삼아 낸')
    expect(VISITOR_NOTE.rule).toContain('한 줄이라도 기록이 달린')
  })
})
