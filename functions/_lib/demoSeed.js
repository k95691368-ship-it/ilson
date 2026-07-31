// 시연용 데이터.
//
// 이 앱은 "여덟 단계를 지나 도구가 만들어지는 과정"이 제품이라, 빈 화면으로는
// 아무것도 보여줄 수 없다. 그래서 서로 다른 단계에 놓인 과제 여덟 건을 심는다.
//
// 가장 공들인 것은 req_settle 하나다. 접수부터 인수인계까지 전 단계를 지나온
// 과제이고, 회의록·요구·충돌 판정·수용 기준·기준선이 전부 들어 있다. 이 한 건이
// 이 포트폴리오가 하려는 말의 전부다.
//
// 데이터는 전부 가상이다. 실존하는 회사·사람·브랜드가 아니다.
// 브랜드 '누리에(NURIE)'는 시험 데이터 생성기(seed/generate_sources.py)와 같은
// 가상 브랜드를 쓴다.

import { newId } from './ids.js'

const DEMO_USER_ID = 'usr_demo_ax'

// ── 과제 여덟 건 ────────────────────────────────────────────────────────────
// status와 단계를 다르게 두어, 작업대에서 "무엇이 어디까지 왔는지"가 한눈에 보이게 한다.
const REQUESTS = [
  {
    id: 'req_settle',
    body_text:
      '매주 월요일마다 자사몰·올리브영·쿠팡·아마존·큐텐 정산서를 하나씩 열어서 손으로 붙이고 있어요. 채널마다 양식이 달라서 컬럼을 맞추는 데만 한 시간 넘게 걸립니다. 지난주에는 올리브영 파일 맨 아래 합계 줄을 같이 붙여서 매출이 두 배로 나온 걸 화요일에야 발견했어요.',
    dept: '재무',
    status: '발행',
    impact_score: 4.6,
    difficulty_score: 3.1,
    days_ago: 12,
    published_days_ago: 11,
  },
  {
    id: 'req_erp',
    body_text:
      '정산 취합 끝나면 그 결과를 ERP 매출 모듈에 자동으로 등록되게 해주세요. 지금은 취합한 엑셀을 보고 사람이 다시 타이핑하고 있습니다.',
    dept: '재무',
    status: '거절',
    refuse_reason_code: 'external_write',
    refuse_reason_text:
      '이 시스템에는 외부 시스템에 쓰는 블록이 없습니다. ERP에 등록하려면 계정 권한과 실패 시 롤백 설계가 별도로 필요하고, 그건 이 도구가 감당할 범위가 아닙니다.',
    refuse_alternative:
      'ERP 업로드 양식에 맞춘 파일까지는 만들어 드립니다. 등록 버튼은 사람이 누릅니다. 그것만으로도 재입력 시간은 사라집니다.',
    days_ago: 10,
  },
  {
    id: 'req_dos',
    body_text:
      '재고 소진일이 2주 밑으로 떨어진 품목을 매주 확인해야 하는데, 재고 파일이랑 판매 파일을 따로 받아서 엑셀에서 브이룩업으로 붙이고 있습니다. 붙이다 실수하면 결품이 납니다.',
    dept: 'SCM',
    status: '제작중',
    impact_score: 4.2,
    difficulty_score: 2.4,
    days_ago: 6,
  },
  {
    id: 'req_roas',
    body_text:
      '채널별 광고비는 광고 관리자에서 받고 매출은 정산서에서 받는데, 둘을 붙여서 제품 단위 기여이익 기준 ROAS를 보고 싶습니다. 지금은 매출 ROAS만 봐서 실제로 남는지를 모르겠어요.',
    dept: '마케팅',
    status: '명세',
    impact_score: 4.0,
    difficulty_score: 3.6,
    days_ago: 4,
  },
  {
    id: 'req_store',
    body_text:
      '점포별 주간 실적을 영업사원들한테 매주 카톡으로 돌리는데, 사람마다 담당 점포가 달라서 표를 여덟 번 잘라 만듭니다.',
    dept: '영업',
    status: '접수',
    days_ago: 2,
  },
  {
    id: 'req_cs',
    body_text:
      '고객문의 엑셀을 매일 받아서 유형별로 분류하고 담당자한테 나눠주는 일을 하고 있어요. 분류 기준이 사람마다 달라서 통계가 안 맞습니다.',
    dept: '운영',
    status: '접수',
    days_ago: 2,
  },
  {
    id: 'req_photo',
    body_text: '신제품 상세페이지 시안을 자동으로 만들어주면 좋겠어요. 매번 디자인팀 일정에 막힙니다.',
    dept: '마케팅',
    status: '거절',
    refuse_reason_code: 'media_gen',
    refuse_reason_text:
      '이 시스템은 표와 문서를 다루는 여덟 개의 블록으로 되어 있고, 이미지 시안을 만드는 블록은 없습니다.',
    refuse_alternative:
      '없습니다. 이 요청은 다른 도구로 가야 합니다. 다만 시안에 들어갈 제품 정보·소구점 표를 정리해 드리는 것은 가능합니다.',
    days_ago: 8,
  },
  {
    id: 'req_vat',
    body_text:
      '분기 부가세 신고할 때 채널별 과세/면세를 나눠야 하는데, 정산서에 그 구분이 없어서 매번 세무사무소에 물어봅니다.',
    dept: '재무',
    status: '보류',
    impact_score: 2.8,
    difficulty_score: 4.4,
    days_ago: 9,
  },
]

