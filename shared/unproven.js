// 현재 조회로 확인한 기록과, 그 기록만으로 증명할 수 없는 한계를 구분한다.
// 인수인계+성과 기록의 존재는 여섯 단계 검증 완료가 아니며, 실행 횟수와
// 표본 합계는 장기 운영·통계적 신뢰성을 증명하지 않는다. 미조회는 0이 아니다.
function count(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  // SQL counts use decimal integer text. Reject a nonzero fractional part
  // before Number can round it to an integer or underflow it to zero.
  if (typeof v === 'string' && !/^\d+(?:\.0+)?$/.test(v.trim())) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

export function unprovenList(counts, context = {}) {
  const c = counts ?? {}
  const mode = context?.mode === 'demo' ? 'demo' : context?.mode === 'access' ? 'access' : 'unknown'
  const finished = count(c.finished) // 되돌리지 않은 인수인계+성과 기록이 있는 신청서 수
  const baselines = count(c.baselines) // 열람 가능한 기준선 기록 수
  const samples = count(c.baselineSamples) // 기준선별 sample_n의 합계
  const runs = count(c.runs) // 열람 가능한 실행 시도 기록 수

  return [
    {
      key: 'sample_size',
      title: baselines === null || samples === null ? '기준선 측정 수치를 확인하지 못했습니다'
        : baselines === 0 ? '열람 가능한 기준선 기록이 없습니다' : `기준선 ${baselines}건에 측정 ${samples}회가 기록됐습니다`,
      body: baselines === null || samples === null ? '기준선 수와 측정 표본 합계 중 확인되지 않은 값이 있습니다. 이를 0으로 취급하지 않습니다.'
        : '현재 접근 범위의 기준선 기록과 표본 합계입니다. 합계만으로 업무별 표본의 충분성이나 대표성을 판단하지 않습니다.',
      instead: '성과는 각 업무의 기준선·실행·검토 기록으로 계산합니다. 이 합계만으로 통계적 신뢰성이나 절감 효과를 확정하지 않습니다.',
    },
    {
      key: 'fake_data',
      title: mode === 'demo' ? '개인 체험의 기본 자료는 가상입니다'
        : mode === 'access' ? '입력 자료의 실제성은 별도 확인이 필요합니다' : '자료의 출처와 실행 환경을 확인하지 못했습니다',
      body: mode === 'demo' ? '기본 신청서와 예시는 가상 자료입니다. 사용자가 추가한 자료의 출처나 정확성까지 자동으로 검증하지는 않습니다.'
        : mode === 'access' ? '사내 모드는 인증된 계정이 열람할 수 있는 기록을 표시합니다. 계정 인증은 자료의 정확성이나 실제 회사 자료임을 증명하지 않습니다.'
          : '이 조회에는 확인된 실행 환경이나 자료 출처 정보가 없습니다. 자료가 가상인지 실제 회사 자료인지 단정하지 않습니다.',
      instead: mode === 'demo' ? '개인 체험의 기록은 방문자별 공간에 남습니다. 가상 예시만으로 실제 현업의 효과를 확정하지 않습니다.'
        : '원본·작성자·검토 근거를 별도로 확인하고, 확인한 범위에서만 자료와 성과를 해석합니다.',
    },
    {
      key: 'one_case',
      title: finished === null ? '인수인계·성과 기록 수를 확인하지 못했습니다'
        : finished === 0 ? '인수인계·성과 기록이 함께 있는 신청서가 없습니다' : `인수인계·성과 기록이 함께 있는 신청서 ${finished}건`,
      body: finished === null ? '해당 신청서 수가 확인되지 않았습니다. 확인되지 않은 값을 0건으로 표시하지 않습니다.'
        : '현재 접근 범위에서 되돌리지 않은 인수인계와 성과 기록이 함께 있는 수입니다. 여섯 단계의 검증 완료나 현업 효과를 보증하지 않습니다.',
      instead: mode === 'demo' ? '개인 체험은 로그인 없이 열 수 있습니다. 각 단계의 기록과 판정 근거는 별도로 확인해야 합니다.'
        : mode === 'access' ? '사내 운영은 인증된 계정과 허용된 접근 범위가 필요합니다. 각 단계의 기록과 판정 근거를 개별 확인합니다.'
          : '접근 상태와 각 단계의 기록을 확인해야 합니다. 이 건수만으로 실제 현장의 성과를 판단하지 않습니다.',
    },
    {
      key: 'no_ai',
      title: '정산·검산은 규칙으로 계산합니다',
      body: '파일 처리·정산·검산과 유사 신청서 검색은 정해진 규칙을 사용합니다. 규칙에 맞지 않는 자료는 격리될 수 있습니다.',
      instead: mode === 'demo' ? '개인 체험에서는 외부 AI 호출을 차단합니다. 최종 판정은 사람이 근거를 확인해야 합니다.'
        : mode === 'access' ? '사내 권한과 서버 설정이 충족되면 외부 AI 초안을 요청할 수 있습니다. 이 조회는 키 설정·호출 성공을 확인하지 않으며, 초안은 사람의 최종 승인을 대신하지 않습니다.'
          : '외부 AI의 설정이나 활성 상태는 이 조회로 확인하지 않습니다. 최종 판정은 사람이 근거를 확인해야 합니다.',
    },
    {
      key: 'not_operated',
      title: runs === null ? '도구 실행 기록 수를 확인하지 못했습니다'
        : runs === 0 ? '열람 가능한 도구 실행 기록이 없습니다' : `열람 가능한 도구 실행 기록 ${runs}회`,
      body: runs === null ? '실행 기록 수가 확인되지 않았습니다. 실행 이력이 없다고 단정하지 않습니다.'
        : '기록된 실행 시도 수입니다. 이 횟수만으로 실제 부서의 운영 기간이나 성공 완료·장기 활용 효과를 판단하지 않습니다.',
      instead: '성공 여부·검토·재작업·운영 기간의 근거를 따로 확인해야 합니다. 실행 횟수만으로 현업 성과를 확정하지 않습니다.',
    },
  ]
}
