import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onRequestGet as readOverview } from '../functions/api/overview.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 세어 놓고 아무도 안 읽는 값.
//
// 한 번 훑어보니 열일곱 개가 있었다. 첫 화면을 열 때마다 기준선 표를 통째로
// 읽어 개수만 세고 버리는 쿼리가 돌았고, 도구 목록은 '뜸해짐'과 '실패 있음'을
// 각각 세어 응답에 실었는데 화면은 그 둘을 한 번도 안 읽었다.
//
// 이게 왜 나쁜가. 느려서가 아니다. **응답을 읽는 사람이 무엇이 진짜 쓰이는
// 값인지 알 수 없게 되기 때문이다.** 화면을 고치려고 응답을 열어 보면 스무
// 개가 넘는 이름이 나오는데 그중 절반은 아무 데도 안 닿는다. 그러면 다음
// 사람은 새 값을 더할 때도 "어차피 안 읽히겠지"로 더한다.
//
// 늘어나는 것을 사람이 눈으로 막을 수는 없다. 그래서 여기서 센다.

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.[jt]sx?$/.test(p)) out.push(p)
  }
  return out
}

const apiFiles = walk(join(ROOT, 'functions', 'api'))
const readerText = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared'))]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// 응답 объекта 안의 키처럼 보이는 것만 본다. 들여쓰기가 있는 `이름:` 줄.
function responseKeys(src) {
  return [...src.matchAll(/^\s{4,10}(\w{4,}):/gm)].map((m) => m[1])
}

// 서버끼리만 주고받는 이름들. 응답 키가 아니라 함수에 넘기는 값이다.
const NOT_RESPONSE = new Set([
  'linkKind',
  'linkId',
  'applicationId',
  'stage',
  'actor',
  'title',
  'what',
  'why',
  'alternatives',
  'unrequested',
  // Anthropic로 보내는 요청과 감사 로그 내부 상세. 브라우저 응답이 아니다.
  'max_tokens',
  'messages',
  'call_id',
  'redirect',
  'response_status',
  'row_count',
  // record_volume의 감사 로그 상세. 화면에서는 detail 객체 전체를 표시한다.
  'total_cases',
  'applicable_cases',
])

// 첫 화면의 운영 요약을 삭제해도 이번 화면 변경에서 기존 API 응답 계약까지
// 없애지는 않는다. 현재 화면에서 쓰지 않는 기존 필드만 정확히 열거한다.
// 새 필드는 이 예외에 자동으로 포함되지 않으며, API 폐기 작업 때 함께 제거한다.
const RETAINED_OVERRIDE_FIELDS = new Set([
  'priority_band', 'total_decisions', 'recurring_exception_rate',
  'capture_completeness', 'reason_confirmation_rate', 'average_recording_seconds',
  'pending_validation', 'active_clusters', 'p0_clusters', 'root_cause_days',
  'assigned_rate', 'experiment_conversion_rate', 'in_experiment',
  'verified_improvements', 'rework_cost_krw',
])

// /portfolio와 FlowPage는 의도적으로 폐기했지만, 이번 변경은 UI 교체다.
// 그 화면에서만 읽던 아래 7개 필드는 기존 /api/overview 응답 계약으로
// 보존한다. 다른 API의 동명 필드나 이후 추가하는 필드는 면제하지 않는다.
const RETAINED_OVERVIEW_FIELDS = new Set([
  'refuseRate', 'refuseMix', 'fastest', 'slowest',
  'handedOver', 'recentDecisions', 'unrequestedCount',
])
const OVERVIEW_FILE = join(ROOT, 'functions', 'api', 'overview.js')

function retainedResponseField(file, key) {
  return (file === join(ROOT, 'functions', 'api', 'override.js') && RETAINED_OVERRIDE_FIELDS.has(key))
    || (file === OVERVIEW_FILE && RETAINED_OVERVIEW_FIELDS.has(key))
}

describe('아무도 안 읽는 값을 응답에 싣지 않는다', () => {
  it('서버가 만든 이름은 화면이나 shared 에 닿는다', () => {
    const dead = []
    for (const f of apiFiles) {
      for (const key of responseKeys(readFileSync(f, 'utf8'))) {
        if (NOT_RESPONSE.has(key)) continue
        if (retainedResponseField(f, key)) continue
        if (!readerText.includes(key)) {
          dead.push(`${f.slice(ROOT.length)} — ${key}`)
        }
      }
    }
    expect([...new Set(dead)]).toEqual([])
  })

  it('이 검사가 헛돌지 않는다', () => {
    // 실제로 쓰이는 이름은 걸러 낸다. 늘 빈 배열이면 아무것도 안 지킨다.
    expect(readerText).toContain('remainingToday')
    expect(readerText).toContain('quarantineTotal')
    // 그리고 지운 이름은 정말로 안 닿아야 한다.
    // awaitingAccept·noManual 은 사용법서·배포 단계를 걷어내면서 같이 지웠다.
    for (const gone of ['rowsProcessed', 'quarantineLiveTools', 'toolsAffected', 'awaitingAccept', 'noManual']) {
      expect(readerText.includes(gone), gone).toBe(false)
    }
  })
})

describe('폐기한 업무 현황 화면의 기존 API 계약', () => {
  it('기존 7개 키만 overview에 한정하여 보존한다', () => {
    expect([...RETAINED_OVERVIEW_FIELDS]).toEqual([
      'refuseRate', 'refuseMix', 'fastest', 'slowest',
      'handedOver', 'recentDecisions', 'unrequestedCount',
    ])
    const emitted = responseKeys(readFileSync(OVERVIEW_FILE, 'utf8'))
    for (const key of RETAINED_OVERVIEW_FIELDS) {
      expect(emitted, key).toContain(key)
      expect(retainedResponseField(OVERVIEW_FILE, key), key).toBe(true)
      for (const file of apiFiles.filter(file => file !== OVERVIEW_FILE)) {
        expect(retainedResponseField(file, key), `${file} — ${key}`).toBe(false)
      }
    }
    expect(retainedResponseField(OVERVIEW_FILE, 'newUnusedOverviewField')).toBe(false)
    expect(retainedResponseField(OVERVIEW_FILE, 'priority_band')).toBe(false)
  })

  it('실제 GET 응답은 비어 있는 기록에서도 7개 필드의 위치와 빈 값 계약을 유지한다', async () => {
    const statement = {
      bind() { return this },
      all: async () => ({ results: [] }),
      first: async () => ({ n: 0 }),
    }
    const response = await readOverview({ env: { DB: { prepare: () => statement } } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      refuseRate: null,
      refuseMix: [],
      lead: { fastest: null, slowest: null },
      tools: { handedOver: 0 },
      recentDecisions: [],
      unrequestedCount: 0,
    })
  })
})
