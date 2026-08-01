import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 없는 컬럼을 쓰는 SQL을 배포 전에 잡는다.
//
// 실제로 당했다. /honesty 화면을 만들면서 `b.id`를 썼는데 baseline 표의
// 기본키는 `application_id`였다. 시험도 린트도 빌드도 전부 통과했고,
// 배포하고 나서야 503이 떴다. 화면 하나가 통째로 안 열렸다.
//
// SQL은 문자열이라 아무도 안 읽어 준다. 그러니 여기서 읽는다. 마이그레이션에서
// 표와 컬럼을 뽑고, 서버 코드의 SQL에서 `별칭.컬럼`을 뽑아서 맞춰 본다.
//
// 완벽한 SQL 파서가 아니다. 그럴 필요도 없다 — 오타와 잘못 안 컬럼 이름만
// 잡으면 되고, 그게 실제로 나는 사고의 거의 전부다.

// 경로에 한글이 있어서 URL 그대로 쓰면 %EB%B0%94… 로 인코딩된 채 넘어간다.
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function readSchema() {
  const dir = join(ROOT, 'migrations')
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')

  const tables = new Map()
  const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]*?)\n\);/g
  let m
  while ((m = re.exec(sql))) {
    const [, name, body] = m
    const cols = new Set()
    for (const line of body.split('\n')) {
      const t = line.trim()
      // 제약조건 줄은 컬럼이 아니다.
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(t)) continue
      const col = t.match(/^([a-z_][a-z0-9_]*)\s+[A-Z]/)
      if (col) cols.add(col[1])
    }
    tables.set(name, cols)
  }
  return tables
}

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) jsFiles(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

// SQL 한 덩이에서 "별칭 → 표" 짝을 뽑는다. FROM/JOIN 뒤에 오는 것만 본다.
function aliasMap(sql, tables) {
  const map = new Map()
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi
  let m
  while ((m = re.exec(sql))) {
    const [, table, alias] = m
    // ON·WHERE 같은 예약어가 별칭 자리에 걸린 경우는 버린다.
    if (/^(on|where|group|order|left|inner|join|using|set|values|as)$/i.test(alias)) continue
    if (tables.has(table)) map.set(alias, table)
  }
  // 별칭 없이 쓰는 경우 — FROM application 처럼. 표 이름 자체가 별칭이 된다.
  const re2 = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\b/gi
  while ((m = re2.exec(sql))) {
    if (tables.has(m[1]) && !map.has(m[1])) map.set(m[1], m[1])
  }
  return map
}

describe('SQL이 없는 컬럼을 쓰고 있지 않은지', () => {
  const tables = readSchema()

  it('마이그레이션에서 표를 읽어 낸다', () => {
    // 이 시험 자체가 헛돌지 않는지 먼저 본다. 정규식이 안 맞아서 표를 하나도
    // 못 읽으면, 아래 검사는 전부 통과하지만 아무것도 안 본 것이 된다.
    expect(tables.size).toBeGreaterThan(20)
    expect(tables.get('application')?.has('ticket_no')).toBe(true)
    expect(tables.get('baseline')?.has('application_id')).toBe(true)
    expect(tables.get('baseline')?.has('id')).toBe(false)
  })

  it('서버 코드의 SQL이 전부 실제 컬럼만 쓴다', () => {
    const problems = []

    for (const file of jsFiles(join(ROOT, 'functions'))) {
      const src = readFileSync(file, 'utf8')
      const rel = file.slice(ROOT.length).replace(/\\/g, '/')

      // 백틱 문자열 중 SQL로 보이는 것만 본다.
      for (const raw of src.match(/`[^`]*`/g) ?? []) {
        if (!/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(raw)) continue
        // ${...} 로 끼워 넣은 자리는 검사할 수 없다. 빈칸으로 두고 넘어간다.
        const sql = raw.replace(/\$\{[^}]*\}/g, ' ')
        const map = aliasMap(sql, tables)
        if (map.size === 0) continue

        const ref = /\b([a-z][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi
        let m
        while ((m = ref.exec(sql))) {
          const [whole, alias, col] = m
          const table = map.get(alias)
          if (!table) continue
          if (tables.get(table).has(col)) continue
          problems.push(`${rel} — ${whole} (${table} 표에 ${col} 컬럼이 없습니다)`)
        }
      }
    }

    expect(problems).toEqual([])
  })
})
