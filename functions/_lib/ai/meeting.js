// ② 발굴 회의 단계의 AI — 질문지 초안과 회의록에서 요구 추출.
//
// 이 단계가 이 포트폴리오의 중심이다. 자동화가 실패하는 가장 흔한 이유는 코드가
// 어려워서가 아니라 "무엇을 만들어야 하는지"를 아무도 부서에 제대로 묻지 않아서다.
// 그래서 여기서 AI가 하는 일은 딱 두 가지다.
//
//   draftQuestions   : 이 업무 유형에서 반드시 물어야 할 것을 질문지로 뽑는다.
//   extractFromMinutes: 회의록에서 요구·제약·미결·가정을 뽑되, 원문 인용을 반드시 붙인다.
//
// 회의는 사람이 한다. 질문을 고르는 것도, 답을 듣는 것도, 뽑힌 항목을 채택할지
// 기각할지도 사람이 한다. AI가 뽑은 항목은 status='초안'으로 저장되고, 사람이
// 승인하기 전까지는 다음 단계(충돌 판정 → 수용 기준)로 내려가지 못한다.
//
// quote를 스키마상 필수로 둔 것이 이 파일의 핵심 설계다. 근거 문장을 못 붙이면
// 항목을 만들 수 없으므로, 회의록에 없던 요구가 지어져 나오는 일이 구조적으로
// 어려워진다. (완전히 막지는 못한다 — 그래서 화면에서 인용을 항상 함께 보여주고,
// 담당자가 회의록과 대조해 기각할 수 있게 한다.)

import { callTool, wrapData, asDraft } from '../claude.js'
import { DEPTS } from './intake.js'

const QUESTIONS_TOOL = {
  name: 'record_meeting_questions',
  description:
    '자동화 대상 업무를 파악하기 위해 현업 부서에 물어야 할 질문지를 만든다. 담당자가 회의에서 실제로 쓸 목록이다.',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 5,
        maxItems: 9,
        items: {
          type: 'object',
          required: ['question', 'why_ask'],
          properties: {
            question: {
              type: 'string',
              description: '현업에게 그대로 읽어 줄 수 있는 한 문장. 전문용어를 쓰지 않는다.',
            },
            why_ask: {
              type: 'string',
              description:
                '이 질문의 답이 설계의 무엇을 결정하는지. "그냥 궁금해서"는 안 된다. 예: "예외 비율이 5%를 넘으면 검토함 UI가 본체가 되므로 화면 구성이 달라진다"',
            },
            target_dept: {
              type: ['string', 'null'],
              enum: [...DEPTS, null],
              description: '특히 이 부서에 물어야 하는 질문이면 부서명. 모두에게 물을 것이면 null.',
            },
          },
        },
      },
    },
  },
}

// 여기 적힌 다섯 축은 실무에서 빠뜨리면 반드시 나중에 터지는 것들이다.
// 모델이 매번 "이 업무 자주 하시나요?" 같은 무해하고 쓸모없는 질문을 내지 않도록
// 무엇을 결정하는 질문이어야 하는지를 못 박는다.
const QUESTIONS_SYSTEM = `당신은 사내 자동화 담당자가 현업 부서와 여는 첫 회의를 준비하도록 돕습니다.
질문지 초안을 만드는 것이 당신의 일이고, 회의를 진행하는 것은 담당자입니다.

좋은 질문은 설계의 무언가를 결정합니다. 아래 다섯 축을 반드시 덮으세요.

1. 입력 — 이 일의 재료가 어디서 어떤 형태로 오는가. 매번 같은 양식인가, 누가 보내는가.
2. 판단 — 그 자료를 받아서 사람이 무슨 결정을 하는가. 이 산출물을 누가 보고 무엇을 하는가.
3. 오류 — 틀렸을 때 누가 언제 어떻게 알아채는가. 틀린 채로 지나가면 무슨 일이 생기는가.
4. 예외 — 규칙에서 벗어나는 건이 몇 %쯤 되는가. 그럴 때 지금은 어떻게 처리하는가.
5. 현재 비용 — 지금 몇 명이 몇 분을 쓰는가. 언제 하는가(마감이 있는가).

규칙:
1. 현업이 그대로 들었을 때 이해되는 한국어로 쓰세요. "스키마", "정규화", "파이프라인" 같은
   말을 쓰면 안 됩니다.
2. 예/아니오로 끝나는 질문을 피하세요. 답이 설계를 바꾸지 못합니다.
3. why_ask에는 이 답이 무엇을 결정하는지를 구체적으로 쓰세요. 담당자가 회의에서
   "왜 그걸 물어보세요?"라는 되물음을 받았을 때 답할 수 있어야 합니다.
4. [업무 정보]에 이미 답이 나와 있는 것은 다시 묻지 마세요.
5. 5개에서 9개 사이로 만드세요. 한 시간 회의에서 실제로 다 물을 수 있는 양이어야 합니다.
6. 모든 출력은 한국어로 작성하세요.`

