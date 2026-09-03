import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAIN, TECH, techFacts } from '../shared/about.js'
import { STAGE_ORDER } from '../shared/dossier.js'
import { inlineParts, plainText } from '../src/lib/inline.js'

// "기술 구현 보러가기"에 적은 것이 사실인지 지킨다.
//
// 소개문은 코드보다 먼저 낡는다. 기능을 빼거나 바꿔도 글은 그대로 남고,
// 읽는 사람은 그 글을 믿고 코드를 열었다가 없는 것을 찾는다. 그러면 그
// 사람은 나머지 글도 안 믿는다.
//
// 이 저장소에서 실제로 그랬다. README 가 `_lib/claude.js` 와 `tool_choice`
// 강제를 설명하고 있었는데 그런 파일이 없었다. AI 를 쓰지 않기로 하고
// 지운 뒤에도 글만 남아 있었던 것이다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

describe('두 칸이 서로 다른 질문에 답하는가', () => {
  it('쉬운 쪽에는 기술 용어가 없다', () => {
    // 코딩을 모르는 사람이 그 자리에서 닫게 만드는 말들.
    const text = [
      PLAIN.headline,
      PLAIN.intro,
      ...PLAIN.stages.map((s) => s.body),
      ...PLAIN.points.map((p) => p.body),
    ].join(' ')
    for (const jargon of ['API', 'SQL', 'React', 'Cloudflare', 'D1', 'LLM', '라우트', '스키마']) {
      expect(text).not.toContain(jargon)
    }
  })

  it('여섯 단계를 전부 설명한다', () => {
    expect(PLAIN.stages).toHaveLength(6)
    // 실제 단계 이름과 같아야 한다. 글에만 있는 단계는 없다.
    expect(PLAIN.stages.map((s) => s.title)).toEqual(STAGE_ORDER)
  })

  it('단계마다 무엇을 하는지 한 문장 이상 적는다', () => {
    for (const s of PLAIN.stages) expect(s.body.length).toBeGreaterThan(30)
  })

  it('어려운 쪽은 용어를 줄이지 않는다', () => {
    // 얕게 쓰면 읽는 사람이 시간을 버린다.
    const text = [
      TECH.headline,
      ...TECH.stack.map((s) => s.v),
      ...TECH.sections.map((s) => `${s.title} ${s.body}`),
    ].join(' ')
    for (const term of ['isomorphic', 'append-only', 'D1', 'Workers']) {
      expect(text).toContain(term)
    }
  })
})

describe('화면에 표시가 새어 나오지 않는가', () => {
  // 본문은 `**강조**` 와 `` `코드` `` 를 달고 쓰여 있다. 화면이 그냥 문자열로
  // 넣으면 별표와 백틱이 그대로 보인다. 이건 눈에 바로 띌 것 같지만,
  // 탭을 눌러야 나오는 자리라 안 열어 보면 모른다.
  const bodies = [
    PLAIN.headline,
    PLAIN.intro,
    ...PLAIN.stages.map((s) => s.body),
    ...PLAIN.points.map((p) => p.body),
    TECH.headline,
    ...TECH.sections.map((s) => s.body),
    TECH.llm.inProduct.body,
    TECH.llm.inProduct.why,
    TECH.llm.inBuilding.body,
    ...TECH.llm.inBuilding.how,
    TECH.llm.inBuilding.note,
  ]

  it('표시는 전부 짝이 맞는다', () => {
    for (const b of bodies) {
      // 짝이 안 맞으면 렌더러가 원문을 그대로 두므로 화면에 표시가 남는다.
      expect(plainText(b), b.slice(0, 40)).not.toContain('**')
      expect(plainText(b), b.slice(0, 40)).not.toContain('`')
    }
  })

  it('쪼갠 뒤에도 글자가 하나도 안 없어진다', () => {
    for (const b of bodies) {
      const stripped = b.split('**').join('').split('`').join('')
      expect(plainText(b)).toBe(stripped)
    }
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 표시가 실제로 쓰이고 있어야 위 두 검사가 뭔가를 지킨다.
    const marked = bodies.filter((b) => b.includes('**') || b.includes('`'))
    expect(marked.length).toBeGreaterThan(5)
    // 짝이 안 맞는 글은 손대지 않고 그대로 둔다 — 조용히 지우면 글쓴이가
    // 표시를 빠뜨린 것을 아무도 모른다.
    expect(plainText('여는 것만 **있다')).toBe('여는 것만 **있다')
    expect(inlineParts('앞 **가운데** 뒤')).toEqual(['앞 ', { kind: 'b', text: '가운데' }, ' 뒤'])
    expect(inlineParts('`decision_log`를')).toEqual([
      { kind: 'code', text: 'decision_log' },
      '를',
    ])
  })
})

