import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 첫 화면 코드를 index 와 **동시에** 받아 오게 한다.
//
// 화면을 라우트 단위로 갈라 두면 좋은 점이 크지만, 첫 화면에는 대가가 있다.
// 브라우저가 index.js 를 다 받아 실행해야 그제서야 "아, FlowPage 도
// 필요하구나"를 알고 그때 받으러 간다. 왕복이 두 번 쌓인다 —
//
//   index.html  →  index.js  →  FlowPage.js  →  그제서야 그림
//
// 정적 import 로 바꾸면 이 왕복은 없어지지만, 부서가 직접 여는 도구
// 화면(/t/:slug)까지 첫 화면 코드를 같이 받게 된다. 한 화면을 다른 화면과
// 맞바꾸는 셈이다.
//
// modulepreload 는 그 맞바꿈이 없다. **받아만 두고 실행하지 않는다.**
// 첫 화면으로 들어온 사람은 왕복 하나를 벌고, 다른 화면으로 들어온 사람은
// 그리는 것을 막지 않는 자리에서 10KB 를 미리 받아 둘 뿐이다 — 그리고 이
// 사이트에서 그다음에 누르는 곳은 대개 첫 화면이다.
//
// 파일 이름에는 해시가 박혀 매 빌드마다 달라진다. 그래서 손으로 적지 않고
// 빌드가 끝난 뒤 실제로 나온 이름을 index.html 에 끼워 넣는다. 손으로 적으면
// 다음 빌드에서 조용히 없는 파일을 가리키게 된다.
function preloadHomeChunk() {
  let homeFile = null
  return {
    name: 'preload-home-chunk',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.facadeModuleId?.endsWith('FlowPage.jsx')) {
          homeFile = file
        }
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // 못 찾으면 아무것도 안 넣는다. 없는 파일을 가리키는 것보다 낫다.
        if (!homeFile) return html
        return html.replace(
          '</head>',
          `  <link rel="modulepreload" crossorigin href="/${homeFile}" />\n  </head>`
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), preloadHomeChunk()],
})
