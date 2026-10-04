// Index once per calculation. The first sample deliberately matches the old
// find(code) contract, while affected counts only unknown_sku rows.
export function indexTeachQuarantine(rows) {
  const byCode = new Map()
  for (const row of rows ?? []) {
    const code = row.externalCode
    if (!code) continue
    let entry = byCode.get(code)
    if (!entry) {
      entry = { affected: 0, sample: row }
      byCode.set(code, entry)
    }
    if (row.reason === 'unknown_sku') entry.affected += 1
  }
  return byCode
}
