import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEPT_KINDS, PROXY_KINDS, sideOf } from '../shared/side.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 이름만 보고 목록에 넣다가 두 번 뒤집혔다.
//
// '코드확인'은 이름이 그래서 부서가 알려 준 것처럼 읽힌다. 그런데 그 기록을
// 쓰는 곳은 담당자용 /codes 화면 하나뿐이고 글쓴이 기본값이 'AX 담당자'다 —
// 담당자가 훑어보고 "맞습니다"를 누른 것이다. 정작 부서가 알려 주는
// '코드알림'은 목록에 아예 없었다. 둘이 정확히 뒤바뀌어 세어졌다.
//
// '같은건아님'도 같은 모양이다. 손든 것은 부서지만 푸는 것은 담당자다.
//
// 그래서 이 화면이 자기 주장의 증거로 내세우는 숫자 — "전체 N건 중 M건은
// 부서가 직접 누른 것입니다" — 가 **부풀려지는 쪽으로** 틀렸다. 담당자가
// 확인을 누를 때마다 하나씩 늘었다. 결정 기록 화면에는 제목이 'AX 담당자'인
// 줄에 초록색 '부서가 한 것' 배지가 붙어 자기모순이 눈에 보였다.
//
// 개수를 못 박아 둔 기존 검사는 이걸 못 잡는다. 하나 빼고 하나 넣으면
// 개수는 그대로다. 그래서 여기서는 이름이 아니라 **어디서 누가 쓰는가**로
// 판정한다.

const files = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (p.endsWith('.js')) files.push(p)
  }
}
walk(join(ROOT, 'functions'))

// ROOT 는 끝에 구분자가 붙어 있다. +1 을 더하면 경로 첫 글자를 먹는다.
const rel = (f) => f.slice(ROOT.length).split('\\').join('/')

// shared/ 에 흩어진 종류 상수를 이름 → 값으로 모은다.
function kindConstants() {
  const map = new Map()
  for (const f of readdirSync(join(ROOT, 'shared'))) {
    if (!f.endsWith('.js')) continue
    const src = readFileSync(join(ROOT, 'shared', f), 'utf8')
    for (const m of src.matchAll(/export const (\w*KIND\w*) = '([^']+)'/g)) {
      map.set(m[1], m[2])
    }
  }
  return map
}

// logDecision(...linkKind: X...) 을 쓰는 자리를 찾아 종류 문자열을 알아낸다.
function writesByKind() {
  const consts = kindConstants()
  const out = new Map()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/linkKind:\s*(?:'([^']+)'|(\w+))/g)) {
      const kind = m[1] ?? consts.get(m[2])
      if (!kind) continue
      if (!out.has(kind)) out.set(kind, new Set())
      out.get(kind).add(rel(f))
    }
    // logDecision 을 안 거치고 decision_log 에 직접 INSERT 하는 자리도 있다.
    // 파일 전체에서 상수를 찾으면 **읽기만 하는 파일까지 '쓴 곳'이 된다** —
    // 실제로 처음에 그렇게 짰다가 열다섯 건이 잘못 걸렸다. INSERT 문 뒤의
    // bind 목록 안에서만 찾는다.
    for (const part of src.split('INSERT INTO decision_log').slice(1)) {
      for (const m of part.slice(0, 900).matchAll(/\b(\w*KIND\w*)\b/g)) {
        const kind = consts.get(m[1])
        if (!kind) continue
        if (!out.has(kind)) out.set(kind, new Set())
        out.get(kind).add(rel(f))
      }
    }
  }
  return out
}

// 부서가 로그인 없이 여는 자리. 접수번호나 도구 주소 하나로 들어온다.
const isDeptRoute = (path) =>
  path.includes('functions/api/track/') || path.includes('functions/api/tools/')

