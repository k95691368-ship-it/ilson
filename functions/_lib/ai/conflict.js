// ③ 요구 충돌 판정 단계의 AI — 후보 탐지까지만 한다.
//
// 재무는 "금액이 1원도 틀리면 안 된다"고 하고, 마케팅은 "월요일 아침 전에는
// 나와야 한다"고 하고, 운영은 "내가 손댈 일이 없어야 한다"고 한다. 셋 다는 안 된다.
// 이 지점을 아무도 판정하지 않아서 자동화가 멈춘다.
//
// **그 판정이 사람의 일이다.** 그래서 이 파일의 AI는 충돌 '후보'만 올린다.
// requirement_conflict.verdict는 NULL로 저장되고, 사람이 채우기 전까지는
// 수용 기준을 확정할 수 없다(다음 단계가 잠긴다).
//
// 판정이 끝나면 draftCriteria가 수용 기준 초안을 만든다. 이것도 초안이다 —
// 사람이 confirmed_at을 찍어야 인수인계 게이트의 채점 규칙으로 내려간다.

import { callTool, wrapData, asDraft } from '../claude.js'

const CONFLICT_TOOL = {
  name: 'record_conflicts',
  description:
    '확정된 요구사항들 사이에서 동시에 만족시킬 수 없는 쌍을 찾아 후보로 올린다. 판정은 하지 않는다.',
  input_schema: {
    type: 'object',
    required: ['conflicts'],
    properties: {
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['req_a_id', 'req_b_id', 'reason', 'severity'],
          properties: {
            req_a_id: { type: 'string', description: '[요구사항 목록]에 있는 id 그대로' },
            req_b_id: { type: 'string', description: '[요구사항 목록]에 있는 id 그대로' },
            reason: {
              type: 'string',
              description:
                '왜 이 둘이 양립할 수 없는지. "둘 다 중요하다" 같은 말이 아니라, 무엇을 얻으면 무엇을 잃는지의 인과를 쓴다.',
            },
            severity: {
              type: 'string',
              enum: ['낮음', '보통', '높음'],
              description:
                '높음=판정 없이 진행하면 만든 뒤에 갈아엎어야 한다 / 보통=한쪽을 조금 양보하면 된다 / 낮음=대부분의 경우 문제되지 않는다',
            },
            tradeoff_axis: {
              type: ['string', 'null'],
              description:
                '무엇과 무엇을 맞바꾸는 것인지 한 마디로. 예: "정확도 ↔ 마감시각", "자동화율 ↔ 사람 개입".',
            },
          },
        },
      },
      note: {
        type: ['string', 'null'],
        description: '충돌이 하나도 없다면 왜 그렇게 보는지. 있으면 null.',
      },
    },
  },
}

const CONFLICT_SYSTEM = `당신은 사내 자동화 담당자가 부서 회의에서 모은 요구사항을 검토합니다.
당신의 일은 **동시에 만족시킬 수 없는 쌍을 찾아 올리는 것까지**입니다.

**어느 쪽을 택할지는 절대 결정하지 마세요.** 그것은 담당자가 부서들과의 관계와
사업 맥락을 알고 내리는 판단입니다. 당신은 무엇이 부딪히는지와 무엇을 맞바꾸는
것인지를 정확히 보여주기만 하면 됩니다.

무엇이 충돌인가:
- 한쪽을 완전히 만족시키면 다른 쪽이 반드시 나빠지는 관계여야 합니다.
- 흔한 축: 정확도 ↔ 속도 / 자동화율 ↔ 사람 개입 / 범용성 ↔ 단순함 /
  즉시성 ↔ 검증 / 상세함 ↔ 유지보수 비용
- 단지 부서가 다르다는 것은 충돌이 아닙니다. 둘 다 만족시킬 수 있으면 충돌이 아닙니다.
- 우선순위가 다른 것도 충돌이 아닙니다. 하나가 다른 하나를 불가능하게 만들어야 합니다.

규칙:
1. req_a_id와 req_b_id는 [요구사항 목록]에 실제로 있는 id를 그대로 쓰세요.
   목록에 없는 id를 만들면 그 항목은 버려집니다.
2. reason에는 인과를 쓰세요. "A를 지키면 B가 왜 불가능해지는가"가 문장에 있어야 합니다.
3. 억지로 찾지 마세요. 충돌이 없으면 빈 배열과 note를 주세요. 없는 충돌을 만들면
   담당자가 쓸데없는 판정을 하게 되고, 진짜 충돌이 묻힙니다.
4. severity는 "판정을 미뤘을 때 나중에 얼마나 비싼가"로 매기세요.
5. 모든 출력은 한국어로 작성하세요.`

