// 시연용 신청서.
//
// 검토 화면은 신청서가 한 건만 있으면 아무것도 보여주지 못한다. 우선순위는
// 여럿을 놓고 견주는 일이고, 반려는 "이건 되고 이건 안 된다"의 대비에서
// 뜻이 생긴다. 그래서 서로 성격이 다른 여덟 건을 심는다.
//
// 그중 둘은 반려될 것이다 — 외부 시스템에 쓰는 일과 이미지 시안을 만드는 일.
// 하나는 보류다 — 원천에 필요한 구분 자체가 없는 일. 나머지는 수용이지만
// 순서가 다르다.
//
// 전부 가상이다. 실존하는 회사·부서·사람이 아니다.

export const DEMO_APPLICATIONS = [
  {
    ticket_no: 'AX-DEM-001',
    dept: '재무',
    applicant_label: '정산 담당자',
    contact: '사내 메신저 finance01',
    title: '매주 채널 정산서를 손으로 붙입니다',
    bottleneck:
      '월요일 아침에 채널 다섯 군데 정산서를 각각 받아서 새 시트에 하나씩 붙입니다. 자사몰과 오픈마켓은 CSV, 오프라인 채널은 엑셀, 해외 두 곳은 통화가 다르고 시트도 월별로 나뉘어 있습니다. 컬럼 이름이 전부 달라서 순서 맞추는 데 가장 오래 걸립니다.',
    problem:
      '지난주에는 오프라인 채널 파일 맨 아래 합계 줄을 같이 붙여서 매출이 두 배로 나왔는데, 화요일에 영업팀이 "이번 주 대박이네요?" 해서야 알았습니다. 그런 게 아니면 틀려도 대개 모르고 지나갑니다.',
    wish: '파일만 올리면 하나로 합쳐진 표가 나왔으면 합니다. 수수료와 원가를 뺀 금액까지요.',
    impact_if_wrong:
      '대표님 주간 보고에 들어가는 숫자입니다. 마감 넘어가면 정정 공시까지 가는 일이라 1원도 틀리면 안 됩니다.',
    current_minutes: 100,
    current_people: 1,
    current_frequency: '주 1회',
    days_ago: 12,
  },
  {
    ticket_no: 'AX-DEM-002',
    dept: '재무',
    applicant_label: '정산 담당자',
    title: '정산 결과를 ERP에 자동으로 등록해주세요',
    bottleneck:
      '정산 취합이 끝나면 그 결과를 ERP 매출 모듈에 사람이 다시 타이핑해서 넣습니다. 취합한 엑셀을 보면서 한 줄씩 옮깁니다.',
    problem:
      '옮겨 적다가 자리를 놓치면 ERP 숫자와 엑셀 숫자가 달라집니다. 그러면 어느 쪽이 맞는지부터 확인해야 해서 반나절이 갑니다.',
    wish: 'ERP에 자동으로 등록되면 좋겠습니다.',
    impact_if_wrong: '회계 마감이 밀립니다.',
    current_minutes: 40,
    current_people: 1,
    current_frequency: '주 1회',
    days_ago: 10,
  },
  {
    ticket_no: 'AX-DEM-003',
    dept: 'SCM',
    applicant_label: '수급 담당자',
    title: '재고 소진일 2주 미만 품목을 매주 확인합니다',
    bottleneck:
      '재고 파일과 판매 파일을 따로 받아서 엑셀에서 브이룩업으로 붙입니다. 상품코드가 서로 달라서 손으로 맞추는 것도 있습니다.',
    problem:
      '붙이다 실수하면 결품이 납니다. 지난 분기에 실제로 한 품목이 2주 결품 났고, 그때 판매 기회를 놓쳤습니다.',
    wish: '소진일이 짧은 품목만 자동으로 뜨면 좋겠습니다.',
    impact_if_wrong: '결품이 나면 그 주 매출이 그대로 빠집니다.',
    current_minutes: 55,
    current_people: 1,
    current_frequency: '주 1회',
    days_ago: 6,
  },
  {
    ticket_no: 'AX-DEM-004',
    dept: '마케팅',
    applicant_label: '퍼포먼스 담당자',
    title: '기여이익 기준 ROAS를 보고 싶습니다',
    bottleneck:
      '광고비는 광고 관리자에서 받고 매출은 정산서에서 받는데, 둘을 제품 단위로 붙이는 게 매번 오래 걸립니다.',
    problem:
      '지금은 매출 ROAS만 봅니다. 수수료율이 높은 채널은 매출이 잘 나와도 실제로는 남는 게 없는데 그걸 모르고 광고비를 더 씁니다.',
    wish: '수수료와 원가를 뺀 뒤의 ROAS가 채널별·제품별로 보였으면 합니다.',
    impact_if_wrong: '광고비를 잘못된 채널에 계속 넣게 됩니다.',
    current_minutes: 120,
    current_people: 1,
    current_frequency: '격주',
    days_ago: 4,
  },
  {
    ticket_no: 'AX-DEM-005',
    dept: '영업',
    applicant_label: '영업기획 담당자',
    title: '점포별 주간 실적을 담당자별로 잘라서 보냅니다',
    bottleneck:
      '전체 실적표를 받아서 담당자 여덟 명 각자의 점포만 남기고 잘라 냅니다. 여덟 번 같은 일을 합니다.',
    problem: '가끔 담당이 바뀐 점포를 예전 담당자에게 보내서 혼선이 생깁니다.',
    wish: '담당자별로 자동으로 나뉘면 좋겠습니다.',
    impact_if_wrong: '엉뚱한 사람이 남의 점포 숫자를 봅니다.',
    current_minutes: 35,
    current_people: 1,
    current_frequency: '주 1회',
    days_ago: 2,
  },
  {
    ticket_no: 'AX-DEM-006',
    dept: '운영',
    applicant_label: 'CS 파트장',
    title: '고객문의를 유형별로 분류해서 나눠줍니다',
    bottleneck:
      '매일 아침 문의 엑셀을 받아서 유형을 보고 담당자에게 배분합니다. 하루 200건 정도 됩니다.',
    problem:
      '분류 기준이 사람마다 달라서 월말 통계가 맞지 않습니다. 같은 문의를 어떤 날은 배송, 어떤 날은 교환으로 넣습니다.',
    wish: '유형이 자동으로 붙고, 기준이 한 가지로 유지되면 좋겠습니다.',
    impact_if_wrong: '통계가 틀리면 어디를 개선할지 판단이 틀립니다.',
    current_minutes: 45,
    current_people: 2,
    current_frequency: '매일',
    days_ago: 2,
  },
  {
    ticket_no: 'AX-DEM-007',
    dept: '마케팅',
    applicant_label: '콘텐츠 담당자',
    title: '신제품 상세페이지 시안을 자동으로 만들어주세요',
    bottleneck: '신제품이 나올 때마다 디자인팀 일정에 막혀서 2주씩 기다립니다.',
    problem: '출시일은 정해져 있는데 상세페이지가 늦어서 초기 판매를 놓칩니다.',
    wish: '시안이 자동으로 나오면 그걸 다듬어서 쓰겠습니다.',
    impact_if_wrong: '출시 초기 판매를 놓칩니다.',
    current_minutes: null,
    current_people: null,
    current_frequency: '비정기',
    days_ago: 8,
  },
  {
    ticket_no: 'AX-DEM-008',
    dept: '재무',
    applicant_label: '세무 담당자',
    title: '분기 부가세 신고용 과세·면세 구분',
    bottleneck: '채널 정산서에 과세인지 면세인지가 없어서 매번 세무사무소에 물어봅니다.',
    problem: '답을 기다리는 동안 신고 준비가 멈춥니다. 분기마다 사흘씩 밀립니다.',
    wish: '자동으로 구분되면 좋겠습니다.',
    impact_if_wrong: '신고가 틀리면 가산세가 나옵니다.',
    current_minutes: 180,
    current_people: 1,
    current_frequency: '분기',
    days_ago: 9,
  },
]
