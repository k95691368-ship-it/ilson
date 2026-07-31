// 여덟 단계. 이 앱의 목차이자 실제 일이 흘러가는 순서다.
//
// 상단 탭이 곧 이 순서다. 화면을 기능별로 나누지 않고 단계별로 나눈 이유는,
// 이 포트폴리오가 보여주려는 것이 "어떤 기능이 있는가"가 아니라 "부서의 병목이
// 도구가 되어 돌아가기까지 무슨 일이 있었는가"이기 때문이다.
//
// owner는 그 단계의 주인이다. 신청서는 현업 부서가 쓰고, 나머지는 AX 담당자가
// 한다. 이 구분이 화면마다 표시된다 — 누가 하는 일인지가 흐려지면 포트폴리오의
// 주어가 사라진다.

export const STAGES = [
  {
    no: 1,
    key: 'apply',
    path: '/apply',
    label: '신청서',
    title: '병목 해결 신청서',
    owner: '현업 부서',
    summary: '부서가 자기 병목을 적어 낸다. 신청 부서·병목 이유·문제 상황·바라는 해결 방안, 그리고 지금 걸리는 시간.',
  },
  {
    no: 2,
    key: 'review',
    path: '/review',
    label: '검토',
    title: '신청서 검토와 판정',
    owner: 'AX 담당자',
    summary: '접수된 신청서를 열람하고, 무엇을 먼저 할지 정하고, 수용·반려·보류를 판정한다.',
  },
  {
    no: 3,
    key: 'agreement',
    path: '/agreement',
    label: '협의안',
    title: '협의안과 합격 기준',
    owner: 'AX 담당자 × 현업 부서',
    summary: '부서와 합의한 내용을 문서로 굳힌다. 무엇을 통과로 볼지(합격 기준)를 만들기 전에 정한다.',
  },
  {
    no: 4,
    key: 'build',
    path: '/build',
    label: '제작',
    title: '제작 과정',
    owner: 'AX 담당자',
    summary: '실제로 만든다. 무엇을 어떻게 만들었고 어디서 막혔는지가 남는다.',
  },
  {
    no: 5,
    key: 'beta',
    path: '/beta',
    label: '베타 테스트',
    title: '베타 테스트 결과',
    owner: '현업 부서 × AX 담당자',
    summary: '실제 담당자가 써 본다. 합격 기준으로 판정하고, 떨어지면 제작으로 돌아간다.',
  },
  {
    no: 6,
    key: 'manual',
    path: '/manual',
    label: '사용법서',
    title: '사용법서',
    owner: 'AX 담당자',
    summary: '만든 사람이 없어도 부서가 계속 쓸 수 있게 하는 문서. 이게 없으면 인수인계가 아니다.',
  },
  {
    no: 7,
    key: 'deploy',
    path: '/deploy',
    label: '배포',
    title: '배포와 인수인계',
    owner: 'AX 담당자 → 현업 부서',
    summary: '실제로 동작하는 도구를 부서에 넘긴다. 여기서부터는 부서가 주인이다.',
  },
  {
    no: 8,
    key: 'result',
    path: '/result',
    label: '성과',
    title: '성과 정리',
    owner: 'AX 담당자',
    summary: '기준선 대비 무엇이 얼마나 달라졌는지. 차감할 것을 차감한 뒤의 숫자만 적는다.',
  },
]

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]))
export const STAGE_BY_PATH = Object.fromEntries(STAGES.map((s) => [s.path, s]))

export function stageByNo(no) {
  return STAGES.find((s) => s.no === no) ?? null
}

export function nextStage(key) {
  const cur = STAGE_BY_KEY[key]
  return cur ? stageByNo(cur.no + 1) : null
}

export function prevStage(key) {
  const cur = STAGE_BY_KEY[key]
  return cur ? stageByNo(cur.no - 1) : null
}