// 주소만으로는 못 가르는 둘. 이유를 적어 두고 예외로 둔다 — 예외를 아예
// 안 두면 규칙을 느슨하게 만들게 되고, 그러면 정작 뒤바뀐 것을 못 잡는다.
const EXCEPTIONS = {
  // 부서가 손드는 폼인데 라우트는 신청서 번호로 열려서 applications/ 아래
  // 있다. 실제로 적는 사람은 손든 부서다 — 제목이 "{부서} — 우리도 같은
  // 일을 겪는다"이고 부서·인원·분을 그 부서가 채운다. 같은 파일의
  // 'AX 담당자' 기본값은 담당자가 **푸는** 쪽(같은건아님) 것이다.
  같은건손듦: '부서가 적는 폼인데 라우트가 신청서 번호로 열린다',
  // 부서가 다시 낸 것은 새 신청서 쪽의 '재신청'으로 이미 한 번 세어진다.
  // 이것은 앞 신청서에 남기는 되짚기 표식이라, 부서 응답으로 또 세면
  // 한 번의 행동이 두 번 세어진다.
  재신청됨: '앞 신청서에 남기는 표식이라 부서 응답으로 또 세면 두 번 세어진다',
}

describe('부서인지 담당자인지를 이름이 아니라 코드에서 유도한다', () => {
  const writes = writesByKind()

  it('종류 상수를 실제로 찾아냈다', () => {
    // 이 검사가 헛돌지 않는지 먼저 본다. 못 찾으면 아래가 전부 공회전이다.
    expect(writes.size).toBeGreaterThan(10)
    expect([...writes.keys()]).toContain('신고')
  })

  it('부서만 여는 라우트가 쓰는 종류는 부서로 세어진다', () => {
    // '코드알림'이 빠져 있던 자리를 이 규칙이 잡는다.
    const missing = []
    for (const [kind, where] of writes) {
      const onlyDept = [...where].every(isDeptRoute)
      if (!onlyDept) continue
      if (DEPT_KINDS.has(kind) || PROXY_KINDS.has(kind)) continue
      if (EXCEPTIONS[kind]) continue
      missing.push(`${kind} ← ${[...where].join(', ')}`)
    }
    expect(missing).toEqual([])
  })

  it('담당자만 쓰는 종류를 부서로 세지 않는다', () => {
    // '코드확인'과 '같은건아님'이 들어가 있던 자리를 이 규칙이 잡는다.
    const wrong = []
    for (const kind of DEPT_KINDS) {
      const where = writes.get(kind)
      if (!where) continue
      if ([...where].some(isDeptRoute)) continue
      if (EXCEPTIONS[kind]) continue
      wrong.push(`${kind} ← ${[...where].join(', ')}`)
    }
    expect(wrong).toEqual([])
  })

  it('부서 종류에 담당자 이름이 기본값으로 박혀 있지 않다', () => {
    // 부서가 눌렀는데 글쓴이가 'AX 담당자'로 굳으면, 그 줄은 화면에서
    // 제목은 담당자인데 배지는 '부서가 한 것'이 된다. 실제로 그랬다.
    const suspicious = []
    for (const kind of DEPT_KINDS) {
      const where = writes.get(kind)
      if (!where) continue
      for (const w of where) {
        if (isDeptRoute(w)) continue
        if (EXCEPTIONS[kind]) continue
        const src = readFileSync(join(ROOT, w), 'utf8')
        if (src.includes("'AX 담당자'")) suspicious.push(`${kind} ← ${w}`)
      }
    }
    expect(suspicious).toEqual([])
  })

  it('예외마다 이유가 적혀 있다', () => {
    // 이유 없는 예외는 다음 사람이 "왜 여기 있지" 하고 지우거나, 반대로
    // 아무거나 더 넣는 문이 된다.
    for (const [kind, why] of Object.entries(EXCEPTIONS)) {
      expect(String(why).length, kind).toBeGreaterThan(15)
    }
  })

  it('분류가 실제 판정 함수와 맞는다', () => {
    expect(sideOf('코드확인')).toBe('ax')
    expect(sideOf('코드알림')).toBe('dept')
    expect(sideOf('같은건손듦')).toBe('dept')
    expect(sideOf('같은건아님')).toBe('ax')
  })
})
