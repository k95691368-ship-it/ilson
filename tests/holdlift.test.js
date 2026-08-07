import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BULK_BY_CODE } from '../shared/bulk.js'
import {
  validateHoldLift,
  holdState,
  bulkHoldFrom,
  BULK_HOLD_KIND,
  holdHeadline,
  holdWhy,
  liftKindOf,
  LIFT_KINDS,
  HOLD_LIFT_KIND,
  HOLD_LIFT_CANCEL_KIND,
} from '../shared/holdlift.js'

// 검토에서 보류를 하면 화면은 "보류 조건이 풀리면 알려주세요"라고 적는다.
// 그런데 알릴 자리가 아무 데도 없었다. 수령 확인·시험판 의견과 다른 점은,
// 저 둘은 담당자가 대신이라도 누를 수 있었는데 조건이 풀렸는지는 부서만
// 안다는 것이다.

const held = { status: '보류' }
const review = {
  verdict: '보류',
  hold_until_condition: 'SAP 이관이 끝나면 다시 봅니다',
  updated_at: '2026-07-01 00:00:00',
  decided_at: '2026-07-01 00:00:00',
}
const rec = (kind, at, over = {}) => ({ id: at, kind, by: '김대리', body: '이관 끝났습니다', at, ...over })
const NOW = Date.parse('2026-08-05T00:00:00Z')

describe('알려 주실 때 받는 것', () => {
  const good = { by: '김대리', kind: 'met', body: 'SAP 이관이 지난주에 끝났습니다' }

  it('성함을 받는다', () => {
    expect(validateHoldLift({ ...good, by: '' }).by).toBeTruthy()
    expect(validateHoldLift(good)).toEqual({})
  })

  it('무엇이 달라졌는지 한 줄이라도 받는다', () => {
    // "풀렸어요" 한 마디만 오면 담당자는 다시 판정할 근거가 없다.
    // 그러면 되물어야 하고, 되묻는 사이에 또 한 달이 간다.
    expect(validateHoldLift({ ...good, body: '' }).body).toBeTruthy()
    expect(validateHoldLift({ ...good, body: '풀림' }).body).toBeTruthy()
  })

  it('조건이 풀린 것인지 사정이 달라진 것인지 고르게 한다', () => {
    expect(validateHoldLift({ ...good, kind: '' }).kind).toBeTruthy()
    expect(validateHoldLift({ ...good, kind: 'aaa' }).kind).toBeTruthy()
    expect(validateHoldLift({ ...good, kind: 'changed' })).toEqual({})
  })

  it('조건이 그대로여도 말할 자리가 있다', () => {
    // "아직 그 시스템은 안 바뀌었는데 사람이 둘 나가서 더 급해졌습니다"를
    // 받을 자리가 없으면 부서는 아무 말도 못 하고 기다리기만 한다.
    expect(liftKindOf('changed')).toBeTruthy()
    expect(liftKindOf('changed').ready).toBe(false)
    expect(liftKindOf('met').ready).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateHoldLift()).not.toThrow()
    expect(liftKindOf()).toBeNull()
  })
})

