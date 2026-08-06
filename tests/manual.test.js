import { describe, it, expect } from 'vitest'
import {
  inputSpec,
  autoSections,
  PROCESS_STEPS,
  QUARANTINE_GUIDE,
  NOT_GUARANTEED,
} from '../shared/manual.js'
import { CHANNEL_RULES_PUBLIC, QUARANTINE_REASONS } from '../shared/pipeline.js'
import { FX, PERIOD, CHANNELS, SKUS } from '../shared/master.js'

// 이 파일은 시험이 하나도 없었다. shared/ 40개 중 어느 시험에서도 안 걸리는
// 유일한 파일이었다. 앞서 같은 처지였던 outcome.js 를 열었을 때 금액 버그가
// 세 건 나왔다.
//
// 그리고 이 파일은 스스로 이렇게 주장한다 —
//   "받는 파일 형식, 처리 단계, 검토함에 뜨는 이유는 문서에 손으로 적지
//    않는다. 실제로 도는 코드와 같은 곳에서 뽑아 온다. 규칙이 바뀌면
//    문서도 같이 바뀐다."
//
// 그 주장이 참인지를 여기서 지킨다. 사용법서가 쓸모없어지는 가장 흔한
// 이유가 낡아서인데, 낡았다는 것을 아무도 안 알려주면 담당자는 문서대로
// 하다가 안 되는 것을 겪고 그다음부터 문서를 안 본다.

describe('검토함 안내가 실제 규칙을 다 덮는가', () => {
  it('견줄 것이 실제로 있다', () => {
    // 양쪽이 다 비어 있으면 아래 검사는 통과하지만 아무것도 안 본 것이다.
    // 이 저장소에서 "검사기가 있는데 그 검사기가 안 보는 자리"에 정확히
    // 버그가 들어간 적이 있다.
    expect(Object.keys(QUARANTINE_REASONS).length).toBeGreaterThan(5)
    expect(QUARANTINE_GUIDE.length).toBeGreaterThan(5)
    expect(CHANNEL_RULES_PUBLIC.length).toBeGreaterThan(2)
    expect(Object.keys(FX).length).toBeGreaterThan(1)
  })

  it('규칙에 있는 이유는 전부 안내가 있다', () => {
    // 이 목록은 손으로 적혀 있다. 파이프라인에 격리 이유를 하나 더하고
    // 여기 안 적으면, 부서는 검토함에서 이유만 보고 무엇을 해야 하는지
    // 모르는 채로 남는다. 문서가 조용히 낡는 자리다.
    const guided = new Set(QUARANTINE_GUIDE.map((g) => g.reason))
    const missing = Object.keys(QUARANTINE_REASONS).filter((r) => !guided.has(r))
    expect(missing).toEqual([])
  })

  it('규칙에 없는 안내가 떠 있지 않다', () => {
    // 반대쪽도 본다. 규칙에서 이유를 뺐는데 안내만 남으면, 있지도 않은
    // 상황에 대한 설명을 읽게 된다.
    const known = new Set(Object.keys(QUARANTINE_REASONS))
    const extra = QUARANTINE_GUIDE.filter((g) => !known.has(g.reason)).map((g) => g.reason)
    expect(extra).toEqual([])
  })

  it('이유 이름은 규칙에서 그대로 가져온다', () => {
    for (const g of QUARANTINE_GUIDE) {
      expect(g.label).toBe(QUARANTINE_REASONS[g.reason])
    }
  })

  it('안내마다 무엇인지와 무엇을 해야 하는지가 둘 다 있다', () => {
    // "왜 걸렸는지"만 있고 "그래서 뭘 해야 하는지"가 없으면 부서는
    // 검토함을 열어 보고 그냥 닫는다.
    for (const g of QUARANTINE_GUIDE) {
      expect(g.what.length).toBeGreaterThan(5)
      expect(g.todo.length).toBeGreaterThan(3)
    }
  })
})

describe('받는 파일 설명이 실제 인식 규칙과 같은가', () => {
  it('채널 수가 규칙과 같다', () => {
    expect(inputSpec()).toHaveLength(CHANNEL_RULES_PUBLIC.length)
  })

  it('채널마다 무엇으로 알아보는지와 어떤 컬럼이 필요한지를 적는다', () => {
    for (const s of inputSpec()) {
      expect(s.channel).toBeTruthy()
      expect(Array.isArray(s.tellBy)).toBe(true)
      expect(s.tellBy.length).toBeGreaterThan(0)
      expect(Array.isArray(s.columns)).toBe(true)
    }
  })

  it('통화를 상품 마스터에서 가져온다', () => {
    // 여기서 손으로 적으면 마스터의 통화를 고쳤을 때 문서만 옛 값으로 남는다.
    for (const s of inputSpec()) {
      const known = CHANNELS.find((c) => c.name === s.channel)
      if (known) expect(s.currency).toBe(known.currency)
      else expect(s.currency).toBe('KRW')
    }
  })

  it('환산 단계 문장에 실제 환율이 들어간다', () => {
    const step = PROCESS_STEPS.find((s) => s.title === '통화 환산')
    for (const [code, rate] of Object.entries(FX)) {
      if (code === 'KRW') continue
      expect(step.body).toContain(`${code} ${rate}원`)
    }
    // 원화는 환산할 것이 없으니 안 적는다.
    expect(step.body).not.toContain('KRW ')
  })
})

describe('문서 전체를 한 번에 뽑을 때', () => {
  const doc = autoSections()

  it('사람이 읽을 것이 전부 들어 있다', () => {
    for (const k of ['period', 'fx', 'inputs', 'steps', 'quarantine', 'notGuaranteed']) {
      expect(doc[k]).toBeTruthy()
    }
  })

  it('개수는 마스터에서 센다', () => {
    expect(doc.skuCount).toBe(SKUS.length)
    expect(doc.channelCount).toBe(CHANNELS.length)
    expect(doc.period).toBe(PERIOD)
  })

  it('이 부분이 코드에서 뽑은 것이라고 밝힌다', () => {
    // 사람이 쓴 부분과 기계가 채운 부분을 갈라 놓지 않으면, 낡은 쪽이
    // 어디인지 아무도 모른다.
    expect(doc.generatedNote).toContain('코드에서 그대로 뽑았습니다')
  })
})

describe('보장하지 않는 것', () => {
  it('처음부터 적어 둔다', () => {
    // 나중에 다투지 않으려면 못 하는 것을 먼저 말해야 한다.
    expect(NOT_GUARANTEED.length).toBeGreaterThan(3)
    for (const t of NOT_GUARANTEED) expect(t.length).toBeGreaterThan(10)
  })

  it('환율을 고정으로 쓴다는 것을 밝힌다', () => {
    // 실제로 고정 환율(FX)을 쓰고 있으므로 이건 사실이어야 한다.
    expect(NOT_GUARANTEED.some((t) => t.includes('환율'))).toBe(true)
  })
})

describe('처리 단계', () => {
  it('단계마다 제목과 설명이 있다', () => {
    expect(PROCESS_STEPS.length).toBeGreaterThan(5)
    for (const s of PROCESS_STEPS) {
      expect(s.title.length).toBeGreaterThan(1)
      expect(s.body.length).toBeGreaterThan(15)
    }
  })

  it('계산 순서를 바꾸면 금액이 달라진다는 것을 적는다', () => {
    // 이 문장이 없으면 나중에 누가 순서를 바꿔 놓고도 문제를 모른다.
    const calc = PROCESS_STEPS.find((s) => s.title === '계산')
    expect(calc.body).toContain('순서를 바꾸면 금액이 달라집니다')
  })
})
