// 기준 정보 — 상품, 채널, 환율.
//
// 이 값들은 코드에 둔다. 데이터베이스가 아니라.
// 이유: 합치기 규칙을 검사할 때 데이터베이스 없이 돌려 볼 수 있어야 한다.
// 사람이 나중에 새로 알려 준 별칭(예: 신상품 코드)은 데이터베이스에 쌓이고,
// 합칠 때 이 기본값 위에 덮어쓴다.
//
// 브랜드 '누리에'는 가상이다. 실존하지 않는다.
// seed/generate_sources.py 가 만드는 시험 파일과 같은 값을 쓴다.

export const FX = {"KRW":1,"USD":1385,"JPY":8.9}

// 정산 대상 기간. 이 밖의 날짜는 합계에 넣지 않고 따로 빼 둔다.
export const PERIOD = { start: '2026-06-01', end: '2026-06-30' }

// 시급. 성과를 돈으로 환산할 때 쓴다.
export const HOURLY_WAGE_KRW = 25000

export const SKUS = [
  {
    "canonical_code": "NR-CM-100",
    "name_ko": "콜라겐 래핑 마스크",
    "line": "래핑",
    "volume_ml": 100,
    "std_cogs_krw": 3400,
    "shelf_life_months": 30,
    "list_price_krw": 13700
  },
  {
    "canonical_code": "NR-PA-030",
    "name_ko": "펩타이드 앰플",
    "line": "앰플",
    "volume_ml": 30,
    "std_cogs_krw": 7200,
    "shelf_life_months": 24,
    "list_price_krw": 24300
  },
  {
    "canonical_code": "NR-EG-050",
    "name_ko": "EGF 리페어 세럼",
    "line": "세럼",
    "volume_ml": 50,
    "std_cogs_krw": 9800,
    "shelf_life_months": 24,
    "list_price_krw": 39400
  },
  {
    "canonical_code": "NR-CC-075",
    "name_ko": "시카 진정 크림",
    "line": "크림",
    "volume_ml": 75,
    "std_cogs_krw": 5600,
    "shelf_life_months": 30,
    "list_price_krw": 17900
  },
  {
    "canonical_code": "NR-VT-200",
    "name_ko": "비타민 브라이트 토너",
    "line": "토너",
    "volume_ml": 200,
    "std_cogs_krw": 4100,
    "shelf_life_months": 36,
    "list_price_krw": 15400
  },
  {
    "canonical_code": "NR-RE-020",
    "name_ko": "리페어 아이크림",
    "line": "크림",
    "volume_ml": 20,
    "std_cogs_krw": 6300,
    "shelf_life_months": 24,
    "list_price_krw": 24200
  },
  {
    "canonical_code": "NR-CO-150",
    "name_ko": "딥 클렌징 오일",
    "line": "클렌징",
    "volume_ml": 150,
    "std_cogs_krw": 3900,
    "shelf_life_months": 36,
    "list_price_krw": 14600
  },
  {
    "canonical_code": "NR-SC-050",
    "name_ko": "데일리 선크림 SPF50",
    "line": "선케어",
    "volume_ml": 50,
    "std_cogs_krw": 4700,
    "shelf_life_months": 30,
    "list_price_krw": 18900
  }
]

export const CHANNELS = [
  {
    "name": "자사몰",
    "type": "D2C",
    "nominal_commission_rate": 0.032,
    "settlement_cycle_days": 3,
    "currency": "KRW",
    "effective_extra_rate": 0,
    "country": "KR"
  },
  {
    "name": "올리브영",
    "type": "오프라인",
    "nominal_commission_rate": 0.335,
    "settlement_cycle_days": 60,
    "currency": "KRW",
    "effective_extra_rate": 0.018,
    "country": "KR"
  },
  {
    "name": "쿠팡",
    "type": "오픈마켓",
    "nominal_commission_rate": 0.108,
    "settlement_cycle_days": 45,
    "currency": "KRW",
    "effective_extra_rate": 0.011,
    "country": "KR"
  },
  {
    "name": "Amazon US",
    "type": "해외",
    "nominal_commission_rate": 0.15,
    "settlement_cycle_days": 14,
    "currency": "USD",
    "effective_extra_rate": 0.007,
    "country": "US"
  },
  {
    "name": "Qoo10 JP",
    "type": "해외",
    "nominal_commission_rate": 0.12,
    "settlement_cycle_days": 30,
    "currency": "JPY",
    "effective_extra_rate": 0.004,
    "country": "JP"
  }
]

// 채널마다 다른 상품코드 → 우리 표준코드.
// 같은 마스크가 다섯 가지 이름으로 불린다. 이 표가 없으면 채널 간 합산이
// 아예 불가능하다.
export const SKU_ALIAS = {
  "87123401": "NR-CM-100",
  "87123402": "NR-PA-030",
  "87123403": "NR-EG-050",
  "87123404": "NR-CC-075",
  "87123405": "NR-VT-200",
  "87123406": "NR-RE-020",
  "87123407": "NR-CO-150",
  "87123408": "NR-SC-050",
  "NR-CM-100": "NR-CM-100",
  "NR-PA-030": "NR-PA-030",
  "NR-EG-050": "NR-EG-050",
  "NR-CC-075": "NR-CC-075",
  "NR-VT-200": "NR-VT-200",
  "NR-RE-020": "NR-RE-020",
  "NR-CO-150": "NR-CO-150",
  "NR-SC-050": "NR-SC-050",
  "OY1024881": "NR-CM-100",
  "OY1024882": "NR-PA-030",
  "OY1024883": "NR-EG-050",
  "OY1024884": "NR-CC-075",
  "OY1024885": "NR-VT-200",
  "OY1024886": "NR-RE-020",
  "OY1024887": "NR-CO-150",
  "OY1024888": "NR-SC-050",
  "NURIE-NRCM100-US": "NR-CM-100",
  "NURIE-NRPA030-US": "NR-PA-030",
  "NURIE-NREG050-US": "NR-EG-050",
  "NURIE-NRCC075-US": "NR-CC-075",
  "NURIE-NRVT200-US": "NR-VT-200",
  "NURIE-NRRE020-US": "NR-RE-020",
  "NURIE-NRCO150-US": "NR-CO-150",
  "NURIE-NRSC050-US": "NR-SC-050",
  "NR_CM_100_JP": "NR-CM-100",
  "NR_PA_030_JP": "NR-PA-030",
  "NR_EG_050_JP": "NR-EG-050",
  "NR_CC_075_JP": "NR-CC-075",
  "NR_VT_200_JP": "NR-VT-200",
  "NR_RE_020_JP": "NR-RE-020",
  "NR_CO_150_JP": "NR-CO-150",
  "NR_SC_050_JP": "NR-SC-050"
}

export const SKU_BY_CODE = Object.fromEntries(SKUS.map((s) => [s.canonical_code, s]))
export const CHANNEL_BY_NAME = Object.fromEntries(CHANNELS.map((c) => [c.name, c]))
