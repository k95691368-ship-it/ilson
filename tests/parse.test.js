// 파일 읽는 코드가 실제 파일을 제대로 읽는지 확인한다.
//
// 지어낸 예제가 아니라 seed/out/ 에 있는 진짜 파일로 검사한다. 이 파일들에는
// 실무에서 만나는 것들이 그대로 들어 있다 — 병합된 제목 줄, 4번째 줄에서
// 시작하는 머리글, CP949 인코딩, 반품 음수, 맨 끝 합계 줄, 시트 세 장.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readXlsx, toTable, findHeaderRow, excelSerialToISO, columnIndex } from '../shared/xlsx.js'
import { readCsv, detectEncoding, detectDelimiter, splitLine, fileKind } from '../shared/csv.js'

const seed = (name) => readFileSync(resolve(process.cwd(), 'seed/out', name))

describe('CSV 읽기', () => {
  it('UTF-8 파일을 읽는다', () => {
    const t = readCsv(seed('01_자사몰_주문내역_2026-06.csv'))
    expect(t.encoding).toBe('UTF-8')
    expect(t.header).toEqual(['주문일자', '상품코드', '상품명', '수량', '판매가', '할인액', '결제수단'])
    expect(t.rows.length).toBeGreaterThan(100)
  })

  it('CP949 파일을 알아보고 한글을 살려 읽는다', () => {
    const t = readCsv(seed('03_쿠팡_정산내역_2026-06.csv'))
    expect(t.encoding).toBe('CP949')
    // UTF-8로 읽었다면 여기가 깨진 글자였을 것이다.
    expect(t.header).toContain('노출상품명')
    expect(t.header).toContain('실지급액')
    expect(t.rows.some((r) => r.cells.some((c) => c.includes('마스크')))).toBe(true)
  })

  it('반품이 음수로 들어온 줄을 그대로 읽는다', () => {
    const t = readCsv(seed('03_쿠팡_정산내역_2026-06.csv'))
    const qtyIndex = t.header.indexOf('판매수량')
    const negatives = t.rows.filter((r) => Number(r.cells[qtyIndex]) < 0)
    expect(negatives.length).toBeGreaterThan(0)
  })

  it('따옴표 안의 쉼표에서 값을 자르지 않는다', () => {
    // "₩24,200" 을 쉼표에서 자르면 금액이 24와 200으로 갈라진다.
    expect(splitLine('2026-06-18,NR-RE-020,아이크림,1,"₩24,200",2420,카드', ',')).toEqual([
      '2026-06-18',
      'NR-RE-020',
      '아이크림',
      '1',
      '₩24,200',
      '2420',
      '카드',
    ])
  })

  it('따옴표 안의 따옴표를 한 글자로 되돌린다', () => {
    expect(splitLine('a,"그가 ""안 된다"" 라고 했다",c', ',')).toEqual([
      'a',
      '그가 "안 된다" 라고 했다',
      'c',
    ])
  })

  it('구분자를 알아본다', () => {
    expect(detectDelimiter('a,b,c')).toBe(',')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
    expect(detectDelimiter('a;b;c')).toBe(';')
    // 따옴표 안의 구분자는 세지 않는다
    expect(detectDelimiter('a,"b;c;d;e;f",g')).toBe(',')
  })

  it('맨 앞의 안 보이는 표시(BOM)를 떼어 낸다', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('가,나\n1,2')])
    const t = readCsv(withBom)
    expect(t.header[0]).toBe('가')
  })

  it('빈 줄을 건너뛰되 원본 줄 번호는 지킨다', () => {
    const text = new TextEncoder().encode('머리1,머리2\n\n값1,값2\n')
    const t = readCsv(text)
    expect(t.rows).toHaveLength(1)
    // 빈 줄 때문에 값 줄은 원본에서 3번째다. 여기가 어긋나면 나중에
    // "원본 몇 번째 줄" 되짚기가 전부 밀린다.
    expect(t.rows[0].rowNo).toBe(3)
  })

  it('확장자로 읽는 방법을 고른다', () => {
    expect(fileKind('a.xlsx')).toBe('xlsx')
    expect(fileKind('a.CSV')).toBe('csv')
    expect(fileKind('a.pdf')).toBe('other')
  })

  it('인코딩을 확신할 수 없으면 그렇다고 말한다', () => {
    // 어느 쪽으로 읽어도 깨지는 바이트
    const junk = new Uint8Array([0xff, 0xfe, 0xff, 0xfe])
    const r = detectEncoding(junk)
    expect(r.confident).toBe(false)
  })
})

