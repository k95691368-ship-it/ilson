// ① 접수 단계의 AI — 분류 초안과 가능/불가 판정.
//
// 두 가지를 한다.
//   triageRequest  : 불평 한 줄을 부서·업무유형·빈도 추정으로 정리한다(초안).
//   judgeFeasibility: 이 요청을 블록 8종으로 만들 수 있는지 판정한다.
//
// 두 번째가 이 제품의 신뢰를 만드는 지점이다. "무엇이든 만들어 드립니다"는
// 지킬 수 없는 약속이고, 못 만드는 것을 3초 안에 이유와 대안과 함께 말할 수
// 있어야 나머지 약속이 믿긴다. 그래서 이 판정의 정확도 자체를 골든셋에 넣는다
// (kind='refusal').
//
// 어느 쪽도 확정하지 않는다. triage는 사람이 우선순위를 정할 때 참고하는 초안이고,
// feasibility는 사람이 착수/거절을 누르기 전에 보는 근거다.

import { callTool, wrapData, asDraft } from '../claude.js'
import { scopeBrief, OUT_OF_SCOPE_CODES } from '../blockTypes.js'

export const DEPTS = ['재무', '마케팅', '영업', 'SCM', '운영', '인사', '기타']

const TRIAGE_TOOL = {
  name: 'record_intake_triage',
  description:
    '현업이 남긴 요청 한 줄을 읽고, 어느 부서의 어떤 업무인지와 얼마나 자주 반복되는지를 추정해 기록한다.',
  input_schema: {
    type: 'object',
    required: ['dept', 'job_kind', 'summary', 'evidence', 'confidence'],
    properties: {
      dept: {
        type: 'string',
        enum: DEPTS,
        description: '이 업무를 하는 부서. 문장에서 단서를 찾을 수 없으면 "기타".',
      },
      job_kind: {
        type: 'string',
        description: '업무 유형을 짧은 한국어 명사구로. 예: "다채널 정산서 취합", "주간 실적 보고서 작성"',
      },
      summary: { type: 'string', description: '이 요청이 무엇인지 한 문장으로. 원문에 없는 사실을 더하지 않는다.' },
      evidence: {
        type: 'string',
        description: '위 판단의 근거가 된 원문 구절을 그대로 인용. 인용할 구절이 없으면 빈 문자열.',
      },
      est_frequency: {
        type: ['string', 'null'],
        description: '원문에 반복 주기가 언급된 경우에만 채운다. 예: "매주", "매월 초". 없으면 null.',
      },
      est_minutes_per_run: {
        type: ['number', 'null'],
        description: '원문에 1회 소요 시간이 언급된 경우에만 채운다(분). 없으면 null. 추측하지 않는다.',
      },
      confidence: { type: 'number', description: '0.0~1.0. 문장이 짧고 모호하면 낮게 준다.' },
    },
  },
}

const TRIAGE_SYSTEM = `당신은 사내 자동화 담당자를 돕는 접수 보조입니다.

규칙:
1. [요청 문장]에 실제로 쓰인 내용만 근거로 삼으세요. 없는 사실을 추정해 채우지 마세요.
2. est_frequency와 est_minutes_per_run은 원문에 명시되었을 때만 채웁니다. "아마 주 1회일 것"
   같은 추측은 금지입니다. 모르면 null입니다.
3. evidence에는 판단 근거가 된 원문 구절을 그대로 옮기세요. 요약하거나 다듬지 마세요.
4. 이 결과는 초안입니다. 담당자가 보고 고칠 것을 전제로, 확신이 낮으면 confidence를 낮게 주세요.
5. 모든 출력은 한국어로 작성하세요.`

export async function triageRequest(env, bodyText) {
  const { input, usage } = await callTool(env, {
    system: TRIAGE_SYSTEM,
    user: wrapData('요청 문장', bodyText),
    tool: TRIAGE_TOOL,
    maxTokens: 1024,
    isEmpty: (r) => !r.summary,
  })
  return asDraft(input, usage)
}