// ── req_settle 의 이해관계자 ───────────────────────────────────────────────
// 이 넷이 원하는 것이 서로 부딪힌다. 그 충돌이 ③단계의 재료다.
const STAKEHOLDERS = [
  {
    dept: '재무',
    role_label: '정산 담당',
    person_label: '정산 담당자',
    wants: '금액이 1원도 틀리지 않을 것. 틀리면 마감 후에 정정 공시를 해야 한다.',
    is_owner: 1,
  },
  {
    dept: '영업',
    role_label: '채널 관리',
    person_label: '채널 매니저',
    wants: '월요일 오전 회의 전에 채널별 실적을 볼 것.',
    is_owner: 0,
  },
  {
    dept: 'SCM',
    role_label: '수급 계획',
    person_label: '수급 담당자',
    wants: '판매 수량이 SKU 단위로 정확히 나올 것. 세트 상품도 낱개로 환산되면 좋겠다.',
    is_owner: 0,
  },
  {
    dept: '운영',
    role_label: '실무 수행',
    person_label: '운영 담당자',
    wants: '내가 매주 손댈 일이 없을 것. 지금처럼 붙여넣기만 하는 거면 안 하느니만 못하다.',
    is_owner: 0,
  },
]

// ── 회의록 ─────────────────────────────────────────────────────────────────
// 실제로 있을 법한 말투로 쓴다. 이 원문에서 요구가 인용으로 추출되고,
// 화면에서 담당자가 인용과 대조해 채택·기각한다.
const MINUTES = `[다채널 정산 취합 자동화 — 1차 발굴 회의]
참석: 재무 정산 담당, 영업 채널 매니저, SCM 수급 담당, 운영 담당
일시: 화요일 14:00~15:10

(AX) 지금 이 일을 정확히 어떻게 하고 계신지부터 들을게요.
(재무) 월요일 아침에 채널 다섯 군데 정산서를 각각 다운받아요. 자사몰이랑 쿠팡은 CSV고,
올리브영은 엑셀, 아마존은 CSV인데 달러고, 큐텐은 엑셀인데 시트가 월별로 나뉘어 있어요.
그걸 새 시트에 하나씩 붙이는데, 컬럼 이름이 다 달라서 순서 맞추는 게 제일 오래 걸려요.

(AX) 한 번에 몇 분쯤 걸리세요?
(재무) 재본 적은 없는데, 커피 한 잔 마시고 시작해서 점심 전에 끝나요. 한 시간 반? 두 시간?
바쁜 주에는 오후까지도 가요.

(AX) 틀렸을 때는 어떻게 아세요?
(재무) 대개 모릅니다. 지난주에는 올리브영 파일 맨 아래 합계 줄을 같이 붙여서 매출이 두 배로
나왔는데, 화요일에 영업팀이 "이번 주 대박이네요?" 해서 알았어요. 그런 거 아니면 그냥 지나가요.
그리고 금액이 1원이라도 틀리면 안 됩니다. 마감 넘어가면 정정 공시까지 가는 일이라서요.

(영업) 저희는 월요일 오전 10시에 채널 회의가 있어요. 그때 채널별 실적이 있어야 하는데
지금은 못 받아서 지난주 숫자로 얘기하고 있습니다.

(재무) 그건 좀... 정확하게 하려면 시간이 걸리는데요.
(영업) 대충이라도 있으면 좋겠어요.
(재무) 대충은 안 됩니다.

(AX) 그 부분은 제가 따로 정리해서 다시 여쭐게요. SCM은요?
(SCM) 수량이 SKU 단위로 정확하면 좋겠어요. 그런데 채널마다 상품코드가 달라요.
올리브영은 자기네 코드를 쓰고 쿠팡은 옵션ID를 써요. 같은 마스크인데 코드가 다섯 개예요.
그리고 세트 상품이요. 5매 기획세트 같은 게 팔리면 그건 낱개 5개로 봐야 하는데
지금은 그냥 1개로 잡혀 있어요.

(AX) 세트 구성이 어디 정리돼 있나요?
(SCM) ...그건 없네요. 담당자가 알고 있어요.

(운영) 저는 솔직히, 지금처럼 제가 매주 붙여넣기만 하는 거면 안 하느니만 못해요.
자동으로 안 되는 건이 몇 건씩 나올 텐데 그거 제가 다 처리해야 하면 시간이 똑같아요.

(AX) 자동으로 안 되는 게 몇 %쯤 나올 것 같으세요?
(재무) 미등록 코드는 매주 몇 개씩 나와요. 신상품 나오면 특히요. 열 개 안쪽?
(운영) 열 개면 괜찮은데, 그게 매번 처음부터 다시 판단해야 하는 거면 안 됩니다.

(AX) 한 번 판단한 건 기억해서 다음부터 자동으로 하는 걸로 하면요?
(운영) 그거면 됩니다.

(재무) 아 그리고 정산서 양식은 안 바뀌니까 한 번 맞춰두면 계속 쓸 수 있을 거예요.
(AX) 최근에 바뀐 적 있나요?
(재무) 작년에 쿠팡이 컬럼 하나 늘렸던 것 같은데... 확실하진 않아요.

(AX) 이 표를 최종적으로 누가 보고 무슨 결정을 하나요?
(재무) 대표님 주간 보고에 들어가요. 채널별로 얼마 남았는지를 봅니다.
(영업) 저희는 어느 채널에 힘을 더 줄지를 정하죠.
(SCM) 저는 그거 보고 발주를 넣습니다.

(AX) 그러면 "얼마 팔았나"가 아니라 "얼마 남았나"가 필요한 거네요.
(재무) 네. 수수료랑 원가 빼고요. 그건 지금 표에는 없어요. 따로 계산합니다.`

