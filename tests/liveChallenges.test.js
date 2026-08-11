import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveChallenges, daysSince, deptFeltFrom, runsFromTotals } from '../shared/outcome.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 반박을 세는 자리가 네 군데였고, 넷이 서로 달랐다.
//
// 부서가 여는 도구 화면만 이랬다 —
//   · buildChallenges 에 baselineAgeDays 와 deptFelt 를 아예 안 넘겨서
//     규칙 둘("기준선이 오래됐다", "부서 체감과 다르다")이 영영 안 걸렸다.
//   · 해소한 반박을 빼지도 않아서, 담당자가 전부 해소해도 부서에게는
//     영원히 '보수적 추정'이라고 적혔다.
//   · 실행 기록을 최근 40번만 읽어 절감이 40회분에서 얼어붙었다. 그런데
//     만든 공수는 전액 빼므로, 본전을 넘긴 도구가 부서 화면에서는 영영
//     '아직 본전'에 갇혔다.
// 부서별 화면은 살아 있는 개수에서 해소한 **개수**를 뺐다. 규칙에서 이미
// 빠진 반박이 해소 목록에 있으면 그만큼 또 빠진다.
//
// 같은 것을 네 벌로 두면 규칙이 하나 늘 때마다 세 곳이 뒤처진다.
// 세는 자리를 shared/outcome.js 의 liveChallenges 하나로 모았다.

const outcome = (over = {}) => ({
  status: '절감',
  savedSeconds: 36000,
  savedKrw: 250000,
  runCount: 57,
  reviewSeconds: 600,
  reworkSeconds: 0,
  ...over,
})

describe('살아 있는 반박을 세는 자리는 하나다', () => {
  it('해소한 코드는 빠진다', () => {
    const ctx = { outcome: outcome(), quarantineLeft: 3, deptConfirmed: false }
    const before = liveChallenges(ctx)
    expect(before.openCount).toBeGreaterThan(0)

    const after = liveChallenges({ ...ctx, resolvedCodes: before.all.map((c) => c.code) })
    expect(after.openCount).toBe(0)
    // 전체 목록은 그대로 둔다. 화면이 "무엇을 해소했는지"를 보여야 하기 때문이다.
    expect(after.all.length).toBe(before.all.length)
  })

  it('이어 붙인 문자열로 와도 같게 센다', () => {
    // 라우트마다 GROUP_CONCAT 으로 뽑기도 하고 배열로 뽑기도 한다.
    // 여기서 맞춰 주지 않으면 또 갈린다.
    const ctx = { outcome: outcome(), quarantineLeft: 3, deptConfirmed: false }
    const codes = liveChallenges(ctx).all.map((c) => c.code)
    expect(liveChallenges({ ...ctx, resolvedCodes: codes.join(',') }).openCount).toBe(0)
    expect(liveChallenges({ ...ctx, resolvedCodes: ` ${codes[0]} , ` }).openCount).toBe(
      liveChallenges(ctx).openCount - 1
    )
  })

  it('해소 목록에 없는 코드가 있어도 두 번 빼지 않는다', () => {
    // 뺄셈으로 세던 시절의 버그다. 규칙에서 이미 빠진 반박이 해소 목록에
    // 남아 있으면 살아 있는 것까지 하나 더 빠졌다.
    const ctx = { outcome: outcome(), quarantineLeft: 3, deptConfirmed: false }
    const plain = liveChallenges(ctx).openCount
    const withGhost = liveChallenges({ ...ctx, resolvedCodes: '없는규칙,another_ghost' }).openCount
    expect(withGhost).toBe(plain)
  })

  it('인자를 빼먹으면 반박이 덜 걸린다 — 그래서 넷이 갈렸다', () => {
    const base = { outcome: outcome(), quarantineLeft: 0, deptConfirmed: true }
    const 없이 = liveChallenges(base).openCount
    const 있게 = liveChallenges({ ...base, baselineAgeDays: 400, deptFelt: 5 }).openCount
    // 이 차이가 부서 화면과 담당자 화면의 개수 차이였다.
    expect(있게).toBeGreaterThan(없이)
  })

  it('산정불가면 반박을 만들지 않는다', () => {
    // 값도 없는 화면에 "이 숫자를 믿지 마세요"가 뜨면 안 된다.
    const r = liveChallenges({ outcome: outcome({ status: '산정불가' }), quarantineLeft: 9 })
    expect(r.all).toEqual([])
    expect(r.openCount).toBe(0)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => liveChallenges()).not.toThrow()
    expect(liveChallenges().openCount).toBe(0)
  })
})

describe('전수로 세는가', () => {
  it('합계를 되돌리면 전수 실행이 된다', () => {
    // 부서 화면이 최근 40번만 계산에 넣고 있었다. 41번째부터는 절감이
    // 통째로 빠진다.
    const runs = runsFromTotals({
      count: 57,
      durationMs: 57000,
      reviewSeconds: 600,
      reworkSeconds: 60,
    })
    expect(runs).toHaveLength(57)
  })

  it('부서 도구 화면이 목록용 쿼리로 계산하지 않는다', () => {
    const src = readFileSync(join(ROOT, 'functions', 'api', 'tools', '[slug].js'), 'utf8')
    // 목록은 LIMIT 40 이 맞다. 계산에 그걸 쓰면 안 된다.
    expect(src).toContain('LIMIT 40')
    expect(src).not.toMatch(/runs:\s*recent\.results/)
    expect(src).toContain('runsFromTotals')
    // 전수 합계를 뽑는 쿼리가 실제로 있어야 한다.
    expect(src).toContain('COUNT(*) AS n')
  })
})

describe('같은 부품을 나눠 쓴다', () => {
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.js')) files.push(p)
    }
  }
  walk(join(ROOT, 'functions'))

  it('daysSince 를 라우트마다 새로 만들지 않는다', () => {
    // 넷이 똑같이 복사돼 있었다. 반박 규칙 하나가 이 값을 보므로, 한 곳이
    // 안 넘기면 그 화면에서만 반박이 하나 덜 뜬다.
    const copies = files.filter((f) => readFileSync(f, 'utf8').includes('function daysSince('))
    expect(copies.map((f) => f.slice(ROOT.length))).toEqual([])
  })

  it('공용 daysSince 가 같은 답을 낸다', () => {
    expect(daysSince(null)).toBe(0)
    expect(daysSince('말도 안 되는 값')).toBe(0)
    expect(daysSince('2000-01-01 00:00:00')).toBeGreaterThan(9000)
  })

  it('부서 체감값을 읽는 방법도 하나다', () => {
    expect(deptFeltFrom({ alternatives: JSON.stringify({ felt: 42 }) })).toBe(42)
    expect(deptFeltFrom({ alternatives: '깨진 JSON' })).toBeNull()
    expect(deptFeltFrom(null)).toBeNull()
  })
})
