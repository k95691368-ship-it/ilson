// 사용법서에서 "여기 모르겠습니다"를 부서가 짚는다.
//
// 사용법서의 목적은 만든 사람이 없어도 부서가 계속 쓸 수 있게 하는 것이다.
// 그런데 지금은 쓴 사람만 읽어 보고 넘긴다. 쓴 사람은 다 안다. **모르는
// 데가 어디인지는 실제로 읽는 사람만 안다.**
//
// 그래서 모르는 채로 담당자에게 전화한다. 담당자는 그때그때 말로 답해 주고,
// 문서는 그대로 남는다. 다음 사람이 오면 같은 전화가 또 온다. 사용법서를
// 쓴 뜻이 거기서 사라진다.
//
// 여기서는 짚은 자리가 문서로 돌아가게 한다. 짚기 → 담당자가 그 대목을
// 다시 씀 → 짚은 자리에 "다시 썼습니다"가 붙음.

export const UNCLEAR_KIND = '사용법모름'
export const UNCLEAR_FIXED_KIND = '사용법고침'

// 짚을 수 있는 자리.
//
// 자유롭게 아무 데나 짚게 하지 않는다. 어디를 말하는지 서로 다르게 알면
// 담당자는 어느 대목을 고쳐야 할지 모른다. where는 그 대목이 실제로
// 보이는 화면이다 — 목록에서 담당자가 바로 열어 볼 수 있게.
export const MANUAL_SECTIONS = [
  {
    key: 'intro',
    label: '이 도구가 무엇인지',
    where: 'tool',
    hint: '무엇을 해주는 도구인지가 안 와닿으시면 여기를 짚어 주세요.',
  },
  {
    key: 'when_to_run',
    label: '언제 돌리는지',
    where: 'tool',
    hint: '언제 돌려야 할지, 무엇이 다 와야 돌릴 수 있는지가 헷갈리시면요.',
  },
  {
    key: 'upload',
    label: '어떤 파일을 올리는지',
    where: 'tool',
    hint: '어느 파일을 어디서 받아 올려야 하는지 모르시겠으면요.',
  },
  {
    key: 'quarantine',
    label: '검토함에 뜬 줄을 어떻게 하는지',
    where: 'tool',
    hint: '밀려난 줄이 떴는데 무엇을 해야 할지 모르시겠으면요.',
  },
  {
    key: 'what_to_do_after',
    label: '결과를 받은 뒤에 무엇을 하는지',
    where: 'tool',
    hint: '나온 파일을 누구에게 어떻게 넘기는지가 안 적혀 있으면요.',
  },
  {
    key: 'contact',
    label: '막혔을 때 누구에게 연락하는지',
    where: 'tool',
    hint: '연락처가 없거나, 그 사람이 지금 없으면요.',
  },
]

export const SECTION_KEYS = MANUAL_SECTIONS.map((s) => s.key)
export const SECTION_BY_KEY = Object.fromEntries(MANUAL_SECTIONS.map((s) => [s.key, s]))

// 이만큼 짚히면 그건 읽는 사람 문제가 아니다.
//
// 한 사람이 모르는 것은 그 사람이 처음이라 그럴 수 있다. 두 사람이 같은
// 자리에서 막히면 문서가 잘못 쓰인 것이다. 그 선을 여기 둔다.
export const MANY = 2

// 무엇을 모르겠는지 이만큼은 적어야 한다.
//
// "모르겠어요"만 오면 담당자는 무엇을 고쳐야 할지 알 수 없고, 결국
// 전화를 걸게 된다. 그러면 짚기가 전화를 한 번 더 만든 셈이 된다.
export const MIN_BODY = 5

export function validateUnclear({ section, body } = {}) {
  const errors = {}
  if (!SECTION_KEYS.includes(String(section ?? ''))) {
    errors.section = '어느 대목인지 골라주세요.'
  }
  if (String(body ?? '').trim().length < MIN_BODY) {
    errors.body = '무엇이 모르겠는지 한 줄만 적어주세요. 이것만 있으면 그 대목을 다시 씁니다.'
  }
  return errors
}