describe('지금 이 보류가 어떤 상태인가', () => {
  it('보류가 아니면 아무 말도 안 한다', () => {
    const s = holdState({ application: { status: '수용' }, review, records: [] })
    expect(s.canTell).toBe(false)
    expect(holdHeadline(s)).toBeNull()
  })

  it('보류면 알릴 수 있고 조건을 다시 보여준다', () => {
    // 몇 주 전에 읽은 문장을 기억해 내라고 하면 대개 기억 못 한다.
    const s = holdState({ application: held, review, records: [], now: NOW })
    expect(s.canTell).toBe(true)
    expect(s.condition).toBe('SAP 이관이 끝나면 다시 봅니다')
    expect(s.pending).toBe(false)
  })

  it('알리면 담당자 답을 기다리는 상태가 된다', () => {
    const s = holdState({
      application: held,
      review,
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.pending).toBe(true)
    expect(holdHeadline(s)).toContain('아직 못 봤습니다')
  })

  it('거두면 없던 일이 된다', () => {
    // 잘못 눌렀을 때 되돌릴 자리가 없으면 부서는 아예 안 누른다.
    const s = holdState({
      application: held,
      review,
      records: [
        rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00'),
        rec(HOLD_LIFT_CANCEL_KIND, '2026-08-02 00:00:00'),
      ],
      now: NOW,
    })
    expect(s.pending).toBe(false)
    expect(s.open).toBeNull()
  })

  it('거둔 뒤 다시 알리면 다시 기다리는 상태다', () => {
    const s = holdState({
      application: held,
      review,
      records: [
        rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00'),
        rec(HOLD_LIFT_CANCEL_KIND, '2026-08-02 00:00:00'),
        rec(HOLD_LIFT_KIND, '2026-08-03 00:00:00'),
      ],
      now: NOW,
    })
    expect(s.pending).toBe(true)
  })

  it('알린 뒤에 다시 판정했으면 답을 받은 것이다', () => {
    // 따로 "확인했습니다" 버튼을 만들지 않는다. 누르기만 하고 판정은 안 하는
    // 자리가 하나 더 생길 뿐이다. 판정이 곧 답이다.
    const s = holdState({
      application: held,
      review: { ...review, updated_at: '2026-08-04 00:00:00' },
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.answered).toBe(true)
    expect(s.pending).toBe(false)
    expect(holdHeadline(s)).toContain('다시 판정했습니다')
  })

  it('판정이 알림보다 앞서면 답이 아니다', () => {
    // 보류 판정 그 자체를 "답했다"로 세면, 알림은 영원히 안 읽힌 채로 끝난다.
    const s = holdState({
      application: held,
      review,
      records: [rec(HOLD_LIFT_KIND, '2026-08-01 00:00:00')],
      now: NOW,
    })
    expect(s.answered).toBe(false)
    expect(s.pending).toBe(true)
  })

  it('오래 묵으면 먼저 말을 건다', () => {
    // 한 달이 넘도록 아무 말이 없으면 그건 미뤄 둔 것이 아니라 잊힌 것이다.
    const s = holdState({ application: held, review, records: [], now: NOW })
    expect(s.heldDays).toBeGreaterThanOrEqual(30)
    expect(holdHeadline(s)).toContain('미뤄 둔 지')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => holdState()).not.toThrow()
    expect(holdState().canTell).toBe(false)
  })
})

describe('왜 부서가 먼저 말해야 하는지', () => {
  it('아무도 안 움직이면 그대로라는 것을 말한다', () => {
    const t = holdWhy({ pending: false })
    expect(t).toContain('그쪽에서만 아십니다')
    expect(t).toContain('영원히 그대로')
  })

  it('알린 뒤에는 어디로 갔는지 말한다', () => {
    // 보냈는데 어디로 갔는지 모르면 다음부터 안 보낸다.
    expect(holdWhy({ pending: true })).toContain('할 일 목록')
  })
})

describe('고를 수 있는 것', () => {
  it('조건이 풀린 쪽이 먼저다', () => {
    // 화면에서 기본 선택으로 쓴다.
    expect(LIFT_KINDS[0].code).toBe('met')
  })

  it('종류마다 무엇을 적어야 하는지 알려준다', () => {
    for (const k of LIFT_KINDS) {
      expect(k.hint.length).toBeGreaterThan(10)
      expect(k.label.length).toBeGreaterThan(4)
    }
  })
})

// 한 번에 미룬 보류가 어디에도 안 보였다.
//
// 보류가 두 길로 들어온다. 한 건씩 판정하면 review 표에
// hold_until_condition 이 적히고, 접수함에서 여러 건을 한 번에 미루면
// decision_log 에만 남는다. 한 번에 미루는 화면은 "언제 다시 보시겠습니까"를
// **필수로** 받는데(5자 이상), 그 답이 review 표에는 안 들어갔다.
//
// 그래서 담당자가 의무로 적은 조건을 읽는 자리가 전부 비어 있었다 —
// 부서 조회 화면, 부서별 화면, 못 한 것 화면, 그리고 30일 넘김 경보.
// 경보가 특히 나쁘다. 한 달이 지나도 안 켜지니 한 번에 미룬 건은 영영
// 잊힌다. 한 번에 미룬다는 것은 원래 급하지 않아서 미루는 것인데, 그게
// 곧 아무도 다시 안 본다는 뜻이 되어 버렸다.
describe('한 번에 미룬 보류', () => {
  const bulkRow = (what, at) => ({
    link_kind: BULK_HOLD_KIND,
    what,
    created_at: at,
  })

  it('기록에서 조건만 뽑아낸다', () => {
    // 기록에는 "보류로 미룹니다. {조건}"으로 적힌다. 앞머리를 떼야 부서가
    // 읽을 문장이 된다.
    const got = bulkHoldFrom([bulkRow('보류로 미룹니다. 9월 마감 뒤에 봅니다.', '2026-01-01')])
    expect(got.condition).toBe('9월 마감 뒤에 봅니다.')
    expect(got.at).toBe('2026-01-01')
  })

  it('앞머리가 없으면 본문을 그대로 쓴다', () => {
    // 문구를 고치는 날 조용히 끊기면 안 된다.
    expect(bulkHoldFrom([bulkRow('손이 없습니다', '2026-01-01')]).condition).toBe('손이 없습니다')
  })

  it('여러 번 미뤘으면 마지막 것이 지금 상태다', () => {
    // append-only 로그다. 첫 줄을 집으면 나중에 고친 값이 버려진다 —
    // 이 저장소에서 이미 두 번 당한 자리다.
    const got = bulkHoldFrom([
      bulkRow('보류로 미룹니다. 처음 조건', '2026-01-01'),
      bulkRow('보류로 미룹니다. 나중 조건', '2026-03-01'),
    ])
    expect(got.condition).toBe('나중 조건')
    expect(got.at).toBe('2026-03-01')
  })

  it('순서가 뒤섞여 와도 마지막을 집는다', () => {
    const got = bulkHoldFrom([
      bulkRow('보류로 미룹니다. 나중 조건', '2026-03-01'),
      bulkRow('보류로 미룹니다. 처음 조건', '2026-01-01'),
    ])
    expect(got.condition).toBe('나중 조건')
  })

  it('없으면 null', () => {
    expect(bulkHoldFrom([])).toBeNull()
    expect(bulkHoldFrom(null)).toBeNull()
    // 다른 종류는 안 센다.
    expect(bulkHoldFrom([{ link_kind: '일괄:ack', what: '읽었습니다.' }])).toBeNull()
  })

  it('조건이 부서 화면까지 간다', () => {
    const state = holdState({
      application: { status: '보류' },
      review: null,
      records: [],
      decisions: [bulkRow('보류로 미룹니다. 9월 마감 뒤에 봅니다.', '2026-01-01')],
      now: '2026-01-10 00:00:00',
    })
    expect(state.condition).toBe('9월 마감 뒤에 봅니다.')
    expect(state.canTell).toBe(true)
    // 한 번에 미룬 것이라고 밝힌다. 감춰 두면 나중에 알았을 때 속은 기분이 든다.
    expect(state.bulk).toBe(true)
  })

  it('30일 넘김 경보가 켜진다', () => {
    // 이게 이 버그에서 제일 나빴다. 한 달이 지나도 안 켜지니 한 번에 미룬
    // 건은 영영 잊혔다.
    const state = holdState({
      application: { status: '보류' },
      review: null,
      records: [],
      decisions: [bulkRow('보류로 미룹니다. 9월 마감 뒤에 봅니다.', '2026-01-01 00:00:00')],
      now: '2026-03-01 00:00:00',
    })
    expect(state.heldDays).toBeGreaterThanOrEqual(30)
    expect(holdHeadline(state)).toContain('미뤄 둔 지')
  })

  it('표에 한 번에 미뤘다고 적혀 있으면 그대로 읽는다', () => {
    // 이제 한 번에 미룬 것도 review 표에 적힌다. 조건이 표에서 오므로
    // 기록 쪽으로 안 되짚는데, 그때 "한 번에"가 꺼져서 새로 미룬 건이
    // 오히려 보통 보류로 보였다. 옛 건은 한 번에로 나오고 새 건은 안
    // 나오는, 정확히 거꾸로 된 상태였다.
    const state = holdState({
      application: { status: '보류' },
      review: {
        verdict: '보류',
        hold_until_condition: '9월 마감 뒤에 봅니다',
        bulk: 1,
        decided_at: '2026-02-01',
      },
      records: [],
      decisions: [],
    })
    expect(state.bulk).toBe(true)
    expect(state.condition).toBe('9월 마감 뒤에 봅니다')
  })

  it('한 건씩 판정한 것이 우선이다', () => {
    // 그쪽이 더 자세하고 점수까지 매긴 것이다.
    const state = holdState({
      application: { status: '보류' },
      review: { verdict: '보류', hold_until_condition: '한 건씩 적은 조건', decided_at: '2026-02-01' },
      records: [],
      decisions: [bulkRow('보류로 미룹니다. 한 번에 적은 조건', '2026-01-01')],
    })
    expect(state.condition).toBe('한 건씩 적은 조건')
    expect(state.bulk).toBe(false)
  })

  it('보류가 아니면 아무 말도 안 한다', () => {
    // 미뤄 뒀다가 다시 판정해 수용한 건에 "보류 중"이 뜨면 안 된다.
    const state = holdState({
      application: { status: '수용' },
      review: null,
      records: [],
      decisions: [bulkRow('보류로 미룹니다. 옛 조건', '2026-01-01')],
    })
    expect(state.canTell).toBe(false)
    expect(holdHeadline(state)).toBeNull()
  })

  it('종류 이름이 서버가 쓰는 것과 같다', () => {
    // 다르면 아무것도 안 걸러지고 조용히 빈 값이 된다.
    expect(BULK_HOLD_KIND).toBe('일괄:hold')
  })
})

describe('두 길이 같은 이름을 쓰는가', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))

  it('쓰는 쪽 이름이 읽는 쪽과 같다', () => {
    // 한쪽만 고치면 아무것도 안 걸러지고 조용히 빈 값이 된다. 예외도 안 나고
    // 화면도 안 깨진다 — 이 저장소에서 제일 자주 난 사고의 모양이다.
    const bulk = readFileSync(join(ROOT, 'functions', 'api', 'applications', 'bulk.js'), 'utf8')
    expect(bulk).toContain('`일괄:${spec.code}`')
    expect(BULK_BY_CODE.hold).toBeTruthy()
    expect(`일괄:${BULK_BY_CODE.hold.code}`).toBe(BULK_HOLD_KIND)
  })

  it('SQL로 읽는 자리도 같은 이름을 쓴다', () => {
    // 이 둘은 JS가 아니라 SQL 문자열이라 이름을 바꿔도 아무도 안 알려 준다.
    for (const f of [
      join('functions', 'api', 'honesty.js'),
      join('functions', 'api', 'depts', '[dept].js'),
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toContain(BULK_HOLD_KIND)
    }
  })

  it('한 번에 미루는 화면이 조건을 필수로 받는다', () => {
    // 안 받으면 여기서 읽어 낼 것이 없다.
    expect(BULK_BY_CODE.hold.needsReason).toBe(true)
    expect(BULK_BY_CODE.hold.changesStatus).toBe('보류')
  })
})
