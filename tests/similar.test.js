import { describe, it, expect } from 'vitest'
import {
  tokenize,
  similarity,
  findSimilar,
  reasonText,
  SIMILAR_THRESHOLD,
} from '../shared/similar.js'

// 이 판정이 헐거우면 아무 신청서나 서로 비슷하다고 떠서 아무도 안 읽고,
// 빡빡하면 진짜 중복을 놓친다. 둘 다 여기서 못 박는다.
//
// 아래 두 건은 라이브에 실제로 들어와 있는 것이다. 하나는 이미 만들어서
// 넘겼고 하나는 아직 접수함에 앉아 있다.

const 기존_정산 = {
  id: 'a',
  ticket_no: 'AX-EFD-E58',
  dept: '재무',
  title: '매주 채널 정산서를 손으로 붙입니다',
  bottleneck: '스마트스토어 쿠팡 자사몰 등 다섯 채널 정산서를 하나로 합칩니다.',
  problem: '한 줄만 밀려도 금액이 틀어지고 어디서 틀렸는지 찾는 데 반나절이 갑니다.',
  status: '진행중',
  created_at: '2026-07-20 09:00:00',
}

const 새로_낸_정산 = {
  dept: '재무',
  title: '채널별 정산서 취합을 매주 손으로 하고 있습니다',
  bottleneck: '채널 다섯 곳에서 온 정산 내역을 엑셀에 하나로 모읍니다.',
  problem: '옮기다 한 줄 놓치면 합계가 안 맞습니다.',
}

const 전혀_다른_건 = {
  id: 'b',
  ticket_no: 'AX-OPS-001',
  dept: '운영',
  title: '고객문의를 유형별로 분류해서 나눠줍니다',
  bottleneck: '하루에 들어오는 문의를 읽고 담당 팀으로 넘깁니다.',
  problem: '분류가 틀리면 엉뚱한 팀에 가서 답이 늦어집니다.',
  status: '접수',
  created_at: '2026-07-29 09:00:00',
}

describe('낱말 뽑기', () => {
  it('조사를 떼어 낸다', () => {
    // "정산서를"과 "정산서가"가 같은 낱말이 되어야 겹친다.
    expect(tokenize('정산서를')).toEqual(tokenize('정산서가'))
  })

  it('한글은 두 글자 조각으로도 쪼갠다', () => {
    // "정산서"와 "정산 내역"이 서로 걸리려면 이게 있어야 한다.
    const t = tokenize('정산서')
    expect(t.has('정산')).toBe(true)
    expect(t.has('산서')).toBe(true)
  })

  it('어디에나 나오는 말은 버린다', () => {
    const t = tokenize('합니다 있습니다 업무 담당자')
    expect(t.has('합니다')).toBe(false)
    expect(t.has('업무')).toBe(false)
    expect(t.has('담당자')).toBe(false)
  })

  it('한 글자는 버린다', () => {
    expect(tokenize('이 그 저 수 것')).toEqual(new Set())
  })

  it('문장부호와 대소문자를 무시한다', () => {
    expect(tokenize('ERP, 자동화!')).toEqual(tokenize('erp 자동화'))
  })

  it('빈 값에도 터지지 않는다', () => {
    expect(tokenize(null)).toEqual(new Set())
    expect(tokenize('')).toEqual(new Set())
    expect(tokenize(undefined)).toEqual(new Set())
  })
})

describe('같은 병목을 다시 낸 것', () => {
  it('말이 달라도 같은 건으로 잡는다', () => {
    // 제목·병목·문제 어느 하나도 글자 그대로 같지 않다. 그래도 같은 일이다.
    const { score } = similarity(새로_낸_정산, 기존_정산)
    expect(score).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD)
  })

  it('왜 비슷한지 겹친 말을 함께 돌려준다', () => {
    // 점수만 주면 "왜 비슷하다는 거지"에 답할 수 없고,
    // 답할 수 없는 경고는 사람이 그냥 닫아 버린다.
    const { shared } = similarity(새로_낸_정산, 기존_정산)
    expect(shared.length).toBeGreaterThan(0)
    expect(shared.some((w) => w.includes('정산'))).toBe(true)
  })

  it('겹친 말을 한국어 한 줄로 적어 준다', () => {
    const hit = findSimilar(새로_낸_정산, [기존_정산])[0]
    expect(reasonText(hit)).toContain('겹칩니다')
  })
})

