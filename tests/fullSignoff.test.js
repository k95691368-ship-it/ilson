import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fullySignedIds } from '../functions/_lib/signoff.js'
import { SIGNOFF_KIND } from '../shared/signoff.js'
import { JOIN_KIND, UNJOIN_KIND } from '../shared/join.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 한 부서만 서명해도 '서명 받음'으로 세고 있었다.
//
// 세 곳이 각자 "SIGNOFF_KIND 줄이 하나라도 있으면 받은 것"으로 셌다 —
// 조회 화면의 '지금 해 주셔야 할 것', 부서 응답률, 부서별 화면의 남은 할 일.
//
// 그런데 다른 부서가 손들면 걸린 부서가 둘 이상이 된다. 그중 한 부서가
// 먼저 서명하는 순간 —
//   · 정작 신청서를 낸 부서는 확인 안내를 더 이상 못 받고,
//   · 응답률은 이 건을 '답했음'으로 세어 실제보다 높게 나오고,
//   · 담당자의 남은 할 일에서도 사라진다.
// 그리고 5단계에서 "합격 기준을 통과했습니다"가 나간다. 서명 안 한 부서는
// 그 기준을 본 적이 없는데.

// decision_log 를 흉내 낸 D1. 넘긴 SQL 을 보고 알맞은 줄을 돌려준다.
function fakeDB({ signs = [], joins = [] } = {}) {
  const stmt = (sql) => ({
    bind: () => stmt(sql),
    all: async () => ({ results: sql.includes('link_id AS dept') ? signs : joins }),
    first: async () => null,
  })
  // fullySignedIds 는 env 를 받는다. DB 를 그대로 주면 안 된다.
  return { DB: { prepare: stmt } }
}

const sign = (appId, dept) => ({ application_id: appId, dept })
const join = (id, appId, dept) => ({
  id,
  application_id: appId,
  link_kind: JOIN_KIND,
  link_id: null,
  title: `${dept} — 우리도 같은 일을 겪는다`,
  why: JSON.stringify({ dept }),
})
const unjoin = (joinId, appId) => ({
  id: `u_${joinId}`,
  application_id: appId,
  link_kind: UNJOIN_KIND,
  link_id: joinId,
  title: '',
  why: '',
})

const APPS = [{ id: 'app_1', dept: '재무' }]

describe('걸린 부서가 전부 서명해야 받은 것이다', () => {
  it('한 부서만 걸렸으면 한 장으로 끝난다', async () => {
    const db = fakeDB({ signs: [sign('app_1', '재무')] })
    expect([...(await fullySignedIds(db, APPS))]).toEqual(['app_1'])
  })

  it('두 부서가 걸렸는데 한 곳만 서명하면 아직이다', async () => {
    // 여기가 틀렸던 자리다.
    const db = fakeDB({
      signs: [sign('app_1', '마케팅')],
      joins: [join('j1', 'app_1', '마케팅')],
    })
    expect((await fullySignedIds(db, APPS)).size).toBe(0)
  })

  it('두 부서가 다 서명하면 받은 것이다', async () => {
    const db = fakeDB({
      signs: [sign('app_1', '마케팅'), sign('app_1', '재무')],
      joins: [join('j1', 'app_1', '마케팅')],
    })
    expect((await fullySignedIds(db, APPS)).has('app_1')).toBe(true)
  })

  it('담당자가 푼 손은 기다리지 않는다', async () => {
    // 풀었는데도 그 부서 서명을 기다리면 이 신청서는 영영 확인됨이 못 된다.
    const db = fakeDB({
      signs: [sign('app_1', '재무')],
      joins: [join('j1', 'app_1', '마케팅'), unjoin('j1', 'app_1')],
    })
    expect((await fullySignedIds(db, APPS)).has('app_1')).toBe(true)
  })

  it('서명이 하나도 없으면 아직이다', async () => {
    expect((await fullySignedIds(fakeDB(), APPS)).size).toBe(0)
  })

  it('부서가 안 붙은 옛 서명은 낸 부서 것으로 본다', async () => {
    // 부서를 남기기 전에 받은 서명이 있다. 그것 때문에 옛 건이 영영
    // '아직'으로 남으면, 담당자 할 일에 지울 수 없는 줄이 생긴다.
    const db = fakeDB({ signs: [sign('app_1', null)] })
    expect((await fullySignedIds(db, APPS)).has('app_1')).toBe(true)
  })

  it('빈 입력에도 터지지 않는다', async () => {
    expect((await fullySignedIds(fakeDB(), [])).size).toBe(0)
    expect((await fullySignedIds(fakeDB(), undefined)).size).toBe(0)
  })
})

describe('세 화면이 모두 그 판정을 쓴다', () => {
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.js')) files.push(p)
    }
  }
  walk(join(ROOT, 'functions', 'api'))

  it('한 줄이라도 있으면 받은 것으로 세는 곳이 없다', () => {
    // SIGNOFF_KIND 를 세어 0보다 크면 서명으로 치던 자리들이다.
    const bad = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('SIGNOFF_KIND')) continue
      if (/some\(\(?\w+\)? => \w+\.link_kind === SIGNOFF_KIND\)/.test(src)) bad.push(f.slice(ROOT.length))
      if (/CASE WHEN signed > 0/.test(src)) bad.push(f.slice(ROOT.length))
      if (/&& !\w+\.signed\b/.test(src)) bad.push(f.slice(ROOT.length))
    }
    expect(bad).toEqual([])
  })

  it('세 곳이 같은 함수를 부른다', () => {
    for (const rel of [
      'functions/api/track/[ticket].js',
      'functions/api/response.js',
      'functions/api/depts/[dept].js',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src, rel).toContain('fullySignedIds')
    }
  })
})