describe('엑셀 읽기', () => {
  it('병합된 제목 줄을 건너뛰고 진짜 머리글을 찾는다', async () => {
    const sheets = await readXlsx(seed('02_올리브영_정산_2026-06.xlsx'))
    expect(sheets).toHaveLength(1)

    const s = sheets[0]
    expect(s.name).toBe('정산내역')
    // 1행 제목, 2행 안내, 3행 빈 줄, 4행이 진짜 머리글
    expect(s.merges).toContain('A1:G1')

    const t = toTable(s)
    expect(t.headerRowNo).toBe(4)
    expect(t.header).toEqual([
      '매출일자',
      '점포',
      '자체상품코드',
      '상품명',
      '판매수량',
      '매출액(VAT포함)',
      '수수료율',
    ])
  })

  it('날짜로 저장된 칸을 숫자가 아니라 날짜로 읽는다', async () => {
    const sheets = await readXlsx(seed('02_올리브영_정산_2026-06.xlsx'))
    const t = toTable(sheets[0])
    const first = t.rows[0].cells[0]
    // 45000 같은 숫자가 아니라 2026-06-23 모양이어야 한다
    expect(first).toMatch(/^2026-06-\d{2}$/)
  })

  it('맨 끝 합계 줄이 데이터에 섞여 들어온다 — 걸러 내는 것은 다음 단계의 일', async () => {
    const sheets = await readXlsx(seed('02_올리브영_정산_2026-06.xlsx'))
    const t = toTable(sheets[0])
    const last = t.rows[t.rows.length - 1]
    expect(last.cells.some((c) => String(c ?? '').includes('합'))).toBe(true)
  })

  it('시트 세 장을 모두 읽고, 시트마다 머리글 위치가 달라도 각각 찾는다', async () => {
    const sheets = await readXlsx(seed('05_Qoo10_JP_決済明細_2026Q2.xlsx'))
    expect(sheets.map((s) => s.name)).toEqual(['2026年04月', '2026年05月', '2026年06月'])

    const tables = sheets.map(toTable)
    // 첫 시트는 1행, 나머지는 3행이 머리글이다.
    expect(tables[0].headerRowNo).toBe(1)
    expect(tables[1].headerRowNo).toBe(3)
    expect(tables[2].headerRowNo).toBe(3)

    for (const t of tables) {
      expect(t.header).toEqual(['決済日', '商品コード', '数量', '販売金額', '手数料'])
      expect(t.rows.length).toBeGreaterThan(20)
    }
  })

  it('엑셀 날짜 숫자를 실제 날짜로 바꾼다', () => {
    expect(excelSerialToISO(46234)).toBe('2026-07-31')
    expect(excelSerialToISO(46174)).toBe('2026-06-01')
    expect(excelSerialToISO(NaN)).toBeNull()
    expect(excelSerialToISO(null)).toBeNull()
  })

  it('1900년 3월 이전 날짜가 하루 어긋나는 것은 알고 있는 한계다', () => {
    // 엑셀이 1900년을 윤년으로 잘못 알아 2월 29일을 실제 날처럼 세기 때문이다.
    // 여기서 맞추면 오히려 엑셀과 값이 달라진다. 정산 데이터는 전부 최근
    // 날짜라 실무에서 걸릴 일이 없으므로, 고치지 않고 알고 있다고 적어 둔다.
    expect(excelSerialToISO(1)).toBe('1899-12-31') // 엑셀은 1900-01-01이라고 한다
    expect(excelSerialToISO(61)).toBe('1900-03-01') // 여기부터는 엑셀과 같다
  })

  it('셀 주소에서 열 번호를 뽑는다', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('B12')).toBe(1)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnIndex('BC100')).toBe(54)
  })

  it('머리글 찾기: 숫자만 있는 줄은 머리글로 보지 않는다', () => {
    const rows = [
      ['2026-06-01', 1, 2],
      ['날짜', '수량', '금액'],
    ]
    // 첫 줄이 이미 데이터다. 글자가 든 두 번째 줄이 머리글.
    expect(findHeaderRow(rows, [])).toBe(1)
  })
})
