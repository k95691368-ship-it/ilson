// 같은 코드에서 세 벌의 배포본을 낸다.
//
// 이 앱이 다루는 일은 여덟 단계짜리 한 줄기인데, 보는 사람에 따라 그 줄기의
// 어느 마디가 중심인지가 다르다. 데이터 파이프라인과 BI가 궁금한 사람에게
// LoRA 학습곡선이 먼저 보이면 초점 없는 물건으로 읽히고, 반대로 모델 평가가
// 궁금한 사람에게 기여이익 워터폴이 먼저 보이면 자기 관심사가 곁가지로 읽힌다.
//
// 그래서 바꾸는 것은 딱 세 가지다 — 첫 화면, 상단 탭 순서, 접수함 시드.
// 기능도 데이터도 코드도 전부 같다. 어느 배포본에도 회사 이름은 없다.
//
// 빌드 환경변수 VITE_VIEW로 고른다. 없으면 'data'.
//   VITE_VIEW=data     성과(파이프라인·BI)를 앞에
//   VITE_VIEW=product  작업대(접수·회의·인수인계)를 앞에
//   VITE_VIEW=eval     품질(평가·실험·학습)을 앞에

export const VIEWS = ['data', 'product', 'eval']

const PRESETS = {
  data: {
    key: 'data',
    label: '데이터·BI',
    home: '/metrics',
    tagline: '흩어진 채널 원장 5종을 하나로 합치고, 대시보드의 모든 숫자를 원본 셀까지 되짚는다.',
    navOrder: ['/metrics', '/', '/quality', '/log', '/honesty'],
    seedFocus: ['재무', 'SCM', '영업'],
  },
  product: {
    key: 'product',
    label: '제품·운영',
    home: '/',
    tagline: '현업의 불평 한 줄을 받아, 부서와 회의하고, 도구로 만들어 인수인계한다.',
    navOrder: ['/', '/metrics', '/quality', '/log', '/honesty'],
    seedFocus: ['운영', '마케팅', '영업'],
  },
  eval: {
    key: 'eval',
    label: 'AI 품질',
    home: '/quality',
    tagline: '합격 기준을 사람이 정의하고, 3층으로 채점하고, 회귀가 보이면 인수인계를 막는다.',
    navOrder: ['/quality', '/', '/metrics', '/log', '/honesty'],
    seedFocus: ['재무', '운영', '마케팅'],
  },
}

function readEnv() {
  try {
    return import.meta.env?.VITE_VIEW
  } catch {
    return undefined
  }
}

// 잘못된 값이 들어와도 앱이 죽지 않는다. 배포 설정 실수는 화면이 깨지는 것보다
// 조용히 기본값으로 도는 편이 낫다.
export function normalizeView(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return VIEWS.includes(v) ? v : 'data'
}

export function getView(override) {
  return PRESETS[normalizeView(override ?? readEnv())]
}

export const NAV_ITEMS = [
  { to: '/', label: '작업대', end: true },
  { to: '/metrics', label: '성과' },
  { to: '/quality', label: '품질' },
  { to: '/log', label: '의사결정' },
  { to: '/honesty', label: '한계' },
]

// navOrder에 적힌 순서대로 정렬한다. 목록에 없는 항목은 뒤에 원래 순서로 붙는다.
export function orderedNav(view, items = NAV_ITEMS) {
  const order = view.navOrder
  return [...items].sort((a, b) => {
    const ia = order.indexOf(a.to)
    const ib = order.indexOf(b.to)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
}
