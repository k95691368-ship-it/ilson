// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const design = read('src/microsoft-design.css')
const token = name => design.match(new RegExp('--' + name + ':\\s*(#[a-f0-9]{6})', 'i'))?.[1]
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + .05) / (dark + .05)
}

describe('shared Microsoft-style design contract', () => {
  it.each([
    ['ms-ink', 'ms-paper'], ['ms-muted', 'ms-parchment'], ['ms-paper', 'ms-blue'],
    ['success-text', 'success-bg'], ['warning-text', 'warning-bg'], ['danger-text', 'danger-bg'],
  ])('keeps normal text contrast for %s on %s', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
  })
  it('uses the readable warning token in shared OverrideLoop badges', () => {
    expect(design).toContain('--ol-amber: var(--warning-text)')
  })
  it('does not leave undefined Apple variables or a second heading font in active styles', () => {
    const override = read('src/override.css')
    expect(override).not.toContain('--apple-')
    expect(override).not.toMatch(/font-family:.*(?:SF Pro|Pretendard)/)
    expect(design).toContain("'Segoe UI Variable'")
    expect(design).toContain("'Malgun Gothic'")
  })
  it('keeps metadata at least 12px with the 16px root', () => {
    for (const file of ['src/index.css', 'src/redesign.css', 'src/override.css']) {
      for (const match of read(file).matchAll(/font(?:-size)?:[^;{}\n]*?(0\.\d+)rem/g)) {
        expect(Number(match[1]), file + ': ' + match[0]).toBeGreaterThanOrEqual(.75)
      }
    }
  })
  it('loads the common design after the structural styles', () => {
    const entry = read('src/main.jsx')
    expect(entry.indexOf("'./microsoft-design.css'")).toBeGreaterThan(entry.indexOf("'./override.css'"))
    expect(read('src/journey.css')).toContain('var(--ms-blue)')
  })
  it('uses the available workspace width without stretching introductory prose', () => {
    expect(design).toMatch(/--page-max:\s*100%;/)
    expect(design).toContain('.ol-page, .ol-skeleton { width: 100%; }')
    expect(design).toMatch(/\.site-nav-inner\s*\{[^}]*var\(--page-max\)/)
    expect(design).toMatch(/\.app-main\s*\{[^}]*var\(--page-max\)/)
    expect(design).toMatch(/\.stage-head \.page-sub\s*\{[^}]*max-width:\s*760px/)
    expect(read('src/override.css')).toMatch(/\.ol-page-intro p\s*\{[^}]*max-width:\s*660px/)
  })
})
