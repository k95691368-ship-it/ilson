// 합격 기준으로 채점한다.
//
// 3단계에서 부서와 합의해 정한 기준을, 4단계에서 나온 결과에 대고 판정한다.
// 사람이 눈으로 맞춰 보지 않는다 — 시험 파일을 만들 때 정답도 같이 만들어
// 뒀기 때문에 기계가 대조할 수 있다.
//
// 각 판정은 통과/실패만 말하지 않는다. **무엇을 근거로 그렇게 판단했는지**를
// 함께 남긴다. "실패"만 있으면 어디를 고쳐야 할지 알 수 없다.

import { runPipeline } from './pipeline.js'
import { tally } from './tally.js'

const KRW_TOLERANCE = 0 // 금액은 1원도 봐주지 않는다. 재무가 그렇게 요구했다.

function pass(evidence) {
  return { passed: true, evidence }
}
function fail(evidence, samples = []) {
  return { passed: false, evidence, samples }
}

// 정답표가 없을 때 쓴다.
//
// 시연 파일 다섯 장을 걷어내면서 함께 만들어 뒀던 정답표도 없앴다. 정답이
// 없는데 정답 대조 기준을 **실패**로 적으면 도구가 틀린 것처럼 보인다.
// 틀린 것이 아니라 **판정할 수 없는 것**이다. 그 둘을 같은 칸에 적으면
// 이 화면의 통과율이 거짓말이 된다.
function cannotJudge(what) {
  return {
    passed: null,
    evidence: `${what} 정답표가 없어 기계가 판정하지 못했습니다. 넣으신 파일의 정답을 이 사이트는 모릅니다.`,
  }
}

// ─────────────────────────────────────────────────────────────
// 기준별 채점
// ─────────────────────────────────────────────────────────────

