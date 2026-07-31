// 채널 정산서 여러 장을 하나의 표로 합친다.
//
// 여기에 AI는 없다. 전부 정해진 규칙이다. 같은 파일을 넣으면 언제나 같은
// 결과가 나오고, 왜 그렇게 나왔는지 한 줄 한 줄 되짚을 수 있다.
//
// 다루는 어려움
//   1) 채널마다 컬럼 이름이 다르다 (주문일자 / 매출일자 / 정산일 / 決済日)
//   2) 같은 상품이 채널마다 다른 코드로 불린다 (다섯 가지 이름)
//   3) 통화가 셋이다 (원 / 달러 / 엔)
//   4) 날짜 모양이 넷이다
//   5) 반품이 음수 줄로 들어온다
//   6) 맨 끝에 합계 줄이 붙어 있다 — 이걸 데이터로 세면 매출이 두 배가 된다
//   7) 정산 대상 기간 밖의 자료가 섞여 있다
//   8) 우리 목록에 없는 상품코드가 매주 몇 개씩 나온다
//
// 원칙: **모르는 것은 버리지 않는다.**
// 합계 줄이든 처음 보는 코드든, 조용히 떨어뜨리면 합계가 조용히 틀린다.
// 전부 '검토함'으로 빼서 사람이 보게 한다. 그것이 정확한 동작이다.

import { readCsv, fileKind } from './csv.js'
import { readXlsx, toTable } from './xlsx.js'
import { FX, PERIOD, SKUS, CHANNELS, SKU_ALIAS, SKU_BY_CODE, CHANNEL_BY_NAME } from './master.js'

// ─────────────────────────────────────────────────────────────
// 어느 채널의 파일인지 알아보기
// ─────────────────────────────────────────────────────────────
//
// 파일 이름으로 판단하지 않는다. 이름은 담당자가 바꿔서 저장하는 순간 틀린다.
// 대신 머리글에 무엇이 있는지로 알아본다. 양식이 바뀌면 여기서 못 알아보고,
// 그때는 사람에게 묻는다 — 조용히 틀린 채널로 처리하는 것보다 낫다.

const CHANNEL_RULES = [
  { channel: '자사몰', mustHave: ['주문일자', '상품코드'] },
  { channel: '올리브영', mustHave: ['자체상품코드'] },
  { channel: '쿠팡', mustHave: ['옵션ID'] },
  { channel: 'Amazon US', mustHave: ['sku', 'quantity-purchased'] },
  { channel: 'Qoo10 JP', mustHave: ['商品コード'] },
]

