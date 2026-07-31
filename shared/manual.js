// 사용법서에서 **기계가 아는 부분**을 만든다.
//
// 사용법서가 쓸모없어지는 가장 흔한 이유는 낡아서다. 코드는 바뀌었는데 문서는
// 그대로라, 담당자가 문서대로 했는데 안 되는 상황이 온다. 그러면 그다음부터는
// 아무도 문서를 안 본다.
//
// 그래서 받는 파일 형식, 처리 단계, 검토함에 뜨는 이유는 문서에 손으로 적지
// 않는다. 실제로 도는 코드와 **같은 곳**에서 뽑아 온다. 규칙이 바뀌면 문서도
// 같이 바뀐다.
//
// 사람이 써야 하는 것은 따로 있다 — 언제 돌리는지, 결과를 누구에게 주는지,
// 막혔을 때 누구에게 연락하는지. 그건 코드가 알 수 없다.

import { CHANNEL_RULES_PUBLIC, QUARANTINE_REASONS } from './pipeline.js'
import { FX, PERIOD, CHANNELS, SKUS } from './master.js'

// 이 도구가 받는 파일. 코드의 채널 인식 규칙에서 그대로 뽑는다.
export function inputSpec() {
  return CHANNEL_RULES_PUBLIC.map((r) => ({
    channel: r.channel,
    tellBy: r.mustHave,
    columns: r.columns,
    currency: CHANNELS.find((c) => c.name === r.channel)?.currency ?? 'KRW',
  }))
}

// 파일이 어떤 단계를 거치는지. 화면의 되짚기에 나오는 단계와 같은 순서다.
export const PROCESS_STEPS = [
  {
    title: '파일 읽기',
    body: '엑셀은 시트를 모두 훑고, 제목이 병합된 줄을 지나 진짜 머리글을 찾습니다. CSV는 글자 코드를 판별합니다(UTF-8이 아니면 CP949로 다시 읽습니다).',
  },
  {
    title: '어느 채널인지 알아보기',
    body: '파일 이름이 아니라 머리글에 무엇이 있는지로 판단합니다. 이름을 바꿔 저장해도 상관없습니다. 대신 양식이 바뀌면 알아보지 못하고 물어봅니다.',
  },
  {
    title: '컬럼 맞추기',
    body: '채널마다 다른 컬럼 이름을 표준 이름으로 맞춥니다.',
  },
  {
    title: '상품코드 통일',
    body: '채널마다 다른 상품코드를 우리 코드로 바꿉니다. 모르는 코드는 처리하지 않고 검토함으로 뺍니다.',
  },
  {
    title: '값 정리',
    body: '통화기호와 천 단위 쉼표를 떼고, 날짜 모양을 통일하고, 반품(음수)을 매출과 나눕니다.',
  },
  {
    title: '통화 환산',
    body: `외화를 원화로 바꿉니다. ${Object.entries(FX)
      .filter(([k]) => k !== 'KRW')
      .map(([k, v]) => `${k} ${v}원`)
      .join(', ')} 기준입니다.`,
  },
  {
    title: '계산',
    body: '순매출(총매출 − 할인 − 반품) → 수수료 → 원가 → 물류비 → 광고비 순으로 빼서 기여이익을 냅니다. 이 순서를 바꾸면 금액이 달라집니다.',
  },
  {
    title: '검산',
    body: '합계 줄, 빈 줄, 정산 대상이 아닌 달의 시트를 걸러 냅니다. 내용이 똑같은 파일을 두 번 넣으면 한 번만 셉니다.',
  },
]

// 검토함에 뜰 수 있는 이유와, 그때 무엇을 해야 하는지.
export const QUARANTINE_GUIDE = [
  {
    reason: 'unknown_sku',
    label: QUARANTINE_REASONS.unknown_sku,
    what: '우리 상품 목록에 없는 코드가 나왔습니다. 신상품이거나 기획세트인 경우가 많습니다.',
    todo: '화면에서 어느 상품인지 골라 주세요. 한 번만 알려 주면 다음부터는 자동으로 처리됩니다.',
  },
  {
    reason: 'total_row',
    label: QUARANTINE_REASONS.total_row,
    what: '파일 맨 아래 합계 줄입니다.',
    todo: '그대로 두세요. 이 줄을 넣으면 매출이 두 배가 됩니다.',
  },
  {
    reason: 'out_of_period',
    label: QUARANTINE_REASONS.out_of_period,
    what: `${PERIOD.start.slice(0, 7)} 정산인데 다른 달 시트가 들어 있습니다.`,
    todo: '그대로 두세요. 그 달 정산을 할 때 다시 넣으면 됩니다.',
  },
  {
    reason: 'unknown_channel',
    label: QUARANTINE_REASONS.unknown_channel,
    what: '머리글이 알고 있는 어느 채널과도 맞지 않습니다. 채널이 양식을 바꿨을 수 있습니다.',
    todo: '담당자에게 알려 주세요. 규칙을 손봐야 합니다. 그때까지 이 파일은 처리되지 않습니다.',
  },
  {
    reason: 'missing_columns',
    label: QUARANTINE_REASONS.missing_columns,
    what: '있어야 할 컬럼이 빠져 있습니다.',
    todo: '파일을 다시 받아 보세요. 내려받다 잘린 경우가 있습니다.',
  },
  {
    reason: 'empty_row',
    label: QUARANTINE_REASONS.empty_row,
    what: '아무것도 없는 줄입니다. 엑셀에서 CSV로 내보낼 때 자주 생깁니다.',
    todo: '그대로 두세요.',
  },
  {
    reason: 'bad_date',
    label: QUARANTINE_REASONS.bad_date,
    what: '날짜 칸을 날짜로 읽을 수 없습니다.',
    todo: '그 줄의 날짜 칸을 확인해 주세요.',
  },
  {
    reason: 'bad_amount',
    label: QUARANTINE_REASONS.bad_amount,
    what: '금액이나 수량을 숫자로 읽을 수 없습니다.',
    todo: '그 줄의 금액 칸을 확인해 주세요.',
  },
  {
    reason: 'no_sku',
    label: QUARANTINE_REASONS.no_sku,
    what: '상품코드 칸이 비어 있습니다.',
    todo: '원본 파일에서 그 줄이 무엇인지 확인해 주세요.',
  },
]

// 이 도구가 보장하지 않는 것. 처음부터 적어 두어야 나중에 다투지 않는다.
export const NOT_GUARANTEED = [
  '일자별 환율을 반영하지 않습니다. 고정 환율로 환산합니다.',
  '부분 취소와 교환은 다루지 않습니다. 전량 반품만 처리합니다.',
  '지난달 매출이 이번 달 정산서에 섞여 들어온 경우를 가려내지 못합니다.',
  '부가세(과세·면세) 구분을 하지 않습니다.',
  '세트 상품을 낱개로 나누지 않습니다. 검토함으로 뺍니다.',
  'PDF로만 오는 정산서는 읽지 못합니다.',
]

// 문서 전체에서 기계가 채우는 부분.
export function autoSections() {
  return {
    period: PERIOD,
    fx: FX,
    inputs: inputSpec(),
    steps: PROCESS_STEPS,
    quarantine: QUARANTINE_GUIDE,
    notGuaranteed: NOT_GUARANTEED,
    skuCount: SKUS.length,
    channelCount: CHANNELS.length,
    generatedNote:
      '이 부분은 실제로 도는 코드에서 그대로 뽑았습니다. 규칙이 바뀌면 이 문서도 같이 바뀝니다.',
  }
}
