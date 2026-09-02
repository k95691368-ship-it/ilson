// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import Field from '../src/components/Field.jsx'
import { handleRadioGroupKeyDown } from '../src/lib/radioGroup.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ROOT = process.cwd()
let container
let root

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
  }
  container?.remove()
  container = undefined
  root = undefined
})

describe('단일 테마 리디자인 계약', () => {
  it('실제 앱 진입점에는 테마 전환 기능이 없다', () => {
    const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8')
    const main = readFileSync(join(ROOT, 'src', 'main.jsx'), 'utf8')
    const themeCss = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8')

    expect(app).not.toContain('ThemeToggle')
    expect(main).not.toContain('ThemeProvider')
    expect(themeCss).not.toMatch(/\[data-theme=['"](?:light|dark)['"]\]/)
    expect(existsSync(join(ROOT, 'src', 'components', 'ThemeToggle.jsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src', 'context', 'ThemeContext.jsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src', 'lib', 'theme.js'))).toBe(false)
  })

  it('필수 입력과 오류 설명을 입력 요소에 직접 연결한다', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          Field,
          { label: '부서', required: true, hint: '소속을 고르세요.', error: '부서를 선택해 주세요.' },
          createElement('select', null, createElement('option', null, '선택'))
        )
      )
    })

    const control = container.querySelector('select')
    const label = container.querySelector('label')
    const describedIds = control.getAttribute('aria-describedby').split(' ')

    expect(control.required).toBe(true)
    expect(control.getAttribute('aria-required')).toBe('true')
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(label.htmlFor).toBe(control.id)
    expect(describedIds).toHaveLength(2)
    for (const id of describedIds) expect(document.getElementById(id)).not.toBeNull()
  })

  it('데이터 표마다 제목과 열 머리글 범위를 둔다', () => {
    const pagesDir = join(ROOT, 'src', 'pages')
    const pageFiles = readdirSync(pagesDir).filter((file) => file.endsWith('.jsx'))

    for (const file of pageFiles) {
      const source = readFileSync(join(pagesDir, file), 'utf8')
      const tables = source.match(/<table\b/g) ?? []
      if (!tables.length) continue

      expect(source.match(/<caption\b/g) ?? [], `${file}: caption`).toHaveLength(tables.length)
      for (const heading of source.match(/<th\b[^>]*>/g) ?? []) {
        expect(heading, `${file}: ${heading}`).toMatch(/scope="col"/)
      }
    }
  })

  it('시각적 카드 제목을 실제 문서 제목으로 제공한다', () => {
    const sourceDirs = [join(ROOT, 'src', 'pages'), join(ROOT, 'src', 'components')]

    for (const sourceDir of sourceDirs) {
      for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.jsx'))) {
        const source = readFileSync(join(sourceDir, file), 'utf8')
        expect(source, file).not.toMatch(/<(?:span|div) className="card-title"/)
      }
    }
  })

  it('표시되는 입력 오류를 알림과 해당 컨트롤에 연결한다', () => {
    const sourceDirs = [join(ROOT, 'src', 'pages'), join(ROOT, 'src', 'components')]
    let errors = 0
    let literalIds = 0

    for (const sourceDir of sourceDirs) {
      for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.jsx'))) {
        const source = readFileSync(join(sourceDir, file), 'utf8')
        const tags = source.match(/<(?:div|em|span)\b[^>]*className="field-error"[^>]*>/g) ?? []
        errors += tags.length

        for (const tag of tags) {
          expect(tag, file).toContain('role="alert"')
          expect(tag, file).toMatch(/\bid=(?:"[^"]+"|\{[^}]+\})/)

          const id = tag.match(/\bid="([^"]+)"/)?.[1]
          if (!id) continue
          literalIds += 1
          expect(source.split(id).length - 1, `${file}: ${id}`).toBeGreaterThan(1)
        }
      }
    }

    expect(errors).toBeGreaterThan(15)
    expect(literalIds).toBeGreaterThan(10)
  })

  it('단일 선택 오류는 이름 있는 radiogroup에 연결한다', () => {
    const sourceDirs = [join(ROOT, 'src', 'pages'), join(ROOT, 'src', 'components')]
    let radiogroups = 0
    let customRadios = 0

    for (const sourceDir of sourceDirs) {
      for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.jsx'))) {
        const source = readFileSync(join(sourceDir, file), 'utf8')
        const groupTags = source.match(/<[^>]+\brole="(?:group|radiogroup)"[^>]*>/gs) ?? []

        for (const tag of groupTags) {
          if (tag.includes('role="group"')) {
            expect(tag, `${file}: 일반 group에 필수·오류 상태를 두지 않는다`).not.toMatch(
              /aria-(?:required|invalid)=/
            )
            continue
          }

          radiogroups += 1
          expect(tag, `${file}: radiogroup 이름`).toMatch(/aria-(?:label|labelledby)=/)
          if (tag.includes('aria-invalid=')) {
            expect(tag, `${file}: radiogroup 오류 설명`).toContain('aria-describedby=')
          }
        }

        for (const tag of source.match(/<input\b[^>]*type="radio"[^>]*>/gs) ?? []) {
          expect(tag, `${file}: 개별 radio가 아닌 묶음에 오류를 둔다`).not.toContain('aria-invalid=')
        }

        for (const match of source.matchAll(/role="radio"/g)) {
          customRadios += 1
          const nearby = source.slice(Math.max(0, match.index - 320), match.index + 320)
          expect(nearby, `${file}: 사용자 정의 radio 선택 상태`).toContain('aria-checked=')
          expect(nearby, `${file}: 사용자 정의 radio 탭 순서`).toContain('tabIndex=')
        }
      }
    }

    expect(radiogroups).toBeGreaterThanOrEqual(9)
    expect(customRadios).toBeGreaterThanOrEqual(3)
  })

  it('버튼형 radio도 화살표 키로 다음 선택지로 이동한다', async () => {
    function RadioHarness() {
      const [choice, setChoice] = useState('a')
      return createElement(
        'div',
        { role: 'radiogroup', 'aria-label': '시험 선택', onKeyDown: handleRadioGroupKeyDown },
        ['a', 'b', 'c'].map((value) =>
          createElement(
            'button',
            {
              key: value,
              type: 'button',
              role: 'radio',
              'aria-checked': choice === value,
              tabIndex: choice === value ? 0 : -1,
              onClick: () => setChoice(value),
            },
            value
          )
        )
      )
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(RadioHarness)))

    const radios = [...container.querySelectorAll('[role="radio"]')]
    radios[0].focus()
    await act(async () => {
      radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(document.activeElement).toBe(radios[1])
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(radios[1].tabIndex).toBe(0)
  })

  it('반복 입력과 판정 묶음에도 읽을 수 있는 이름을 둔다', () => {
    const agreement = readFileSync(join(ROOT, 'src', 'pages', 'AgreementPage.jsx'), 'utf8')
    const build = readFileSync(join(ROOT, 'src', 'pages', 'BuildPage.jsx'), 'utf8')
    const thread = readFileSync(join(ROOT, 'src', 'components', 'Thread.jsx'), 'utf8')
    const similar = readFileSync(join(ROOT, 'src', 'components', 'SimilarNotice.jsx'), 'utf8')
    const priority = readFileSync(join(ROOT, 'src', 'pages', 'PriorityPage.jsx'), 'utf8')
    const tool = readFileSync(join(ROOT, 'src', 'pages', 'ToolPage.jsx'), 'utf8')
    const track = readFileSync(join(ROOT, 'src', 'pages', 'TrackPage.jsx'), 'utf8')

    expect(agreement).toContain('<Field label="부서" required>')
    expect(agreement).toContain('aria-label={`${m.title} 회의록`}')
    expect(agreement).toContain('aria-label="새 회의 제목"')
    expect(agreement).toContain('<Field label="종류">')
    expect(agreement).toContain('<Field label="내용" required>')
    expect(agreement).toContain('aria-label={`${r.dept} 요구사항을 고친 문장`}')
    expect(agreement).toContain('aria-label={`${r.dept} 요구사항 기각 사유`}')
    expect(agreement).toContain('aria-label={`${p.dept} 요구 내용`}')
    expect(agreement).not.toContain('<h4>')
    expect(build).toContain('aria-label="합칠 파일 선택"')
    expect(build).toContain('aria-label={`${q.external_code}에 해당하는 상품`}')
    expect(build).not.toContain('<h4>')
    expect(thread).toContain('<Field label="답변" required')
    expect(similar).toContain('label="우리 부서의 사정"')
    expect(priority).toContain('label="먼저 할 이유"')
    expect(tool).toContain('label="쓰지 못하는 이유"')
    expect(track).toContain('aria-labelledby={`signoff-criterion-${c.id}`}')
    expect(track).toContain('role="radiogroup"')
    expect(track).toContain('aria-label={`${c.body} — 다른 이유`}')
  })
})
