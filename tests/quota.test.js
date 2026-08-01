import { describe, it, expect } from 'vitest'
import {
  quotaState,
  nextFreeText,
  whatNow,
  checkFiles,
  LOW_ABSOLUTE,
} from '../shared/quota.js'

// 부서 사람이 월요일 아침에 정산을 돌리다가 "더 못 쓴다"를 만나면 그날
// 할 일이 거기서 멈춘다. 미리 알았으면 순서를 바꿨을 것이다.
//
// 그리고 늘 경고가 떠 있으면 아무도 안 읽는다. 넉넉할 때는 조용해야 한다.

describe('얼마나 남았는지', () => {
  it('넉넉하면 조용히 둔다', () => {
    const s = quotaState({ remaining: 18, limit: 20 })
    expect(s.level).toBe('넉넉함')
    expect(s.loud).toBe(false)
    expect(s.headline).toBeNull()
  })

  it('얼마 안 남으면 눈에 띄게 한다', () => {
    const s = quotaState({ remaining: 4, limit: 20 })
    expect(s.level).toBe('얼마 안 남음')
    expect(s.loud).toBe(true)
    expect(s.headline).toContain('4번')
  })

  it('한도가 작으면 비율만으로 못 잡는다', () => {
    // 5회 중 2회 남은 것은 40%라 비율로는 안 걸리지만, 두 번이면 곧 끝난다.
    const s = quotaState({ remaining: 2, limit: 5 })
    expect(s.loud).toBe(true)
  })

  it('세 번 이하는 비율이 넉넉해도 눈에 띈다', () => {
    // 한도가 100이어도 세 번 남았으면 곧 끝난다.
    expect(quotaState({ remaining: LOW_ABSOLUTE, limit: 100 }).loud).toBe(true)
  })

  it('비율도 절대 수도 넉넉하면 조용하다', () => {
    // 10회 중 4회는 40%라 비율로 안 걸리고, 네 번이라 절대 수로도 안 걸린다.
    expect(quotaState({ remaining: 4, limit: 10 }).loud).toBe(false)
  })

  it('다 썼으면 그렇게 말한다', () => {
    const s = quotaState({ remaining: 0, limit: 20 })
    expect(s.level).toBe('다 씀')
    // '오늘'이라고 하지 않는다. 자정에 초기화되는 것이 아니라 최근
    // 24시간 기준이라, '오늘'이라고 하면 자정까지 헛기다리게 된다.
    expect(s.headline).toContain('더 돌리실 수 없습니다')
    expect(s.headline).not.toContain('오늘')
  })

  it('이상한 값에도 터지지 않는다', () => {
    expect(quotaState({ remaining: -5, limit: 20 }).remaining).toBe(0)
    expect(quotaState({ remaining: 3, limit: 0 }).limit).toBe(1)
  })

  it('값이 비어 있어도 NaN을 화면에 내보내지 않는다', () => {
    // Number(undefined)는 null이 아니라 NaN이라 ?? 로는 안 걸러진다.
    // 안 걸러 두면 "NaN번 남았습니다"가 그대로 뜬다.
    for (const bad of [{}, { remaining: undefined, limit: undefined }, { remaining: '아무 말' }]) {
      const s = quotaState(bad)
      expect(Number.isFinite(s.remaining)).toBe(true)
      expect(Number.isFinite(s.limit)).toBe(true)
      expect(String(s.headline ?? '')).not.toContain('NaN')
    }
  })
})

describe('언제 한 번 더 쓸 수 있는지', () => {
  const NOW = new Date('2026-08-01T12:00:00Z').getTime()
  const at = (ms) => new Date(NOW + ms).toISOString()

  it('분 단위로 알려 준다', () => {
    // "기다리세요"만 하면 얼마나 기다릴지 몰라서 결국 담당자에게 전화한다.
    expect(nextFreeText(at(20 * 60000), NOW)).toBe('20분 뒤에 한 번 더 쓰실 수 있습니다')
  })

  it('한 시간이 넘으면 시간과 분으로', () => {
    expect(nextFreeText(at(95 * 60000), NOW)).toBe('1시간 35분 뒤에 한 번 더 쓰실 수 있습니다')
  })

  it('딱 떨어지면 분을 안 붙인다', () => {
    expect(nextFreeText(at(120 * 60000), NOW)).toBe('2시간 뒤에 한 번 더 쓰실 수 있습니다')
  })

  it('이미 지났으면 지금 쓸 수 있다고 한다', () => {
    expect(nextFreeText(at(-60000), NOW)).toContain('지금')
  })

  it('D1이 주는 모양도 읽는다', () => {
    // 'YYYY-MM-DD HH:MM:SS' 로 온다. 그대로 new Date에 넣으면 브라우저가
    // 지역 시간대로 오해한다.
    expect(nextFreeText('2026-08-01 12:30:00', NOW)).toBe('30분 뒤에 한 번 더 쓰실 수 있습니다')
  })

  it('모르면 아는 척하지 않는다', () => {
    expect(nextFreeText(null, NOW)).toBeNull()
    expect(nextFreeText('아무 말', NOW)).toBeNull()
  })
})

describe('다 썼을 때 무엇을 해야 하나', () => {
  it('언제 풀리는지와 누구에게 말할지를 같이 준다', () => {
    const s = quotaState({ remaining: 0, limit: 5 })
    const t = whatNow(s, '3시간 뒤에 한 번 더 쓰실 수 있습니다')
    expect(t).toContain('3시간 뒤')
    expect(t).toContain('담당자')
  })

  it('아직 남았으면 아무 말도 안 한다', () => {
    expect(whatNow(quotaState({ remaining: 3, limit: 5 }), '어쩌고')).toBeNull()
  })

  it('언제 풀릴지 몰라도 담당자 얘기는 해 준다', () => {
    expect(whatNow(quotaState({ remaining: 0, limit: 5 }), null)).toContain('담당자')
  })
})

describe('파일을 고르기 전에 걸러 준다', () => {
  const MB = 1024 * 1024
  const opts = { maxFileMb: 10, maxFiles: 5 }

  it('괜찮은 파일은 통과시킨다', () => {
    expect(checkFiles([{ name: 'a.csv', size: 2 * MB }], opts)).toEqual([])
  })

  it('너무 큰 파일을 짚어 준다', () => {
    // 올리고 나서 "너무 큽니다"를 듣는 것과 고르기 전에 아는 것은 다르다.
    const p = checkFiles([{ name: '자사몰.xlsx', size: 12.5 * MB }], opts)
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('자사몰.xlsx')
    expect(p[0]).toContain('12.5MB')
  })

  it('개수가 넘으면 말한다', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `${i}.csv`, size: 1 * MB }))
    expect(checkFiles(many, opts)[0]).toContain('5개까지')
  })

  it('여러 파일이 크면 전부 짚어 준다', () => {
    const p = checkFiles(
      [
        { name: 'a.csv', size: 11 * MB },
        { name: 'b.csv', size: 1 * MB },
        { name: 'c.csv', size: 20 * MB },
      ],
      opts
    )
    expect(p).toHaveLength(2)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(checkFiles([], opts)).toEqual([])
    expect(checkFiles(undefined, opts)).toEqual([])
  })
})
