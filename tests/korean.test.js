import { describe, it, expect } from 'vitest'
import { hasFinalConsonant, withJosa, listWithJosa } from '../shared/korean.js'

// 라이브에서 "영업가 붙였던 것"이 찍혔다.
//
// 이 사이트는 부서 사람이 읽는 화면이다. 틀린 조사 하나가 "이거 대충
// 만들었구나"로 읽히고, 그러면 그 옆의 숫자도 같이 못 믿게 된다.

describe('받침이 있는가', () => {
  it('받침 있는 글자를 알아본다', () => {
    expect(hasFinalConsonant('영업')).toBe(true)
    expect(hasFinalConsonant('운영')).toBe(true)
    expect(hasFinalConsonant('김대리')).toBe(false)
  })

  it('받침 없는 글자를 알아본다', () => {
    expect(hasFinalConsonant('재무')).toBe(false)
    expect(hasFinalConsonant('마케팅')).toBe(true)
    expect(hasFinalConsonant('경리')).toBe(false)
  })

  it('숫자는 읽는 소리로 본다', () => {
    // "3이 남았습니다"가 아니라 "3이"— 삼은 받침이 있다.
    expect(hasFinalConsonant('3')).toBe(true)
    expect(hasFinalConsonant('2')).toBe(false)
    expect(hasFinalConsonant('10')).toBe(true)
    expect(hasFinalConsonant('5')).toBe(false)
  })

  it('판단할 수 없는 것은 null이다', () => {
    // 여기서 찍으면 틀린 조사가 나온다.
    expect(hasFinalConsonant('SCM')).toBeNull()
    expect(hasFinalConsonant('team-a')).toBeNull()
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(hasFinalConsonant('')).toBe(false)
    expect(hasFinalConsonant(null)).toBe(false)
    expect(() => hasFinalConsonant()).not.toThrow()
  })
})

describe('조사 붙이기', () => {
  it('받침이 있으면 이/은/을', () => {
    expect(withJosa('영업', '가')).toBe('영업이')
    expect(withJosa('영업', '는')).toBe('영업은')
    expect(withJosa('영업', '를')).toBe('영업을')
  })

  it('받침이 없으면 가/는/를', () => {
    expect(withJosa('재무', '이')).toBe('재무가')
    expect(withJosa('재무', '은')).toBe('재무는')
    expect(withJosa('재무', '을')).toBe('재무를')
  })

  it('어느 쪽으로 적어 넣어도 맞게 고른다', () => {
    // 부르는 쪽이 '이'라고 쓰든 '가'라고 쓰든 결과가 같아야 한다.
    expect(withJosa('영업', '이')).toBe(withJosa('영업', '가'))
    expect(withJosa('재무', '이')).toBe(withJosa('재무', '가'))
  })

  it('으로/로도 가른다', () => {
    expect(withJosa('영업', '로')).toBe('영업으로')
    expect(withJosa('재무', '으로')).toBe('재무로')
  })

  it('판단할 수 없으면 둘 다 보여준다', () => {
    // 찍어서 틀리는 것보다 낫다.
    expect(withJosa('SCM', '가')).toBe('SCM이(가)')
  })

  it('모르는 조사는 그대로 붙인다', () => {
    expect(withJosa('영업', '도')).toBe('영업도')
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(withJosa('', '가')).toBe('')
    expect(() => withJosa()).not.toThrow()
  })
})

describe('여러 이름을 잇기', () => {
  it('맨 끝 이름에 맞춰 조사를 고른다', () => {
    expect(listWithJosa(['재무', '마케팅', '영업'], '가')).toBe('재무·마케팅·영업이')
    expect(listWithJosa(['영업', '재무'], '가')).toBe('영업·재무가')
  })

  it('하나면 그냥 붙인다', () => {
    expect(listWithJosa(['영업'], '가')).toBe('영업이')
  })

  it('빈 값은 걸러 낸다', () => {
    expect(listWithJosa(['재무', '', null, '영업'], '가')).toBe('재무·영업이')
  })

  it('아무것도 없으면 빈 문자열이다', () => {
    expect(listWithJosa([], '가')).toBe('')
    expect(() => listWithJosa()).not.toThrow()
  })
})
