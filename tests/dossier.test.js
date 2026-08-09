import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dossierText, dossierFilename, progressOf } from '../shared/dossier.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 기록 문서에서 가장 중요한 성질은 "하지 않은 것을 한 것처럼 적지 않는다"이다.
// 여덟 단계 중 두 단계만 밟은 신청서가 여덟 단계를 다 밟은 것처럼 보이면
// 그건 기록이 아니라 홍보물이다. 그 성질을 여기서 못 박는다.

const MINIMAL = {
  application: {
    id: 'app_1',
    ticket_no: 'AX-ABC-123',
    dept: '재무',
    applicant_label: '정산 담당자',
    title: '매주 채널 정산서를 손으로 붙입니다',
    bottleneck: '다섯 채널 정산서를 하나로 합칩니다.',
    problem: '한 줄 밀리면 금액이 틀립니다.',
    created_at: '2026-07-21 11:09:00',
  },
  done: { 신청서: true },
}

describe('진행 단계 세기', () => {
  it('밟은 단계만 센다', () => {
    const p = progressOf({ 신청서: true, 검토: true })
    expect(p.count).toBe(2)
    expect(p.total).toBe(8)
    expect(p.reached).toEqual(['신청서', '검토'])
  })

  it('중간을 건너뛰고 뒤가 채워지면 건너뛴 것을 드러낸다', () => {
    // 협의안 없이 제작으로 갔다. 순서를 지키지 않은 것도 사실대로 남겨야 한다.
    const p = progressOf({ 신청서: true, 검토: true, 제작: true })
    expect(p.skipped).toEqual(['협의안'])
  })

  it('아무것도 없어도 터지지 않는다', () => {
    const p = progressOf({})
    expect(p.count).toBe(0)
    expect(p.skipped).toEqual([])
  })

  it('done 자체가 없어도 터지지 않는다', () => {
    expect(progressOf(undefined).count).toBe(0)
  })
})

