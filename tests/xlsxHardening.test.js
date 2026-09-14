// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { readXlsx } from '../shared/xlsx.js'

// Small in-memory fixtures only. Never read untrusted files or contact a server.
function zip(entries) {
  const local = [], central = []
  let offset = 0
  for (const { name, text, declared, method = 8 } of entries) {
    const filename = Buffer.from(name), plain = Buffer.from(text)
    const data = method === 0 ? plain : deflateRawSync(plain)
    const header = Buffer.alloc(30), directory = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(method, 8)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(declared ?? plain.length, 22)
    header.writeUInt16LE(filename.length, 26)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(method, 10)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(declared ?? plain.length, 24)
    directory.writeUInt16LE(filename.length, 28)
    directory.writeUInt32LE(offset, 42)
    local.push(header, filename, data)
    central.push(directory, filename)
    offset += header.length + filename.length + data.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(Buffer.concat(central).length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}
const workbook = xml => zip([
  { name: 'xl/workbook.xml', text: '<workbook><sheets><sheet name="정산" sheetId="1" r:id="r1"/></sheets></workbook>' },
  { name: 'xl/worksheets/sheet1.xml', text: `<worksheet><sheetData>${xml}</sheetData></worksheet>` },
])

describe('bounded XLSX parsing', () => {
  it('preserves normal values and sparse row/column positions', async () => {
    expect((await readXlsx(workbook('<c r="B3"><v>42</v></c>')))[0].rows).toEqual([[], [], [null, 42]])
  })
  it.each(['A100001', 'A99999999999999', 'ZZZZZZ1', 'A0'])('rejects oversized cell coordinates %s before expanding arrays', async ref => {
    await expect(readXlsx(workbook(`<c r="${ref}"><v>1</v></c>`))).rejects.toThrow('처리 한도')
  })
  it('checks actual decompressed bytes even if ZIP metadata lies', async () => {
    const bomb = zip([{ name: 'xl/sharedStrings.xml', text: 'x'.repeat(16 * 1024 * 1024 + 1), declared: 1 }])
    expect(bomb.byteLength).toBeLessThan(20000)
    await expect(readXlsx(bomb)).rejects.toThrow('처리 한도')
  })
  it('rejects excessive declared sizes before decompression', async () => {
    await expect(readXlsx(zip([{ name: 'a', text: 'ok', declared: 0xffffffff }]))).rejects.toThrow('처리 한도')
  })
  it('rejects unsupported compression, duplicate names, and truncated directories', async () => {
    await expect(readXlsx(zip([{ name: 'a', text: 'ok', method: 99 }]))).rejects.toThrow('압축 형식')
    await expect(readXlsx(zip([{ name: 'a', text: 'one' }, { name: 'a', text: 'two' }]))).rejects.toThrow('압축 형식')
    const data = zip([{ name: 'a', text: 'ok' }])
    data.writeUInt32LE(data.length - 5, data.length - 6)
    await expect(readXlsx(data)).rejects.toThrow('압축 형식')
  })
  it('rejects inconsistent sizes and respects the whole-workbook materialization budget', async () => {
    await expect(readXlsx(zip([{ name: 'a', text: 'hello', declared: 1, method: 0 }]))).rejects.toThrow('압축 형식')
    const cells = Array.from({ length: 2000 }, (_, i) => `<c r="AMJ${i + 1}"><v>1</v></c>`).join('')
    await expect(readXlsx(workbook(cells))).rejects.toThrow('처리 한도')
  })
})
