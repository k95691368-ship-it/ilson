// 엑셀 파일(.xlsx)을 직접 뜯어 읽는다. 바깥에서 가져다 쓰는 라이브러리가 없다.
//
// 왜 직접 쓰는가
// -------------
// 흔히 쓰는 엑셀 라이브러리는 브라우저와 서버 양쪽에서 수백 KB를 차지하고,
// 이 도구가 필요한 것은 그중 아주 일부다 — 시트 이름, 셀 값, 병합 정보, 날짜.
// 그리고 이 파일들을 어떻게 읽는지가 이 프로젝트가 푸는 문제의 절반이라,
// 남의 코드에 맡기면 무엇이 왜 깨지는지 설명할 수 없게 된다.
//
// .xlsx가 무엇인가
// ---------------
// 압축 파일(zip)이다. 안에 XML 몇 개가 들어 있다.
//   xl/workbook.xml           시트 이름과 순서
//   xl/_rels/workbook.xml.rels 시트 이름 → 실제 파일 경로
//   xl/sharedStrings.xml      반복되는 글자를 한 번만 저장해 둔 사전
//   xl/styles.xml             셀 서식 (날짜인지 숫자인지를 여기서 안다)
//   xl/worksheets/sheet1.xml  실제 셀 값
//
// 압축 해제는 브라우저와 Cloudflare가 기본으로 가진 DecompressionStream을 쓴다.

// ─────────────────────────────────────────────────────────────
// 1. zip 풀기
// ─────────────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50 // 중앙 목록의 끝 표시
const SIG_CENTRAL = 0x02014b50 // 중앙 목록의 항목 하나
const SIG_LOCAL = 0x04034b50 // 실제 파일 앞에 붙는 머리말

// zip은 파일 목록이 뒤쪽에 있다. 그래서 끝에서부터 거꾸로 찾는다.
function findEndOfCentralDirectory(view, bytes) {
  // 주석이 붙을 수 있어 최대 64KB까지 거슬러 올라간다.
  const from = Math.max(0, bytes.length - 65558)
  for (let i = bytes.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i
  }
  return -1
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// zip 안의 파일들을 { 경로: 내용(bytes) } 로 돌려준다.
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocd = findEndOfCentralDirectory(view, bytes)
  if (eocd < 0) throw new Error('엑셀 파일이 아니거나 파일이 손상됐습니다.')

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)

  const files = {}
  const decoder = new TextDecoder('utf-8')

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break

    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))

    // 실제 내용은 다른 자리에 있고, 그 앞 머리말의 길이가 여기와 다를 수 있다.
    if (view.getUint32(localOffset, true) === SIG_LOCAL) {
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const raw = bytes.subarray(dataStart, dataStart + compressedSize)
      files[name] = method === 0 ? raw : await inflateRaw(raw)
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return files
}

// ─────────────────────────────────────────────────────────────
// 2. XML에서 필요한 것만 꺼내기
// ─────────────────────────────────────────────────────────────

const utf8 = new TextDecoder('utf-8')

function textOf(bytes) {
  return bytes ? utf8.decode(bytes) : ''
}

// XML에서 &amp; 같은 표기를 원래 글자로 되돌린다.
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

