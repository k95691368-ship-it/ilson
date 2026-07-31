// 이 시스템이 만들 수 있는 것의 경계.
//
// 여덟 가지뿐이다. 이 목록이 짧은 것은 능력이 모자라서가 아니라 의도한 것이다 —
// "무엇이든 만들어 드립니다"는 신입이 할 수 있는 약속이 아니고, 면접장에서
// 즉흥 요청 하나에 무너진다. 대신 "이건 못 만듭니다, 이유는 이것, 대안은 이것"을
// 3초 안에 말할 수 있으면 그게 더 신뢰를 준다.
//
// 실행은 AI가 만든 코드를 eval하는 것이 아니라 이 여덟 종만 해석하는 순수 JS
// 인터프리터가 한다(functions/_lib/blocks.js). 그래서 모델이 무엇을 내놓든
// 실제로 도는 것은 우리가 정의한 여덟 가지뿐이다.

export const BLOCK_TYPES = [
  {
    type: 'ingest',
    name_ko: '읽기',
    what: 'CSV·XLSX 파일을 읽어 행 배열로 만든다. 인코딩 자동 판별, 헤더 오프셋 탐지, 다중 시트 순회를 포함한다.',
  },
  {
    type: 'map',
    name_ko: '매핑',
    what: '원본 컬럼을 표준 필드에 붙인다. 규칙 엔진이 먼저 풀고 애매한 것만 사람에게 묻는다.',
  },
  {
    type: 'normalize',
    name_ko: '정규화',
    what: 'SKU 별칭·통화·날짜 포맷·단위·부호(반품 음수)를 표준형으로 바꾼다.',
  },
  {
    type: 'extract',
    name_ko: '추출',
    what: '문서나 자유 텍스트에서 항목을 뽑는다. 근거가 되는 원문 구간을 반드시 함께 남기고, 근거가 약하면 답하지 않고 격리한다.',
  },
  {
    type: 'join',
    name_ko: '결합',
    what: '두 표를 키로 붙인다. 키가 없는 행은 버리지 않고 격리한다.',
  },
  {
    type: 'compute',
    name_ko: '계산',
    what: '산술식으로 파생 값을 만든다. 순매출·수수료·기여이익처럼 순서가 중요한 계산을 명시적 단계로 남긴다.',
  },
  {
    type: 'check',
    name_ko: '검증',
    what: '합계 대조, 중복 판정, 임계 초과, 필수값 누락을 검사한다. 통과하지 못한 행을 격리한다.',
  },
  {
    type: 'emit',
    name_ko: '내보내기',
    what: '결과를 표·CSV·XLSX로 낸다. 적재 대상이 있으면 멱등하게 적재한다.',
  },
]

export const BLOCK_TYPE_KEYS = BLOCK_TYPES.map((b) => b.type)

// 블록 여덟 종으로 표현할 수 없는 것들. 거절 판정의 근거 목록이며,
// 거절 카드의 reason_code가 여기서 온다.
export const OUT_OF_SCOPE = [
  {
    code: 'external_write',
    label: '외부 시스템에 쓰기',
    detail: 'ERP·그룹웨어·메신저·메일에 등록하거나 발송하는 일. 이 시스템에는 write 계열 블록이 없다.',
    alternative: '결과 파일을 만들어 드리고 업로드·발송은 사람이 한다.',
  },
  {
    code: 'auth_crawl',
    label: '로그인이 필요한 수집',
    detail: '계정으로 로그인해야 보이는 페이지를 긁는 일. 자격증명 보관과 차단 대응이 별도 문제다.',
    alternative: '해당 화면에서 내려받은 파일을 올리면 그 다음부터 자동으로 처리한다.',
  },
  {
    code: 'realtime',
    label: '실시간 감시·구독',
    detail: '값이 바뀌는 즉시 반응해야 하는 일. 이 시스템은 사람이 파일을 올릴 때 도는 배치다.',
    alternative: '정해진 주기로 확인하고, 임계를 넘으면 성과 화면에 액션 카드로 띄운다.',
  },
  {
    code: 'human_judgment',
    label: '사람의 판단이 본체인 일',
    detail: '협상, 품평, 채용 결정처럼 결과의 책임이 판단 자체에 있는 일.',
    alternative: '판단에 필요한 자료를 한 장으로 정리해 드린다. 결정은 사람이 한다.',
  },
  {
    code: 'media_gen',
    label: '이미지·영상 제작',
    detail: '시안이나 영상 산출물을 만드는 일. 이 시스템은 표와 문서를 다룬다.',
    alternative: '없다. 이 요청은 다른 도구로 가야 한다.',
  },
  {
    code: 'unstructured_only',
    label: '입력이 아직 없는 일',
    detail: '자동화할 대상 파일이나 문서가 아직 존재하지 않는 일. 만들 근거가 없다.',
    alternative: '먼저 그 자료가 어디서 어떤 형태로 생기는지부터 회의로 정한다.',
  },
]

export const OUT_OF_SCOPE_CODES = OUT_OF_SCOPE.map((o) => o.code)

// 프롬프트에 넣을 요약. 모델이 매번 같은 경계를 보게 한다.
export function scopeBrief() {
  const can = BLOCK_TYPES.map((b) => `- ${b.type}(${b.name_ko}): ${b.what}`).join('\n')
  const cannot = OUT_OF_SCOPE.map((o) => `- ${o.code}(${o.label}): ${o.detail}`).join('\n')
  return `[만들 수 있는 것 — 블록 8종]\n${can}\n\n[만들 수 없는 것]\n${cannot}`
}
