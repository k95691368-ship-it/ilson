import { describe, expect, it } from 'vitest'
import {
  canExpandExperiment,
  compareDecision,
  evaluateExperimentRun,
  priorityBand,
  priorityScore,
  recommendCluster,
  recurringExceptionRate,
  roleCan,
  suggestCauses,
  trendSignal,
} from '../shared/override.js'
import { overrideDemoMode } from '../functions/_lib/override.js'

describe('Override Event 판정', () => {
  it('AI 판단과 사람 판단의 차이를 구조화한다', () => {
    expect(compareDecision('자동 승인', '추가 심사 후 승인')).toEqual({
      changed: true,
      removed: ['자동'],
      added: ['추가', '심사'],
    })
    expect(compareDecision('전문가 이관', '전문가 이관').changed).toBe(false)
  })

  it('근거 문장에서 원인 후보를 만들되 최종 확정하지 않는다', () => {
    const candidates = suggestCauses({
      reasonDetail: '문서 버전이 오래되어 최신 내규를 검색하지 못했습니다.',
      aiDecision: '승인',
      humanDecision: '거절',
    })
    expect(candidates[0].key).toBe('policy_retrieval')
    expect(candidates[0].source).toBe('rule')
    expect(candidates).toHaveLength(3)
  })

  it('유사 사건을 가장 가까운 반복 문제에 제안한다', () => {
    const result = recommendCluster(
      {
        reasonDetail: '정책 검색 결과가 오래된 문서 버전입니다.',
        causeKey: 'policy_retrieval',
        policyRefs: '심사내규-2026.08',
      },
      [
        {
          id: 'policy',
          title: '오래된 정책 검색',
          sample_text: '문서 버전 내규',
          cause_code: 'policy_retrieval',
          policy_refs_json: '["심사내규-2026.08"]',
        },
        {
          id: 'api',
          title: 'API 권한 오류',
          sample_text: '접속 실패',
          cause_code: 'system',
          policy_refs_json: '[]',
        },
      ]
    )
    expect(result.cluster.id).toBe('policy')
    expect(result.score).toBeGreaterThan(0.3)
  })
})

describe('우선순위와 재발 지표', () => {
  it('고객·규제·재발·비용 근거를 가중 합산한다', () => {
    const low = priorityScore({
      customerImpact: 1,
      regulatoryRisk: 0,
      recurrence: 1,
      operationsCost: 1000,
    })
    const high = priorityScore({
      customerImpact: 5,
      regulatoryRisk: 5,
      recurrence: 31,
      operationsCost: 1_000_000,
    })
    expect(high).toBe(100)
    expect(high).toBeGreaterThan(low)
    expect(priorityBand(high)).toBe('P0')
    expect(priorityBand(60)).toBe('P1')
    expect(priorityBand(40)).toBe('P2')
  })

  it('적용 가능 건수가 없으면 오해를 만드는 0%를 내지 않는다', () => {
    expect(recurringExceptionRate(5, 0)).toBeNull()
    expect(recurringExceptionRate(13, 100)).toBe(13)
  })

  it('전주 대비 25% 이상 증가를 급증으로 분류한다', () => {
    expect(trendSignal(130, 100)).toEqual({ change: 30, direction: 'surge' })
    expect(trendSignal(70, 100).direction).toBe('down')
  })
})

describe('개선 실험 가드레일', () => {
  it('성과가 목표를 넘고 가드레일이 지켜져야 통과한다', () => {
    expect(
      evaluateExperimentRun({
        direction: 'lower',
        controlValue: 20,
        variantValue: 15,
        targetImprovement: 20,
        sampleSize: 400,
      })
    ).toMatchObject({ status: 'passed', improvement: 25 })

    expect(
      evaluateExperimentRun({
        direction: 'lower',
        controlValue: 20,
        variantValue: 14,
        targetImprovement: 20,
        sampleSize: 400,
        guardrailBreaches: 1,
      }).status
    ).toBe('blocked')
  })

  it('세 단계를 모두 통과하고 고위험 승인을 받아야 확대할 수 있다', () => {
    const passedRuns = ['historical', 'shadow', 'limited'].map((phase) => ({
      phase,
      status: 'passed',
      guardrail_breaches: 0,
    }))
    expect(canExpandExperiment({ risk_level: 'high' }, passedRuns)).toMatchObject({
      ok: false,
      needsApproval: true,
    })
    expect(
      canExpandExperiment({ risk_level: 'high', approved_at: '2026-09-03' }, passedRuns).ok
    ).toBe(true)
    expect(canExpandExperiment({ risk_level: 'low' }, passedRuns.slice(0, 2)).missing).toEqual([
      '제한 배포',
    ])
  })

  it('역할별 책임 경계를 강제한다', () => {
    expect(roleCan('reviewer', 'capture_event')).toBe(true)
    expect(roleCan('reviewer', 'decide_experiment')).toBe(false)
    expect(roleCan('policy', 'approve_experiment')).toBe(true)
  })

  it('사내 운영 모드에는 시연 데이터를 넣지 않는다', () => {
    expect(overrideDemoMode({})).toBe(true)
    expect(overrideDemoMode({ OVERRIDE_DEMO_MODE: 'false' })).toBe(false)
  })
})
