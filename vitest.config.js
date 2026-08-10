import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// 시험만의 설정.
//
// vitest 는 vitest.config.js 가 있으면 vite.config.js 를 **대신** 쓴다. 그냥
// 새로 쓰면 React 플러그인이 빠져서 나중에 .jsx 를 불러오는 시험을 하나
// 쓰는 순간 이유 모를 문법 오류가 난다. 그래서 합친다.
//
// 기본 제한 시간 5초를 늘린다. 시험 하나가 5초씩 걸려서가 아니라,
// tests/handlerSmoke.test.js 와 tests/todoWiring.test.js 가 **시험 안에서**
// 라우트 파일을 걸어 다니며 import 하기 때문이다. 그 import 는 처음 불릴 때
// 파일을 변환한다 — 변환 시간이 시험 시간으로 계산된다. 시험 파일 47개가
// 동시에 도는 차가운 실행에서는 그 한 번이 5초를 넘긴다.
//
// 실제로 그랬다. tests/outcome.test.js 의 "연간 횟수 표가 어긋나지 않았다"가
// 전체 실행에서만 시간 초과로 떨어지고 그 파일만 따로 돌리면 통과했다.
// 이런 실패는 코드가 멀쩡한데 빨간 불이 켜지는 것이라, 몇 번 겪으면
// 빨간 불을 안 믿게 된다. 그게 진짜 손해다.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // 화면을 실제로 그려 보는 시험(tests/pageRender.test.jsx)을 넣으면서
    // 걸렸다. vitest 는 노드 쪽 변환에서 esbuild 를 쓰는데 그때 JSX 를
    // 옛 방식(React.createElement)으로 바꾼다. src/ 의 화면 파일은 React 를
    // import 하지 않으므로 그리는 순간 "React is not defined" 가 난다.
    // 코드가 멀쩡한데 시험만 빨간 불이 되는 종류라 여기서 맞춰 둔다.
    esbuild: { jsx: 'automatic' },
    test: {
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  })
)
