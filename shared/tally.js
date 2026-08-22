// 채점 한 판의 결과를 센다.
//
// grade.js 에서 떼어 냈다. 서버(베타 회차 저장)는 이 함수 하나만 쓰는데,
// grade.js 는 맨 위에서 pipeline.js 를 끌어오고 그 pipeline 은 다시
// xlsx.js·csv.js·master.js 를 끌어온다. 파일을 합치는 일은 전부 브라우저에서
// 도는데도 **서버가 그 엔진을 통째로 지고 뜨고 있었다.** 세는 데 필요한 것은
// 1.4KB 인데 71KB 를 안고 시작한 셈이다. Workers 는 잠들었다 깰 때마다 그
// 짐을 다시 편다.

// 채점 결과 하나하나에서 합격 여부를 센다.
//
// 이 계산이 브라우저에만 있었다. 서버는 채점 결과 배열을 받아 놓고도 합격
// 여부만은 브라우저가 보낸 값을 그대로 적었다. 그래서 필수 안전 기준이 전부
// 실패인 채점을 "통과"라고 보내면 통과로 적혔고, 첫 화면의 단계도 넘어갔다.
// 라이브에서 실제로 그렇게 됐다.
//
// 이 사이트가 "그게 게이트입니다"라고 적어 둔 자리라서, 판정은 받는 쪽에서
// 다시 한다. 두 군데서 따로 세면 언젠가 갈라지므로 세는 함수는 이 하나다.
export function tally(list) {
  const graded = Array.isArray(list) ? list : []
  const machine = graded.filter((g) => g?.kind === 'rule')
  const passed = machine.filter((g) => g.verdict === '통과')
  const failed = machine.filter((g) => g.verdict === '실패')
  // 못 판정한 것. 실패도 통과도 아니다.
  const unjudged = machine.filter((g) => g.verdict === '판정불가')
  const safetyFailed = failed.filter(
    (g) => g.is_required_safety === 1 || g.is_required_safety === true
  )

  return {
    total: graded.length,
    machineChecked: machine.length,
    passed: passed.length,
    failed: failed.length,
    humanNeeded: graded.filter((g) => g?.kind === 'human').length,
    safetyFailed: safetyFailed.length,
    unjudged: unjudged.length,
    // 필수 안전 기준이 하나라도 깨지면 통과가 아니다. 다른 점수가 아무리
    // 좋아도 마찬가지다.
    //
    // 그리고 **못 판정한 것이 남아 있으면 통과가 아니다.** 안 본 것을 통과로
    // 세면 이 게이트는 안 보고 열어 주는 문이 된다. 여기가 "합격 기준을
    // 통과해야만 넘길 수 있습니다"라고 적어 둔 자리다.
    overall:
      failed.length > 0
        ? safetyFailed.length > 0
          ? '차단'
          : '조건부'
        : unjudged.length > 0
          ? '조건부'
          : '통과',
  }
}
