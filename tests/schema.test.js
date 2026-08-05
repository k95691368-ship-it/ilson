import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REFUSE_CODES } from '../shared/review.js'

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

// SQL 예약어와 함수 이름. 컬럼 자리에 와도 컬럼이 아니다.
const NOT_A_COLUMN = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'as',
  'order', 'group', 'by', 'having', 'limit', 'offset', 'asc', 'desc',
  'inner', 'left', 'right', 'outer', 'join', 'on', 'using', 'union', 'all',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'case', 'when',
  'then', 'else', 'end', 'distinct', 'exists', 'between', 'like', 'cast',
  'count', 'sum', 'max', 'min', 'avg', 'coalesce', 'ifnull', 'nullif',
  'datetime', 'date', 'julianday', 'strftime', 'trim', 'upper', 'lower',
  'length', 'substr', 'replace', 'abs', 'round', 'integer', 'real', 'text',
  'conflict', 'do', 'nothing', 'excluded', 'returning', 'true', 'false',
])

// 표 하나만 쓰는 SQL의 SELECT 목록에서 맨 컬럼 이름을 뽑는다.
//
// 위 검사는 `별칭.컬럼`만 본다. 그런데 표가 하나뿐이면 별칭을 안 붙이는 것이
// 보통이고, 그때 오타는 아무도 안 잡는다. 실제로 당했다 —
// `SELECT verdict, hold_until_condition, created_at FROM review` 라고 썼는데
// review 표의 판정 시각 컬럼은 `decided_at`이었다. 시험·린트·빌드가 전부
// 통과했고, 배포하고 나서 500이 떴다. 부서만 여는 화면이라 하마터면 아무도
// 안 보는 자리에서 조용히 죽어 있을 뻔했다.
function bareColumns(sql) {
  // 표가 둘 이상이면 어느 표의 컬럼인지 알 수 없다. 그건 안 본다.
  const froms = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1])
  if (new Set(froms).size !== 1) return null

  const head = sql.match(/\bSELECT\s+([\s\S]*?)\s+FROM\b/i)
  if (!head) return null

  // 함수 호출이나 별칭이 섞인 항목은 통째로 버린다. 괄호 안까지 파싱할
  // 값어치가 없다 — 오타를 잡는 것이 목적이지 SQL 파서를 만드는 것이 아니다.
  const cols = []
  for (const piece of head[1].split(',')) {
    const t = piece.trim()
    if (!t || t.includes('(') || t.includes('.') || t.includes('*')) continue
    const name = t.split(/\s+/)[0].toLowerCase()
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) continue
    if (NOT_A_COLUMN.has(name)) continue
    cols.push({ table: froms[0], col: name })
  }
  return cols
}

describe('SQL이 없는 컬럼을 쓰고 있지 않은지', () => {
  const tables = readSchema()

  it('별칭 없는 컬럼도 실제 컬럼인지 본다', () => {
    // 표가 하나뿐인 SQL은 위 검사가 통째로 못 본다. 여기서 본다.
    const problems = []

    for (const file of jsFiles(join(ROOT, 'functions'))) {
      const src = readFileSync(file, 'utf8')
      const rel = file.slice(ROOT.length).replace(/\\/g, '/')

      // 한 줄짜리 SQL은 홑따옴표로 쓴다. 백틱만 보면 그것들을 다 놓친다.
      const literals = [...(src.match(/`[^`]*`/g) ?? []), ...(src.match(/'[^'\n]*'/g) ?? [])]
      for (const raw of literals) {
        if (!/\bSELECT\b/i.test(raw)) continue
        const sql = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, ' ')
        const cols = bareColumns(sql)
        if (!cols) continue
        for (const { table, col } of cols) {
          if (!tables.has(table)) continue
          if (tables.get(table).has(col)) continue
          problems.push(`${rel} — ${table} 표에 ${col} 컬럼이 없습니다`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('그 검사가 헛돌지 않는다', () => {
    // 정규식이 어긋나면 아무것도 안 보면서 통과한다. 실제로 당했던 그 SQL을
    // 그대로 넣어 잡히는지 본다.
    const bad = bareColumns('SELECT verdict, created_at FROM review WHERE application_id = ?')
    expect(bad).toContainEqual({ table: 'review', col: 'created_at' })
    expect(bad).toContainEqual({ table: 'review', col: 'verdict' })
    expect(tables.get('review').has('created_at')).toBe(false)
    expect(tables.get('review').has('decided_at')).toBe(true)

    // 표가 둘이면 안 본다 — 어느 표의 컬럼인지 알 수 없다.
    expect(
      bareColumns('SELECT id FROM application a JOIN review r ON r.application_id = a.id')
    ).toBeNull()
    // 함수가 낀 항목은 건너뛴다.
    expect(bareColumns('SELECT COUNT(*) AS n FROM review')).toEqual([])
  })

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

// 반려 사유 코드가 DB CHECK 목록과 갈라져 있었다.
//
// shared/review.js에는 no_input이 있는데 migrations의 CHECK에는 그 자리에
// unstructured_only가 있었다. 그 사유로 반려하면 판정 저장이 통째로 500이
// 났고, 같은 배치에 묶인 점수·근거·대안이 전부 롤백됐다. 담당자는 적어 둔
// 것을 다 잃고 신청서는 '접수' 그대로 남았다.
//
// 위의 스키마 검사기는 CHECK로 시작하는 줄을 건너뛰기 때문에 이걸 못 잡았다.
describe('CHECK 목록과 코드 목록', () => {
  it('반려 사유가 DB가 받는 값과 같다', () => {
    const sql = readFileSync(join(ROOT, 'migrations', '0003_review.sql'), 'utf8')
    const m = sql.match(/refuse_code TEXT CHECK \(refuse_code IN \(([\s\S]*?)\)\)/)
    expect(m).toBeTruthy()
    const allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    expect([...REFUSE_CODES].sort()).toEqual(allowed)
  })
})
