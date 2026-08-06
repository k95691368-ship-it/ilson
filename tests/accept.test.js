import { describe, it, expect } from 'vitest'
import {
  validateAccept,
  validateReject,
  validateOutcomeConfirm,
  acceptState,
  proxyNote,
  ACCEPT_KIND,
  ACCEPT_PROXY_KIND,
  REJECT_KIND,
  MIN_NAME,
} from '../shared/accept.js'

// 이 사이트는 "넘겼다고 받은 것이 아니다"를 여러 화면에서 되풀이한다.
// 그런데 그 확인을 누르는 자리가 담당자 화면에만 있었다. 담당자가 창을
// 띄워 부서 사람 이름을 대신 타이핑하고, 기록에는 그 부서 사람이 확인한
// 것으로 남았다.
//
// 부서 사람은 조회 화면에서 "받았다고 눌러주세요"를 읽고 도구 화면으로
// 갔는데 거기엔 누를 것이 없었다.

const rec = (kind, at, by = '김대리') => ({ kind, at, by })
const handed = { accepted_at: null, accepted_by: null, rolled_back_at: null }

describe('받았다고 할 때 받는 것', () => {
  it('성함을 받는다', () => {
    // 계정을 만들게 하지는 않는다. 다만 누가 받았는지 모르면 나중에
    // "그런 거 받은 적 없다"가 됐을 때 댈 것이 없다.
    expect(validateAccept({ by: '' }).by).toBeTruthy()
    expect(validateAccept({ by: 'ㄱ'.repeat(MIN_NAME - 1) }).by).toBeTruthy()
    expect(validateAccept({ by: '김대리' })).toEqual({})
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => validateAccept()).not.toThrow()
  })
})

describe('못 쓰겠다고 할 때', () => {
  it('무엇이 안 맞는지 받는다', () => {
    // 못 쓰겠다는 말만 오면 담당자는 무엇을 고쳐야 할지 모른다.
    expect(validateReject({ by: '김대리', reason: '' }).reason).toBeTruthy()
    expect(validateReject({ by: '김대리', reason: '별로' }).reason).toBeTruthy()
    expect(validateReject({ by: '김대리', reason: '광고비 칸이 비어서 옵니다' })).toEqual({})
  })

  it('성함도 같이 받는다', () => {
    expect(validateReject({ reason: '광고비 칸이 비어서 옵니다' }).by).toBeTruthy()
  })
})

describe('성과가 체감과 맞는지 물을 때', () => {
  const good = { by: '김대리', agree: true }

  it('맞다/다르다를 고르게 한다', () => {
    expect(validateOutcomeConfirm({ by: '김대리' }).agree).toBeTruthy()
    expect(validateOutcomeConfirm(good)).toEqual({})
  })

  it('다르다면 실제로 몇 분인지 받는다', () => {
    // "다릅니다" 한 마디로 끝내면 담당자는 얼마나 다른지 모른다.
    expect(validateOutcomeConfirm({ by: '김대리', agree: false }).felt).toBeTruthy()
    expect(validateOutcomeConfirm({ by: '김대리', agree: false, felt: 40 }).felt).toBeUndefined()
  })

  it('맞다고 하면 숫자를 안 묻는다', () => {
    expect(validateOutcomeConfirm(good).felt).toBeUndefined()
  })

  it('0분도 받는다', () => {
    // 아예 안 걸린다는 답도 답이다.
    expect(validateOutcomeConfirm({ by: '김대리', agree: false, felt: 0 }).felt).toBeUndefined()
  })
})

