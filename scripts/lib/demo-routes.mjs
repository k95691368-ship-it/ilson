// The isolated server must exercise the same route after a .js -> .ts migration.
// Fail closed on ambiguous source files instead of silently choosing one handler.
export function compileDemoRoutes(files) {
  const seen = new Map()
  return files.filter(file => /\.[jt]s$/.test(file) && !file.endsWith('.d.ts') && !/(?:^|[/\\])_middleware\.[jt]s$/.test(file)).map(file => {
    const normalized = file.replaceAll('\\', '/')
    if (!normalized.startsWith('functions/api/')) throw new Error(`Unexpected API source path: ${file}`)
    const path = normalized.slice('functions'.length).replace(/\/index\.[jt]s$/, '').replace(/\.[jt]s$/, '')
    const names = []
    const pattern = path.split('/').map(segment => {
      const parameter = /^\[([A-Za-z_][\w]*)\]$/.exec(segment)
      if (parameter) {
        if (names.includes(parameter[1])) throw new Error(`Duplicate API parameter: ${file}`)
        names.push(parameter[1])
        return '([^/]+)'
      }
      if (segment.includes('[') || segment.includes(']')) throw new Error(`Unsupported API parameter: ${file}`)
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('/')
    if (seen.has(pattern)) throw new Error(`Duplicate API route: ${seen.get(pattern)} and ${file}`)
    seen.set(pattern, file)
    return { file, names, regex: new RegExp('^' + pattern + '/?$') }
  }).sort((a, b) => a.names.length - b.names.length || a.file.localeCompare(b.file))
}