export async function detectConflicts(env, { requirements }) {
  const compact = requirements.map((r) => ({
    id: r.id,
    kind: r.kind,
    dept: r.dept,
    body: r.decided_body || r.body,
    priority: r.priority,
    measurable: r.measurable ?? null,
  }))

  const { input, usage } = await callTool(env, {
    system: CONFLICT_SYSTEM,
    user: wrapData('요구사항 목록', compact),
    tool: CONFLICT_TOOL,
    maxTokens: 2048,
    isEmpty: null, // 충돌 0건은 정상적인 결과다. 재시도하면 없는 충돌을 지어낸다.
  })

  // 존재하지 않는 id를 가리키는 후보는 버린다. 화면에서 링크가 깨지고,
  // 무엇보다 모델이 요구사항을 새로 지어낸 흔적이기 때문이다.
  const valid = new Set(compact.map((r) => r.id))
  const conflicts = (input.conflicts || []).filter(
    (c) => valid.has(c.req_a_id) && valid.has(c.req_b_id) && c.req_a_id !== c.req_b_id
  )

  return asDraft({ ...input, conflicts, dropped: (input.conflicts || []).length - conflicts.length }, usage)
}

const CRITERIA_TOOL = {
  name: 'record_acceptance_criteria',
  description:
    '확정된 요구사항과 담당자가 내린 충돌 판정을 바탕으로, 완성된 도구가 통과해야 할 합격 기준의 초안을 만든다.',
  input_schema: {
    type: 'object',
    required: ['criteria'],
    properties: {
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          required: ['body', 'check_kind', 'from'],
          properties: {
            body: {
              type: 'string',
              description:
                '통과/실패를 가를 수 있는 한 문장. "정확해야 한다"가 아니라 "정답 대비 금액 오차가 0원이어야 한다"처럼 쓴다.',
            },
            check_kind: {
              type: 'string',
              enum: ['rule', 'judge', 'human'],
              description:
                'rule=코드로 자동 판정 가능 / judge=문장 품질이라 LLM 심판이 필요 / human=사람이 직접 봐야 한다',
            },
            check_hint: {
              type: ['string', 'null'],
              description:
                'rule일 때, 무엇을 무엇과 비교하면 되는지. 예: "산출 합계 = ground_truth.agg_by_channel의 net_revenue_krw"',
            },
            from: {
              type: 'string',
              description: '이 기준의 출처가 된 요구사항 id 또는 충돌 판정 id. [입력]에 있는 값 그대로.',
            },
            is_required_safety: {
              type: 'boolean',
              description:
                '이것이 깨지면 다른 점수가 아무리 좋아도 인수인계를 막아야 하는 기준이면 true. 남발하지 않는다.',
            },
          },
        },
      },
      not_covered: {
        type: 'array',
        items: { type: 'string' },
        description:
          '요구사항 중 합격 기준으로 옮기지 못한 것과 그 이유. 판정 가능한 형태로 바꿀 수 없는 것들. 없으면 빈 배열.',
      },
    },
  },
}

const CRITERIA_SYSTEM = `당신은 확정된 요구사항을 "완성된 도구가 통과해야 할 합격 기준"으로 옮깁니다.
이 기준은 나중에 인수인계 게이트에서 그대로 채점에 쓰입니다.

규칙:
1. 판정할 수 없는 문장을 만들지 마세요. "쓰기 편해야 한다"는 기준이 될 수 없습니다.
   그런 요구는 criteria에 넣지 말고 not_covered에 이유와 함께 적으세요.
   **옮기지 못한 것을 옮긴 척하는 것이 가장 나쁩니다.**
2. check_kind를 정확히 고르세요.
   - rule: 숫자·개수·형식처럼 코드가 판정할 수 있는 것. 되도록 이것을 많이 만드세요.
   - judge: "설명이 근거에 충실한가"처럼 문장 품질을 봐야 하는 것.
   - human: 사람이 직접 눈으로 봐야 하는 것. 자동화할 수 없으니 최소로.
3. is_required_safety는 아껴 쓰세요. 이것이 붙은 기준은 하나만 깨져도 인수인계가
   막힙니다. 금액 정확성, 개인정보 유출, 통화 미변환처럼 "틀리면 돌이킬 수 없는 것"에만
   붙이세요. 전부 필수로 만들면 필수의 뜻이 없어집니다.
4. [충돌 판정]에서 담당자가 내린 결정을 반드시 반영하세요. 담당자가 "정확도 우선,
   마감은 화요일로 미룬다"고 판정했으면 기준도 그렇게 써야 합니다. 판정을 뒤집지 마세요.
5. from에는 [입력]에 실제로 있는 id를 쓰세요.
6. 이 결과는 초안입니다. 담당자가 확정해야 채점에 쓰입니다.
7. 모든 출력은 한국어로 작성하세요.`

export async function draftCriteria(env, { requirements, conflicts }) {
  const payload = {
    요구사항: requirements.map((r) => ({
      id: r.id,
      kind: r.kind,
      dept: r.dept,
      body: r.decided_body || r.body,
      priority: r.priority,
      measurable: r.measurable ?? null,
    })),
    충돌_판정: conflicts.map((c) => ({
      id: c.id,
      a: c.req_a_id,
      b: c.req_b_id,
      담당자_판정: c.verdict,
      판정_근거: c.verdict_reason,
      맞바꾼_것: c.tradeoff_note ?? null,
    })),
  }

  const { input, usage } = await callTool(env, {
    system: CRITERIA_SYSTEM,
    user: wrapData('입력', payload),
    tool: CRITERIA_TOOL,
    maxTokens: 3072,
    isEmpty: (r) => !Array.isArray(r.criteria) || r.criteria.length === 0,
  })
  return asDraft(input, usage)
}
