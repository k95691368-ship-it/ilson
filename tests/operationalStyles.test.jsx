// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
let style, fixture
beforeEach(() => {
  style = document.createElement('style')
  style.textContent = read('src/microsoft-design.css')
  document.head.append(style)
  fixture = document.createElement('div')
  fixture.innerHTML = `<section class="payoff"><div class="payoff-row"><div><span class="payoff-value">91원 추가 비용</span><span class="card-note">성공 확인 없음</span></div></div></section>
    <div class="who-ran"><label><span>돌리시는 분</span><input /></label></div>
    <div class="tool-limits"><span>3회 남음</span><span>10MB까지</span><span>브라우저에서 계산</span></div>
    <section class="accept-box"><div class="accept-head"><strong>받으셨습니까</strong><span>직접 확인</span></div><div class="accept-reject"><label><span>반려 이유</span><input /></label></div></section>
    <section class="verdict verdict-passed"><div class="verdict-head">통과</div></section>
    <section class="verdict verdict-blocked"><div class="verdict-head">배포 차단</div></section>
    <div class="result-card result-fail"><span class="result-mark">×</span><div class="result-evidence">확인 근거</div></div>`
  fixture.insertAdjacentHTML('beforeend', `<div class="review-layout"><nav class="review-list"><div class="review-list-head">접수함</div><ul><li><label class="review-pick"><input type="checkbox" /></label><button class="review-list-item on"><span class="review-list-top">접수</span><span class="review-list-title">검토할 신청서</span><span class="review-list-meta">소요 미기재</span></button></li></ul></nav><div class="review-detail">판정 내용</div></div>`)
  document.body.append(fixture)
})
afterEach(() => { fixture.remove(); style.remove() })
const css = selector => getComputedStyle(fixture.querySelector(selector))

it('separates figures from their qualifications and individual quota facts', () => {
  expect(css('.payoff-row').display).toBe('grid')
  expect(css('.payoff-row > div').flexDirection).toBe('column')
  expect(css('.tool-limits').display).toBe('flex')
  expect(css('.tool-limits').gap).not.toBe('normal')
})
it('keeps actor and acceptance inputs in labeled groups', () => {
  expect(css('.who-ran label').display).toBe('flex')
  expect(css('.accept-box').display).toBe('grid')
  expect(css('.accept-head').display).toBe('grid')
  expect(css('.accept-reject label').display).toBe('grid')
})
it('distinguishes pass, safety block and evidence without importing the retired stylesheet', () => {
  expect(css('.verdict-passed').backgroundColor).not.toBe(css('.verdict-blocked').backgroundColor)
  expect(css('.verdict-blocked .verdict-head').fontWeight).toBe('600')
  expect(css('.result-card').paddingTop).toBe('20px')
  expect(css('.result-evidence').whiteSpace).toBe('pre-wrap')
  expect(css('.result-evidence').overflowWrap).toBe('anywhere')
  expect(read('src/main.jsx')).not.toContain("'./App.css'")
})
it('distributes the review list and detail into usable desktop columns', () => {
  // Include the real preceding structural styles to catch cascade regressions.
  style.textContent = ['src/index.css', 'src/redesign.css', 'src/override.css', 'src/microsoft-design.css'].map(read).join('\n')
  expect(css('.review-layout').display).toBe('grid')
  expect(css('.review-layout').gridTemplateColumns).toBe('minmax(280px, 360px) minmax(0, 1fr)')
  expect(css('.review-layout').gap).toBe('24px')
  expect(css('.review-detail').minWidth).toBe('0')
  expect(css('.review-list li').display).toBe('flex')
  expect(css('.review-list-title').display).toBe('block')
  expect(css('.review-list-meta').display).toBe('block')
  expect(css('.review-list-item').textAlign).toBe('left')
})
it('keeps department columns and compared values aligned in the active stylesheet', () => {
  style.textContent = ['src/index.css', 'src/redesign.css', 'src/override.css', 'src/microsoft-design.css'].map(read).join('\n')
  fixture.insertAdjacentHTML('beforeend', `<div class="dept-grid"><div class="stack"><section>신청 목록</section></div><div class="stack"><section>후속 요청</section></div></div><div class="cmp-heads"><div class="cmp-head">왼쪽</div><div class="cmp-head">오른쪽</div></div><div class="cmp-texts"><blockquote class="cmp-text">내용 A</blockquote><blockquote class="cmp-text">내용 B</blockquote></div><div class="cmp-value-pair"><span>10분</span><span class="cmp-vs">≠</span><span>20분</span></div><div class="track-actions"><h2>다음 행동</h2><ol></ol></div>`)
  expect(css('.dept-grid').display).toBe('grid')
  expect(css('.dept-grid').gridTemplateColumns).toBe('minmax(0, 1.35fr) minmax(0, 1fr)')
  expect(css('.cmp-heads').display).toBe('grid')
  expect(css('.cmp-heads').gridTemplateColumns).toBe(css('.cmp-texts').gridTemplateColumns)
  expect(css('.cmp-value-pair').display).toBe('grid')
  expect(css('.cmp-value-pair').gridTemplateColumns).toBe('minmax(0, 1fr) auto minmax(0, 1fr)')
  expect(css('.cmp-value-pair').gap).toBe('12px')
  expect(css('.track-actions').gridTemplateColumns).not.toContain('repeat(2')
  fixture.insertAdjacentHTML('beforeend', '<div class="dept-grid empty-sidebar"><div class="stack"><section>신청 목록만 있음</section></div><div class="stack"></div></div>')
  expect(css('.empty-sidebar').gridTemplateColumns).toBe('minmax(0, 1fr)')
  expect(css('.empty-sidebar > .stack:last-child').display).toBe('none')
})
