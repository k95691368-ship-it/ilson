import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runPipeline } from '../shared/pipeline.js'
import { gradeAll } from '../shared/grade.js'
import { settlementCsv } from '../shared/settlementExport.js'
import { readCsv } from '../shared/csv.js'

const file = (gross, name = '정산.csv') => ({ name, buffer: new TextEncoder().encode([
  '주문일자,상품코드,상품명,수량,판매가,할인액',
  `2026-06-01,NR-CM-100,합성 상품,1,${gross},0`,
  `2026-06-02,UNKNOWN,검토할 합성 상품,1,${gross},0`,
].join('\n')) })
const hash = input => createHash('sha256').update(input.buffer).digest('hex')

describe('browser settlement source identity', () => {
  it('distinguishes different contents with the same filename, sheet and row number', async () => {
    const inputs = [file(10000), file(15000)]
    const result = await runPipeline({ files: inputs })
    expect(result.rows).toHaveLength(2)
    expect(result.quarantine).toHaveLength(2)
    expect(new Set(result.rows.map(r => `${r.source.file}:${r.source.sheet}:${r.source.rowNo}`)).size).toBe(1)
    expect(result.rows.map(r => r.source.sha256)).toEqual(inputs.map(hash))
    expect(new Set(result.rows.map(r => r.source.sha256)).size).toBe(2)
    expect(result.quarantine.map(q => q.source.sha256)).toEqual(inputs.map(hash))
    expect(result.files.map(report => report.sha256)).toEqual(inputs.map(hash))
    for (const row of [...result.rows, ...result.quarantine]) expect(row.source.ambiguousName).toBe(true)
    expect(result.totals.all.net_revenue_krw).toBe(25000)
  })

  it('keeps identical-content suppression and its exact retained reference across renamed files', async () => {
    const original = file(10000)
    const renamed = { ...original, name: '사본.csv' }
    const result = await runPipeline({ files: [original, renamed] })
    expect(result.rows).toHaveLength(1)
    expect(result.stats.duplicateFilesSkipped).toBe(1)
    expect(result.totals.all.net_revenue_krw).toBe(10000)
    expect(result.files.find(f => f.skippedDuplicate)).toMatchObject({
      name: '사본.csv', sha256: hash(original), duplicateOf: { file: original.name, sha256: hash(original) },
    })
    expect(result.rows[0].source.ambiguousName).toBe(false)
  })

  it('preserves row duplicate suspicion across different files without deleting either row', async () => {
    const original = file(10000)
    const changed = { ...original, buffer: new TextEncoder().encode(new TextDecoder().decode(original.buffer) + '\n') }
    const result = await runPipeline({ files: [original, changed] })
    expect(result.stats.duplicateFilesSkipped).toBe(0)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1].duplicate_of).toMatchObject({ file: original.name, rowNo: 2, sha256: hash(original) })
    expect(result.rows[1].source.sha256).toBe(hash(changed))
    expect(result.totals.all.net_revenue_krw).toBe(20000)
  })

  it('preserves exact file labels and complete source fingerprints in the browser export', async () => {
    const inputs = [file(10000, '01_정산.csv'), file(15000, '01_정산.csv')]
    const result = await runPipeline({ files: inputs })
    const csv = settlementCsv(result.rows)
    const parsed = readCsv(new TextEncoder().encode(csv))
    const column = label => parsed.header.indexOf(label)
    expect(parsed.rows.map(row => row.cells[column('원본파일')])).toEqual(inputs.map(input => input.name))
    expect(parsed.rows.map(row => row.cells[column('원본SHA256')])).toEqual(inputs.map(hash))
    expect(parsed.rows.map(row => Number(row.cells[column('순매출')]))).toEqual([10000, 15000])
    expect(parsed.rows.map(row => Number(row.cells[column('원본줄')]))).toEqual([2, 2])
  })

  it('exports duplicate suspicion as a reference rather than silently removing the row', async () => {
    const a = file(10000)
    const b = { ...a, buffer: new TextEncoder().encode(new TextDecoder().decode(a.buffer) + '\n') }
    const result = await runPipeline({ files: [a, b] })
    const parsed = readCsv(new TextEncoder().encode(settlementCsv(result.rows)))
    expect(parsed.rows).toHaveLength(2)
    const duplicateHash = parsed.header.indexOf('중복의심원본SHA256')
    expect(parsed.rows[0].cells[duplicateHash]).toBe('')
    expect(parsed.rows[1].cells[duplicateHash]).toBe(hash(a))
  })

  it('preserves identity for unreadable and unknown-layout reports, not only successful rows', async () => {
    const inputs = [
      { name: 'bad.xlsx', buffer: new TextEncoder().encode('not a zip') },
      { name: 'unknown.csv', buffer: new TextEncoder().encode('새항목,새값\n예,아니오') },
    ]
    const result = await runPipeline({ files: inputs })
    expect(result.files.map(report => report.sha256)).toEqual(inputs.map(hash))
    expect(result.quarantine[0].source.sha256).toBe(hash(inputs[1]))
  })

  it('records the empty-file reference explicitly without inventing a positive source line', async () => {
    const input = { name: 'empty.csv', buffer: new Uint8Array(0) }
    const result = await runPipeline({ files: [input] })
    expect(result.rows).toHaveLength(0)
    expect(result.quarantine[0]).toMatchObject({ reason: 'unknown_channel', source: { file: input.name, rowNo: 0, sha256: hash(input) } })
    expect(result.files[0]).toMatchObject({ name: input.name, sha256: hash(input), headerRowNo: 0, ok: false })
  })

  it('distinguishes two same-name sheets in beta and does not accept ambiguous truth references', async () => {
    const inputs = [file(10000), file(15000)]
    const criteria = ['period_scoped', 'traceable', 'quarantine_complete', 'quarantine_precise'].map((check_key, ord) => ({ id: `c${ord}`, ord, check_kind: 'rule', check_key }))
    const oldTruth = { quarantine: [{ source_file: '정산.csv', source_sheet: '', source_row_no: 3 }] }
    const incomplete = await gradeAll({ files: inputs, criteria, truth: oldTruth, period: { start: '2026-06-01' } })
    expect(incomplete.graded[0].evidence).toContain('시트 2장')
    expect(incomplete.graded[1].verdict).toBe('통과')
    expect(incomplete.graded.slice(2).map(check => check.verdict)).toEqual(['판정불가', '판정불가'])
    expect(incomplete.sourceFiles.map(report => report.sha256)).toEqual(inputs.map(hash))
    const truth = { quarantine: inputs.map(input => ({ ...oldTruth.quarantine[0], source_sha256: hash(input) })) }
    const complete = await gradeAll({ files: inputs, criteria, truth, period: { start: '2026-06-01' } })
    expect(complete.graded.map(check => check.verdict)).toEqual(['통과', '통과', '통과', '통과'])
    const wrongTruth = { quarantine: [{ ...oldTruth.quarantine[0], source_sha256: '0'.repeat(64) }] }
    const wrong = await gradeAll({ files: inputs, criteria, truth: wrongTruth, period: { start: '2026-06-01' } })
    expect(wrong.graded.slice(2).map(check => check.verdict)).toEqual(['실패', '실패'])
  })

  it('does not ignore a supplied truth fingerprint merely because one filename is unique', async () => {
    const input = file(10000)
    const criteria = [{ id: 'q', check_kind: 'rule', check_key: 'quarantine_complete' }]
    const truth = { quarantine: [{ source_file: input.name, source_sheet: '', source_row_no: 3, source_sha256: hash(file(15000)) }] }
    const graded = await gradeAll({ files: [input], criteria, truth })
    expect(graded.graded[0].verdict).toBe('실패')
    expect(graded.graded[0].samples[0].원본SHA256).toBe(truth.quarantine[0].source_sha256)
  })
})