const FEASIBILITY_TOOL = {
  name: 'record_feasibility',
  description:
    '이 요청을 주어진 블록 8종의 조합으로 만들 수 있는지 판정하고, 만들 수 없으면 그 이유와 대안을 기록한다.',
  input_schema: {
    type: 'object',
    required: ['feasible', 'reason', 'confidence'],
    properties: {
      feasible: {
        type: 'boolean',
        description: '블록 8종의 조합만으로 이 요청의 산출물을 만들 수 있으면 true.',
      },
      reason: { type: 'string', description: '판정 이유 한두 문장. 어떤 블록이 필요한지 또는 왜 없는지.' },
      needed_blocks: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['ingest', 'map', 'normalize', 'extract', 'join', 'compute', 'check', 'emit'],
        },
        description: 'feasible이 true일 때, 필요할 것으로 보이는 블록 타입들. 순서대로.',
      },
      blocked_by: {
        type: ['string', 'null'],
        enum: [...OUT_OF_SCOPE_CODES, null],
        description: 'feasible이 false일 때, 막힌 사유 코드. true면 null.',
      },
      alternative: {
        type: ['string', 'null'],
        description:
          'feasible이 false일 때, 이 시스템이 대신 해 줄 수 있는 것. "결과 파일까지는 만들고 등록은 사람이 한다"처럼 구체적으로. 대안이 없으면 그렇다고 쓴다.',
      },
      partial_note: {
        type: ['string', 'null'],
        description:
          '요청의 일부만 가능한 경우, 어디까지 가능하고 어디부터 불가능한지. 해당 없으면 null.',
      },
      confidence: { type: 'number', description: '0.0~1.0' },
    },
  },
}

const FEASIBILITY_SYSTEM = `당신은 사내 자동화 시스템의 접수 판정기입니다. 이 시스템이 무엇을 만들 수 있고
무엇을 만들 수 없는지는 아래에 정확히 정해져 있습니다.

${scopeBrief()}

규칙:
1. 위 블록 8종의 조합만으로 요청한 산출물을 만들 수 있으면 feasible=true입니다.
   "조금 무리하면 될 것 같다"는 true가 아닙니다. 블록으로 표현되지 않으면 false입니다.
2. false일 때 blocked_by는 [만들 수 없는 것] 목록의 코드 중에서만 고르세요.
3. false일 때 alternative는 반드시 이 시스템이 실제로 할 수 있는 범위 안에서 쓰세요.
   할 수 없는 것을 대안으로 제시하면 거절의 의미가 없어집니다. 대안이 정말 없으면
   "이 요청은 다른 도구로 가야 합니다"라고 쓰세요.
4. 요청의 앞부분은 가능한데 뒷부분이 불가능한 경우가 가장 흔합니다(예: 표를 만드는 것은
   가능하지만 그것을 시스템에 등록하는 것은 불가능). 이때는 feasible=false로 두고
   partial_note에 경계를 정확히 적으세요. 절반만 되는 것을 된다고 하면 안 됩니다.
5. 자료를 아직 아무도 만들고 있지 않은 일(입력 자체가 없는 일)은 unstructured_only입니다.
6. 이 판정은 담당자가 착수·거절을 결정하기 전에 보는 근거입니다. 당신이 결정하는 것이
   아니므로, 애매하면 confidence를 낮추고 이유를 자세히 쓰세요.
7. 모든 출력은 한국어로 작성하세요.`

export async function judgeFeasibility(env, { bodyText, fileProfiles = [] }) {
  const parts = [wrapData('요청 문장', bodyText)]
  if (fileProfiles.length > 0) {
    parts.push(wrapData('함께 올라온 파일의 구조', fileProfiles))
  }

  const { input, usage } = await callTool(env, {
    system: FEASIBILITY_SYSTEM,
    user: parts.join('\n\n'),
    tool: FEASIBILITY_TOOL,
    maxTokens: 1024,
    isEmpty: (r) => typeof r.feasible !== 'boolean' || !r.reason,
  })

  // 모델이 false를 주면서 코드를 빠뜨리는 경우가 있다. 화면은 코드로 문구를
  // 고르므로, 비어 있으면 판정 자체를 신뢰하지 않고 사람에게 넘긴다.
  if (input.feasible === false && !OUT_OF_SCOPE_CODES.includes(input.blocked_by)) {
    input.blocked_by = null
    input.needs_human = true
  }
  return asDraft(input, usage)
}
