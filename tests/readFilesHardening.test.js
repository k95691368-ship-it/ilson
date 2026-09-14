import { describe, it, expect, vi } from 'vitest'
import { readLocalFiles } from '../src/lib/readFiles.js'

describe('local file intake before allocating buffers', () => {
  it('reads no files when any selected file exceeds the size cap', async () => {
    const read = vi.fn()
    await expect(readLocalFiles([{ name: 'ok', size: 10, arrayBuffer: read }, { name: 'large', size: 10 * 1024 * 1024 + 1, arrayBuffer: read }])).rejects.toThrow('10MB')
    expect(read).not.toHaveBeenCalled()
  })
  it('rejects excessive counts before any read', async () => {
    const read = vi.fn()
    await expect(readLocalFiles(Array.from({ length: 6 }, () => ({ size: 1, arrayBuffer: read })))).rejects.toThrow('5개')
    expect(read).not.toHaveBeenCalled()
  })
  it('preserves names, content, order and the exact allowed boundary', async () => {
    const buffer = new ArrayBuffer(4)
    const files = [{ name: 'one.csv', size: 10 * 1024 * 1024, arrayBuffer: async () => buffer }, { name: 'two.xlsx', size: 1, arrayBuffer: async () => buffer }]
    expect(await readLocalFiles(files)).toEqual(files.map(file => ({ name: file.name, buffer })))
    expect(await readLocalFiles(null)).toEqual([])
  })
})
