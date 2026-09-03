// Database adapter bridge for optional Supabase backend.
// Keeps route call shape unchanged: env.DB.prepare(...).bind(...).all()/first()/run()

const RPC_NAME = 'execute_sql'

function hasValue(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function toText(v) {
  if (v == null) return null
  if (typeof v === 'string') return v
  return String(v)
}

function unwrapPayload(payload) {
  // Supabase can return scalar object or array with a named key.
  if (Array.isArray(payload)) {
    if (payload.length === 0) return null
    if (payload.length === 1 && payload[0] && Object.keys(payload[0]).length === 1) {
      const item = payload[0]
      const only = item[RPC_NAME]
      if (only !== undefined) return only
    }
    return payload[0]
  }
  return payload
}

async function callRpc(url, key, sql, binds) {
  const baseUrl = typeof url === 'string' && url.endsWith('/') ? url.slice(0, -1) : url
  const endpoint = `${baseUrl}/rest/v1/rpc/${RPC_NAME}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ p_sql: toText(sql), p_params: binds ?? [] }),
  })

  const raw = await res.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }

  const data = unwrapPayload(payload)

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && (data.message || data.error || data.details)) ||
      raw ||
      `Supabase RPC request failed with ${res.status}`
    throw new Error(msg)
  }

  return data
}

function toRowsResult(payload) {
  const data = unwrapPayload(payload)
  if (!data) return { results: [] }

  if (data.rows && Array.isArray(data.rows)) return { results: data.rows }
  if (data.result && Array.isArray(data.result)) return { results: data.result }
  if (Array.isArray(data)) return { results: data }
  return { results: [] }
}

function toRunResult(payload) {
  const data = unwrapPayload(payload) || {}
  const rows = toRowsResult(data).results

  const countRaw = data.rowCount ?? data.row_count
  const rowCount = Number.isFinite(Number(countRaw)) ? Number(countRaw) : rows.length

  const lastRowId =
    data.last_row_id ??
    data.lastRowId ??
    (rows.length > 0 && rows[0]?.id != null
      ? Number(rows[0].id)
      : null)

  return {
    success: true,
    meta: {
      ...(rowCount >= 0 ? { row_count: rowCount, changes: rowCount } : {}),
      ...(lastRowId == null ? {} : { last_row_id: Number.isFinite(Number(lastRowId)) ? Number(lastRowId) : lastRowId }),
    },
  }
}

function createSupabaseDb(url, key) {
  const exec = async (sql, binds) => {
    const data = await callRpc(url, key, sql, binds)
    return {
      rows: () => toRowsResult(data),
      all: () => toRowsResult(data),
      first: () => {
        const rows = toRowsResult(data).results
        return rows[0] ?? null
      },
      run: () => toRunResult(data),
    }
  }

  return {
    prepare(sql) {
      const text = toText(sql)
      if (text == null) {
        throw new Error('SQL statement is required.')
      }

      const stmt = {
        _binds: [],
        bind(...binds) {
          stmt._binds = binds
          return stmt
        },
      }

      stmt.all = async () => {
        const r = await exec(text, stmt._binds)
        return r.all()
      }

      stmt.first = async () => {
        const r = await exec(text, stmt._binds)
        return r.first()
      }

      stmt.run = async () => {
        const r = await exec(text, stmt._binds)
        return r.run()
      }

      return stmt
    },

    async batch(stmts = []) {
      const out = []
      for (const s of stmts) {
        if (!s || typeof s.run !== 'function') continue
        out.push(await s.run())
      }
      return out
    },
  }
}

export async function withDbBinding(env) {
  if (!env) return env

  const useSupabase = hasValue(env.SUPABASE_URL) && hasValue(env.SUPABASE_SERVICE_ROLE_KEY)
  if (!useSupabase) return env.DB

  return createSupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
}
