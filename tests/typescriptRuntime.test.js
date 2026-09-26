import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compileDemoRoutes } from '../scripts/lib/demo-routes.mjs'

const ROOT = process.cwd()
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? walk(path) : [path]
})

describe('incremental TypeScript runtime coverage', () => {
  it('discovers both source extensions, index routes and dynamic parameters', () => {
    const routes = compileDemoRoutes([
      'functions/api/_middleware.js', 'functions/api/private/_middleware.ts',
      'functions/api/types.d.ts', 'functions/api/readme.md',
      'functions/api/applications/index.ts', 'functions/api/applications/[id]/review.ts',
      'functions/api/tools/[slug].js',
    ])
    expect(routes).toHaveLength(3)
    expect(routes.find(route => route.regex.test('/api/applications/'))?.file).toBe('functions/api/applications/index.ts')
    const review = routes.find(route => route.regex.test('/api/applications/app_1/review'))
    expect(review?.names).toEqual(['id'])
    expect('/api/applications/app_1/review'.match(review.regex)?.[1]).toBe('app_1')
    expect(routes.some(route => route.regex.test('/api/applications/app_1/review/more'))).toBe(false)
    expect(routes.find(route => route.regex.test('/api/tools/example'))?.names).toEqual(['slug'])
  })

  it('keeps static routes ahead of dynamic routes across extensions', () => {
    const routes = compileDemoRoutes(['functions/api/tools/[slug].js', 'functions/api/tools/new.ts'])
    expect(routes.find(route => route.regex.test('/api/tools/new'))?.file).toBe('functions/api/tools/new.ts')
  })

  it.each([
    ['functions/api/example.js', 'functions/api/example.ts'],
    ['functions/api/example.ts', 'functions/api/example/index.js'],
    ['functions/api/tools/[slug].ts', 'functions/api/tools/[id].js'],
  ])('rejects ambiguous routes %s and %s instead of choosing a file', (first, second) => {
    expect(() => compileDemoRoutes([first, second])).toThrow('Duplicate API route')
  })

  it('normalizes Windows paths and escapes literal route characters', () => {
    const [route] = compileDemoRoutes(['functions\\api\\version.v1.ts'])
    expect(route.regex.test('/api/version.v1')).toBe(true)
    expect(route.regex.test('/api/versionXv1')).toBe(false)
    expect(() => compileDemoRoutes(['elsewhere/api/example.ts'])).toThrow('Unexpected API source path')
    expect(() => compileDemoRoutes(['functions/api/[id]/[id].ts'])).toThrow('Duplicate API parameter')
  })

  it('includes every current API source and the migrated review handler', () => {
    const sources = walk('functions/api').filter(file => /\.[jt]s$/.test(file) && !file.endsWith('.d.ts') && !/_middleware\.[jt]s$/.test(file))
    const routes = compileDemoRoutes(sources)
    expect(routes).toHaveLength(sources.length)
    expect(routes.length).toBeGreaterThan(40)
    expect(routes.find(route => route.regex.test('/api/applications/app_test/review'))?.file.replaceAll('\\', '/')).toBe('functions/api/applications/[id]/review.ts')
    expect(readFileSync('scripts/dev-demo.mjs', 'utf8')).toContain('compileDemoRoutes(await walk(')
  })

  it('imports migrated server/shared modules with the actual Node demo flags', () => {
    const modules = ['functions', 'shared'].flatMap(walk).filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    expect(modules.length).toBeGreaterThan(5)
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['dev:demo']).toContain('node --experimental-strip-types scripts/dev-demo.mjs')
    const script = `import { pathToFileURL } from 'node:url';
      for (const file of ${JSON.stringify(modules.map(file => resolve(ROOT, file)))}) await import(pathToFileURL(file).href);
      console.log('migrated-runtime-ok');`
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 30000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('migrated-runtime-ok')
  }, 35000)

  it('does not silently exclude any TypeScript application source from type checking', () => {
    const sources = ['functions', 'shared', 'src'].flatMap(walk).filter(file => /\.tsx?$/.test(file))
    const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '--listFilesOnly', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const included = new Set(result.stdout.split(/\r?\n/).filter(Boolean).map(file => resolve(file)))
    for (const file of sources) expect(included.has(resolve(ROOT, file)), file).toBe(true)
  }, 35000)
})
