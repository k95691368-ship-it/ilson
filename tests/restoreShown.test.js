import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastRestore, RESTORE_KIND } from '../shared/rollback.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 다시 올렸는데 부서는 무엇이 고쳐졌는지 못 봤다.
//
// 라이브에서 도구를 내렸다가 복구해 봤다. 서버는 이렇게 답한다 —
//
//   "다시 올렸습니다. 부서 도구 화면에 무엇을 고쳤는지 함께 뜹니다."
//
// 그리고 도구 화면을 열어 보면 그 문장이 어디에도 없다. 기록은 남아 있다
// (decision_log 의 다시올림). 화면이 그걸 안 읽었을 뿐이다.
//
// 이게 왜 큰가. 부서는 그 도구가 틀린 숫자를 내는 것을 겪었고, 며칠 못
// 썼고, 어느 날 그냥 다시 열린 것을 본다. 무엇이 달라졌는지 모르면 안
// 쓴다. 손으로 하던 방식으로 조용히 돌아가고, 그 사실은 아무 화면에도
// 안 남는다. 넘긴 도구를 부서가 안 쓰는 것이 이 사이트 최악의 결말이다.

const row = (over = {}) => ({
  link_kind: RESTORE_KIND,
  what: '반품 줄의 부호를 뒤집던 규칙을 고쳤습니다.',
  why: '합계가 12,400원 더 나왔던 것 — 이것을 고쳤습니다.',
  created_at: '2026-08-09 07:00:00',
  ...over,
})

describe('고친 내용이 부서에게 간다', () => {
  it('마지막으로 고친 것을 말한다', () => {
    // 첫 줄을 잡으면 예전에 고친 내용이 뜬다.
    const r = lastRestore([
      row({ what: '처음에 고친 것', created_at: '2026-07-01 00:00:00' }),
      row({ what: '이번에 고친 것' }),
    ])
    expect(r.fixed).toBe('이번에 고친 것')
    expect(r.count).toBe(2)
  })

  it('몇 번째인지 감추지 않는다', () => {
    // 두 번 세 번 내려간 도구라면 부서가 그것까지 알고 판단할 일이다.
    expect(lastRestore([row(), row(), row()]).count).toBe(3)
  })

  it('내렸던 이유도 같이 온다', () => {
    // 무엇이 문제였고 무엇을 고쳤나가 붙어 있어야 읽힌다.
    expect(lastRestore([row()]).why).toContain('12,400원')
  })

  it('내려간 적 없으면 아무 말도 안 한다', () => {
    expect(lastRestore([])).toBeNull()
    expect(lastRestore(null)).toBeNull()
    // 신고 기록만 있는 경우에 잘못 뜨면 안 된다.
    expect(lastRestore([{ link_kind: '신고', what: 'x' }])).toBeNull()
  })
})

describe('그 값이 실제로 화면까지 간다', () => {
  const route = readFileSync(join(ROOT, 'functions', 'api', 'tools', '[slug].js'), 'utf8')
  const page = readFileSync(join(ROOT, 'src', 'pages', 'ToolPage.jsx'), 'utf8')

  it('서버가 다시올림 줄을 뽑는다', () => {
    // 뽑는 문장에서 빠지면 늘 null 이 되고 화면은 조용히 안 뜬다.
    expect(route).toContain('RESTORE_KIND')
    expect(route).toContain('link_kind IN (?, ?, ?)')
  })

  it('서버가 그 값을 응답에 넣는다', () => {
    // 계산해 놓고 return 에 안 넣는 것이 이 저장소에서 되풀이된 실수다.
    expect(route).toContain('restored: lastRestore(')
  })

  it('신고 목록에는 안 섞는다', () => {
    // 같은 쿼리로 뽑았으니 거르지 않으면 "부서가 낸 신고"에 담당자 기록이 낀다.
    expect(route).toContain('r.link_kind !== RESTORE_KIND')
  })

  it('화면이 그 값을 그린다', () => {
    expect(page).toContain('data.restored')
    expect(page).toContain('고친 것')
    expect(page).toContain('내렸던 이유')
  })
})
