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

// Promise.all 을 구조분해할 때 이름 수와 쿼리 수가 어긋난 것.
//
// 첨부 기능을 걷어내면서 `functions/api/track/[ticket].js` 의 쿼리 하나만
// 지우고 이름(`files`)은 그대로 뒀다. 이름이 14개, 쿼리가 13개. 자바스크립트는
// 아무 말도 하지 않는다 — 모자란 이름에 undefined 를 넣고 나머지를 한 칸씩
// 당긴다. 그래서 review 는 맞고 그 뒤가 전부 딴 표의 값이 됐다.
//
// 결과: 부서가 접수번호를 넣으면 `files.results.length` 에서 500. 접수번호
// 조회는 로그인 없는 이 사이트에서 부서가 자기 신청서를 보는 **유일한**
// 길이다. 그게 통째로 막혀 있었다.
//
// 왜 라우트 스모크가 못 잡았나. 그 검사는 [ticket] 자리에 아무 문자열이나
// 넣는데, 이 라우트는 쿼리 전에 접수번호 모양(AX-000-000)을 본다. 모양이
// 틀리니 400 으로 먼저 돌아가고 문제의 줄까지 가지도 않았다. 실행해 보는
// 검사에도 못 가는 자리가 있다 — 그래서 세어 보는 검사를 따로 둔다.
// 대괄호 안에서 맨 바깥 쉼표로 갈린 항목 수를 센다.
//
// 그냥 쉼표를 세면 세 군데서 틀린다. ① SQL 문자열 안의 쉼표와 괄호
// (`SELECT a, b FROM ...`, `IN (?, ?)`) ② 마지막 항목 뒤의 쉼표
// ③ 쿼리 사이에 끼워 둔 주석 안의 쉼표. 셋 다 실제로 이 저장소 코드에 있다.
function topLevelItems(body) {
  let depth = 0
  const parts = ['']
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    // 주석은 코드가 아니다. 이 저장소는 쿼리 사이에 왜 그렇게 했는지를
    // 길게 적어 두는데, 그 안의 쉼표를 세면 쿼리가 늘어난 것으로 보인다.
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++
      continue
    }
    if (ch === '/' && body[i + 1] === '*') {
      i += 2
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i++
      i++
      continue
    }
    // 문자열·템플릿 안은 통째로 건너뛴다. 그 안의 괄호와 쉼표는 코드가 아니다.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') i++
        i++
      }
      parts[parts.length - 1] += 'S'
      continue
    }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) {
      parts.push('')
      continue
    }
    parts[parts.length - 1] += ch
  }
  // 빈 조각은 항목이 아니다 — 마지막 쉼표 뒤의 공백이 여기 걸린다.
  return parts.filter((p) => p.trim() !== '').length
}