// 이름은 받지 않는다.
//
// 서명과 다르다. 서명은 누가 했는지가 핵심이라 이름을 받는다. 모르겠다고
// 말하는 일에 이름을 붙이라고 하면, 모르는 것을 밝히는 것 자체가 부담이
// 되어 아무도 안 짚는다. 그러면 문서는 영원히 안 고쳐진다.
export const ASKS_NAME = false

export function validateFix({ body, by } = {}) {
  const errors = {}
  if (String(body ?? '').trim().length < MIN_BODY) {
    errors.body = '어떻게 고치셨는지 적어주세요. 이 문장이 그 자리에 그대로 붙습니다.'
  }
  if (String(by ?? '').trim().length < 2) {
    errors.by = '누가 고치셨는지 적어주세요.'
  }
  return errors
}

// 지금 어느 자리가 안 읽히는가.
//
// 짚힌 것과 고친 것을 맞춰 자리별로 묶는다. 고친 뒤에 또 짚히면 그건
// 아직 안 고쳐진 것이므로 다시 올라온다.
export function unclearBoard({ flags, fixes } = {}) {
  const fixed = new Map((fixes ?? []).map((f) => [f.flag_id, f]))
  const rows = (flags ?? []).map((f) => ({ ...f, fix: fixed.get(f.id) ?? null }))

  const sections = MANUAL_SECTIONS.map((s) => {
    const mine = rows.filter((r) => r.section === s.key)
    const open = mine.filter((r) => !r.fix)
    return {
      ...s,
      total: mine.length,
      open: open.length,
      flags: mine,
      // 두 사람이 같은 자리에서 막히면 문서가 잘못 쓰인 것이다.
      mustFix: open.length >= MANY,
    }
  }).filter((s) => s.total > 0)

  // 여러 번 짚힌 자리가 먼저다. 한 번 짚힌 것 열 개보다 세 번 짚힌 것
  // 하나를 먼저 고치는 편이 전화를 더 많이 줄인다.
  sections.sort((a, b) => b.open - a.open || b.total - a.total || a.key.localeCompare(b.key))

  const openTotal = sections.reduce((n, s) => n + s.open, 0)
  return {
    sections,
    summary: {
      openTotal,
      fixedTotal: rows.filter((r) => r.fix).length,
      mustFix: sections.filter((s) => s.mustFix).length,
    },
  }
}

// 담당자 화면 맨 위에 뭐라고 쓸 것인가.
export function boardLine(summary) {
  const s = summary ?? {}
  if (!s.openTotal) {
    return s.fixedTotal > 0
      ? `짚힌 곳을 모두 다시 썼습니다. (지금까지 ${s.fixedTotal}곳)`
      : '아직 모르겠다고 짚힌 곳이 없습니다.'
  }
  const parts = [`부서가 ${s.openTotal}곳을 모르겠다고 짚었습니다.`]
  if (s.mustFix > 0) {
    parts.push(`그중 ${s.mustFix}곳은 두 사람 이상이 같은 자리에서 막혔습니다 — 문서가 잘못 쓰인 것입니다.`)
  }
  return parts.join(' ')
}

// 부서가 보는 자리에 뭐라고 붙일 것인가.
//
// 짚고 나서 아무 표시가 없으면 "말해 봐야 소용없다"가 된다. 그 뒤로는
// 아무도 안 짚고, 문서는 영원히 그대로다.
export function sectionNote(section) {
  if (!section) return null
  if (section.open > 0) {
    return {
      tone: 'open',
      text: `${section.open}분이 이 대목을 모르겠다고 짚어 주셨습니다. 담당자가 다시 쓰는 중입니다.`,
    }
  }
  const last = [...(section.flags ?? [])].reverse().find((f) => f.fix)
  if (last) {
    return {
      tone: 'fixed',
      text: `이 대목은 한 번 다시 썼습니다 — ${last.fix.body} 그래도 모르시겠으면 또 짚어 주세요.`,
    }
  }
  return null
}
