import { describe, it, expect } from 'vitest'
import {
  saveDraft,
  loadDraft,
  clearDraft,
  isWorthSaving,
  isExpired,
  draftAge,
  describeDraft,
  DRAFT_KEY,
  draftKey,
  DRAFT_MAX_DAYS,
} from '../src/lib/draft.js'

// 적다 만 신청서를 잃으면 그 사람은 다시 안 적는다. 그러면 그 병목은
// 영영 접수되지 않는다. 되살리기가 틀리면 그것대로 나쁘다 — 엉뚱한 것이
// 채워지면 지금 적던 것까지 잃는다.

// 브라우저 저장소 흉내. 진짜 localStorage 없이 시험한다.
function fakeStorage(initial = {}) {
  const box = { ...initial }
  return {
    getItem: (k) => box[k] ?? null,
    setItem: (k, v) => {
      box[k] = String(v)
    },
    removeItem: (k) => {
      delete box[k]
    },
    _box: box,
  }
}

// 저장을 아예 막아 둔 브라우저(시크릿 창, 용량 초과).
function brokenStorage() {
  return {
    getItem: () => {
      throw new Error('막혔습니다')
    },
    setItem: () => {
      throw new Error('막혔습니다')
    },
    removeItem: () => {
      throw new Error('막혔습니다')
    },
  }
}

const FULL = {
  dept: '재무',
  title: '매주 채널 정산서를 손으로 붙입니다',
  bottleneck: '다섯 채널 정산서를 하나로 합칩니다.',
  problem: '',
  wish: '',
  current_people: '1',
}

const NOW = new Date('2026-08-01T12:00:00Z').getTime()
const ago = (ms) => new Date(NOW - ms).toISOString()
const DAY = 24 * 60 * 60 * 1000
const SCOPE = 'a'.repeat(64)
const OTHER_SCOPE = 'b'.repeat(64)
const KEY = draftKey(SCOPE)

describe('저장할 값이 있는지', () => {
  it('사람이 글을 쓴 흔적이 있으면 저장한다', () => {
    expect(isWorthSaving(FULL)).toBe(true)
  })

  it('부서만 골라 둔 것은 저장하지 않는다', () => {
    // "적으시던 것이 있습니다"를 이런 걸로 띄우면 성가시기만 하다.
    expect(isWorthSaving({ dept: '재무', current_people: '1' })).toBe(false)
  })

  it('몇 글자 안 친 것도 저장하지 않는다', () => {
    expect(isWorthSaving({ title: '정산' })).toBe(false)
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(isWorthSaving(null)).toBe(false)
    expect(isWorthSaving({})).toBe(false)
  })
})

describe('오래된 것은 되살리지 않는다', () => {
  it('방금 것은 살아 있다', () => {
    expect(isExpired(ago(60 * 1000), NOW)).toBe(false)
  })

  it('이레가 지나면 버린다', () => {
    // 두 주 전에 적다 만 것을 지금 꺼내 주면 도움이 아니라 방해다.
    expect(isExpired(ago(DRAFT_MAX_DAYS * DAY + 1000), NOW)).toBe(true)
  })

  it('미래에 저장된 것으로 적혀 있으면 믿지 않는다', () => {
    // 시계가 틀어졌거나 누가 손댄 것이다.
    expect(isExpired(new Date(NOW + DAY).toISOString(), NOW)).toBe(true)
  })

  it('날짜가 없거나 이상하면 버린다', () => {
    expect(isExpired(null, NOW)).toBe(true)
    expect(isExpired('아무 말', NOW)).toBe(true)
  })
})

describe('저장하고 되살리기', () => {
  it('저장한 것을 그대로 되살린다', () => {
    const s = fakeStorage()
    expect(saveDraft(s, SCOPE, FULL, NOW)).toBe(true)
    const back = loadDraft(s, SCOPE, NOW)
    expect(back.form).toEqual(FULL)
    expect(back.savedAt).toBe(new Date(NOW).toISOString())
  })

  it('저장한 것이 없으면 아무것도 안 준다', () => {
    expect(loadDraft(fakeStorage(), SCOPE, NOW)).toBeNull()
  })

  it('오래된 것은 안 주고 치운다', () => {
    const s = fakeStorage()
    saveDraft(s, SCOPE, FULL, NOW - DRAFT_MAX_DAYS * DAY - 1000)
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
    // 꺼내지도 않을 것을 남겨 두지 않는다.
    expect(s.getItem(KEY)).toBeNull()
  })

  it('사람이 다 지웠으면 전에 저장해 둔 것도 지운다', () => {
    // 이걸 안 하면, 다 지우고 나갔다가 돌아왔을 때 옛것이 되살아난다.
    const s = fakeStorage()
    saveDraft(s, SCOPE, FULL, NOW)
    saveDraft(s, SCOPE, { dept: '재무' }, NOW)
    expect(s.getItem(KEY)).toBeNull()
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
  })

  it('깨진 값이 남아 있으면 치우고 넘어간다', () => {
    // 그대로 두면 열 때마다 실패한다.
    const s = fakeStorage({ [KEY]: '{이건 JSON이 아닙니다' })
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
    expect(s.getItem(KEY)).toBeNull()
  })

  it('모양이 맞지 않는 값도 치운다', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ scope: SCOPE, savedAt: ago(1000) }) })
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
  })

  it('지우면 없어진다', () => {
    const s = fakeStorage()
    saveDraft(s, SCOPE, FULL, NOW)
    clearDraft(s, SCOPE)
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
  })
})

