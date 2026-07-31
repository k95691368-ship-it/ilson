// 올린 파일을 브라우저에서 곧바로 들여다본다. 서버도 AI도 부르지 않는다.
//
// 신청자가 파일을 넣자마자 "이 파일에 컬럼이 몇 개고 어떤 이름인지"가 보이면
// 두 가지가 좋다. 제대로 된 파일을 넣었는지 본인이 바로 확인하고, 담당자는
// 나중에 파일을 열어 보지 않고도 무엇이 왔는지 안다.
//
// 인코딩 판별이 특히 중요하다. 국내 회사에서 받는 정산서는 CP949(EUC-KR)인
// 경우가 흔한데, UTF-8로 읽으면 한글이 전부 깨진다. 그 상태로 업로드되면
// 나중에 "왜 깨졌지"를 아무도 모른다. 여기서 먼저 잡는다.

const TEXT_EXT = ['csv', 'txt', 'tsv']
const PEEK_BYTES = 64 * 1024

export function extOf(name) {
  return (String(name || '').split('.').pop() || '').toLowerCase()
}

// UTF-8로 디코딩했을 때 대체 문자(U+FFFD)가 많이 나오면 UTF-8이 아니다.
// 그럴 때 EUC-KR로 다시 읽어 본다. 둘 다 이상하면 판단을 보류한다.
function decodeBest(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const bad = (utf8.match(/�/g) || []).length
  if (bad === 0) return { text: utf8, encoding: 'UTF-8' }

  try {
    const euckr = new TextDecoder('euc-kr', { fatal: false }).decode(bytes)
    const badKr = (euckr.match(/�/g) || []).length
    if (badKr < bad) return { text: euckr, encoding: 'CP949(EUC-KR)' }
  } catch {
    // 이 브라우저가 euc-kr을 모르는 경우. 판단을 보류하고 UTF-8 결과를 쓴다.
  }
  return { text: utf8, encoding: '판별 실패', suspect: true }
}

// 구분자 추정. 첫 줄에서 가장 많이 나오는 것을 고르되, 따옴표 안은 세지 않는다.
function guessDelimiter(line) {
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 }
  let inQuote = false
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote
    else if (!inQuote && ch in counts) counts[ch] += 1
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ','
}

// 따옴표를 존중하는 한 줄 분해. "₩24,200" 같은 값이 콤마에서 잘리면 안 된다.
export function splitRow(line, delimiter) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else inQuote = !inQuote
    } else if (ch === delimiter && !inQuote) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export async function peekFile(file) {
  const ext = extOf(file.name)
  const base = {
    name: file.name,
    size: file.size,
    ext,
    kind: TEXT_EXT.includes(ext) ? 'text' : ext === 'xlsx' || ext === 'xls' ? 'sheet' : 'other',
  }

  if (base.kind !== 'text') {
    // XLSX는 압축된 XML 묶음이라 여기서 열지 않는다. 실제 해석은 제작 단계에서
    // 한다. 여기서는 "표 파일이 왔다"는 것만 알려 주고, 못 여는 것을 열 수
    // 있는 척하지 않는다.
    return {
      ...base,
      note:
        base.kind === 'sheet'
          ? '엑셀 파일입니다. 시트 구성은 제작 단계에서 확인합니다.'
          : '내용 미리보기를 지원하지 않는 형식입니다.',
    }
  }

  try {
    const slice = await file.slice(0, PEEK_BYTES).arrayBuffer()
    const bytes = new Uint8Array(slice)
    const { text, encoding, suspect } = decodeBest(bytes)

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) return { ...base, encoding, note: '내용이 비어 있습니다.' }

    const delimiter = guessDelimiter(lines[0])
    const headers = splitRow(lines[0], delimiter)
    const sampleRows = lines.slice(1, 4).map((l) => splitRow(l, delimiter))

    // 64KB만 읽었으므로 전체 행 수는 추정치다. 추정이라는 것을 화면에도 적는다.
    const avgLineBytes = slice.byteLength / Math.max(lines.length, 1)
    const estimatedRows =
      file.size > PEEK_BYTES ? Math.round(file.size / avgLineBytes) : lines.length - 1

    return {
      ...base,
      encoding,
      encodingSuspect: Boolean(suspect),
      delimiter: delimiter === '\t' ? '탭' : delimiter,
      headers,
      sampleRows,
      estimatedRows,
      rowsAreEstimate: file.size > PEEK_BYTES,
    }
  } catch (err) {
    return { ...base, note: `파일을 읽지 못했습니다: ${String(err.message).slice(0, 80)}` }
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