// 반복되는 글자 사전. 셀에 t="s"가 붙으면 값이 아니라 이 사전의 번호다.
function parseSharedStrings(xml) {
  const out = []
  // <si> 하나가 글자 하나. 안에 <t>가 여러 개로 쪼개져 있을 수 있다(서식이 섞인 경우).
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) || []
  for (const si of items) {
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
    out.push(
      parts
        .map((p) => unescapeXml(p.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')))
        .join('')
    )
  }
  return out
}

// 엑셀이 기본으로 정해 둔 날짜 서식 번호들.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

// 어떤 셀이 날짜인지 알려면 서식을 봐야 한다. 엑셀은 날짜를 숫자로 저장하고
// "이 셀은 날짜 모양으로 보여라"라는 서식만 따로 붙이기 때문이다.
function parseDateStyles(xml) {
  if (!xml) return new Set()

  // 사용자가 직접 만든 서식 중 날짜 모양인 것 찾기
  const customDateIds = new Set()
  const numFmts = xml.match(/<numFmt[^>]*\/>/g) || []
  for (const f of numFmts) {
    const id = Number(/numFmtId="(\d+)"/.exec(f)?.[1])
    const code = /formatCode="([^"]*)"/.exec(f)?.[1] ?? ''
    // yyyy, mm, dd, hh 같은 글자가 있으면 날짜·시각 서식이다.
    if (/[ymdhs]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))) {
      customDateIds.add(id)
    }
  }

  // 셀들이 실제로 참조하는 서식 목록. 여기서의 순번이 셀의 s="번호"다.
  const cellXfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  const xfs = cellXfsBlock.match(/<xf[^>]*>|<xf[^>]*\/>/g) || []

  const dateStyleIndexes = new Set()
  xfs.forEach((xf, index) => {
    const id = Number(/numFmtId="(\d+)"/.exec(xf)?.[1] ?? 0)
    if (BUILTIN_DATE_FORMATS.has(id) || customDateIds.has(id)) dateStyleIndexes.add(index)
  })
  return dateStyleIndexes
}

// 셀 주소("BC12")에서 열 번호를 뽑는다. A=0, B=1 … Z=25, AA=26 …
export function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function rowNumber(ref) {
  return Number(/(\d+)$/.exec(ref)?.[1] ?? 0)
}

// 엑셀의 날짜 숫자를 사람이 읽는 날짜로.
//
// 엑셀은 날짜를 "1900년 1월 1일부터 며칠째"라는 숫자로 저장한다. 46234는
// 2026년 7월 31일이다.
//
// 25569를 빼는 이유: 이 프로그램의 기준일은 1970년 1월 1일인데, 그날이
// 엑셀 숫자로 25569다. 그래서 빼면 두 기준이 맞는다.
//
// 알려진 한계 — 1900년 3월 1일 이전 날짜는 하루 어긋난다.
// 엑셀이 1900년을 윤년으로 잘못 알고 2월 29일을 실제로 있는 날처럼 세기
// 때문이다(그런 날은 없었다). 이건 엑셀 쪽의 오래된 오류라 여기서 맞추면
// 오히려 엑셀과 값이 달라진다. 이 도구가 다루는 정산 데이터는 전부 최근
// 날짜라 실무에서 걸릴 일은 없지만, 모르고 지나가지 않도록 적어 둔다.
export function excelSerialToISO(serial) {
  if (!Number.isFinite(serial)) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function parseSheet(xml, sharedStrings, dateStyles) {
  const rows = new Map()

  // 셀 하나: <c r="A1" s="3" t="s"><v>12</v></c>
  const cellRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
  let m
  while ((m = cellRe.exec(xml)) !== null) {
    const attrs = m[1]
    const inner = m[3] ?? ''

    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
    if (!ref) continue
    const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n'
    const styleIndex = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1)

    let value = null
    if (type === 'inlineStr') {
      const parts = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
      value = parts
        .map((p) => unescapeXml(p.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')))
        .join('')
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      if (raw == null) {
        value = null
      } else if (type === 's') {
        value = sharedStrings[Number(raw)] ?? ''
      } else if (type === 'str' || type === 'e') {
        value = unescapeXml(raw)
      } else if (type === 'b') {
        value = raw === '1'
      } else {
        const n = Number(raw)
        // 날짜 서식이 붙은 숫자는 날짜로 바꿔 준다. 안 그러면 45000 같은
        // 숫자가 그대로 화면에 나오고, 아무도 그게 날짜인 줄 모른다.
        value = dateStyles.has(styleIndex) ? excelSerialToISO(n) : n
      }
    }

    const r = rowNumber(ref)
    if (!rows.has(r)) rows.set(r, [])
    rows.get(r)[columnIndex(ref)] = value
  }

  // 병합된 칸. 제목 줄을 찾아 건너뛸 때 쓴다.
  const merges = (xml.match(/<mergeCell[^>]*ref="([^"]+)"/g) || []).map(
    (s) => /ref="([^"]+)"/.exec(s)[1]
  )

  const maxRow = rows.size === 0 ? 0 : Math.max(...rows.keys())
  const out = []
  for (let r = 1; r <= maxRow; r++) {
    const row = rows.get(r) ?? []
    // 빈 칸을 null로 채워 길이를 맞춘다. 안 그러면 뒤 칸이 앞으로 당겨진다.
    out.push(Array.from({ length: row.length }, (_, i) => (row[i] === undefined ? null : row[i])))
  }

  return { rows: out, merges }
}