// 회의에서 실제로 오간 요구·제약·미결·가정.
// quote는 위 MINUTES에 실제로 존재하는 문자열이어야 한다 — 시드가 그 규칙을
// 어기면 화면의 '인용 대조' 표시가 거짓말을 하게 된다.
const REQUIREMENTS = [
  {
    id: 'rq_exact',
    kind: '제약',
    dept: '재무',
    body: '정답 대비 금액 오차가 0원이어야 한다.',
    quote: '금액이 1원이라도 틀리면 안 됩니다',
    priority: '필수',
    measurable: '정답 대비 금액 오차 0원',
    status: '채택',
  },
  {
    id: 'rq_monday',
    kind: '요구',
    dept: '영업',
    body: '월요일 오전 10시 채널 회의 전에 채널별 실적을 볼 수 있어야 한다.',
    quote: '월요일 오전 10시에 채널 회의가 있어요',
    priority: '필수',
    measurable: '월요일 09:30까지 산출 완료',
    status: '채택',
  },
  {
    id: 'rq_sku',
    kind: '요구',
    dept: 'SCM',
    body: '판매 수량이 채널 공통의 SKU 단위로 집계되어야 한다.',
    quote: '수량이 SKU 단위로 정확하면 좋겠어요',
    priority: '필수',
    measurable: '채널별 상품코드가 마스터 SKU로 100% 매핑되거나, 매핑 실패 시 격리',
    status: '채택',
  },
  {
    id: 'rq_noop',
    kind: '제약',
    dept: '운영',
    body: '운영 담당자가 매주 반복 작업을 하지 않아야 한다. 같은 판단을 두 번 요구하면 안 된다.',
    quote: '그게 매번 처음부터 다시 판단해야 하는 거면 안 됩니다',
    priority: '필수',
    measurable: '한 번 확정한 별칭은 다음 실행에서 자동 적용(사람 개입 0회)',
    status: '채택',
  },
  {
    id: 'rq_margin',
    kind: '요구',
    dept: '재무',
    body: '매출이 아니라 수수료와 원가를 뺀 기여이익이 채널별로 보여야 한다.',
    quote: '수수료랑 원가 빼고요',
    priority: '필수',
    measurable: '채널별 기여이익 산출',
    status: '채택',
  },
  {
    id: 'rq_rough',
    kind: '요구',
    dept: '영업',
    body: '정확도가 덜 하더라도 월요일 오전에 볼 수 있는 잠정 수치를 제공한다.',
    quote: '대충이라도 있으면 좋겠어요',
    priority: '보통',
    measurable: null,
    status: '기각',
    reject_reason:
      '잠정 수치와 확정 수치가 같은 화면에 있으면 어느 쪽이 인용될지 통제할 수 없다. 재무의 정정 공시 리스크가 이 편의보다 크다. 대신 산출 시각을 앞당기는 쪽(rq_monday)으로 해결한다.',
  },
  {
    id: 'rq_bundle',
    kind: '미결',
    dept: 'SCM',
    body: '세트 상품을 낱개로 환산하는 구성 정보가 어디에도 정리되어 있지 않다.',
    quote: '그건 없네요. 담당자가 알고 있어요.',
    priority: '보통',
    measurable: null,
    status: '채택',
  },
  {
    id: 'rq_format',
    kind: '가정',
    dept: '재무',
    body: '채널 정산서 양식이 바뀌지 않는다고 전제하고 있다. 실제로는 작년에 바뀐 적이 있다.',
    quote: '정산서 양식은 안 바뀌니까',
    priority: '필수',
    measurable: '헤더 지문이 달라지면 자동 적용을 멈추고 사람에게 확인을 요청',
    status: '수정채택',
    decided_body:
      '양식이 바뀔 수 있다고 전제한다. 헤더 지문이 이전과 다르면 자동 매핑을 적용하지 않고 검토함으로 보낸다.',
  },
  {
    id: 'rq_unknown',
    kind: '요구',
    dept: '운영',
    body: '자동으로 처리되지 않는 건이 주당 10건 이내여야 하고, 한 번 판단하면 기억되어야 한다.',
    quote: '미등록 코드는 매주 몇 개씩 나와요',
    priority: '필수',
    measurable: '주당 격리 건수 10건 이하 + 재실행 시 동일 사유 격리 0건',
    status: '채택',
  },
  {
    id: 'rq_decision',
    kind: '요구',
    dept: '재무',
    body: '이 표는 대표 주간 보고에 들어가며, 채널별로 남은 금액을 보고 발주와 채널 투자를 결정한다.',
    quote: '대표님 주간 보고에 들어가요',
    priority: '보통',
    measurable: null,
    status: '채택',
  },
]