export async function draftQuestions(env, { bodyText, jobKind, dept, stakeholders = [], previousUnasked = [] }) {
  const parts = [wrapData('업무 정보', { 요청문장: bodyText, 업무유형: jobKind, 부서: dept })]
  if (stakeholders.length > 0) {
    parts.push(wrapData('이해관계자', stakeholders))
  }
  if (previousUnasked.length > 0) {
    // 지난 회의에서 물어야 했는데 못 물은 질문은 다음 회의 질문지의 1순위다.
    parts.push(wrapData('지난 회의에서 묻지 못한 질문', previousUnasked))
  }

  const { input, usage } = await callTool(env, {
    system: QUESTIONS_SYSTEM,
    user: parts.join('\n\n'),
    tool: QUESTIONS_TOOL,
    maxTokens: 2048,
    isEmpty: (r) => !Array.isArray(r.questions) || r.questions.length === 0,
  })
  return asDraft(input, usage)
}

const REQUIREMENTS_TOOL = {
  name: 'record_requirements',
  description:
    '회의록을 읽고 그 자리에서 실제로 오간 요구·제약·미결사항·가정을 항목으로 정리한다. 각 항목에는 회의록 원문 인용이 반드시 붙는다.',
  input_schema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'dept', 'body', 'quote', 'priority'],
          properties: {
            kind: {
              type: 'string',
              enum: ['요구', '제약', '미결', '가정'],
              description:
                '요구=해달라는 것 / 제약=지켜야 하는 한계 / 미결=아직 정해지지 않은 것 / 가정=확인 없이 전제하고 있는 것',
            },
            dept: {
              type: 'string',
              enum: DEPTS,
              description: '이 말을 한 쪽의 부서. 회의록에서 화자를 특정할 수 없으면 "기타".',
            },
            body: {
              type: 'string',
              description:
                '항목 내용을 한 문장으로. 회의록의 말을 그대로 옮기지 말고, 설계에 쓸 수 있는 형태로 정리한다.',
            },
            quote: {
              type: 'string',
              description:
                '이 항목의 근거가 된 회의록 원문을 그대로 인용. 반드시 회의록에 실제로 있는 문자열이어야 한다. 요약하거나 다듬지 않는다.',
            },
            priority: {
              type: 'string',
              enum: ['필수', '보통', '있으면좋음'],
              description:
                '회의에서 표현된 강도를 반영한다. "이건 안 되면 못 씁니다"는 필수, "되면 좋고요"는 있으면좋음.',
            },
            measurable: {
              type: ['string', 'null'],
              description:
                '이 요구를 나중에 통과/실패로 판정할 수 있는 형태로 바꿀 수 있으면 그 기준. 예: "금액 오차 0원", "월요일 09시 이전 산출". 판정 기준으로 만들 수 없으면 null.',
            },
          },
        },
      },
      unclear_points: {
        type: 'array',
        items: { type: 'string' },
        description:
          '회의록만으로는 뜻을 확정할 수 없어 담당자가 다시 확인해야 하는 대목. 없으면 빈 배열.',
      },
    },
  },
}