describe('기록 문서 만들기', () => {
  it('1단계만 있는 신청서도 문서가 나온다', () => {
    const text = dossierText(MINIMAL)
    expect(text).toContain('AX-ABC-123')
    expect(text).toContain('매주 채널 정산서를 손으로 붙입니다')
    expect(text).toContain('여덟 단계 중 1단계까지 기록됨')
  })

  it('하지 않은 단계를 숨기지 않고 아직 안 했다고 적는다', () => {
    const text = dossierText(MINIMAL)
    expect(text).toContain('[2] 검토')
    expect(text).toContain('아직 판정하지 않았습니다')
    expect(text).toContain('[5] 베타테스트')
    expect(text).toContain('[8] 성과')
  })

  it('기각한 요구도 사유와 함께 남는다', () => {
    const text = dossierText({
      ...MINIMAL,
      requirements: [
        {
          id: 'r1',
          kind: '요구',
          dept: '마케팅',
          body: '실시간으로 갱신되면 좋겠습니다',
          priority: '있으면좋음',
          status: '기각',
          reject_reason: '원천이 하루 한 번만 갱신되어 실시간이 불가능합니다.',
        },
      ],
    })
    expect(text).toContain('실시간으로 갱신되면 좋겠습니다')
    expect(text).toContain('기각 사유: 원천이 하루 한 번만 갱신되어')
  })

  it('회의록 인용이 있으면 그대로 옮긴다', () => {
    const text = dossierText({
      ...MINIMAL,
      requirements: [
        {
          id: 'r1',
          kind: '제약',
          dept: '재무',
          body: '금액 오차는 0원이어야 한다',
          priority: '필수',
          status: '채택',
          quote: '한 푼이라도 틀리면 정정 공시까지 갑니다',
        },
      ],
    })
    expect(text).toContain('회의록 인용: "한 푼이라도 틀리면 정정 공시까지 갑니다"')
  })

  it('필수 안전 기준에는 배포를 막는다는 것을 적는다', () => {
    const text = dossierText({
      ...MINIMAL,
      criteria: [
        {
          id: 'c1',
          ord: 1,
          body: '금액 오차 0원',
          is_required_safety: 1,
          check_kind: 'rule',
        },
      ],
    })
    expect(text).toContain('[필수 안전 — 깨지면 배포 차단]')
  })

  it('기준선에는 표본이 약하다는 말을 반드시 붙인다', () => {
    const text = dossierText({
      ...MINIMAL,
      baseline: {
        median_seconds: 5820,
        sample_n: 3,
        sealed_at: '2026-07-25 09:00:00',
      },
    })
    expect(text).toContain('97분 0초')
    expect(text).toContain('표본 3회는 통계적으로 약합니다')
    expect(text).toContain('신뢰구간을 붙이지 않습니다')
  })

  it('부서가 확인하지 않은 성과는 확인받지 못했다고 적는다', () => {
    const text = dossierText({
      ...MINIMAL,
      outcome: { dev_hours: 12, ops_cost_krw: 0, amortize_months: 24, dept_confirmed_at: null },
    })
    expect(text).toContain('만든 사람만 아는 성과는 성과가 아닙니다')
  })

  it('미해소 반박이 남으면 보수적 추정치라고 부른다', () => {
    const text = dossierText({
      ...MINIMAL,
      outcome: { dev_hours: 12, ops_cost_krw: 0, amortize_months: 24 },
      challenges: [
        { id: 'ch1', rule_code: 'sample_small', title: '표본이 세 번뿐이다', body: '...', resolved_at: null },
      ],
    })
    expect(text).toContain("'보수적 추정치'로 부릅니다")
  })

  it('넘겼지만 부서가 확인 안 했으면 그렇다고 적는다', () => {
    const text = dossierText({
      ...MINIMAL,
      handover: {
        slug: 'settlement',
        handed_to_dept: '재무',
        handed_to_person: '정산 담당자',
        handed_at: '2026-07-30 10:00:00',
        accepted_at: null,
        daily_limit: 20,
        max_file_mb: 10,
      },
    })
    expect(text).toContain('넘겼다고 받은 것이 아닙니다')
    expect(text).toContain('넘긴 뒤 아직 한 번도 쓰이지 않았습니다')
  })

  it('요청받지 않고 먼저 제안한 결정에는 표시가 붙는다', () => {
    const text = dossierText({
      ...MINIMAL,
      decisions: [
        {
          id: 'd1',
          stage: '검토',
          title: '반품 행을 따로 뺀다',
          what: '음수 수량 행을 별도 집계로 분리했다.',
          why: '순매출에 섞이면 채널별 비교가 무너진다.',
          alternatives: '그냥 합산 — 간단하지만 반품이 많은 주에 왜곡이 크다.',
          unrequested: 1,
          created_at: '2026-07-26 14:00:00',
        },
      ],
    })
    expect(text).toContain('*요청받지 않았으나 먼저 제안*')
    expect(text).toContain('고르지 않은 길:')
  })

  it('베타 실패 항목에는 근거가 함께 남는다', () => {
    const text = dossierText({
      ...MINIMAL,
      betaRounds: [
        {
          id: 'br1',
          seq: 1,
          overall: '차단',
          total: 5,
          passed: 4,
          failed: 1,
          safety_failed: 1,
          created_at: '2026-07-28 09:00:00',
          fixed_what: null,
        },
      ],
      betaResults: [
        {
          id: 'x1',
          round_id: 'br1',
          ord: 1,
          body: '금액 오차 0원',
          verdict: '실패',
          is_required_safety: 1,
          evidence: '자사몰 합계가 정답보다 255,255원 많습니다.',
        },
      ],
    })
    expect(text).toContain('× 금액 오차 0원')
    expect(text).toContain('근거: 자사몰 합계가 정답보다 255,255원 많습니다.')
  })
})