// ── 충돌 판정 ──────────────────────────────────────────────────────────────
// AI는 후보만 올렸고, verdict와 그 근거는 사람이 채웠다. 이 세 건이
// "내가 한 일"의 가장 선명한 증거다.
const CONFLICTS = [
  {
    id: 'cf_exact_monday',
    req_a_id: 'rq_exact',
    req_b_id: 'rq_monday',
    ai_reason:
      '금액 오차 0원을 보장하려면 미등록 코드와 이상치를 사람이 확인한 뒤 확정해야 하는데, 그 확인 시간이 월요일 09:30 마감 안에 들어간다는 보장이 없다. 마감을 지키려면 미확인 건을 포함한 채 산출해야 하고 그러면 금액이 틀릴 수 있다.',
    severity: '높음',
    tradeoff_axis: '정확도 ↔ 마감시각',
    verdict: 'A우선',
    verdict_reason:
      '재무의 정확도가 이긴다. 틀린 숫자가 대표 보고와 정정 공시로 이어지는 비용이, 영업이 하루 늦게 보는 비용보다 훨씬 크다. 다만 영업 요구를 버리지는 않는다 — 금요일 마감분까지를 일요일 밤에 미리 돌려 두고, 월요일 아침에는 검토함에 남은 건만 확인하면 되게 만든다. 그러면 대개 09:30 안에 끝난다. 못 끝내는 주에는 정확도를 택한다.',
    tradeoff_note:
      '영업은 월요일 회의에서 "검토 중 N건 제외" 표시가 붙은 확정 수치를 본다. 잠정 수치는 만들지 않는다.',
  },
  {
    id: 'cf_noop_exact',
    req_a_id: 'rq_noop',
    req_b_id: 'rq_exact',
    ai_reason:
      '사람 개입을 0으로 만들려면 미등록 코드를 자동으로 추정해 붙여야 하는데, 추정이 틀리면 금액이 틀린다. 반대로 오차 0원을 지키려면 애매한 건마다 사람 확인이 필요하다.',
    severity: '높음',
    tradeoff_axis: '자동화율 ↔ 사람 개입',
    verdict: '절충',
    verdict_reason:
      '"사람 개입 0"이 아니라 "같은 판단을 두 번 하지 않음"으로 요구를 다시 읽었다. 운영 담당자가 실제로 못 견디는 것은 개입 자체가 아니라 반복이다(회의록에서도 "매번 처음부터 다시 판단해야 하는 거면 안 됩니다"라고 했다). 그래서 추정은 하지 않고 격리하되, 한 번 확정한 별칭은 사전에 저장해 다음 실행부터 자동 적용한다. 개입 건수는 주차가 지날수록 0에 수렴한다.',
    tradeoff_note:
      '첫 주 격리 건수는 높다. 그 대신 4주차부터는 신상품이 나온 주에만 개입이 생긴다.',
  },
  {
    id: 'cf_sku_bundle',
    req_a_id: 'rq_sku',
    req_b_id: 'rq_bundle',
    ai_reason:
      'SKU 단위 정확 집계를 요구하면서 세트 구성 정보는 존재하지 않는다. 세트를 1개로 세면 SKU 수량이 틀리고, 낱개로 환산하려면 없는 자료가 필요하다.',
    severity: '보통',
    tradeoff_axis: '완결성 ↔ 지금 있는 자료',
    verdict: 'B우선',
    verdict_reason:
      '세트 환산은 이번 범위에서 뺀다. 구성 정보가 문서로 존재하지 않는 상태에서 담당자 기억에 의존해 환산표를 만들면, 그 표가 틀렸을 때 아무도 모른다. 세트 상품은 격리로 보내 사람이 보게 하고, SCM이 구성표를 문서로 만들어 주면 그때 normalize 블록에 넣는다.',
    tradeoff_note:
      '세트 상품 매출은 채널 합계에는 들어가지만 SKU별 수량에서는 빠진다. 이 사실을 지표 정의의 "알려진 한계"에 적는다.',
  },
]