const REQUIREMENTS_SYSTEM = `당신은 사내 자동화 담당자가 쓴 회의록을 읽고, 그 자리에서 오간 요구사항을
정리하는 보조입니다.

가장 중요한 규칙: **회의록에 없는 것을 만들지 마세요.**

1. 모든 항목에는 quote가 필요합니다. quote는 [회의록]에 실제로 존재하는 문자열을
   그대로 옮긴 것이어야 합니다. 근거 문장을 찾을 수 없다면 그 항목은 만들지 마세요.
   "보통 이런 업무는 이런 요구가 있다"는 추론으로 항목을 채우면 안 됩니다.
2. body는 quote를 그대로 반복하는 것이 아니라, 설계에 쓸 수 있게 정리한 한 문장입니다.
   대화체("그거 좀 빨리 되면 좋겠는데")를 그대로 두지 말고 뜻을 명확히 하세요.
3. kind를 정확히 가르세요.
   - 요구: 해달라는 것. "주간 단위로 채널별로 볼 수 있으면 좋겠어요"
   - 제약: 지켜야 하는 한계. "금액이 1원이라도 틀리면 안 됩니다"
   - 미결: 아직 정해지지 않은 것. "그건 팀장님께 여쭤봐야 할 것 같은데요"
   - 가정: 확인 없이 전제되고 있는 것. "정산서 양식은 안 바뀌니까요" (실제로 안 바뀌는지 확인되지 않음)
   가정을 찾아내는 것이 특히 중요합니다. 나중에 깨지는 것은 대개 가정입니다.
4. measurable은 판정 가능한 형태로 바꿀 수 있을 때만 채우세요. "쓰기 편했으면 좋겠다"는
   판정 기준이 될 수 없으므로 null입니다.
5. 서로 부딪히는 요구가 보여도 여기서 조정하지 마세요. 둘 다 각각의 항목으로 남기세요.
   조정은 담당자가 다음 단계에서 합니다.
6. 이 결과는 초안입니다. 담당자가 항목마다 채택·수정·기각을 결정합니다.
7. 모든 출력은 한국어로 작성하세요.`

export async function extractFromMinutes(env, { minutesText, jobKind, questions = [] }) {
  const parts = [wrapData('회의록', minutesText)]
  if (jobKind) parts.push(wrapData('업무 유형', jobKind))
  if (questions.length > 0) {
    parts.push(wrapData('이 회의에서 물으려 했던 질문', questions))
  }

  const { input, usage } = await callTool(env, {
    system: REQUIREMENTS_SYSTEM,
    user: parts.join('\n\n'),
    tool: REQUIREMENTS_TOOL,
    maxTokens: 4096,
    isEmpty: (r) => !Array.isArray(r.items) || r.items.length === 0,
  })

  // 인용이 회의록에 실제로 없으면 그 항목은 근거가 없는 것이다. 버리지 않고
  // 표시만 해서 담당자에게 보낸다 — 조용히 지우면 무엇이 걸러졌는지 알 수 없고,
  // 그대로 두면 지어낸 요구가 설계로 흘러간다.
  const haystack = normalizeForMatch(minutesText)
  const items = (input.items || []).map((item) => ({
    ...item,
    quote_verified: haystack.includes(normalizeForMatch(item.quote || '')),
  }))

  return asDraft({ ...input, items }, usage)
}

// 인용 대조용 정규화. 모델이 공백·줄바꿈·따옴표를 조금 다듬어 오는 것까지
// 근거 없음으로 몰면 멀쩡한 항목이 전부 미검증으로 뜬다. 눈으로 같은 문장이면
// 같은 것으로 본다.
function normalizeForMatch(text) {
  return String(text ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/["'“”‘’]/g, '')
    .toLowerCase()
}
