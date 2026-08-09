import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickPrimary, holdCondition } from '../shared/merge.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 판정만 하고 아무 일도 안 일어나면, 담당자는 끝났다고 생각하고 부서는
// 아무 소식이 없다고 생각한다. 둘 다 상대가 뭘 하고 있는 줄 안다.
//
// 그리고 잘못 묶으면 더 나쁘다. 진행 중인 것을 접수만 된 것에 묶으면
// 그 진행이 통째로 끊긴다.

const app = (id, ticket, created, status = '접수', dept = '재무') => ({
  id,
  ticket_no: ticket,
  dept,
  status,
  created_at: created,
})

describe('어느 쪽을 남기는가', () => {
  it('먼저 낸 쪽을 남긴다', () => {
    // 나중 것을 남기면 이미 검토를 받았거나 만들어지고 있는 진행이 끊긴다.
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    const b = app('b', 'AX-BBB-002', '2026-07-28 09:00:00')
    expect(pickPrimary(a, b).primary.id).toBe('a')
    expect(pickPrimary(a, b).merged.id).toBe('b')
  })

  it('넣는 순서를 바꿔도 같은 답이 나온다', () => {
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    const b = app('b', 'AX-BBB-002', '2026-07-28 09:00:00')
    expect(pickPrimary(b, a).primary.id).toBe('a')
  })

  it('먼저 낸 것이 반려됐으면 그쪽으로 안 묶는다', () => {
    // 반려된 것에 묶으면 부서는 "왜 내 신청서가 반려된 것에 붙었지"가 된다.
    const dead = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '반려')
    const alive = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '접수')
    const r = pickPrimary(dead, alive)
    expect(r.primary.id).toBe('b')
    expect(r.merged.id).toBe('a')
  })

  it('둘 다 반려됐으면 묶을 것이 없다', () => {
    const r = pickPrimary(
      app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '반려'),
      app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '반려')
    )
    expect(r.primary).toBeNull()
    expect(r.blocked).toContain('반려')
  })

  it('나중에 냈어도 더 나아간 쪽을 남긴다', () => {
    // 처음에는 반대로 만들었다. 라이브에서 실제로 묶어 보니 여덟 단계를
    // 다 거쳐 도구까지 배포된 신청서가 접수만 된 신청서에 묶여 보류로
    // 내려갔다. 해 놓은 일이 통째로 선반에 올라갔다.
    const first = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '접수')
    const later = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '진행중')
    expect(pickPrimary(first, later).primary.id).toBe('b')
    expect(pickPrimary(first, later).merged.id).toBe('a')
  })

  it('진행이 같으면 그때 먼저 낸 쪽을 남긴다', () => {
    const first = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '수용')
    const later = app('b', 'AX-BBB-002', '2026-07-28 09:00:00', '수용')
    expect(pickPrimary(first, later).primary.id).toBe('a')
  })

  it('모르는 상태는 아는 척하고 위로 올리지 않는다', () => {
    const known = app('a', 'AX-AAA-001', '2026-07-28 09:00:00', '접수')
    const weird = app('b', 'AX-BBB-002', '2026-07-20 09:00:00', '처음 보는 상태')
    expect(pickPrimary(known, weird).primary.id).toBe('a')
  })

  it('같은 신청서끼리는 묶지 않는다', () => {
    const a = app('a', 'AX-AAA-001', '2026-07-20 09:00:00')
    expect(pickPrimary(a, a).blocked).toBeTruthy()
  })

  it('한쪽이 없으면 막는다', () => {
    expect(pickPrimary(app('a', 'AX-AAA-001', '2026-07-20 09:00:00'), null).blocked).toBeTruthy()
    expect(pickPrimary(null, null).blocked).toBeTruthy()
  })
})

// alreadyMerged·mergeNotice·validateMerge 세 함수를 여기서 확인했었다.
// 셋 다 어디서도 안 불렸다 —
//
//   · mergeNotice 가 만드는 문장은 부서 조회 화면(TrackPage)이 자기 안에
//     똑같이 적어 두고 쓴다. 같은 말이 두 군데 있었다.
//   · validateMerge 가 정한 "근거 없이 묶지 마라"는 규칙은 묶는 라우트
//     (functions/api/compare.js)가 자기 안에서 직접 본다.
//   · alreadyMerged 는 부르는 데가 아예 없었다.
//
// 안 쓰이는 사본을 남겨 두면 다음 사람이 그쪽을 고치고 화면은 안 바뀐다.
// 지웠고, 실제로 지키고 있는 자리를 아래에서 확인한다.

describe('부서에게 뭐라고 말하는가', () => {
  const primary = app('a', 'AX-AAA-001', '2026-07-20 09:00:00', '진행중', '재무')

  it('보류 사유를 그 신청서 번호로 적는다', () => {
    // 화면마다 다른 말로 적으면 부서가 다른 일인 줄 안다.
    expect(holdCondition(primary)).toContain('AX-AAA-001')
    expect(holdCondition(primary)).toContain('배포되면')
  })

  it('버린 것이 아니라는 말이 부서 화면에 실제로 있다', () => {
    // "중복입니다"로 끝내면 부서는 자기 신청서가 버려진 줄 안다.
    const page = readFileSync(join(ROOT, 'src', 'pages', 'TrackPage.jsx'), 'utf8')
    expect(page).toContain('안 하는 것이 아닙니다')
    expect(page).toContain('함께 처리합니다')
  })
})

describe('묶을 때 받는 것', () => {
  it('근거 없이 묶는 것을 라우트가 막는다', () => {
    // 규칙을 두 군데 두지 않는다. 지키는 쪽이 여기다.
    const route = readFileSync(join(ROOT, 'functions', 'api', 'compare.js'), 'utf8')
    expect(route).toContain('reason.length < 5')
    expect(route).toContain('왜 그렇게 판정했는지')
  })
})