export function detectChannel(header) {
  const set = new Set(header.map((h) => String(h ?? '').trim()))
  for (const rule of CHANNEL_RULES) {
    if (rule.mustHave.every((h) => set.has(h))) return rule.channel
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 컬럼 맞추기
// ─────────────────────────────────────────────────────────────
//
// 채널별 머리글 → 우리가 쓰는 이름.
// reported_commission은 정산서에 적힌 수수료다. 우리가 계산한 값과 견주면
// "계약서상 수수료율보다 실제로 더 떼였다"를 잡아낼 수 있다.

const COLUMN_MAP = {
  자사몰: {
    주문일자: 'date',
    상품코드: 'sku',
    상품명: 'name',
    수량: 'qty',
    판매가: 'gross',
    할인액: 'discount',
  },
  올리브영: {
    매출일자: 'date',
    점포: 'store',
    자체상품코드: 'sku',
    상품명: 'name',
    판매수량: 'qty',
    '매출액(VAT포함)': 'gross',
    수수료율: 'reported_commission_rate',
  },
  쿠팡: {
    정산일: 'date',
    옵션ID: 'sku',
    노출상품명: 'name',
    판매수량: 'qty',
    판매금액: 'gross',
    서비스이용료: 'reported_commission',
  },
  'Amazon US': {
    'posted-date': 'date',
    sku: 'sku',
    'quantity-purchased': 'qty',
    'item-price': 'gross',
    'item-promotion-discount': 'discount',
    commission: 'reported_commission',
    currency: 'currency',
  },
  'Qoo10 JP': {
    決済日: 'date',
    商品コード: 'sku',
    数量: 'qty',
    販売金額: 'gross',
    手数料: 'reported_commission',
  },
}

// 사용법서가 "이 도구는 어떤 파일을 받나요"를 적을 때 쓴다.
//
// 문서에 손으로 옮겨 적지 않고 여기서 가져가게 하는 이유: 규칙이 바뀌었는데
// 문서가 그대로면, 담당자가 문서대로 했는데 안 되는 상황이 온다. 그러면
// 그다음부터는 아무도 문서를 안 본다.
export const CHANNEL_RULES_PUBLIC = CHANNEL_RULES.map((r) => ({
  channel: r.channel,
  mustHave: r.mustHave,
  columns: Object.entries(COLUMN_MAP[r.channel] ?? {}).map(([from, to]) => ({ from, to })),
}))

// 없으면 아예 처리할 수 없는 칸.
const REQUIRED_FIELDS = ['date', 'sku', 'qty', 'gross']

// 없으면 금액이 조용히 틀리는 칸.
//
// 이걸 따로 구분하는 이유가 있다. 예전에는 위 네 개만 확인하고 나머지는 없어도
// 그냥 진행했다. 그래서 채널이 '할인액'을 '할인금액'으로 바꿔 보내면, 채널은
// 그대로 알아보고 줄도 전부 처리하는데 할인이 0으로 잡혀 순매출이 부풀려졌다.
// 실제로 재 보니 자사몰 한 채널에서만 25만원이 늘었다. 검토함에도 안 가고
// 경고도 없어서 아무도 모른다.
//
// 이런 종류의 오류가 가장 나쁘다. 터지면 알기라도 하는데, 그럴듯한 숫자가
// 나오면 회의에서 지적받은 뒤에야 발견된다.
const MONEY_FIELDS = ['discount']

// 없어도 금액에 영향이 없는 칸. 없으면 알려만 준다.
const COSMETIC_FIELDS = ['name', 'store', 'currency', 'reported_commission', 'reported_commission_rate']

// 머리글 배열에서 "우리 이름 → 몇 번째 칸" 표를 만든다.
export function buildColumnIndex(channel, header) {
  const map = COLUMN_MAP[channel] ?? {}
  const index = {}
  const unmapped = []

  header.forEach((raw, i) => {
    const name = String(raw ?? '').trim()
    const field = map[name]
    if (field) index[field] = i
    else if (name) unmapped.push(name)
  })

  // 이 채널 정의에 있는 칸 중 파일에서 못 찾은 것.
  const definedFields = new Set(Object.values(map))
  const notFound = [...definedFields].filter((f) => index[f] === undefined)

  const missing = notFound.filter((f) => REQUIRED_FIELDS.includes(f))
  const missingMoney = notFound.filter((f) => MONEY_FIELDS.includes(f))
  const missingCosmetic = notFound.filter((f) => COSMETIC_FIELDS.includes(f))

  // 원래 이름이 무엇이었는지 함께 돌려준다. 사람이 "아, 저 컬럼 이름이
  // 바뀌었구나"를 바로 알 수 있어야 한다.
  const originalNameOf = (field) =>
    Object.entries(map).find(([, to]) => to === field)?.[0] ?? field

  return {
    index,
    unmapped,
    missing,
    missingMoney,
    missingCosmetic,
    missingNames: [...missing, ...missingMoney, ...missingCosmetic].map(originalNameOf),
    moneyMissingNames: missingMoney.map(originalNameOf),
  }
}

// ─────────────────────────────────────────────────────────────
// 값 정리
// ─────────────────────────────────────────────────────────────

// "₩24,200" → 24200. 통화기호와 천 단위 쉼표를 떼고, 괄호 음수도 처리한다.
export function toNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  let s = String(value).trim()
  if (s === '') return null

  // 회계에서 (1,000)은 -1000을 뜻한다.
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }

  s = s.replace(/[₩$￥¥원,\s]/g, '')
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

// 날짜 모양이 채널마다 다르다.
//   2026-06-09  자사몰
//   2026/06/13  쿠팡·Qoo10
//   06/01/2026  Amazon (월/일/년)
//   (엑셀 날짜)  올리브영 — 파일 읽는 단계에서 이미 2026-06-23으로 바뀌어 온다
//
// 06/07/2026이 6월 7일인지 7월 6일인지는 채널을 알아야 정해진다.
// 그래서 채널을 인자로 받는다. 추측하지 않는다.
export function toDate(value, channel) {
  if (value == null || value === '') return null
  const s = String(value).trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s)
  if (slash) return `${slash[1]}-${pad(slash[2])}-${pad(slash[3])}`

  // 미국식은 월이 앞이다.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (us) {
    if (channel === 'Amazon US') return `${us[3]}-${pad(us[1])}-${pad(us[2])}`
    // 채널을 모르면 판단하지 않는다. 틀린 날짜보다 없는 날짜가 낫다.
    return null
  }

  return null
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// 상품명에 전각 공백이 섞여 들어오는 경우가 있다(한글 입력기에서 흔하다).
export function cleanText(value) {
  return String(value ?? '')
    .replace(/[　 ]/g, ' ')
    .trim()
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// ─────────────────────────────────────────────────────────────
// 검토함으로 보낼 이유들
// ─────────────────────────────────────────────────────────────

export const QUARANTINE_REASONS = {
  empty_row: '빈 줄',
  total_row: '합계 줄',
  unknown_sku: '우리 목록에 없는 상품코드',
  no_sku: '상품코드가 비어 있음',
  out_of_period: '정산 기간 밖',
  bad_date: '날짜를 알아볼 수 없음',
  bad_amount: '금액을 숫자로 읽을 수 없음',
  unknown_channel: '어느 채널의 양식인지 알 수 없음',
  missing_columns: '꼭 있어야 할 컬럼이 없음',
}

const TOTAL_ROW_PATTERN = /^(합계|소계|총계|total|sum)$/i

// ─────────────────────────────────────────────────────────────
// 한 줄 처리
// ─────────────────────────────────────────────────────────────

function processRow({ channel, columns, row, source, aliases }) {
  const cell = (field) => {
    const i = columns.index[field]
    return i === undefined ? null : row.cells[i]
  }

  const trace = []
  const rawCells = row.cells

  // 아무것도 없는 줄
  if (rawCells.every((c) => c == null || String(c).trim() === '')) {
    return { quarantine: { reason: 'empty_row', source, raw: rawCells } }
  }

  const rawSku = cleanText(cell('sku'))
  const rawName = cleanText(cell('name'))

  // 합계 줄 — 상품코드가 비어 있고 어딘가에 '합계' 같은 말이 있다.
  // 이걸 데이터로 세면 그 채널 매출이 정확히 두 배가 된다. 그럴듯한 숫자라
  // 대시보드에서 눈으로 찾기 어렵고, 회의에서 지적받은 뒤에야 발견된다.
  if (!rawSku) {
    const looksLikeTotal = rawCells.some((c) =>
      TOTAL_ROW_PATTERN.test(cleanText(c).replace(/\s/g, ''))
    )
    return {
      quarantine: {
        reason: looksLikeTotal ? 'total_row' : 'no_sku',
        source,
        raw: rawCells,
        note: looksLikeTotal ? '이 줄을 합계에 넣으면 매출이 두 배가 됩니다.' : null,
      },
    }
  }

  trace.push({ step: '원본', value: `${rawSku}${rawName ? ` · ${rawName}` : ''}` })

  // 상품코드 통일 — 채널 코드를 우리 표준코드로.
  // aliases는 사람이 나중에 알려 준 것. 기본 표 위에 덮어쓴다.
  const canonical = aliases?.[rawSku] ?? SKU_ALIAS[rawSku] ?? null
  if (!canonical) {
    return {
      quarantine: {
        reason: 'unknown_sku',
        source,
        raw: rawCells,
        externalCode: rawSku,
        productName: rawName,
        note: '이 코드가 어느 상품인지 알려주시면 다음부터는 자동으로 처리됩니다.',
      },
    }
  }
  const sku = SKU_BY_CODE[canonical]
  trace.push({ step: '코드 통일', value: `${rawSku} → ${canonical} (${sku.name_ko})` })

  // 날짜
  const date = toDate(cell('date'), channel)
  if (!date) {
    return { quarantine: { reason: 'bad_date', source, raw: rawCells, externalCode: rawSku } }
  }

  // 수량과 금액
  const qtyRaw = toNumber(cell('qty'))
  const grossRaw = toNumber(cell('gross'))
  if (qtyRaw == null || grossRaw == null) {
    return { quarantine: { reason: 'bad_amount', source, raw: rawCells, externalCode: rawSku } }
  }

  // 반품은 음수 줄로 들어온다. 부호를 무시하고 더하면 매출이 부풀려지고,
  // 반품으로 인식하지 못하면 반품률이 0이 된다.
  const isReturn = qtyRaw < 0 || grossRaw < 0
  const qty = isReturn ? 0 : qtyRaw
  const returnQty = isReturn ? Math.abs(qtyRaw) : 0
  const grossSrc = isReturn ? 0 : grossRaw
  const returnSrc = isReturn ? Math.abs(grossRaw) : 0
  if (isReturn) {
    trace.push({ step: '반품 분리', value: `수량 ${qtyRaw} → 반품 ${returnQty}건` })
  }

  const discountSrc = Math.abs(toNumber(cell('discount')) ?? 0)

  // 통화 환산
  const ch = CHANNEL_BY_NAME[channel]
  const currency = cleanText(cell('currency')) || ch.currency
  const fx = FX[currency]
  if (!fx) {
    return { quarantine: { reason: 'bad_amount', source, raw: rawCells, externalCode: rawSku } }
  }

  const gross = round2(grossSrc * fx)
  const discount = round2(discountSrc * fx)
  const returned = round2(returnSrc * fx)
  if (fx !== 1) {
    trace.push({ step: '통화 환산', value: `${grossSrc} ${currency} × ${fx} = ${gross}원` })
  }

  // 계산 순서가 중요하다. 이 순서를 바꾸면 금액이 달라진다.
  //   순매출   = 총매출 − 할인 − 반품액
  //   수수료   = 순매출 × (계약 요율 + 실제 추가 공제)
  //   기여이익 = 순매출 − 수수료 − 원가 − 물류비 − 광고비
  const net = round2(gross - discount - returned)
  const commissionRate = ch.nominal_commission_rate + ch.effective_extra_rate
  const commission = round2(net * commissionRate)
  const netQty = Math.max(qty - returnQty, 0)
  const cogs = round2(sku.std_cogs_krw * netQty)
  const logistics = round2((ch.type === '해외' ? 2500 : 900) * netQty)
  const ad = round2(net * 0.06)
  const contribution = round2(net - commission - cogs - logistics - ad)

  trace.push({
    step: '수수료 공제',
    value: `${net}원 × ${(commissionRate * 100).toFixed(1)}% = ${commission}원`,
  })
  trace.push({ step: '최종', value: `순매출 ${net}원 · 기여이익 ${contribution}원` })

  // 정산서에 적힌 수수료. 우리 계산과 견주면 계약보다 더 떼인 것이 보인다.
  const reportedRaw = Math.abs(toNumber(cell('reported_commission')) ?? 0)

  return {
    row: {
      date,
      iso_week: isoWeek(date),
      sku: canonical,
      sku_name: sku.name_ko,
      channel,
      country: ch.country,
      qty,
      return_qty: returnQty,
      src_currency: currency,
      fx_rate: fx,
      gross_krw: gross,
      discount_krw: discount,
      return_krw: returned,
      net_revenue_krw: net,
      commission_krw: commission,
      reported_commission_krw: reportedRaw ? round2(reportedRaw * fx) : null,
      cogs_krw: cogs,
      logistics_krw: logistics,
      ad_krw: ad,
      contribution_krw: contribution,
      source,
      trace,
    },
  }
}

// 이 시트가 정산 대상 기간의 것인지 판단한다.
//
// 줄 단위로 기간을 자르면 안 된다. 6월 정산서에 7월 1일자 반품이 섞이는 것은
// 정상이다 — 6월에 판 물건이 7월 초에 반품되면 6월 정산에 잡힌다. 그 줄을
// 빼면 반품이 없던 일이 되고 매출이 부풀려진다.
//
// 걸러야 하는 것은 다른 달 시트 전체다. 분기 파일 하나에 4월·5월·6월 시트가
// 들어 있는 경우, 6월 정산을 하는데 4월 시트까지 더하면 매출이 세 배가 된다.
//
// 그래서 시트에 들어 있는 날짜들의 '가장 많은 달'을 보고 시트 단위로 정한다.
function sheetPeriodCheck(channel, columns, rows) {
  const months = new Map()
  for (const row of rows) {
    const i = columns.index.date
    const d = toDate(i === undefined ? null : row.cells[i], channel)
    if (!d) continue
    const ym = d.slice(0, 7)
    months.set(ym, (months.get(ym) ?? 0) + 1)
  }
  if (months.size === 0) return { inPeriod: true, month: null }

  const [month] = [...months.entries()].sort((a, b) => b[1] - a[1])[0]
  const target = PERIOD.start.slice(0, 7)
  return { inPeriod: month === target, month, target }
}

// ISO 주차. 채널×주차로 묶어 볼 때 쓴다.
export function isoWeek(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7 // 월요일을 0으로
  d.setUTCDate(d.getUTCDate() - day + 3) // 그 주의 목요일
  const year = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000))
  return `${year}-W${String(week).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// 파일 하나 읽기
// ─────────────────────────────────────────────────────────────

async function readFile(file) {
  const kind = fileKind(file.name)
  if (kind === 'csv') return [readCsv(file.buffer)]
  if (kind === 'xlsx') return (await readXlsx(file.buffer)).map(toTable)
  return []
}

// ─────────────────────────────────────────────────────────────
// 전체 실행
// ─────────────────────────────────────────────────────────────

// 내용이 완전히 같은 파일은 한 번만 센다.
//
// 담당자는 "아까 올린 게 맞나?" 싶으면 반드시 다시 올린다. 그때 같은 파일이
// 두 번 들어가면 매출이 정확히 두 배가 되는데, 그럴듯한 숫자라 아무도
// 눈치채지 못한다. 파일 이름이 아니라 **내용의 지문**으로 판단한다 —
// 이름만 바꿔 저장한 같은 파일도 잡아야 한다.
async function fingerprint(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function dedupeFiles(files) {
  const seen = new Map()
  const unique = []
  const skipped = []

  for (const file of files) {
    const hash = await fingerprint(file.buffer)
    if (seen.has(hash)) {
      skipped.push({ name: file.name, sameAs: seen.get(hash) })
      continue
    }
    seen.set(hash, file.name)
    unique.push({ ...file, hash })
  }
  return { unique, skipped }
}

export async function runPipeline({ files: inputFiles, aliases = {} }) {
  const started = Date.now()
  const rows = []
  const quarantine = []
  const fileReports = []

  const { unique: files, skipped } = await dedupeFiles(inputFiles)
  for (const s of skipped) {
    fileReports.push({
      name: s.name,
      ok: true,
      skippedDuplicate: true,
      rowsIn: 0,
      rowsOut: 0,
      quarantined: 0,
      note: `${s.sameAs}와 내용이 완전히 같아 한 번만 셌습니다.`,
    })
  }

  for (const file of files) {
    let tables
    try {
      tables = await readFile(file)
    } catch (err) {
      fileReports.push({
        name: file.name,
        ok: false,
        note: `파일을 열지 못했습니다: ${String(err.message).slice(0, 120)}`,
      })
      continue
    }

    if (tables.length === 0) {
      fileReports.push({ name: file.name, ok: false, note: '읽을 수 있는 형식이 아닙니다.' })
      continue
    }

    for (const table of tables) {
      const source0 = { file: file.name, sheet: table.sheetName }
      const channel = detectChannel(table.header)

      if (!channel) {
        // 양식이 바뀌었거나 처음 보는 채널이다. 조용히 틀린 채널로 처리하는
        // 것보다 사람에게 묻는 편이 낫다.
        quarantine.push({
          reason: 'unknown_channel',
          source: { ...source0, rowNo: table.headerRowNo },
          raw: table.header,
          note: '머리글이 알고 있는 어느 채널과도 맞지 않습니다. 양식이 바뀌었을 수 있습니다.',
        })
        fileReports.push({
          name: file.name,
          sheet: table.sheetName,
          ok: false,
          note: '채널을 알아보지 못했습니다.',
        })
        continue
      }

      const columns = buildColumnIndex(channel, table.header)

      // 처리에 꼭 필요한 칸이 없거나, 금액에 들어가는 칸이 없으면 이 시트를
      // 통째로 멈춘다. 두 번째가 중요하다 — 없는 채로 진행하면 그 칸이 0으로
      // 잡혀 금액이 조용히 틀리고, 그럴듯한 숫자라 아무도 모른다.
      if (columns.missing.length > 0 || columns.missingMoney.length > 0) {
        const names = columns.missing.length > 0 ? columns.missingNames : columns.moneyMissingNames
        const why =
          columns.missing.length > 0
            ? `${names.join(', ')} 칸을 찾지 못했습니다. 이 칸이 없으면 처리할 수 없습니다.`
            : `${names.join(', ')} 칸을 찾지 못했습니다. 이대로 처리하면 그 값이 0으로 잡혀 금액이 틀립니다. 채널이 컬럼 이름을 바꿨는지 확인해주세요.`

        quarantine.push({
          reason: 'missing_columns',
          source: { ...source0, rowNo: table.headerRowNo },
          raw: table.header,
          note: why,
        })
        fileReports.push({
          name: file.name,
          sheet: table.sheetName,
          ok: false,
          channel,
          note: why,
          missingColumns: names,
        })
        continue
      }

      // 금액에 영향은 없지만 없어진 칸. 막지는 않고 알려만 준다.
      if (columns.missingCosmetic.length > 0) {
        fileReports.push({
          name: file.name,
          sheet: table.sheetName,
          ok: true,
          channel,
          warnOnly: true,
          note: `${columns.missingNames.join(', ')} 칸이 없습니다. 금액에는 영향이 없어 그대로 진행했습니다.`,
        })
      }

      // 다른 달 시트면 통째로 뺀다. 한 줄씩 판단하지 않는 이유는 위 주석에 있다.
      const period = sheetPeriodCheck(channel, columns, table.rows)
      if (!period.inPeriod) {
        for (const row of table.rows) {
          quarantine.push({
            reason: 'out_of_period',
            source: { ...source0, rowNo: row.rowNo },
            raw: row.cells,
            note: `이 시트는 ${period.month} 자료입니다. 이번 정산 대상은 ${period.target}입니다.`,
          })
        }
        fileReports.push({
          name: file.name,
          sheet: table.sheetName,
          ok: true,
          channel,
          skippedPeriod: period.month,
          headerRowNo: table.headerRowNo,
          rowsIn: table.rows.length,
          rowsOut: 0,
          quarantined: table.rows.length,
          note: `${period.month} 시트라 이번 정산에서 제외했습니다.`,
        })
        continue
      }

      let okCount = 0
      let quarantineCount = 0

      for (const row of table.rows) {
        const source = { ...source0, rowNo: row.rowNo }
        const result = processRow({ channel, columns, row, source, aliases })
        if (result.row) {
          rows.push(result.row)
          okCount += 1
        } else {
          quarantine.push(result.quarantine)
          quarantineCount += 1
        }
      }

      fileReports.push({
        name: file.name,
        sheet: table.sheetName,
        ok: true,
        channel,
        encoding: table.encoding ?? null,
        headerRowNo: table.headerRowNo,
        rowsIn: table.rows.length,
        rowsOut: okCount,
        quarantined: quarantineCount,
        unmappedColumns: columns.unmapped,
      })
    }
  }

  // 내용이 똑같은 줄 찾기.
  //
  // 지우지 않는다. 결제 시스템이 다시 시도해서 생긴 진짜 중복일 수도 있고,
  // 같은 사람이 같은 날 같은 상품을 두 번 산 것일 수도 있다. 여기서 판단할
  // 수 없으므로 표시만 하고 사람에게 넘긴다.
  const seen = new Map()
  for (const r of rows) {
    const key = `${r.date}|${r.sku}|${r.channel}|${r.qty}|${r.gross_krw}`
    if (seen.has(key)) {
      r.duplicate_of = seen.get(key).source
      seen.get(key).has_duplicate = true
    } else {
      seen.set(key, r)
    }
  }
  const duplicates = rows.filter((r) => r.duplicate_of)

  return {
    rows,
    quarantine,
    duplicates,
    files: fileReports,
    stats: {
      filesRead: inputFiles.length,
      duplicateFilesSkipped: skipped.length,
      sheetsRead: fileReports.length,
      rowsOut: rows.length,
      quarantined: quarantine.length,
      duplicateSuspects: duplicates.length,
      durationMs: Date.now() - started,
      // 이 숫자가 이 화면의 주장이다. 외부 서비스를 한 번도 부르지 않았다.
      externalCalls: 0,
    },
    totals: summarize(rows),
  }
}

// 채널별·주차별 합계.
export function summarize(rows) {
  const byChannel = new Map()
  const byChannelWeek = new Map()

  const blank = () => ({
    qty: 0,
    return_qty: 0,
    gross_krw: 0,
    net_revenue_krw: 0,
    commission_krw: 0,
    reported_commission_krw: 0,
    contribution_krw: 0,
    rows: 0,
  })

  const add = (map, key, r) => {
    if (!map.has(key)) map.set(key, blank())
    const t = map.get(key)
    t.qty += r.qty
    t.return_qty += r.return_qty
    t.gross_krw += r.gross_krw
    t.net_revenue_krw += r.net_revenue_krw
    t.commission_krw += r.commission_krw
    t.reported_commission_krw += r.reported_commission_krw ?? 0
    t.contribution_krw += r.contribution_krw
    t.rows += 1
  }

  const all = blank()
  for (const r of rows) {
    add(byChannel, r.channel, r)
    add(byChannelWeek, `${r.channel}|${r.iso_week}`, r)
    all.qty += r.qty
    all.return_qty += r.return_qty
    all.gross_krw += r.gross_krw
    all.net_revenue_krw += r.net_revenue_krw
    all.commission_krw += r.commission_krw
    all.reported_commission_krw += r.reported_commission_krw ?? 0
    all.contribution_krw += r.contribution_krw
    all.rows += 1
  }

  const fix = (t) => ({
    ...t,
    gross_krw: round2(t.gross_krw),
    net_revenue_krw: round2(t.net_revenue_krw),
    commission_krw: round2(t.commission_krw),
    reported_commission_krw: round2(t.reported_commission_krw),
    contribution_krw: round2(t.contribution_krw),
  })

  return {
    byChannel: [...byChannel.entries()].map(([channel, t]) => ({ channel, ...fix(t) })),
    byChannelWeek: [...byChannelWeek.entries()].map(([key, t]) => {
      const [channel, iso_week] = key.split('|')
      return { channel, iso_week, ...fix(t) }
    }),
    all: fix(all),
  }
}

export { SKUS, CHANNELS, FX, PERIOD }
