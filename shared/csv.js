// CSV 파일 읽기.
//
// 남의 라이브러리를 쓰지 않는 이유는 xlsx.js와 같다. 이 도구가 푸는 문제의
// 절반이 "파일이 생각한 대로 안 생겼다"는 것이라, 어디서 왜 어긋나는지를
// 직접 설명할 수 있어야 한다.
//
// 여기서 다루는 실제 문제 네 가지
//   1) 글자 인코딩이 UTF-8이 아니다 (국내 정산서는 CP949가 흔하다)
//   2) 구분자가 쉼표가 아닐 수 있다 (탭, 세미콜론)
//   3) 값 안에 쉼표가 들어 있다 ("₩24,200")
//   4) 맨 앞에 눈에 안 보이는 표시가 붙어 있다 (BOM)

// 엑셀이 CSV를 저장하면 맨 앞에 EF BB BF 세 바이트를 붙인다. 눈에 안 보이지만
// 첫 컬럼 이름 앞에 붙어서, 그냥 읽으면 '주문일자'가 아니라 '﻿주문일자'가 된다.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// 어떤 글자 코드로 저장됐는지 알아낸다.
//
// 방법: UTF-8로 읽어 보고, 깨진 글자(�)가 나오면 CP949로 다시 읽어 본다.
// 둘 중 덜 깨진 쪽이 맞다. 파일 어디에도 "나는 CP949입니다"라고 적혀 있지
// 않기 때문에 이렇게 재 보는 수밖에 없다.
export function detectEncoding(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const utf8Broken = (utf8.match(/�/g) || []).length
  if (utf8Broken === 0) return { text: utf8, encoding: 'UTF-8', confident: true }

  try {
    const cp949 = new TextDecoder('euc-kr', { fatal: false }).decode(bytes)
    const cp949Broken = (cp949.match(/�/g) || []).length
    if (cp949Broken < utf8Broken) {
      return { text: cp949, encoding: 'CP949', confident: cp949Broken === 0 }
    }
  } catch {
    // 이 환경이 euc-kr을 모르는 경우. 판단을 접고 UTF-8 결과를 쓴다.
  }

  return { text: utf8, encoding: '알 수 없음', confident: false }
}

// 구분자 추정. 첫 줄에서 가장 많이 나오는 것을 고르되, 따옴표 안은 세지 않는다.
export function detectDelimiter(firstLine) {
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 }
  let inQuote = false
  for (const ch of firstLine) {
    if (ch === '"') inQuote = !inQuote
    else if (!inQuote && ch in counts) counts[ch] += 1
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n > 0 ? best : ','
}

// 한 줄을 칸으로 쪼갠다. 따옴표 안의 구분자는 무시한다.
//
// "₩24,200" 을 쉼표에서 자르면 금액이 24와 200으로 갈라진다. 이 한 줄 때문에
// 합계가 통째로 틀리고, 그런 오류는 눈으로 찾기 어렵다.
export function splitLine(line, delimiter) {
  const out = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      // 따옴표 안의 따옴표는 두 번 써서 표시한다("" → ")
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuote = !inQuote
      }
    } else if (ch === delimiter && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

// 줄 나누기. 값 안에 줄바꿈이 들어 있는 경우(따옴표 안)를 감안한다.
//
// **레코드가 파일 몇 번째 줄에서 시작했는지도 같이 돌려준다.**
//
// 처음에는 문자열 배열만 돌려주고 부르는 쪽에서 순번으로 줄 번호를 매겼다.
// 따옴표 안의 줄바꿈을 소비만 하고 세지 않아서, 상품명에 줄바꿈이 든
// 정산서를 올리면 그 지점 이후 '줄' 칸이 통째로 당겨졌다. 되짚기가 가리키는
// 원본 줄이 실제와 어긋난다 — 이 사이트가 내세우는 것이 바로 그 되짚기다.
function splitLines(text) {
  const lines = []
  let cur = ''
  let inQuote = false
  let physical = 1 // 지금 읽는 문자가 파일 몇 번째 줄에 있나
  let startedAt = 1 // 지금 모으는 레코드가 시작한 줄

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuote = !inQuote

    if (ch === '\n' || ch === '\r') {
      // \r\n 은 한 번만 센다
      const crlf = ch === '\r' && text[i + 1] === '\n'
      if (inQuote) {
        // 값 안의 줄바꿈. 레코드는 안 끝나지만 파일 줄 수는 늘어난다.
        cur += crlf ? '\n' : ch
        if (crlf) i += 1
        physical += 1
        continue
      }
      if (crlf) i += 1
      lines.push({ rowNo: startedAt, line: cur })
      cur = ''
      physical += 1
      startedAt = physical
    } else {
      cur += ch
    }
  }
  if (cur !== '') lines.push({ rowNo: startedAt, line: cur })
  return lines
}

// CSV 파일 하나를 { 머리글, 데이터줄 } 로 정리한다.
// xlsx.js의 toTable과 같은 모양으로 돌려주어, 뒤에 오는 처리가 두 형식을
// 구분하지 않아도 되게 한다.
export function readCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const { text, encoding, confident } = detectEncoding(bytes)

  // 완전히 빈 줄은 세지 않되, 원본 몇 번째 줄이었는지는 기억한다.
  // 줄 번호는 splitLines가 물리적으로 세어 준 값을 그대로 쓴다.
  const numbered = splitLines(stripBom(text)).filter((r) => r.line.trim() !== '')

  if (numbered.length === 0) {
    return { sheetName: '', headerRowNo: 0, header: [], rows: [], encoding, encodingConfident: confident }
  }

  const delimiter = detectDelimiter(numbered[0].line)
  const header = splitLine(numbered[0].line, delimiter)

  const rows = numbered.slice(1).map((r) => ({
    rowNo: r.rowNo,
    cells: splitLine(r.line, delimiter),
  }))

  return {
    sheetName: '',
    headerRowNo: numbered[0].rowNo,
    header,
    rows,
    encoding,
    encodingConfident: confident,
    delimiter,
  }
}

// 파일 확장자로 어떤 읽기 방법을 쓸지 정한다.
export function fileKind(name) {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase()
  if (['xlsx', 'xlsm'].includes(ext)) return 'xlsx'
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv'
  return 'other'
}