// ── 수용 기준 ──────────────────────────────────────────────────────────────
const CRITERIA = [
  {
    body: '정답셋 대비 채널별 순매출 합계 오차가 0원이어야 한다.',
    from_requirement_id: 'rq_exact',
    check_kind: 'rule',
    is_required_safety: 1,
  },
  {
    body: '격리되어야 할 행(미등록 코드·합계행·기간 밖)을 빠짐없이 격리하고, 정상 행을 격리하지 않아야 한다.',
    from_requirement_id: 'rq_unknown',
    check_kind: 'rule',
    is_required_safety: 1,
  },
  {
    body: '외화 매출은 반드시 원화로 환산된 뒤 합산되어야 한다. 미환산 금액이 합계에 섞이면 실패.',
    from_requirement_id: 'rq_exact',
    check_kind: 'rule',
    is_required_safety: 1,
  },
  {
    body: '같은 파일을 두 번 적재해도 합계가 변하지 않아야 한다(멱등).',
    from_requirement_id: 'rq_exact',
    check_kind: 'rule',
    is_required_safety: 1,
  },
  {
    body: '한 번 확정한 별칭은 다음 실행에서 사람 개입 없이 자동 적용되어야 한다.',
    from_requirement_id: 'rq_noop',
    from_conflict_id: 'cf_noop_exact',
    check_kind: 'rule',
    is_required_safety: 0,
  },
  {
    body: '헤더 지문이 이전 실행과 다르면 자동 매핑을 적용하지 않고 검토함으로 보내야 한다.',
    from_requirement_id: 'rq_format',
    check_kind: 'rule',
    is_required_safety: 0,
  },
  {
    body: '채널별 기여이익이 순매출·수수료·원가·물류비·광고비의 순서로 계산되어 산출되어야 한다.',
    from_requirement_id: 'rq_margin',
    check_kind: 'rule',
    is_required_safety: 0,
  },
  {
    body: '결과 표의 모든 행이 원본 파일의 시트와 행 번호로 되짚어져야 한다.',
    from_requirement_id: 'rq_decision',
    check_kind: 'rule',
    is_required_safety: 0,
  },
]

// ── 기준선 (섀도 런 3회) ───────────────────────────────────────────────────
// 회의에서 재무 담당자가 "한 시간 반? 두 시간?"이라고 했지만 그 말은 기준선이
// 될 수 없다. 실제로 세 번 재서 나온 값만 봉인한다.
const SHADOW_RUNS = [
  { seq: 1, total_seconds: 6480, error_count: 1, steps: { 다운로드: 420, 붙여넣기: 3900, 코드맞추기: 1560, 검산: 600 } },
  { seq: 2, total_seconds: 5820, error_count: 0, steps: { 다운로드: 360, 붙여넣기: 3300, 코드맞추기: 1560, 검산: 600 } },
  { seq: 3, total_seconds: 7260, error_count: 2, steps: { 다운로드: 480, 붙여넣기: 4200, 코드맞추기: 1980, 검산: 600 } },
]