describe('내려받을 파일 이름', () => {
  it('접수번호가 앞에 온다', () => {
    expect(dossierFilename(MINIMAL.application)).toMatch(/^AX-ABC-123 /)
  })

  it('윈도우가 싫어하는 글자를 뺀다', () => {
    const name = dossierFilename({ ticket_no: 'AX-A-1', title: 'a/b:c*d?e"f<g>h|i' })
    expect(name).toBe('AX-A-1 abcdefghi.txt')
  })

  it('제목이 없어도 이름이 나온다', () => {
    expect(dossierFilename(null)).toBe('AX 신청서.txt')
  })
})

// 여덟 단계가 만들어 내는 숫자가 그 여덟 단계를 편 문서에 없었다.
//
// 인쇄 문서의 성과 칸에는 만든 공수와 자기 반박만 있었다. 얼마나 줄었는지는
// 없었다. 심지어 "미해소 반박이 N건 남아 있어 이 금액은 '보수적 추정치'로
// 부릅니다"라는 줄은 있는데, **정작 그 금액이 안 적혀 있었다.**
//
// 이 문서는 남에게 건네는 것이다 — 부서에 보내거나 감사 때 낸다. 결과가
// 빠진 보고서를 내는 셈이었다.
describe('성과 문서에 금액이 있는가', () => {
  const money = {
    status: '인정',
    runCount: 3,
    savedSeconds: 12600,
    netKrw: 37500,
    annual: {
      perYear: 52,
      hours: 79.7,
      grossKrw: 1991769,
      firstYearKrw: 1641769,
      note: '지금까지 3번 돌린 평균으로 연 52회를 곱한 값입니다.',
    },
  }
  const base = {
    application: { ticket_no: 'AX-DEM-001', dept: '재무', title: '정산 취합' },
    outcome: { dev_hours: 14, amortize_months: 12, ops_cost_krw: 0 },
    done: {},
  }

  it('줄인 시간과 순절감과 연 환산을 적는다', () => {
    const t = dossierText({ ...base, money, moneyLabel: { label: '보수적 추정' } })
    expect(t).toContain('지금까지 줄인 시간')
    expect(t).toContain('순절감')
    expect(t).toContain('연 환산')
    expect(t).toContain('79.7시간')
    expect(t).toContain('1,991,769원')
  })

  it('첫 해는 만든 공수를 뺀 값도 적는다', () => {
    // 두 해가 다른데 한 숫자만 적으면 읽는 사람이 그걸 매년 값으로 읽는다.
    const t = dossierText({ ...base, money, moneyLabel: null })
    expect(t).toContain('첫 해는 만든 공수를 빼고')
    expect(t).toContain('1,641,769원')
  })

  it('금액을 뭐라고 부르는지 함께 적는다', () => {
    // "보수적 추정"이라는 딱지 없이 금액만 적으면 확정으로 읽힌다.
    const t = dossierText({ ...base, money, moneyLabel: { label: '보수적 추정' } })
    expect(t).toContain('보수적 추정')
  })

  it('계산할 수 없으면 아무 숫자도 안 적는다', () => {
    // 기준선이 없거나 한 번도 안 돌린 건은 money 가 없다. 그때 0원이라고
    // 적으면 "아꼈는데 0원"으로 읽힌다.
    const t = dossierText({ ...base, money: null, moneyLabel: null })
    expect(t).not.toContain('연 환산')
    expect(t).not.toContain('순절감')
  })

  it('서버가 화면과 같은 함수로 낸 값을 넘긴다', () => {
    // 두 벌로 만들면 종이와 화면이 다른 금액을 말하는 날이 온다.
    const src = readFileSync(
      join(ROOT, 'functions', 'api', 'applications', '[id]', 'record.js'),
      'utf8'
    )
    expect(src).toContain('annualize(')
    expect(src).toContain('labelForOutcome(')
    expect(src).toContain('money,')
    expect(src).toContain('moneyLabel,')
  })
})