describe('지금 수령이 어떤 상태인가', () => {
  it('안 넘겼으면 누를 것이 없다', () => {
    expect(acceptState({ handover: null }).canAccept).toBe(false)
  })

  it('아직 아무도 안 눌렀으면 부서가 누를 수 있다', () => {
    const s = acceptState({ handover: handed, records: [] })
    expect(s.status).toBe('아직')
    expect(s.canAccept).toBe(true)
  })

  it('부서가 직접 눌렀으면 끝이다', () => {
    const s = acceptState({ handover: handed, records: [rec(ACCEPT_KIND, '2026-08-03 01:00:00')] })
    expect(s.status).toBe('부서가 확인함')
    expect(s.canAccept).toBe(false)
    expect(s.proxy).toBe(false)
  })

  it('담당자가 대신 누른 것은 대신 눌렀다고 적는다', () => {
    // 지우지 않는다. 전화로 확인받고 대신 눌러야 할 때가 실제로 있다.
    // 다만 부서 확인과 같은 것으로 세지 않는다.
    const s = acceptState({
      handover: { ...handed, accepted_at: '2026-08-03 01:00:00', accepted_by: 'AX 담당자' },
      records: [rec(ACCEPT_PROXY_KIND, '2026-08-03 01:00:00', 'AX 담당자')],
    })
    expect(s.status).toBe('담당자가 대신 확인함')
    expect(s.proxy).toBe(true)
    // 대신 누른 뒤에도 부서가 직접 누를 수 있어야 한다.
    expect(s.canAccept).toBe(true)
  })

  it('이 기능 생기기 전 기록도 대리로 읽는다', () => {
    // 그때는 담당자 화면에서만 누를 수 있었으니 전부 대리다.
    const s = acceptState({
      handover: { ...handed, accepted_at: '2026-08-01 00:00:00', accepted_by: '정산 담당자' },
      records: [],
    })
    expect(s.proxy).toBe(true)
  })

  it('못 쓰겠다고 하면 그것이 가장 먼저다', () => {
    const s = acceptState({
      handover: handed,
      records: [rec(REJECT_KIND, '2026-08-03 02:00:00')],
    })
    expect(s.status).toBe('못 쓰겠다고 하심')
    expect(s.rejects).toHaveLength(1)
  })

  it('거절한 뒤 다시 받았다고 하면 그것이 최신이다', () => {
    const s = acceptState({
      handover: handed,
      records: [rec(REJECT_KIND, '2026-08-03 01:00:00'), rec(ACCEPT_KIND, '2026-08-03 03:00:00')],
    })
    expect(s.status).toBe('부서가 확인함')
  })

  it('내린 것은 누를 것이 없다', () => {
    const s = acceptState({ handover: { ...handed, rolled_back_at: 'x' }, records: [] })
    expect(s.canAccept).toBe(false)
  })

  it('빈 입력에도 터지지 않는다', () => {
    expect(() => acceptState()).not.toThrow()
  })
})

describe('대리 확인을 뭐라고 부르나', () => {
  it('부서 확인이 아직 없다는 것을 분명히 말한다', () => {
    const t = proxyNote({ proxy: true, by: 'AX 담당자' })
    expect(t).toContain('대신 확인한 것')
    expect(t).toContain('부서가 직접 누른 것은 아직 없습니다')
  })

  it('부서가 직접 눌렀으면 아무 말도 안 한다', () => {
    expect(proxyNote({ proxy: false })).toBeNull()
    expect(proxyNote()).toBeNull()
  })
})

// 같은 사람이 두 번 누르면 나중 것이 맞다.
//
// records 는 시간순으로 오는데 find 는 첫 번째를 집는다. 그래서 부서가
// 체감을 40분이라고 했다가 다시 재 보고 55분으로 고쳐 보내면, 서버는 200을
// 돌려주고 "고맙습니다"까지 적어 놓고 값은 40 그대로 뒀다. 부서가 애써
// 고쳐 준 숫자가 조용히 버려진다.
describe('두 번 누르면 나중 것이 맞다', () => {
  it('나중에 누른 사람으로 바뀐다', () => {
    const s = acceptState({
      handover: handed,
      records: [
        rec(ACCEPT_KIND, '2026-08-01 00:00:00', '김대리'),
        rec(ACCEPT_KIND, '2026-08-03 00:00:00', '박과장'),
      ],
    })
    expect(s.by).toBe('박과장')
    expect(s.at).toBe('2026-08-03 00:00:00')
  })

  it('대리 확인도 나중 것을 본다', () => {
    const s = acceptState({
      handover: { ...handed, accepted_at: '2026-08-01 00:00:00', accepted_by: '담당자' },
      records: [
        rec(ACCEPT_PROXY_KIND, '2026-08-01 00:00:00', '담당자'),
        rec(ACCEPT_PROXY_KIND, '2026-08-04 00:00:00', '다른 담당자'),
      ],
    })
    expect(s.proxy).toBe(true)
    expect(s.by).toBe('다른 담당자')
  })
})