describe('적어 둔 것이 실제로 그런가', () => {
  const src = walk(join(ROOT, 'src'))
    .concat(walk(join(ROOT, 'functions')), walk(join(ROOT, 'shared')))
    .filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')

  it('"Claude Opus 5 분석 초안만 쓴다"가 사실이다', () => {
    // 모델과 책임 경계를 글에만 적고 구현이 다르면 안 된다.
    expect(TECH.llm.inProduct.title).toContain('분석 초안')
    expect(TECH.llm.inProduct.body).toContain('claude-opus-5')
    expect(src).toContain("const MODEL = 'claude-opus-5'")
    expect(src).toContain('api.anthropic.com')
    expect(src).toContain('CLAUDE_API_KEY')
    expect(src).not.toContain('claude-sonnet')
  })

  it('"파일이 서버로 가지 않는다"가 사실이다', () => {
    // 첨부 기능을 지웠으므로 R2 쓰기 경로가 남아 있으면 안 된다.
    const pipeline = TECH.sections.find((s) => s.title.includes('파이프라인'))
    expect(pipeline.body).toContain('파일이 서버로 가지 않으므로')
    expect(src).not.toContain('SOURCES.put')
  })

  it('"인증이 없다"가 사실이다', () => {
    const auth = TECH.sections.find((s) => s.title.includes('인증 없음'))
    expect(auth).toBeTruthy()
    expect(src).not.toContain('bcrypt')
    expect(src).not.toContain('jsonwebtoken')
  })

  it('"link_kind 32종"이 실제 개수와 맞는다', () => {
    // 이런 숫자는 기능을 더할 때마다 조용히 틀려진다. 글에 적힌 수와
    // 소스에 있는 수를 매번 맞춰 본다.
    const kinds = new Set()
    for (const m of src.matchAll(/link_kind\s*[=:]\s*'([^']+)'/g)) kinds.add(m[1])
    for (const m of src.matchAll(/_KIND\s*=\s*'([^']+)'/g)) kinds.add(m[1])
    expect(kinds.size).toBeGreaterThan(20) // 이 검사가 헛돌지 않는다
    const log = TECH.sections.find((s) => s.title.includes('decision_log'))
    expect(Number(log.body.match(/(\d+)종/)?.[1])).toBe(kinds.size)
  })

  it('"테스트 4층"의 세 번째 층이 실제로 있다', () => {
    // 층 수만 늘려 적고 그 층을 안 만들면 이 문서가 거짓이 된다.
    const layers = TECH.sections.find((s) => s.title.includes('테스트'))
    expect(layers.title).toContain('4층')
    expect(layers.body).toContain('happy-dom')
    expect(existsSync(join(ROOT, 'tests', 'pageRender.test.jsx'))).toBe(true)
  })

  it('"users·sessions 표를 지웠다"가 사실이다', () => {
    // 안 쓴다고만 적고 표는 남겨 두면 언젠가 누가 그 표를 쓴다.
    const auth = TECH.sections.find((s) => s.title.includes('인증 없음'))
    expect(auth.body).toContain('DROP')
    const sql = readdirSync(join(ROOT, 'migrations'))
      .map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8'))
      .join('\n')
    expect(sql).toMatch(/DROP TABLE IF EXISTS users/i)
    expect(sql).toMatch(/DROP TABLE IF EXISTS sessions/i)
  })

  it('"개수 없이는 접지 않는다"가 사실이다', () => {
    // 부품이 그 조건 없이 접으면, 이 문단은 하지 않는 일을 적은 것이 된다.
    const fold = TECH.sections.find((s) => s.title.includes('화면 길이'))
    expect(fold.body).toContain('접지 않고')
    const code = readFileSync(join(ROOT, 'src', 'components', 'Fold.jsx'), 'utf8')
    expect(code).toContain('NEVER_FOLD')
    expect(code).toMatch(/count == null/)
  })

  it('"한 곳에서만 센다"가 사실이다', () => {
    // 합쳐 놓고 옛 계산이 남아 있으면 두 화면이 또 갈라진다.
    const one = TECH.sections.find((s) => s.title.includes('한 숫자는'))
    for (const fn of ['liveChallenges', 'fullySignedIds', 'daysSince', 'tally']) {
      expect(one.body, fn).toContain(fn)
      expect(src, fn).toContain(fn)
    }
  })

  it('스택에 적은 것이 실제로 쓰인다', () => {
    for (const s of TECH.stack) expect(s.v.length).toBeGreaterThan(5)
    const stack = TECH.stack.map((s) => s.v).join(' ')
    expect(stack).toContain('React 19')
    expect(stack).toContain('Vitest')
    expect(src).toContain('react-router-dom')
  })
})

describe('LLM 이야기', () => {
  it('제품 안과 만드는 과정을 갈라서 말한다', () => {
    // 뭉뚱그리면 "AI가 만들어 줬다"로도, "AI 안 썼다"로도 읽힌다.
    expect(TECH.llm.inProduct.title).toContain('제품 안에서는')
    expect(TECH.llm.inBuilding.title).toContain('만드는 과정에서는')
  })

  it('왜 초안으로만 쓰는지를 적는다', () => {
    // 모델을 쓴다는 말만으로는 누가 최종 책임을 지는지 알 수 없다.
    expect(TECH.llm.inProduct.why).toContain('책임')
    expect(TECH.llm.inProduct.body).toContain('3곳')
    expect(TECH.llm.inProduct.body).toContain('사람이 결정')
  })

  it('어떻게 썼는지를 구체적으로 적는다', () => {
    // "AI와 페어로 했습니다"는 아무 말도 아니다.
    expect(TECH.llm.inBuilding.how.length).toBeGreaterThanOrEqual(4)
    for (const h of TECH.llm.inBuilding.how) expect(h.length).toBeGreaterThan(40)
    expect(TECH.llm.inBuilding.how.join(' ')).toContain('라이브에서 실제로 눌러 본다')
  })

  it('저작 기록을 지우지 않는다고 밝힌다', () => {
    expect(TECH.llm.inBuilding.note).toContain('Co-Authored-By')
  })
})

describe('숫자는 지어내지 않는다', () => {
  it('값이 없으면 그 줄을 빼 버린다', () => {
    // 화면에 손으로 적어 두면 그날부터 낡는다.
    expect(techFacts({})).toEqual([])
    expect(techFacts()).toEqual([])
    expect(techFacts({ tests: null, tables: null })).toEqual([])
  })

  it('값이 있으면 그것만 보여준다', () => {
    const f = techFacts({ tables: 33 })
    expect(f).toHaveLength(1)
    expect(f[0].v).toContain('33')
  })
})
