// 이 도구를 언제 무엇으로 돌렸는가.
//
// 부서가 매주 정산을 돌린다. 그러다 "지난주엔 어떤 파일로 돌렸지"를 물을
// 일이 생긴다 — 숫자가 이상해서, 또는 누가 물어봐서. 지금은 답할 데가 없다.
// 결과 파일은 각자 내려받아 어딘가에 두었고, 무엇을 넣었는지는 아무도 안
// 적어 뒀다.
//
// 그런데 목록만 만들면 반쪽이다. 스무 줄을 늘어놓아도 사람은 이상한 것을
// 못 찾는다. 이번 실행이 지난번들과 얼마나 다른지를 시스템이 짚어 줘야 한다.
//
// 가장 흔한 사고는 **파일 하나를 빠뜨리고 돌리는 것**이다. 다섯 채널 중
// 넷만 올려도 도구는 아무 불평 없이 돌고, 결과는 그냥 좀 적을 뿐이다.
// 그 상태로 정산이 마감되면 한 채널 매출이 통째로 빠진다.

// 이만큼 적으면 뭔가 빠진 것으로 본다.
//
// 매주 오차는 있다. 20%는 명절 주간이나 프로모션으로도 나온다. 40%가
// 넘게 줄면 그건 흔들림이 아니라 빠진 것이다.
export const DROP_ALERT = 0.4

// 견줄 지난 실행이 이만큼은 있어야 한다.
//
// 한 번 돌린 것과 견주면 그 한 번이 이상했을 때 이번 것이 이상하다고
// 나온다. 셋을 놓고 가운뎃값을 본다.
export const MIN_HISTORY = 3

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  if (s.length === 0) return null
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function parseFiles(json) {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    if (Array.isArray(v)) return v.map((f) => (typeof f === 'string' ? { name: f } : f))
    return []
  } catch {
    return []
  }
}

// 실행 기록에 "이번엔 뭐가 달랐나"를 붙인다.
//
// 최근 것이 앞에 오는 목록을 받아, 각 실행을 그 **이전** 실행들과 견준다.
export function annotateRuns(rows) {
  const runs = (rows ?? []).map((r) => ({
    ...r,
    files: parseFiles(r.files_json),
  }))

  return runs.map((run, i) => {
    // 자기보다 전에 돌린 것들. 목록이 최근 순이라 뒤쪽이 과거다.
    const past = runs.slice(i + 1).filter((p) => p.ok)
    const flags = []

    if (!run.ok) {
      flags.push({
        kind: 'failed',
        text: run.fail_reason
          ? `돌다가 멈췄습니다 — ${run.fail_reason}`
          : '돌다가 멈췄습니다.',
      })
      return { ...run, flags, comparable: past.length >= MIN_HISTORY }
    }

    if (past.length >= MIN_HISTORY) {
      const base = median(past.map((p) => p.rows_out))
      if (base > 0) {
        const drop = (base - run.rows_out) / base
        if (drop >= DROP_ALERT) {
          flags.push({
            kind: 'fewer_rows',
            text: `여느 때보다 ${Math.round(drop * 100)}% 적게 처리했습니다 (${run.rows_out}줄, 보통 ${base}줄). 파일을 빠뜨리고 돌리셨을 수 있습니다.`,
          })
        }
      }

      // 파일 개수가 줄어든 것도 같이 본다. 줄 수는 그대로인데 파일이
      // 하나 빠진 경우가 있다 — 그 채널이 원래 작을 때.
      const baseFiles = median(past.map((p) => p.files.length))
      if (baseFiles > 0 && run.files.length < baseFiles) {
        flags.push({
          kind: 'fewer_files',
          text: `파일을 ${run.files.length}개 올리셨습니다. 보통 ${baseFiles}개를 올리셨습니다.`,
        })
      }
    }

    if (run.quarantined > 0 && run.rows_out > 0) {
      const ratio = run.quarantined / (run.rows_out + run.quarantined)
      if (ratio >= 0.2) {
        flags.push({
          kind: 'many_quarantined',
          text: `밀려난 줄이 ${Math.round(ratio * 100)}%입니다. 양식이 바뀌었을 수 있습니다.`,
        })
      }
    }

    return { ...run, flags, comparable: past.length >= MIN_HISTORY }
  })
}

// 이 도구를 쓴 사람들.
//
// 한 사람만 쓰고 있으면 그 사람이 자리를 비웠을 때 멈춘다. 인수인계가
// 안 된 것이라 담당자가 알아야 한다.
export function usersOf(runs) {
  const map = new Map()
  for (const r of runs ?? []) {
    const who = String(r.actor_label ?? '').trim() || '이름 없음'
    if (!map.has(who)) map.set(who, { who, runs: 0, lastAt: null })
    const u = map.get(who)
    u.runs += 1
    if (!u.lastAt || String(r.used_at) > String(u.lastAt)) u.lastAt = r.used_at
  }
  return [...map.values()].sort((a, b) => b.runs - a.runs || a.who.localeCompare(b.who, 'ko'))
}

export function summarizeRuns(runs) {
  const list = runs ?? []
  const okRuns = list.filter((r) => r.ok)
  return {
    total: list.length,
    failed: list.length - okRuns.length,
    rows: okRuns.reduce((s, r) => s + (r.rows_out ?? 0), 0),
    quarantined: okRuns.reduce((s, r) => s + (r.quarantined ?? 0), 0),
    flagged: list.filter((r) => (r.flags ?? []).length > 0).length,
    users: usersOf(list).length,
  }
}
