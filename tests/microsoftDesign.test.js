// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const files = ['tokens', 'base', 'shell', 'workflows', 'records', 'operations'].map(name => `src/styles/${name}.css`)
const tokens = read(files[0])
const token = name => tokens.match(new RegExp('--' + name + ':\\s*(#[a-f0-9]{6})', 'i'))?.[1]
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + .05) / (dark + .05)
}

describe('single Microsoft design foundation', () => {
  it('uses the colors and spacing of the selected Microsoft document', () => {
    expect(token('ms-blue')).toBe('#0067b8')
    expect(token('ms-blue-bright')).toBe('#0078d4')
    expect(token('ms-ink')).toBe('#1a1a1a')
    expect(token('ms-border')).toBe('#d1d1d1')
    expect(tokens).toContain('--space-6: 24px')
    expect(tokens).toContain('--radius-card: 20px')
    expect(tokens).toContain('--radius-input: 12px')
  })
  it.each([
    ['ms-ink', 'ms-white'], ['ms-muted', 'ms-gray-050'], ['ms-white', 'ms-blue'],
    ['success-text', 'success-bg'], ['warning-text', 'warning-bg'], ['danger-text', 'danger-bg'],
  ])('keeps readable normal text for %s on %s', (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
  })
  it('replaces the legacy stylesheets instead of cascading another theme over them', () => {
    const entry = read('src/main.jsx')
    const imports = [...entry.matchAll(/import '\.\/(.+\.css)'/g)].map(match => `src/${match[1]}`)
    expect(imports).toEqual(files)
    for (const old of ['index', 'App', 'redesign', 'override', 'journey', 'microsoft-design']) {
      expect(existsSync(new URL(`../src/${old}.css`, import.meta.url)), old).toBe(false)
    }
    for (const file of files) {
      const source = read(file)
      expect(source).not.toMatch(/--apple-|SF Pro|Pretendard|backdrop-filter/)
    }
  })
  it('defines every custom property used by the new system', () => {
    const source = files.map(read).join('\n')
    const definitions = new Set([...source.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(match => match[1]))
    for (const [, name] of source.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) expect(definitions.has(name), name).toBe(true)
  })
  it('uses Segoe with Korean fallbacks and readable text sizes', () => {
    expect(tokens).toContain("'Segoe UI Variable'")
    expect(tokens).toContain("'Malgun Gothic'")
    const base = read(files[1])
    expect(base).toContain('400 17px/1.6 var(--font-sans)')
    expect(base).toContain('font-size: 40px')
    for (const file of files) {
      for (const match of read(file).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        expect(Number(match[1]), `${file}: ${match[0]}`).toBeGreaterThanOrEqual(12)
      }
    }
  })
  it('preserves focus, motion preferences and touch-sized controls', () => {
    const base = read(files[1])
    expect(base).toContain(':focus-visible')
    expect(base).toContain('prefers-reduced-motion: reduce')
    expect(base).toContain('min-height: 44px')
    expect(base).toContain('[hidden] { display: none !important; }')
  })
  it('keeps workspaces fluid while giving the entry a complete responsive layout', () => {
    const shell = read(files[2])
    expect(tokens).toContain('--page-max: 1760px')
    expect(shell).toContain('.app-main { width: 100%; max-width: var(--page-max); margin-inline: auto;')
    expect(shell).toContain('max-width: 1080px')
    expect(shell).toContain('.workspace-entry-panel { grid-template-columns: minmax(0, 1fr); }')
    expect(shell).toContain('.workspace-entry-actions > button { width: 100%; }')
  })
})