const CHECKS = {
  // 채널별 순매출이 정답과 같은가
  amount_exact({ result, truth }) {
    if (!truth?.agg_by_channel) return cannotJudge('채널별 금액')
    const mine = new Map(result.totals.byChannel.map((t) => [t.channel, t]))
    const diffs = []
    for (const t of truth.agg_by_channel) {
      const got = mine.get(t.channel)
      const diff = Math.round((got?.net_revenue_krw ?? 0) - t.net_revenue_krw)
      if (Math.abs(diff) > KRW_TOLERANCE) {
        diffs.push({ 채널: t.channel, 나온값: Math.round(got?.net_revenue_krw ?? 0), 정답: Math.round(t.net_revenue_krw), 차이: diff })
      }
    }
    return diffs.length === 0
      ? pass(`채널 ${truth.agg_by_channel.length}곳 모두 정답과 오차 0원`)
      : fail(`${diffs.length}개 채널에서 금액이 다릅니다.`, diffs)
  },

  // 검토함으로 빼야 할 줄을 빠짐없이 뺐는가
  quarantine_complete({ result, truth }) {
    if (!truth?.quarantine) return cannotJudge('검토함으로 뺄 줄의')
    const mine = new Set(
      result.quarantine.map((q) => `${q.source.file}|${q.source.sheet ?? ''}|${q.source.rowNo}`)
    )
    const missed = truth.quarantine.filter(
      (t) => !mine.has(`${t.source_file}|${t.source_sheet}|${t.source_row_no}`)
    )
    return missed.length === 0
      ? pass(`빼야 할 ${truth.quarantine.length}줄을 모두 뺐습니다.`)
      : fail(
          `${missed.length}줄을 그냥 통과시켰습니다. 이 줄들이 합계에 섞여 있습니다.`,
          missed.slice(0, 8).map((m) => ({ 파일: m.source_file, 줄: m.source_row_no, 이유: m.reason_code }))
        )
  },

  // 멀쩡한 줄을 잘못 빼지는 않았는가
  quarantine_precise({ result, truth }) {
    if (!truth?.quarantine) return cannotJudge('검토함으로 뺄 줄의')
    const truthSet = new Set(
      truth.quarantine.map((t) => `${t.source_file}|${t.source_sheet}|${t.source_row_no}`)
    )
    const wrong = result.quarantine.filter(
      (q) => !truthSet.has(`${q.source.file}|${q.source.sheet ?? ''}|${q.source.rowNo}`)
    )
    return wrong.length === 0
      ? pass('멀쩡한 줄을 검토함으로 보내지 않았습니다.')
      : fail(
          `${wrong.length}줄을 괜히 뺐습니다. 검토할 것이 많아지면 담당자가 결국 전부 통과시켜 버립니다.`,
          wrong.slice(0, 8).map((w) => ({ 파일: w.source.file, 줄: w.source.rowNo, 이유: w.reason }))
        )
  },

  // 외화가 원화로 바뀐 뒤 합산됐는가
  currency_converted({ result }) {
    const foreign = result.rows.filter((r) => r.src_currency !== 'KRW')
    if (foreign.length === 0) return pass('외화 매출이 없습니다.')
    const bad = foreign.filter((r) => !(r.fx_rate > 1) || !(Math.abs(r.net_revenue_krw) > 0))
    const currencies = [...new Set(foreign.map((r) => r.src_currency))]
    return bad.length === 0
      ? pass(`${currencies.join(', ')} ${foreign.length}줄이 모두 원화로 환산됐습니다.`)
      : fail(
          `${bad.length}줄이 환산되지 않은 채 합산됐습니다. 달러 금액이 그대로 더해지면 매출이 1300분의 1로 보입니다.`,
          bad.slice(0, 8).map((b) => ({ 파일: b.source.file, 줄: b.source.rowNo, 통화: b.src_currency }))
        )
  },

  // 같은 파일을 두 번 넣어도 합계가 그대로인가
  async idempotent({ files, aliases }) {
    const a = await runPipeline({ files, aliases })
    const b = await runPipeline({ files: [...files, ...files], aliases })
    const once = Math.round(a.totals.all.net_revenue_krw)
    const twice = Math.round(b.totals.all.net_revenue_krw)
    return once === twice
      ? pass(`두 번 넣어도 합계가 ${once.toLocaleString()}원 그대로입니다.`)
      : fail(
          `두 번 넣으니 합계가 ${once.toLocaleString()}원 → ${twice.toLocaleString()}원으로 변했습니다. 담당자는 "아까 올린 게 맞나" 싶으면 반드시 다시 올립니다.`,
          [{ 한번: once, 두번: twice, 차이: twice - once }]
        )
  },

  // 다른 달 시트가 이번 합계에 섞이지 않았는가
  //
  // 줄 하나씩 보지 않는다. 6월 정산서에 7월 1일자 반품이 들어오는 것은
  // 정상이다 — 6월에 판 물건이 7월 초에 반품되면 6월 정산에 잡힌다. 그 줄을
  // 빼면 반품이 없던 일이 되고 매출이 부풀려진다.
  //
  // 막아야 하는 것은 시트 전체가 다른 달인 경우다. 분기 파일 하나에 4·5·6월
  // 시트가 들어 있는데 다 더하면 매출이 세 배가 된다.
  period_scoped({ result, period }) {
    const target = period.start.slice(0, 7)
    const sheets = new Map()

    for (const r of result.rows) {
      const key = `${r.source.file}|${r.source.sheet ?? ''}`
      if (!sheets.has(key)) sheets.set(key, new Map())
      const months = sheets.get(key)
      const ym = r.date.slice(0, 7)
      months.set(ym, (months.get(ym) ?? 0) + 1)
    }

    const wrong = []
    for (const [key, months] of sheets) {
      const [dominant, count] = [...months.entries()].sort((a, b) => b[1] - a[1])[0]
      if (dominant !== target) {
        const [file, sheet] = key.split('|')
        wrong.push({ 파일: file, 시트: sheet || '—', 달: dominant, 줄수: count })
      }
    }

    return wrong.length === 0
      ? pass(
          `${target} 시트만 합쳤습니다. 시트 ${sheets.size}장을 확인했습니다.`
        )
      : fail(
          `다른 달 시트 ${wrong.length}장이 섞였습니다. 분기 파일 하나에 세 달치가 들어 있어서, 다 더하면 매출이 세 배가 됩니다.`,
          wrong
        )
  },

  // 반품을 매출이 아니라 반품으로 셌는가
  returns_separated({ result }) {
    const returns = result.rows.filter((r) => r.return_qty > 0)
    if (returns.length === 0) return pass('반품 줄이 없습니다.')
    const bad = returns.filter((r) => r.qty !== 0 || !(r.return_krw > 0) || r.gross_krw !== 0)
    return bad.length === 0
      ? pass(`반품 ${returns.length}줄을 매출에서 빼고 반품으로 셌습니다.`)
      : fail(
          `${bad.length}줄이 반품인데 매출로 섞였습니다. 부호를 무시하고 더하면 매출이 부풀려지고 반품률이 0으로 나옵니다.`,
          bad.slice(0, 8).map((b) => ({ 파일: b.source.file, 줄: b.source.rowNo }))
        )
  },

  // 한 번 알려 준 코드가 다음 실행에서 자동으로 처리되는가
  async alias_learned({ files, aliases, result }) {
    const unknown = result.quarantine.filter((q) => q.reason === 'unknown_sku')
    const codes = [...new Set(unknown.map((q) => q.externalCode))]
    if (codes.length === 0) {
      return pass('모르는 코드가 없습니다.')
    }

    // 하나를 임시로 알려 주고 다시 돌려 본다. 저장하지는 않는다.
    const taught = { ...aliases, [codes[0]]: 'NR-CM-100' }
    const after = await runPipeline({ files, aliases: taught })
    const stillUnknown = after.quarantine.filter(
      (q) => q.reason === 'unknown_sku' && q.externalCode === codes[0]
    )
    return stillUnknown.length === 0
      ? pass(
          `"${codes[0]}"를 알려 주니 다음 실행에서 검토함이 ${result.quarantine.length}줄 → ${after.quarantine.length}줄로 줄었습니다. 같은 판단을 두 번 요구하지 않습니다.`
        )
      : fail('알려 준 코드가 다음 실행에서도 여전히 검토함에 남습니다.')
  },

  // 머리글이 바뀌면 아는 척하지 않는가
  async header_change_detected({ files }) {
    // 채널을 알아보는 데 쓰는 머리글을 일부러 바꾼 파일을 만든다.
    const csv = files.find((f) => f.name.endsWith('.csv'))
    if (!csv) return pass('CSV 파일이 없어 확인하지 못했습니다.')

    const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(csv.buffer))
    const lines = text.split(/\r?\n/)
    // 첫 줄(머리글)의 이름을 바꾼다. 양식이 바뀐 상황을 흉내 낸다.
    lines[0] = lines[0]
      .replace('주문일자', '판매일')
      .replace('상품코드', '품번')
      .replace('옵션ID', '옵션번호')
      .replace('정산일', '지급일')
    const mutated = {
      name: `양식바뀜_${csv.name}`,
      buffer: new TextEncoder().encode(lines.join('\n')).buffer,
    }

    const r = await runPipeline({ files: [mutated] })
    const flagged = r.quarantine.some((q) =>
      ['unknown_channel', 'missing_columns'].includes(q.reason)
    )
    return flagged && r.rows.length === 0
      ? pass('머리글을 바꾼 파일을 넣으니 아는 척하지 않고 사람에게 물었습니다.')
      : fail(
          `머리글이 바뀌었는데 ${r.rows.length}줄을 그대로 처리했습니다. "양식은 안 바뀐다"는 확인되지 않은 가정입니다.`
        )
  },

  // 모든 줄이 원본으로 되짚어지는가
  traceable({ result }) {
    const broken = result.rows.filter(
      (r) => !r.source?.file || !(r.source.rowNo > 0) || !(r.trace?.length > 0)
    )
    return broken.length === 0
      ? pass(`${result.rows.length}줄 모두 원본 파일과 줄 번호, 변환 단계를 들고 있습니다.`)
      : fail(
          `${broken.length}줄이 어디서 왔는지 모릅니다. 회의에서 "이 숫자 어디서 나왔냐"는 질문에 답할 수 없습니다.`
        )
  },

  // 기여이익이 정해진 순서로 계산됐는가
  contribution_order({ result }) {
    const wrong = []
    for (const r of result.rows) {
      const net = round2(r.gross_krw - r.discount_krw - r.return_krw)
      const expected = round2(net - r.commission_krw - r.cogs_krw - r.logistics_krw - r.ad_krw)
      if (Math.abs(net - r.net_revenue_krw) > 0.02 || Math.abs(expected - r.contribution_krw) > 0.02) {
        wrong.push({ 파일: r.source.file, 줄: r.source.rowNo, 나온값: r.contribution_krw, 계산값: expected })
      }
    }
    return wrong.length === 0
      ? pass('모든 줄이 순매출 → 수수료 → 원가 → 물류 → 광고 순으로 계산됐습니다.')
      : fail(`${wrong.length}줄의 계산이 순서와 맞지 않습니다.`, wrong.slice(0, 8))
  },
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// ─────────────────────────────────────────────────────────────
// 전체 채점
// ─────────────────────────────────────────────────────────────

