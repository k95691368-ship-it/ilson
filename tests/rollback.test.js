import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  rollbackState,
  rollbackHeadline,
  rollbackWhatNow,
  STALE_DAYS,
  RESTORE_KIND,
  validateRestore,
} from '../shared/rollback.js'
import { buildTodo } from '../shared/todo.js'

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
  it('내려 둔 채 잊은 도구를 첫 화면이 짚는다', () => {
    // 여기 rollbackNudge() 를 시험하던 자리가 있었다. 그 함수는 아무
    // 화면도 안 불렀고, shared/todo.js 가 같은 규칙을 따로 구현해서
    // 그쪽만 걸려 있었다. 두 벌이 있으면 한쪽만 고치는 날 두 화면이
    // 다른 숫자를 말한다. 쓰이는 쪽을 남기고 지웠다.
    const items = buildTodo({ tools: { summary: { downStale: 2 } } })
    const x = items.find((i) => i.key === 'tool_down_stale')
    expect(x).toBeTruthy()
    expect(x.why).toContain('원래 하던 방식으로')
  })
})

// 다시 올리는 자리가 없었다.
//
// 되돌리는 길은 있는데 다시 올리는 길이 없었다. 정확히는 있었는데 아무도
// 몰랐다 — 넘기기 폼이 저장될 때 rolled_back_at 을 조용히 NULL 로 지웠고,
// 그 버튼 이름이 "고치기"였다.
//
// 그게 두 방향으로 나빴다. 다시 올리려는 사람은 그 방법을 모르고,
// **메모 한 줄만 고치려던 사람은 자기도 모르게 부서에게 다시 열어 준다.**
// 일부러 내려 둔 도구가 저장 한 번에 살아난다.
describe('고쳐서 다시 올리기', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url))
  const deploy = readFileSync(
    join(ROOT, 'functions', 'api', 'applications', '[id]', 'deploy.js'),
    'utf8'
  )

  it('저장만 했는데 조용히 다시 올라가지 않는다', () => {
    // ON CONFLICT 절에서 지우면 어느 저장이든 부활시킨다.
    const upsert = deploy.slice(deploy.indexOf('ON CONFLICT'), deploy.indexOf('.bind('))
    expect(upsert).not.toContain('rolled_back_at = NULL')
    expect(upsert).not.toContain('rollback_reason = NULL')
  })

  it('지우는 곳은 다시 올리기 한 군데뿐이다', () => {
    const hits = deploy.split('rolled_back_at = NULL').length - 1
    expect(hits).toBe(1)
    const at = deploy.indexOf('rolled_back_at = NULL')
    // 그 자리가 restore 분기 안이어야 한다.
    expect(deploy.slice(0, at)).toContain("body.kind === 'restore'")
  })

  it('무엇을 고쳤는지 안 적으면 막는다', () => {
    // "고쳤습니다" 한 마디로 다시 열면 부서는 안 쓴다. 한 번 틀린 숫자를
    // 낸 도구이기 때문이다.
    expect(validateRestore({ fixed: '' }).fixed).toBeTruthy()
    expect(validateRestore({}).fixed).toBeTruthy()
    expect(validateRestore({ fixed: '고침' }).fixed).toBeTruthy()
    expect(validateRestore({ fixed: '합계 행을 걸러내도록 고쳤습니다' })).toEqual({})
  })

  it('내려가 있지 않은 것을 다시 올리지 않는다', () => {
    // 그러면 아무 일도 안 일어나는데 "다시 올렸습니다"가 뜬다.
    expect(deploy).toContain('지금 내려가 있지 않습니다')
  })

  it('화면에 그 버튼이 있다', () => {
    // 서버만 만들고 화면에 안 다는 일이 이 저장소에서 되풀이됐다.
    const page = readFileSync(join(ROOT, 'src', 'pages', 'DeployPage.jsx'), 'utf8')
    expect(page).toContain('고쳐서 다시 올리기')
    expect(page).toContain("kind: 'restore'")
  })

  it('기록에 남길 종류 이름이 한 벌이다', () => {
    expect(RESTORE_KIND).toBe('다시올림')
    expect(deploy).toContain('RESTORE_KIND')
  })
})
