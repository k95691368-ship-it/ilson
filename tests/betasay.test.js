import { describe, it, expect } from 'vitest'
import {
  validateBetaSay,
  betaSayState,
  betaSayHeadline,
  betaSayWhy,
  kindOf,
  BETA_SAY_KINDS,
} from '../shared/betasay.js'

// 조회 화면은 "시험판을 써 보고 막힌 곳을 알려주세요"라고 적어 두고, 정작
// 그 말을 적을 칸을 아무 데도 안 뒀다. /beta는 담당자 화면이고, 도구
// 주소(/t/:slug)는 배포가 끝나야 생긴다 — 시험판은 배포 앞 단계다.

const round = { id: 'br1', seq: 2, overall: '통과', created_at: '2026-08-03 01:00:00' }
const say = (over = {}) => ({
  id: 'b1',
  kind: '막힌곳',
  person_label: '김대리',
  body: '광고비 칸이 비어서 옵니다',
  resolved_at: null,
  resolution: null,
  created_at: '2026-08-03 02:00:00',
  ...over,
})

describe('적어 주실 때 받는 것', () => {
  const good = { by: '김대리', kind: '막힌곳', body: '광고비 칸이 비어서 옵니다' }

  it('성함을 받는다', () => {
    // 되물을 것이 생기면 그 성함으로 찾는다.
    expect(validateBetaSay({ ...good, by: '' }).by).toBeTruthy()
    expect(validateBetaSay(good)).toEqual({})
  })

  it('한 줄이라도 적게 한다', () => {
    // "불편해요" 한 마디만 오면 담당자는 무엇을 고쳐야 할지 모른다.
    expect(validateBetaSay({ ...good, body: '' }).body).toBeTruthy()
    expect(validateBetaSay({ ...good, body: '별로' }).body).toBeTruthy()
  })

  it('종류를 고르게 한다', () => {
    expect(validateBetaSay({ ...good, kind: '' }).kind).toBeTruthy()
    expect(validateBetaSay({ ...good, kind: '아무거나' }).kind).toBeTruthy()
  })

  it('고를 수 있는 종류는 DB가 받는 것과 같다', () => {
    // 화면에서 고른 값이 CHECK 목록에 없으면 500이 난다. 반려 사유에서
    // 실제로 그랬다 — 한 묶음이 통째로 되돌아가 점수까지 날아갔다.
    expect(BETA_SAY_KINDS.map((k) => k.code).sort()).toEqual(
      ['막힌곳', '요청', '의견', '칭찬'].sort()
    )
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateBetaSay()).not.toThrow()
  })
})

describe('지금 시험판 의견이 어떤 상태인가', () => {
  it('시험판이 없으면 물어볼 것이 없다', () => {
    // 없는 것에 대고 의견을 받으면 담당자는 무엇을 두고 하신 말인지 모른다.
    expect(betaSayState({ round: null, says: [] }).canSay).toBe(false)
    expect(betaSayHeadline({ canSay: false })).toBeNull()
  })

  it('시험판이 있으면 적을 수 있다', () => {
    const s = betaSayState({ round, says: [] })
    expect(s.canSay).toBe(true)
    expect(s.total).toBe(0)
    expect(betaSayHeadline(s)).toContain('써 보시고')
  })

  it('답 못 드린 것을 센다', () => {
    const s = betaSayState({
      round,
      says: [say(), say({ id: 'b2', resolved_at: '2026-08-03 03:00:00', resolution: '고쳤습니다' })],
    })
    expect(s.total).toBe(2)
    expect(s.open).toBe(1)
    expect(s.answered).toBe(1)
    expect(betaSayHeadline(s)).toContain('1건은 아직')
  })

  it('다 답했으면 다 답했다고 말한다', () => {
    const s = betaSayState({
      round,
      says: [say({ resolved_at: '2026-08-03 03:00:00', resolution: '고쳤습니다' })],
    })
    expect(s.open).toBe(0)
    expect(betaSayHeadline(s)).toContain('모두 답을 드렸습니다')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => betaSayState()).not.toThrow()
  })
})

describe('왜 적어 달라고 하는지', () => {
  it('기계가 통과시켰어도 그것만으로는 통과가 아니라고 말한다', () => {
    const t = betaSayWhy({ round: { overall: '통과' } })
    expect(t).toContain('기계는')
    expect(t).toContain('써 보신 분만 압니다')
  })

  it('통과가 아니면 사용법서 이야기를 한다', () => {
    expect(betaSayWhy({ round: { overall: '조건부' } })).toContain('자주 묻는 것')
  })
})

describe('종류마다 뭐라고 물을지', () => {
  it('종류를 찾으면 물어볼 말이 같이 온다', () => {
    expect(kindOf('막힌곳').hint).toBeTruthy()
    expect(kindOf('막힌곳').label).toBe('여기서 막혔습니다')
  })

  it('모르는 종류는 없다고 답한다', () => {
    expect(kindOf('아무거나')).toBeNull()
    expect(kindOf()).toBeNull()
  })

  it('막힌 곳이 가장 급한 것이다', () => {
    // 이 값으로 화면에서 기본 선택을 정한다.
    expect(BETA_SAY_KINDS.filter((k) => k.urgent).map((k) => k.code)).toEqual(['막힌곳'])
  })
})