export async function gradeAll({ criteria, files, aliases = {}, truth, period }) {
  const started = Date.now()
  const result = await runPipeline({ files, aliases })
  const context = { result, files, aliases, truth, period }

  const graded = []
  for (const c of criteria) {
    // 사람이 봐야 하는 기준은 기계가 판정하지 않는다. 판정한 척하면 안 된다.
    if (c.check_kind !== 'rule' || !c.check_key) {
      graded.push({
        id: c.id,
        ord: c.ord,
        body: c.body,
        check_key: c.check_key,
        is_required_safety: c.is_required_safety,
        kind: 'human',
        verdict: '사람확인',
        evidence: '기계가 판정할 수 없는 기준입니다. 담당자가 직접 확인해야 합니다.',
      })
      continue
    }

    const check = CHECKS[c.check_key]
    if (!check) {
      graded.push({
        id: c.id,
        ord: c.ord,
        body: c.body,
        check_key: c.check_key,
        is_required_safety: c.is_required_safety,
        kind: 'rule',
        verdict: '판정불가',
        evidence: '이 기준을 채점하는 규칙이 아직 없습니다.',
      })
      continue
    }

    try {
      const r = await check(context)
      graded.push({
        id: c.id,
        ord: c.ord,
        body: c.body,
        check_key: c.check_key,
        is_required_safety: c.is_required_safety,
        kind: 'rule',
        // passed 가 null 이면 못 판정한 것이다. 실패로 적으면 도구가 틀린
        // 것처럼 보인다 — 틀린 것이 아니라 대조할 정답이 없는 것이다.
        verdict: r.passed == null ? '판정불가' : r.passed ? '통과' : '실패',
        evidence: r.evidence,
        samples: r.samples ?? [],
      })
    } catch (err) {
      graded.push({
        id: c.id,
        ord: c.ord,
        body: c.body,
        check_key: c.check_key,
        is_required_safety: c.is_required_safety,
        kind: 'rule',
        verdict: '판정불가',
        evidence: `채점 중 오류: ${String(err.message).slice(0, 140)}`,
      })
    }
  }

  return {
    graded,
    summary: { ...tally(graded), durationMs: Date.now() - started },
    rowsOut: result.rows.length,
    quarantined: result.quarantine.length,
  }
}

export { tally }
