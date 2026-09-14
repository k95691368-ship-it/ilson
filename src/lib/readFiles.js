// Validate the complete selection BEFORE reading any file into browser memory.
export async function readLocalFiles(fileList) {
  const files = Array.from(fileList ?? [])
  if (files.length > 5) throw new Error('파일은 한 번에 5개까지 처리할 수 있습니다. 나누어 실행해주세요.')
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > 10 * 1024 * 1024) {
      throw new Error('파일 하나는 10MB까지 처리할 수 있습니다. 파일을 나누어 다시 시도해주세요.')
    }
  }
  // Sequential reads avoid simultaneous temporary buffers for every file.
  const result = []
  for (const file of files) result.push({ name: file.name, buffer: await file.arrayBuffer() })
  return result
}