describe('저장이 막힌 브라우저', () => {
  it('저장하지 못해도 터지지 않는다', () => {
    // 시크릿 창에서도 신청 자체는 계속돼야 한다. 이건 거들어 주는 기능이다.
    expect(() => saveDraft(brokenStorage(), SCOPE, FULL, NOW)).not.toThrow()
    expect(saveDraft(brokenStorage(), SCOPE, FULL, NOW)).toBe(false)
  })

  it('읽지 못해도 터지지 않는다', () => {
    expect(loadDraft(brokenStorage(), SCOPE, NOW)).toBeNull()
  })

  it('지우지 못해도 터지지 않는다', () => {
    expect(() => clearDraft(brokenStorage(), SCOPE)).not.toThrow()
  })

  it('저장소가 아예 없어도 터지지 않는다', () => {
    // 서버에서 그려질 때는 localStorage가 없다.
    expect(loadDraft(null, SCOPE, NOW)).toBeNull()
    expect(saveDraft(null, SCOPE, FULL, NOW)).toBe(false)
    expect(() => clearDraft(null, SCOPE)).not.toThrow()
  })
})

describe('계정·체험 공간별 초안만 읽고 저장하고 지운다', () => {
  it('A→B→A 범위를 분리하며 다른 범위의 삭제가 원래 초안에 영향을 주지 않는다', () => {
    const s = fakeStorage()
    saveDraft(s, SCOPE, FULL, NOW)
    expect(loadDraft(s, OTHER_SCOPE, NOW)).toBeNull()
    saveDraft(s, OTHER_SCOPE, { ...FULL, title: '다른 공간의 초안입니다' }, NOW)
    expect(loadDraft(s, SCOPE, NOW).form).toEqual(FULL)
    clearDraft(s, OTHER_SCOPE)
    expect(loadDraft(s, SCOPE, NOW).form).toEqual(FULL)
  })

  it.each([null, undefined, '', 'unverified', 'a'.repeat(63), 'a'.repeat(65), '../account', 123])('확정되지 않은 범위 %s에서는 저장소에 접근하지 않는다', scope => {
    let calls = 0
    const storage = {
      getItem() { calls++; throw Error('잘못된 읽기') },
      setItem() { calls++; throw Error('잘못된 저장') },
      removeItem() { calls++; throw Error('잘못된 삭제') },
    }
    expect(draftKey(scope)).toBeNull()
    expect(loadDraft(storage, scope, NOW)).toBeNull()
    expect(saveDraft(storage, scope, FULL, NOW)).toBe(false)
    expect(() => clearDraft(storage, scope)).not.toThrow()
    expect(calls).toBe(0)
  })

  it.each(['{깨진 구 초안', JSON.stringify({ savedAt: new Date(NOW).toISOString(), form: FULL })])('이전 공용 초안은 읽거나 이관하거나 삭제하지 않는다: %s', legacy => {
    const s = fakeStorage({ [DRAFT_KEY]: legacy })
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
    saveDraft(s, SCOPE, FULL, NOW)
    clearDraft(s, SCOPE)
    saveDraft(s, OTHER_SCOPE, { title: '' }, NOW)
    expect(s.getItem(DRAFT_KEY)).toBe(legacy)
    expect(s.getItem(KEY)).toBeNull()
  })

  it('키와 다른 범위의 저장값을 복구하지 않는다', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ scope: OTHER_SCOPE, savedAt: new Date(NOW).toISOString(), form: FULL }) })
    expect(loadDraft(s, SCOPE, NOW)).toBeNull()
  })
})

describe('언제 적던 것인지', () => {
  it('사람이 읽는 말로 적는다', () => {
    expect(draftAge(ago(30 * 1000), NOW)).toBe('조금 전')
    expect(draftAge(ago(20 * 60 * 1000), NOW)).toBe('20분 전')
    expect(draftAge(ago(3 * 60 * 60 * 1000), NOW)).toBe('3시간 전')
    expect(draftAge(ago(2 * DAY), NOW)).toBe('2일 전')
  })

  it('알 수 없으면 아는 척하지 않는다', () => {
    expect(draftAge('아무 말', NOW)).toBe('언제인지 알 수 없는')
  })
})

describe('무엇이 되살아나는지 미리 보여 주기', () => {
  it('제목이 있으면 제목을 보여 준다', () => {
    // 눌러 놓고 엉뚱한 것이 채워지면 지금 적던 것까지 잃는다.
    expect(describeDraft(FULL)).toContain('매주 채널 정산서')
  })

  it('제목이 길면 자른다', () => {
    const long = { title: '가'.repeat(60), bottleneck: '병목입니다 어쩌고' }
    expect(describeDraft(long)).toContain('…')
    expect(describeDraft(long).length).toBeLessThan(70)
  })

  it('제목이 없으면 몇 칸을 적었는지 말한다', () => {
    expect(describeDraft({ bottleneck: '정산서를 합치는 일입니다' })).toContain('1칸')
  })
})