// ── 의사결정 로그 ──────────────────────────────────────────────────────────
const DECISIONS = [
  {
    request_id: 'req_settle',
    stage: '접수',
    actor: 'human',
    title: '여덟 건 중 이것을 먼저 하기로 했다',
    what: '접수함의 여덟 건 중 다채널 정산 취합을 1순위로 올렸다.',
    why: '주 1회 반복 × 다섯 부서가 결과를 쓴다 × 이미 오류가 실제로 발생했다(합계행 오적재). 임팩트는 가장 크고 난이도는 중간이다. 재고 소진일(req_dos)이 난이도는 더 낮지만, 그건 이 과제가 만드는 매출 fact 위에서 하면 훨씬 싸게 붙는다.',
    alternatives: '재고 소진일 취합을 먼저 하는 안. 더 쉽지만, 정산 fact가 없으면 판매 수량을 또 따로 만들어야 해서 두 번 일하게 된다.',
    days_ago: 12,
  },
  {
    request_id: 'req_erp',
    stage: '접수',
    actor: 'human',
    title: 'ERP 자동 등록 요청을 거절했다',
    what: '거절하고 대안(업로드 양식 파일까지 생성)을 제시했다.',
    why: '외부 시스템에 쓰는 블록이 없다. 억지로 붙이면 권한·실패 롤백·감사 추적을 전부 새로 설계해야 하고, 그건 이 도구의 범위가 아니다. 재입력 시간을 없애는 것이 요청의 본래 목적이므로, 양식에 맞는 파일까지 만들면 목적의 대부분은 달성된다.',
    alternatives: 'RPA로 화면을 자동 조작하는 안. 화면이 바뀌면 조용히 깨지고, 깨진 걸 아무도 모른다.',
    days_ago: 10,
  },
  {
    request_id: 'req_settle',
    stage: '발굴회의',
    actor: 'human',
    title: '"대충이라도 달라"는 요구를 기각했다',
    what: '영업의 잠정 수치 요구(rq_rough)를 기각하고, 대신 산출 시각을 앞당기는 쪽으로 방향을 잡았다.',
    why: '잠정 수치와 확정 수치가 같은 화면에 있으면 어느 쪽이 인용될지 통제할 수 없다. 대표 보고에 잠정치가 들어가면 정정 비용이 크다. 요구의 본래 목적은 "월요일 회의에서 숫자를 보는 것"이므로, 일요일 밤 사전 실행으로 목적을 달성한다.',
    alternatives: '잠정 수치에 워터마크를 붙여 함께 제공하는 안. 실무에서 워터마크는 캡처되면서 사라진다.',
    days_ago: 9,
  },
  {
    request_id: 'req_settle',
    stage: '충돌판정',
    actor: 'human',
    title: '"사람 개입 0"을 "같은 판단을 두 번 하지 않음"으로 다시 읽었다',
    what: '운영의 요구를 글자 그대로 받지 않고 재해석해 절충안으로 판정했다.',
    why: '회의록에서 운영 담당자가 못 견딘다고 한 것은 개입 자체가 아니라 반복이었다("매번 처음부터 다시 판단해야 하는 거면 안 됩니다"). 글자 그대로 개입을 0으로 만들려면 미등록 코드를 추정해야 하고, 그러면 재무의 오차 0원이 깨진다. 요구의 표현이 아니라 이유를 보면 두 요구가 양립한다.',
    alternatives: '미등록 코드를 유사도로 자동 추정하는 안. 개입은 0이 되지만 틀린 매핑이 조용히 합계에 들어간다.',
    days_ago: 8,
  },
  {
    request_id: 'req_settle',
    stage: '충돌판정',
    actor: 'human',
    title: '세트 상품 환산을 이번 범위에서 뺐다',
    what: 'SKU 정확 집계와 세트 환산이 부딪히는 지점에서, 세트 환산을 빼고 격리로 보내기로 했다.',
    why: '세트 구성 정보가 문서로 존재하지 않는다. 담당자 기억으로 환산표를 만들면 그 표가 틀렸을 때 아무도 모른다. 없는 자료로 만든 숫자는 있는 것보다 나쁘다.',
    alternatives: '담당자 인터뷰로 환산표를 만들어 넣는 안. 지금 당장은 되지만 검증할 방법이 없다.',
    unrequested: 0,
    days_ago: 8,
  },
  {
    request_id: 'req_settle',
    stage: '기준선',
    actor: 'human',
    title: '"한 시간 반쯤"이라는 말을 기준선으로 쓰지 않았다',
    what: '회의에서 나온 체감 시간 대신, 실제 작업을 3회 계측해 중앙값 97분을 봉인했다.',
    why: '절감액은 이 값 위에서 계산되고, 나중에 반드시 "그 시간은 어떻게 아셨어요?"라는 질문을 받는다. 만든 사람이 자기 입으로 말한 숫자는 근거가 아니다. 3회는 통계적으로 약하므로 신뢰구간을 붙이지 않고 "표본 3회" 경고를 화면에 상시 표시한다.',
    alternatives: '담당자에게 지난 4주를 회상해 적게 하는 안. 회상 편향이 크고, 바쁜 주가 과대 대표된다.',
    unrequested: 1,
    days_ago: 7,
  },
  {
    request_id: 'req_settle',
    stage: '품질기준',
    actor: 'human',
    title: '필수 안전 기준을 네 개로 제한했다',
    what: '수용 기준 여덟 개 중 넷만 is_required_safety로 지정했다.',
    why: '전부 필수로 만들면 필수의 뜻이 없어지고, 사소한 회귀에도 인수인계가 막혀 게이트가 무시당하기 시작한다. "틀리면 돌이킬 수 없는 것"에만 붙였다 — 금액 오차, 격리 누락, 통화 미환산, 멱등성.',
    alternatives: '여덟 개 전부를 필수로 두는 안. 안전해 보이지만 실제로는 게이트를 끄게 만든다.',
    days_ago: 5,
  },
  {
    request_id: 'req_settle',
    stage: '성과정의',
    actor: 'human',
    title: '절감 시간에서 검수 시간을 빼기로 했다',
    what: '순절감 계산식에 사람 검수 시간·재작업 시간·개발 공수 상각·API 원가를 차감 항목으로 넣었다.',
    why: '자동화 후에도 사람이 검토함을 보고 있는데 그 시간을 빼지 않으면 절감액이 부풀려진다. 이 숫자는 예산을 요청할 때 쓰이므로, 한 번이라도 부풀려진 것이 드러나면 다음 요청이 전부 의심받는다.',
    alternatives: '총 절감 시간만 표시하는 안. 숫자가 커 보이지만 재무가 검증하면 바로 깨진다.',
    unrequested: 1,
    days_ago: 4,
  },
]

