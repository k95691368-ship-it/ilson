// 2단계 검토를 돕는 AI. 초안만 낸다.
//
// 한 번의 호출로 네 가지를 받는다 — 요약, 만들 수 있는지, 점수 제안, 겹치는
// 신청서 후보. 넷을 따로 부르면 비용도 지연도 네 배가 되는데, 담당자가 한
// 화면에서 함께 보는 것들이라 나눌 이유가 없다.
//
// 이 결과는 review_ai_draft에 들어가고 review 본체에는 절대 쓰이지 않는다.
// 담당자가 화면에서 "이 값 가져오기"를 눌러야 폼에 채워지고, 그마저도 그대로
// 저장되는 게 아니라 담당자가 고쳐서 낸다.

import { callTool, wrapData, asDraft } from '../claude.js'
import { scopeBrief, OUT_OF_SCOPE_CODES } from '../../../shared/blockTypes.js'
import { IMPACT_SCALE, DIFFICULTY_SCALE } from '../../../shared/review.js'

const TOOL = {
  name: 'record_review_draft',
  description:
    '접수된 신청서를 읽고 검토 담당자가 판단하는 데 필요한 초안을 만든다. 판정을 대신하지는 않는다.',
  input_schema: {
    type: 'object',
    required: ['summary', 'feasible', 'feasible_reason', 'suggested_impact', 'suggested_difficulty', 'confidence'],
    properties: {
      summary: {
        type: 'string',
        description:
          '이 신청이 무엇인지 2~3문장. 신청서에 적힌 내용만 쓴다. 없는 사실을 채우지 않는다.',
      },
      feasible: {
        type: 'boolean',
        description: '이 시스템이 만들 수 있는 종류의 일이면 true.',
      },
      feasible_reason: {
        type: 'string',
        description: '그렇게 본 이유 한두 문장.',
      },
      blocked_by: {
        type: ['string', 'null'],
        enum: [...OUT_OF_SCOPE_CODES, 'other', null],
        description: 'feasible이 false일 때 무엇이 막는지. true면 null.',
      },
      suggested_alternative: {
        type: ['string', 'null'],
        description:
          'feasible이 false일 때, 이 시스템이 대신 할 수 있는 것. 할 수 없는 것을 대안으로 적으면 안 된다.',
      },
      partial_note: {
        type: ['string', 'null'],
        description:
          '앞부분은 가능한데 뒷부분이 불가능한 경우 그 경계. 이 경우가 가장 흔하다. 해당 없으면 null.',
      },
      suggested_impact: {
        type: 'number',
        description: '1~5. 아래 척도를 그대로 쓴다.',
      },
      suggested_impact_reason: { type: 'string' },
      suggested_difficulty: {
        type: 'number',
        description: '1~5. 아래 척도를 그대로 쓴다.',
      },
      suggested_difficulty_reason: { type: 'string' },
      similar_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          '[다른 신청서]에 있는 id 중 같은 병목을 가리키는 것. 부서만 다르고 실은 같은 일인 경우가 흔하다. 없으면 빈 배열.',
      },
      missing_info: {
        type: 'array',
        items: { type: 'string' },
        description:
          '판단하려면 더 알아야 하는데 신청서에 없는 것. 담당자가 부서에 되물을 목록이 된다.',
      },
      confidence: { type: 'number', description: '0.0~1.0' },
    },
  },
}

const SYSTEM = `당신은 사내 자동화 담당자가 접수된 신청서를 검토하는 것을 돕습니다.
**판정은 당신이 하지 않습니다.** 담당자가 수용·반려·보류를 정하고, 당신은 그가
판단하는 데 필요한 재료만 정리합니다.

${scopeBrief()}

임팩트 척도 (suggested_impact):
${IMPACT_SCALE.map((s) => `${s.score} = ${s.label} — ${s.detail}`).join('\n')}

난이도 척도 (suggested_difficulty):
${DIFFICULTY_SCALE.map((s) => `${s.score} = ${s.label} — ${s.detail}`).join('\n')}

규칙:
1. [신청서]에 실제로 적힌 내용만 근거로 삼으세요. 없는 사실을 추정해 채우지 마세요.
   특히 소요 시간이나 빈도를 신청자가 안 적었으면 지어내지 마세요.
2. feasible은 "조금 무리하면 될 것 같다"가 아닙니다. 위 블록으로 표현되지 않으면 false입니다.
3. 요청의 앞부분은 가능한데 뒷부분이 불가능한 경우가 가장 흔합니다(예: 표를 만드는 것은
   가능하지만 그것을 다른 시스템에 등록하는 것은 불가능). 이때는 feasible=false로 두고
   partial_note에 경계를 정확히 적으세요. 절반만 되는 것을 된다고 하면 안 됩니다.
4. suggested_alternative는 반드시 이 시스템이 실제로 할 수 있는 범위 안에서 쓰세요.
   할 수 없는 것을 대안으로 제시하면 거절의 의미가 없어집니다.
5. 점수는 척도의 말에 맞춰 고르고, 이유에는 신청서의 어느 대목 때문인지를 적으세요.
   "틀리면 무슨 일이 생기나요" 칸의 답이 임팩트 판단의 가장 큰 근거입니다.
6. missing_info에는 담당자가 부서에 되물어야 할 것을 적으세요. 신청서만으로 판단이
   어려우면 그걸 감추지 말고 여기 적고 confidence를 낮추세요.
7. 모든 출력은 한국어로 작성하세요.`

export async function draftReview(env, { application, others = [] }) {
  const payload = {
    부서: application.dept,
    신청자: application.applicant_label,
    제목: application.title,
    무엇이_병목인가: application.bottleneck,
    지금_무슨_일이_생기나: application.problem,
    바라는_해결: application.wish,
    틀리면_생기는_일: application.impact_if_wrong,
    현재_소요: {
      한번에_분: application.current_minutes,
      인원: application.current_people,
      주기: application.current_frequency,
      비고: '신청자의 체감값이며 실측이 아니다',
    },
    첨부파일: application.file_names ?? [],
  }

  const parts = [wrapData('신청서', payload)]
  if (others.length > 0) {
    parts.push(
      wrapData(
        '다른 신청서',
        others.map((o) => ({ id: o.id, dept: o.dept, title: o.title, status: o.status }))
      )
    )
  }

  const { input, usage } = await callTool(env, {
    system: SYSTEM,
    user: parts.join('\n\n'),
    tool: TOOL,
    maxTokens: 2048,
    isEmpty: (r) => !r.summary || typeof r.feasible !== 'boolean',
  })

  // 존재하지 않는 id를 가리키는 후보는 버린다. 화면에서 링크가 깨지고,
  // 무엇보다 모델이 신청서를 새로 지어낸 흔적이기 때문이다.
  const valid = new Set(others.map((o) => o.id))
  const similar = (input.similar_ids || []).filter((sid) => valid.has(sid))

  // false인데 코드가 없으면 판정을 신뢰하지 않는다. 화면이 코드로 문구를
  // 고르므로, 비어 있으면 담당자에게 그대로 넘긴다.
  if (input.feasible === false && !input.blocked_by) {
    input.blocked_by = 'other'
  }

  return asDraft({ ...input, similar_ids: similar }, usage)
}