describe('안 비슷한 것을 비슷하다고 하지 않는다', () => {
  it('전혀 다른 병목은 걸리지 않는다', () => {
    const { score } = similarity(새로_낸_정산, 전혀_다른_건)
    expect(score).toBeLessThan(SIMILAR_THRESHOLD)
  })

  it('흔한 말만 겹치는 것으로는 안 걸린다', () => {
    // 둘 다 "매주 ~ 확인합니다"고 "틀리면 다시 합니다"지만 하는 일이 다르다.
    // 껍데기가 겹친 것으로 같은 병목이라고 하면 안 된다.
    //
    // 이 판정은 이미 들어와 있는 신청서를 훑어야 할 수 있다. "매주"·"확인"이
    // 여기저기 다 나온다는 것을 알아야 그 말을 가볍게 칠 수 있기 때문이다.
    const 기존들 = [
      { id: '1', title: '매주 재고를 확인합니다', bottleneck: '틀리면 다시 합니다', problem: '늦어집니다' },
      { id: '2', title: '매주 광고비를 확인합니다', bottleneck: '틀리면 다시 합니다', problem: '늦어집니다' },
      { id: '3', title: '매주 미수금을 확인합니다', bottleneck: '틀리면 다시 합니다', problem: '늦어집니다' },
      { id: '4', title: '매주 단가표를 확인합니다', bottleneck: '틀리면 다시 합니다', problem: '늦어집니다' },
      기존_정산,
      전혀_다른_건,
    ]
    const 급여 = { title: '매주 급여대장을 확인합니다', bottleneck: '틀리면 다시 합니다', problem: '늦어집니다' }
    expect(findSimilar(급여, 기존들)).toEqual([])
  })

  it('껍데기를 떼고 나면 알맹이만 남는다', () => {
    // "확인합니다"가 확인·인합·합니·니다 네 조각을 만들면, 그중 합니·니다는
    // 모든 신청서에 다 들어 있는 껍데기다. 어미를 떼서 알맹이만 남긴다.
    const t = tokenize('확인합니다')
    expect(t.has('확인')).toBe(true)
    expect(t.has('합니')).toBe(false)
    expect(t.has('니다')).toBe(false)
  })

  it('찾은 것이 없으면 빈 배열이다', () => {
    expect(findSimilar(새로_낸_정산, [전혀_다른_건])).toEqual([])
    expect(findSimilar(새로_낸_정산, [])).toEqual([])
    expect(findSimilar(새로_낸_정산, undefined)).toEqual([])
  })
})

describe('같은 부서면 더 의심한다', () => {
  it('부서가 같으면 점수가 올라간다', () => {
    const same = similarity({ ...새로_낸_정산, dept: '재무' }, 기존_정산).score
    const other = similarity({ ...새로_낸_정산, dept: '마케팅' }, 기존_정산).score
    expect(same).toBeGreaterThan(other)
  })

  it('부서가 같다고 안 비슷한 것이 비슷해지지는 않는다', () => {
    // 가중치는 거들 뿐이다. 내용이 다르면 여전히 안 걸려야 한다.
    const s = similarity({ ...새로_낸_정산, dept: '운영' }, { ...전혀_다른_건, dept: '운영' })
    expect(s.score).toBeLessThan(SIMILAR_THRESHOLD)
  })

  it('점수는 1을 넘지 않는다', () => {
    const s = similarity(기존_정산, { ...기존_정산, id: 'x' })
    expect(s.score).toBeLessThanOrEqual(1)
  })
})

describe('아직 다 안 적은 신청서', () => {
  it('제목만 적어도 찾아 준다', () => {
    // 다 적기 전에 알려 줘야 헛수고를 막는다. 다 적고 나서 "이미 있습니다"는
    // 늦다 — 그 사람은 이미 십 분을 썼다.
    const draft = { dept: '재무', title: '매주 채널 정산서를 손으로 붙입니다' }
    expect(findSimilar(draft, [기존_정산, 전혀_다른_건])).toHaveLength(1)
  })

  it('안 적은 칸을 0점으로 치지 않는다', () => {
    // 0점으로 치면 아직 다 안 적은 신청서는 무조건 안 비슷한 것으로 나온다.
    const titleOnly = similarity({ title: 기존_정산.title }, 기존_정산).score
    expect(titleOnly).toBeGreaterThan(0.5)
  })

  it('아무것도 안 적었으면 아무것도 안 찾는다', () => {
    expect(findSimilar({ dept: '재무' }, [기존_정산])).toEqual([])
    expect(similarity({}, 기존_정산).score).toBe(0)
  })
})

describe('여러 건 중에서 고르기', () => {
  const 또다른_정산 = {
    ...기존_정산,
    id: 'c',
    ticket_no: 'AX-FIN-777',
    title: '정산 결과를 ERP에 다시 타이핑합니다',
    bottleneck: '취합한 정산 엑셀을 보며 ERP에 한 줄씩 옮깁니다.',
    problem: 'ERP 숫자와 엑셀 숫자가 달라집니다.',
    created_at: '2026-07-22 09:00:00',
  }

  it('가장 비슷한 것이 먼저 나온다', () => {
    const hits = findSimilar(새로_낸_정산, [또다른_정산, 전혀_다른_건, 기존_정산])
    expect(hits[0].ticket_no).toBe('AX-EFD-E58')
  })

  it('너무 많이 보여 주지 않는다', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...기존_정산, id: `x${i}` }))
    expect(findSimilar(새로_낸_정산, many).length).toBeLessThanOrEqual(3)
  })

  it('자기 자신은 빼고 찾는다', () => {
    // 검토 화면에서 쓸 때 필요하다 — 자기가 자기랑 제일 비슷하다.
    const hits = findSimilar(기존_정산, [기존_정산, 전혀_다른_건])
    expect(hits.find((h) => h.id === 'a')).toBeUndefined()
  })

  it('거의 같으면 same 표시가 붙는다', () => {
    const hits = findSimilar({ ...기존_정산, id: undefined }, [기존_정산])
    expect(hits[0].same).toBe(true)
  })
})