async function run(env, sql, ...binds) {
  return env.DB.prepare(sql).bind(...binds).run()
}

function daysAgo(n) {
  return `datetime('now', '-${n} days')`
}

// 시드를 다시 심을 때는 이전 것을 지운다. 데모 화면에서 [초기화]를 누르면
// 언제든 같은 상태로 돌아와야 면접 중에 마음 놓고 눌러 볼 수 있다.
const WIPE_TABLES = [
  'decision_log',
  'acceptance_criterion',
  'requirement_conflict',
  'requirement',
  'meeting_question',
  'meeting',
  'stakeholder',
  'baseline_history',
  'baseline',
  'shadow_run',
  'intake_answer',
  'quarantine_row',
  'run_row',
  'tool_run',
  'recipe_block',
  'recipe',
  'request',
]

export async function seedDemo(env) {
  for (const t of WIPE_TABLES) {
    await run(env, `DELETE FROM ${t}`)
  }

  await run(
    env,
    `INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, display_name, dept)
     VALUES (?, ?, '-', '-', ?, ?)`,
    DEMO_USER_ID,
    'ax@example.invalid',
    'AX 담당자',
    'CEO Staff'
  )

  for (const r of REQUESTS) {
    await run(
      env,
      `INSERT INTO request
         (id, body_text, dept, status, refuse_reason_code, refuse_reason_text, refuse_alternative,
          impact_score, difficulty_score, created_at, first_published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${daysAgo(r.days_ago)},
               ${r.published_days_ago != null ? daysAgo(r.published_days_ago) : 'NULL'})`,
      r.id,
      r.body_text,
      r.dept,
      r.status,
      r.refuse_reason_code ?? null,
      r.refuse_reason_text ?? null,
      r.refuse_alternative ?? null,
      r.impact_score ?? null,
      r.difficulty_score ?? null
    )
  }

  for (const s of STAKEHOLDERS) {
    await run(
      env,
      `INSERT INTO stakeholder (id, request_id, dept, role_label, person_label, wants, is_owner)
       VALUES (?, 'req_settle', ?, ?, ?, ?, ?)`,
      newId('stk'),
      s.dept,
      s.role_label,
      s.person_label,
      s.wants,
      s.is_owner
    )
  }

  const meetingId = 'mtg_settle_1'
  await run(
    env,
    `INSERT INTO meeting
       (id, request_id, seq, title, depts_json, held_at, minutes_text, status,
        questions_generated_at, extracted_at, created_at)
     VALUES (?, 'req_settle', 1, ?, ?, ${daysAgo(10)}, ?, '완료', ${daysAgo(10)}, ${daysAgo(9)}, ${daysAgo(11)})`,
    meetingId,
    '다채널 정산 취합 — 1차 발굴 회의',
    JSON.stringify(['재무', '영업', 'SCM', '운영']),
    MINUTES
  )

  const QUESTIONS = [
    ['지금 이 일을 정확히 어떤 순서로 하시는지 처음부터 끝까지 보여주실 수 있나요?', '단계를 봐야 어디를 자동화할지가 정해진다. 말로 들은 순서와 실제 순서는 대개 다르다.', '재무', 1],
    ['한 번 하는 데 몇 분쯤 걸리세요? 최근에 오래 걸린 주는 얼마나 걸렸나요?', '절감 효과의 기준선이 된다. 평균만 물으면 바쁜 주가 빠진다.', '재무', 1],
    ['결과가 틀렸을 때 누가 언제 어떻게 알아채나요?', '아무도 못 알아챈다면 검증 블록이 산출물보다 중요해진다.', '재무', 1],
    ['규칙에서 벗어나는 건이 몇 %쯤 되나요? 그럴 때 지금은 어떻게 처리하세요?', '예외 비율이 높으면 검토함 화면이 본체가 되고, 낮으면 곁가지가 된다.', '운영', 1],
    ['이 결과를 최종적으로 누가 보고 무슨 결정을 하나요?', '결정이 달라지지 않는 지표는 만들 필요가 없다. 무엇을 계산할지가 여기서 정해진다.', null, 1],
    ['채널마다 상품코드가 다른가요? 같은 제품인지 어떻게 확인하세요?', '별칭 사전이 필요한지, 그 사전을 누가 관리할지가 정해진다.', 'SCM', 1],
    ['정산서 양식이 바뀐 적이 있나요? 바뀌면 어떻게 아세요?', '양식 변경 감지를 넣을지가 정해진다. "안 바뀐다"는 대개 확인되지 않은 가정이다.', '재무', 1],
    ['이 일을 안 하면 무슨 일이 생기나요?', '자동화 우선순위의 근거가 된다. 안 해도 되는 일이면 없애는 것이 자동화보다 낫다.', null, 0],
  ]
  for (let i = 0; i < QUESTIONS.length; i++) {
    const [q, why, dept, asked] = QUESTIONS[i]
    await run(
      env,
      `INSERT INTO meeting_question (id, meeting_id, ord, question, why_ask, target_dept, origin, asked)
       VALUES (?, ?, ?, ?, ?, ?, 'ai', ?)`,
      newId('mq'),
      meetingId,
      i + 1,
      q,
      why,
      dept,
      asked
    )
  }

  for (const r of REQUIREMENTS) {
    await run(
      env,
      `INSERT INTO requirement
         (id, request_id, meeting_id, kind, dept, body, quote, priority, origin, status,
          decided_body, reject_reason, decided_at, created_at)
       VALUES (?, 'req_settle', ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ${daysAgo(9)}, ${daysAgo(9)})`,
      r.id,
      meetingId,
      r.kind,
      r.dept,
      r.body,
      r.quote,
      r.priority,
      r.status,
      r.decided_body ?? null,
      r.reject_reason ?? null
    )
  }

  for (const c of CONFLICTS) {
    await run(
      env,
      `INSERT INTO requirement_conflict
         (id, request_id, req_a_id, req_b_id, ai_reason, severity, verdict, verdict_reason,
          tradeoff_note, decided_by, decided_at, created_at)
       VALUES (?, 'req_settle', ?, ?, ?, ?, ?, ?, ?, ?, ${daysAgo(8)}, ${daysAgo(9)})`,
      c.id,
      c.req_a_id,
      c.req_b_id,
      c.ai_reason,
      c.severity,
      c.verdict,
      c.verdict_reason,
      c.tradeoff_note,
      DEMO_USER_ID
    )
  }

  for (let i = 0; i < CRITERIA.length; i++) {
    const c = CRITERIA[i]
    await run(
      env,
      `INSERT INTO acceptance_criterion
         (id, request_id, ord, body, from_requirement_id, from_conflict_id, check_kind,
          is_required_safety, confirmed_by, confirmed_at)
       VALUES (?, 'req_settle', ?, ?, ?, ?, ?, ?, ?, ${daysAgo(5)})`,
      newId('ac'),
      i + 1,
      c.body,
      c.from_requirement_id ?? null,
      c.from_conflict_id ?? null,
      c.check_kind,
      c.is_required_safety,
      DEMO_USER_ID
    )
  }

  for (const s of SHADOW_RUNS) {
    await run(
      env,
      `INSERT INTO shadow_run (id, request_id, seq, step_timings_json, total_seconds, error_count, run_at)
       VALUES (?, 'req_settle', ?, ?, ?, ?, ${daysAgo(7)})`,
      newId('shd'),
      s.seq,
      JSON.stringify(s.steps),
      s.total_seconds,
      s.error_count
    )
  }

  const totals = SHADOW_RUNS.map((s) => s.total_seconds).sort((a, b) => a - b)
  await run(
    env,
    `INSERT INTO baseline
       (request_id, median_seconds, p25_seconds, p75_seconds, sample_n, error_rate, hourly_wage_krw, sealed_at)
     VALUES ('req_settle', ?, ?, ?, ?, ?, 25000, ${daysAgo(7)})`,
    totals[1],
    totals[0],
    totals[2],
    totals.length,
    SHADOW_RUNS.filter((s) => s.error_count > 0).length / SHADOW_RUNS.length
  )

  for (const d of DECISIONS) {
    await run(
      env,
      `INSERT INTO decision_log
         (id, request_id, stage, actor, title, what, why, alternatives, unrequested, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${daysAgo(d.days_ago)})`,
      newId('dec'),
      d.request_id,
      d.stage,
      d.actor,
      d.title,
      d.what,
      d.why,
      d.alternatives ?? null,
      d.unrequested ?? 0
    )
  }

  return {
    requests: REQUESTS.length,
    stakeholders: STAKEHOLDERS.length,
    requirements: REQUIREMENTS.length,
    conflicts: CONFLICTS.length,
    criteria: CRITERIA.length,
    decisions: DECISIONS.length,
    baselineMedianSeconds: totals[1],
  }
}

export { DEMO_USER_ID, MINUTES }
