// Local verification only: real route handlers + disposable in-memory PostgreSQL.
// No production credentials, database, network integrations or persisted visitor data.
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'
import { onRequest } from '../functions/api/_middleware.js'
const pg = new PGlite()
await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
for (const file of ['0000_schema.sql', '0001_execute_sql.sql', '0002_override_loop.sql', '0003_journey_workspaces.sql', '0004_audit_hardening.sql','0005_field_feedback.sql']) {
  await pg.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
}
let queue = Promise.resolve()
globalThis.fetch = (url, options) => {
  if (!String(url).startsWith('https://local-demo.supabase.co/rest/v1/rpc/')) return Promise.reject(new Error('External network disabled in local demo'))
  const run = queue.then(async () => {
    try {
      const name = new URL(url).pathname.split('/').at(-1)
      if (!/^ilson_(execute|batch|workspace_(query|batch|open|reset)|mutation_receipt|commit_mutation|claim_rate_limit|readiness)$/.test(name)) throw new Error('Unsupported RPC')
      const args = Object.values(JSON.parse(options.body))
      await pg.exec('SET ROLE service_role')
      const result = await pg.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`, args)
      return Response.json(result.rows[0].data)
    } catch (error) { return Response.json({ code: error.code || 'LOCAL' }, { status: 400 }) }
    finally { await pg.exec('RESET ROLE') }
  })
  queue = run.catch(() => {})
  return run
}
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : dir + '/' + entry.name))).flat()
}
const routes = (await walk('functions/api')).filter(file => file.endsWith('.js') && !file.endsWith('_middleware.js')).map(file => {
  const names = []
  const path = file.replace('functions', '').replace(/\/index\.js$/, '').replace(/\.js$/, '').replace(/\[([^\]]+)\]/g, (_, name) => { names.push(name); return '([^/]+)' })
  return { file, names, regex: new RegExp('^' + path + '/?$') }
}).sort((a, b) => a.names.length - b.names.length)
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{
  name: 'local-isolated-api', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next()
      try {
        const url = new URL(req.url, 'http://127.0.0.1:5187')
        const route = routes.find(item => item.regex.test(url.pathname))
        if (!route) { res.statusCode = 404; return res.end() }
        const match = url.pathname.match(route.regex)
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) })
        const module = await import(pathToFileURL(resolve(route.file)))
        const handler = module['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()]
        const context = { request, env: { DEMO_WORKSPACES: 'true', SUPABASE_URL: 'https://local-demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-only' },
          params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i+1])])), data: {}, waitUntil: promise => promise.catch(() => {}) }
        const bindings = context.env
        // Reproduce Pages: next() gets original bindings and shared request data.
        context.next = () => handler ? handler({ ...context, env: bindings }) : Response.json({ error: 'Method not allowed' }, { status: 405 })
        const response = await onRequest(context)
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })) }
    })
  },
}] })
await server.listen()
console.log('Local isolated demo: http://127.0.0.1:5187 — all data is in memory')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); await pg.close(); process.exit(0) })