describe('구조분해와 Promise.all', () => {
  const files = jsFiles(join(ROOT, 'functions'))

  it('받는 이름 수와 기다리는 쿼리 수가 같다', () => {
    const problems = []
    for (const file of files) {
      const rel = file.slice(ROOT.length)
      const src = readFileSync(file, 'utf8')
      // `const [a, b, c] = await Promise.all([ ... ])` 만 본다.
      const re = /const \[([^\]]+)\]\s*=\s*\n?\s*await Promise\.all\(\[/g
      let m
      while ((m = re.exec(src))) {
        const names = m[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        // 여는 대괄호부터 짝이 맞는 닫는 대괄호까지 잘라 낸다.
        const start = m.index + m[0].length - 1
        let depth = 0
        let end = start
        for (let i = start; i < src.length; i++) {
          const ch = src[i]
          if (ch === '[') depth++
          else if (ch === ']') {
            depth--
            if (depth === 0) {
              end = i
              break
            }
          }
        }
        const items = topLevelItems(src.slice(start + 1, end))
        if (names.length !== items) {
          problems.push(`${rel} — 이름 ${names.length}개인데 쿼리 ${items}개 (${names.join(', ')})`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 실제로 세고 있는지 확인한다. 하나도 못 찾으면 위 검사는 늘 통과한다.
    const found = files.filter((f) =>
      /const \[[^\]]+\]\s*=\s*\n?\s*await Promise\.all\(\[/.test(readFileSync(f, 'utf8'))
    )
    expect(found.length).toBeGreaterThan(3)

    // 세는 규칙 자체를 확인한다. 이게 틀리면 위 검사는 조용히 헛돈다.
    expect(topLevelItems('a, b, c')).toBe(3)
    expect(topLevelItems('a, b,')).toBe(2) // 마지막 쉼표
    expect(topLevelItems('f(x, y), g(z)')).toBe(2) // 안쪽 괄호
    expect(topLevelItems("q('SELECT a, b FROM t'), r()")).toBe(2) // 문자열 안의 쉼표
    expect(topLevelItems('a(),\n// 왜 이렇게 했나, 그 이유\nb()')).toBe(2) // 주석 안의 쉼표
    expect(topLevelItems('a(),\n/* 이유, 근거 */\nb()')).toBe(2)
    expect(topLevelItems('')).toBe(0)

    // 그리고 실제로 났던 그 모양을 잡는지 본다.
    const broken = `const [a, b, c] =\n      await Promise.all([\n        one(),\n        two(),\n      ])`
    const m = /const \[([^\]]+)\]\s*=\s*\n?\s*await Promise\.all\(\[([\s\S]*)\]\)/.exec(broken)
    expect(m[1].split(',').length).toBe(3)
    expect(topLevelItems(m[2])).toBe(2)
  })
})

// 골라내는 데 쓰는 칸을 안 뽑아서 목록이 늘 비었던 것.
//
// functions/api/applications/[id]/index.js 가 decision_log 에서 link_kind 와
// link_id 를 안 뽑고 있었다. 화면은 그 줄들을 shared/thread.js 의 toThread 로
// 넘기는데, 그 함수는 link_kind 로 주고받은 말만 골라낸다. 칸이 안 오니
// 하나도 안 골라졌다.
//
// 담당자가 되물어도 자기 화면에 아무것도 안 나왔다. 부서가 답해도 못 봤다.
// 첫 화면이 "되물은 것에 답이 온 신청서 N건"이라고 알려 줘도 눌러서 가면
// 그 답이 없었다. 예외도 안 나고 화면도 안 깨진다 — 그냥 늘 빈 목록이다.
//
// 스키마 검사는 **없는 컬럼**을 잡는다. 이건 반대다 — 있는 컬럼을 안 뽑은
// 것이라 SQL 자체는 완벽히 유효하다. 그래서 따로 센다.
describe('걸러 내는 칸을 실제로 뽑는가', () => {
  // 화면이 이 이름으로 받아서 실을 만든다.
  const NEEDS = ['link_kind', 'link_id']

  it('decisions 를 내려보내는 라우트는 종류 칸을 함께 뽑는다', () => {
    const problems = []
    for (const file of jsFiles(join(ROOT, 'functions'))) {
      const src = readFileSync(file, 'utf8')
      const rel = file.slice(ROOT.length).split('\\').join('/')
      // 응답에 decisions 를 실어 보내지 않으면 상관없다.
      if (!/\bdecisions:/.test(src)) continue
      // decision_log 를 SELECT 하는 문장만 본다.
      for (const m of src.matchAll(/SELECT([\s\S]*?)FROM decision_log/g)) {
        const cols = m[1]
        // SELECT * 는 다 가져오므로 통과.
        if (cols.includes('*')) continue
        for (const need of NEEDS) {
          if (!cols.includes(need)) problems.push(`${rel} — decision_log 에서 ${need} 를 안 뽑습니다`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 아무 파일도 안 보면 늘 통과한다.
    const looked = jsFiles(join(ROOT, 'functions')).filter((f) => {
      const src = readFileSync(f, 'utf8')
      return /\bdecisions:/.test(src) && /FROM decision_log/.test(src)
    })
    expect(looked.length).toBeGreaterThan(1)

    // 그리고 실제로 그 이름들이 화면 쪽에서 쓰이고 있어야 한다.
    const thread = readFileSync(join(ROOT, 'shared', 'thread.js'), 'utf8')
    for (const need of NEEDS) expect(thread).toContain(`r.${need}`)
  })
})

// 지우는 목록에 application_id 없는 표를 넣은 것.
//
// 방문 자료를 딸린 기록까지 지우는 라우트가 자식 표 목록을 들고 있다.
// 거기에 beta_result 를 넣었는데, 그 표에는 application_id 가 없다 —
// beta_round 를 거쳐야 신청서에 닿는다. `DELETE FROM beta_result WHERE
// application_id IN (...)` 이 되어 배치 전체가 터지고 503 이 났다.
//
// 라이브에서 눌러 보고서야 알았다. SQL 은 문자열이라 아무도 안 읽어 준다.
describe('자식 표 목록이 실제 스키마와 맞는가', () => {
  const tables = readSchema()

  it('application_id 로 지우는 표는 그 컬럼을 갖고 있다', () => {
    const src = readFileSync(
      join(ROOT, 'functions', 'api', 'demo', 'visitors.js'),
      'utf8'
    )
    const block = src.slice(src.indexOf('const CHILD_TABLES = ['))
    const list = block.slice(0, block.indexOf(']'))
    const names = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

    expect(names.length).toBeGreaterThan(10)
    const problems = []
    for (const t of names) {
      if (!tables.has(t)) {
        problems.push(`${t} — 그런 표가 없습니다`)
      } else if (!tables.get(t).has('application_id')) {
        problems.push(`${t} — application_id 컬럼이 없습니다`)
      }
    }
    expect(problems).toEqual([])
  })

  it('부모를 거쳐 지우는 표는 그 길이 실제로 있다', () => {
    const src = readFileSync(
      join(ROOT, 'functions', 'api', 'demo', 'visitors.js'),
      'utf8'
    )
    const rows = [
      ...src.matchAll(/\{\s*table:\s*'([a-z_]+)',\s*via:\s*'([a-z_]+)',\s*parent:\s*'([a-z_]+)'\s*\}/g),
    ]
    expect(rows.length).toBeGreaterThan(0)
    for (const [, table, via, parent] of rows) {
      expect(tables.has(table), table).toBe(true)
      expect(tables.get(table).has(via), `${table}.${via}`).toBe(true)
      expect(tables.has(parent), parent).toBe(true)
      expect(tables.get(parent).has('application_id'), `${parent}.application_id`).toBe(true)
      // 그리고 그 표는 자식 목록에 있으면 안 된다 — 두 번 지우려 든다.
      expect(tables.get(table).has('application_id'), `${table} 은 손자가 아닙니다`).toBe(false)
    }
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 실제로 났던 그 상태를 확인한다.
    expect(tables.get('beta_result').has('application_id')).toBe(false)
    expect(tables.get('beta_result').has('round_id')).toBe(true)
    expect(tables.get('beta_round').has('application_id')).toBe(true)
  })
})