// ─────────────────────────────────────────────────────────────
// 3. 바깥에서 쓰는 함수
// ─────────────────────────────────────────────────────────────

// 엑셀 파일을 시트 배열로 돌려준다.
// [{ name, rows: [[셀,셀,…], …], merges: ['A1:G1', …] }, …]
export async function readXlsx(buffer) {
  const files = await unzip(buffer)

  const sharedStrings = parseSharedStrings(textOf(files['xl/sharedStrings.xml']))
  const dateStyles = parseDateStyles(textOf(files['xl/styles.xml']))

  // 시트 이름과 순서
  const workbook = textOf(files['xl/workbook.xml'])
  const sheetTags = workbook.match(/<sheet[^>]*\/>/g) || []

  // 시트 이름이 실제로 어느 파일인지는 관계 파일에 적혀 있다.
  const rels = textOf(files['xl/_rels/workbook.xml.rels'])
  const relMap = {}
  for (const tag of rels.match(/<Relationship[^>]*\/>/g) || []) {
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (id && target) relMap[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  }

  const sheets = []
  sheetTags.forEach((tag, i) => {
    const name = unescapeXml(/name="([^"]*)"/.exec(tag)?.[1] ?? `시트${i + 1}`)
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1]
    const path = relMap[rid] ?? `xl/worksheets/sheet${i + 1}.xml`
    const xml = textOf(files[path])
    if (!xml) return
    const { rows, merges } = parseSheet(xml, sharedStrings, dateStyles)
    sheets.push({ name, rows, merges })
  })

  return sheets
}

// 진짜 머리글 줄이 몇 번째인지 찾는다.
//
// 정산서는 맨 위에 "2026년 6월 판매 정산 내역서" 같은 제목이 병합된 칸으로
// 들어 있는 경우가 흔하다. 첫 줄을 머리글로 읽으면 컬럼이 전부 비어 버린다.
//
// 규칙: 위에서부터 보면서 "글자가 든 칸이 가장 많고 비어 있지 않은 줄"을 고른다.
// 병합된 칸이 걸쳐 있는 줄은 제목일 가능성이 높아 건너뛴다.
export function findHeaderRow(rows, merges = [], maxScan = 12) {
  const mergedRows = new Set()
  for (const ref of merges) {
    const [a, b] = ref.split(':')
    const from = rowNumber(a)
    const to = rowNumber(b ?? a)
    for (let r = from; r <= to; r++) mergedRows.add(r)
  }

  let best = { index: 0, score: -1 }
  const limit = Math.min(rows.length, maxScan)

  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? []
    const filled = row.filter((c) => c !== null && String(c).trim() !== '')
    // 머리글은 대개 글자다. 숫자만 있는 줄은 이미 데이터다.
    const wordCells = filled.filter((c) => typeof c === 'string' && Number.isNaN(Number(c)))

    let score = wordCells.length * 2 + filled.length
    if (mergedRows.has(i + 1)) score -= 8
    if (filled.length < 2) score = -1

    if (score > best.score) best = { index: i, score }
  }

  return best.score > 0 ? best.index : 0
}

// 시트를 { 머리글, 데이터줄 } 로 정리한다.
export function toTable(sheet) {
  const headerIndex = findHeaderRow(sheet.rows, sheet.merges)
  const header = (sheet.rows[headerIndex] ?? []).map((c) => String(c ?? '').trim())
  const body = []

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? []
    // 완전히 빈 줄은 건너뛴다. 다만 몇 번째 줄이었는지는 남긴다 —
    // 나중에 "이 숫자가 원본 몇 번째 줄에서 왔나"를 되짚어야 한다.
    if (row.every((c) => c === null || String(c).trim() === '')) continue
    body.push({ rowNo: i + 1, cells: row })
  }

  return { sheetName: sheet.name, headerRowNo: headerIndex + 1, header, rows: body }
}
