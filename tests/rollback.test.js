import { describe, it, expect } from 'vitest'
import {
  rollbackState,
  rollbackHeadline,
  rollbackWhatNow,
  rollbackNudge,
  STALE_DAYS,
} from '../shared/rollback.js'

// 담당자가 도구를 내리면 조회 화면에는 "문제가 있어 잠시 내렸습니다" 한 줄이
// 떴다. 왜 내렸는지는 rollback_reason 칸에 저장되는데 화면으로 안 갔고,
// 그동안 어떻게 해야 하는지도 아무 말이 없었다.
//
// 부서 입장에서는 어제까지 그 도구로 일했는데 오늘 안 열린다. 그래서
// 전화한다. 이 사이트가 없애려는 것이 정확히 그 전화다.

const NOW = Date.parse('2026-08-10T00:00:00Z')
const down = (at, reason = '수수료 계산이 한 채널에서 틀렸습니다') => ({
  rolled_back_at: at,
  rollback_reason: reason,
})

describe('내려가 있는가', () => {
  it('안 내렸으면 아무 말도 안 한다', () => {
    const s = rollbackState({ handover: { rolled_back_at: null } })
    expect(s.down).toBe(false)
    expect(rollbackHeadline(s)).toBeNull()
    expect(rollbackWhatNow(s)).toBeNull()
  })

  it('내렸으면 이유와 날수를 같이 준다', () => {
    const s = rollbackState({ handover: down('2026-08-08 00:00:00'), now: NOW })
    expect(s.down).toBe(true)
    expect(s.days).toBe(2)
    expect(s.reason).toContain('수수료 계산')
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => rollbackState()).not.toThrow()
    expect(rollbackState().down).toBe(false)
  })
})

describe('부서에게 뭐라고 말하는가', () => {
  it('오늘 내렸으면 오늘이라고 한다', () => {
    const s = rollbackState({ handover: down('2026-08-10 00:00:00'), now: NOW })
    expect(rollbackHeadline(s)).toContain('오늘 내렸습니다')
  })

  it('며칠 됐으면 며칠인지 말한다', () => {
    const s = rollbackState({ handover: down('2026-08-06 00:00:00'), now: NOW })
    expect(rollbackHeadline(s)).toContain('4일 됐습니다')
  })

  it('"곧 고치겠습니다"라고 하지 않는다', () => {
    // 언제 올릴지 모르면서 곧이라고 하면, 부서는 그 말을 믿고 기다리다가
    // 두 번 손해를 본다 — 도구도 없고 대비도 안 한 채로.
    const s = rollbackState({ handover: down('2026-08-09 00:00:00'), now: NOW })
    const t = rollbackWhatNow(s)
    expect(t).not.toMatch(/곧|금방|빠르게 고치|조만간/)
    // 대신 지금 무엇을 해야 하는지를 말한다.
    expect(t).toContain('원래 하시던 방식으로')
  })

  it('내린 것이 맞는 판단이었다는 것도 말한다', () => {
    // 사과만 하면 "잘못 넘긴 것을 그냥 둘 걸 그랬나"로 읽힌다.
    const s = rollbackState({ handover: down('2026-08-09 00:00:00'), now: NOW })
    expect(rollbackWhatNow(s)).toContain('그대로 두는 것보다는 낫다')
  })

  it('오래 내려가 있으면 다시 여쭤보라고 한다', () => {
    // 부서가 언제까지 기다려야 할지 모르는 채로 두는 것이 가장 나쁘다.
    const s = rollbackState({ handover: down('2026-08-01 00:00:00'), now: NOW })
    expect(s.stale).toBe(true)
    expect(rollbackWhatNow(s)).toContain('다시 여쭤보셔도 됩니다')
    expect(rollbackWhatNow(s)).toContain('저희 쪽에서 놓치고 있는 것일 수 있습니다')
  })

  it('막 내린 것은 재촉하지 않는다', () => {
    const s = rollbackState({ handover: down('2026-08-10 00:00:00'), now: NOW })
    expect(s.stale).toBe(false)
    expect(rollbackWhatNow(s)).not.toContain('다시 여쭤보셔도')
  })
})

describe('담당자에게 뭐라고 말하는가', () => {
  it('오래 내려간 것이 없으면 아무 말도 안 한다', () => {
    expect(rollbackNudge([])).toBeNull()
    expect(rollbackNudge()).toBeNull()
    expect(rollbackNudge([{ stale: false }])).toBeNull()
  })

  it('있으면 왜 안 보이는지를 이유로 댄다', () => {
    // 내린 도구는 넘긴 목록에서도 빠져서 화면 어디에도 안 보인다.
    const n = rollbackNudge([{ stale: true }, { stale: true }, { stale: false }])
    expect(n.n).toBe(2)
    expect(n.why).toContain('넘긴 목록에서도 빠져서')
    expect(n.why).toContain('원래 하던 방식으로 일하고 있습니다')
  })

  it('사흘을 선으로 둔다', () => {
    expect(STALE_DAYS).toBe(3)
  })
})
