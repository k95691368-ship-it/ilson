// Server-only Supabase bridge. Route handlers keep the D1 statement interface.
const statementData = new WeakMap()
const accessFailures = new WeakMap()

// Only errors created at a verified scoped RPC boundary may change HTTP access
// status. Never trust an upstream message or an arbitrary error.status property.
export function databaseAccessFailure(error) {
  return accessFailures.get(error) ?? null
}

// Optional logging/compatibility failures may be ignored, but a revoked scope
// must still reach the HTTP boundary. This does not imply earlier writes failed.
export function rethrowDatabaseAccessFailure(error) {
  if (databaseAccessFailure(error)) throw error
}

function integerCasts(tokens) {
  // SQLite truncates integer casts; PostgreSQL rounds. Preserve elapsed-time values.
  for (let i = 0; i < tokens.length; i++) {
    if (!/^CAST$/i.test(tokens[i])) continue
    let open = i + 1
    while (/^\s+$/.test(tokens[open] || '')) open++
    if (tokens[open] !== '(') continue
    let depth = 1, end = open + 1, as = -1
    for (; end < tokens.length; end++) {
      if (tokens[end] === '(') depth++
      if (tokens[end] === ')') {
        depth--
        if (depth === 0) break
      }
      if (depth === 1 && /^AS$/i.test(tokens[end])) as = end
    }
    if (as < 0 || !/^\s*INTEGER\s*$/i.test(tokens.slice(as + 1, end).join(''))) continue
    const expression = integerCasts(tokens.slice(open + 1, as)).join('')
    tokens.splice(i, end - i + 1, `CAST(TRUNC((${expression})::numeric) AS BIGINT)`)
  }
  return tokens
}

function literal(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Unsupported SQL parameter')
  return "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'"
}

export function compileSql(sql, binds = []) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL statement is required')
  // A question mark in a literal, identifier or comment is not a parameter.
  const tokens = sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[a-z_][a-z_0-9]*|\s+|./gi) || []
  let index = 0
  const result = tokens.map(token => {
    if (token === '?') {
      if (index >= binds.length) throw new Error('Missing SQL parameter')
      return literal(binds[index++])
    }
    if (/^REAL$/i.test(token)) return 'DOUBLE PRECISION'
    return token
  })
  if (index !== binds.length) throw new Error('Extra SQL parameter')
  return integerCasts(result).join('').trim().replace(/;\s*$/, '')
}

function resultOf(data) {
  if (!data || !Array.isArray(data.rows) || !Number.isFinite(Number(data.rowCount))) {
    throw new Error('Invalid Supabase database response')
  }
  return {
    success: true, results: data.rows,
    meta: { changes: Number(data.rowCount), row_count: Number(data.rowCount),
      ...(data.last_row_id == null ? {} : { last_row_id: Number(data.last_row_id) }) },
  }
}

export function createSupabaseDb(url, key, workspaceToken = null, actorEmail = null) {
  if (actorEmail !== null && (workspaceToken || typeof actorEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(actorEmail))) {
    throw new Error('Invalid database actor scope')
  }
  const endpoint = new URL(url.trim())
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password) {
    throw new Error('Invalid Supabase URL')
  }
  const rpc = async (name, body) => {
    const response = await fetch(endpoint.origin + '/rest/v1/rpc/' + name, {
      // Workers supports manual/follow, not error. Non-2xx below fails closed
      // without forwarding service credentials to a redirect destination.
      method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer ' + key.trim(), apikey: key.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      // Never expose SQL, user data or service credentials through route errors.
      let code = ''
      try { code = (await response.json()).code || '' } catch { /* malformed upstream error */ }
      const error = new Error('Database request failed (' + response.status + (/^[A-Z0-9]+$/.test(code) ? '/' + code : '') + ')')
      if ((actorEmail || workspaceToken) && (code === '28000' || code === '42501')) {
        error.name = 'DatabaseAccessError'
        accessFailures.set(error, Object.freeze({
          status: code === '28000' ? 401 : 403,
          code: code === '28000' ? 'ACCESS_REVOKED' : 'ACCESS_DENIED',
          error: workspaceToken
            ? code === '28000' ? '체험 공간이 만료되었습니다. 페이지를 새로 열어 주세요.' : '현재 체험 공간에서 이 자료에 접근할 수 없습니다.'
            : code === '28000' ? '현재 계정으로 접근할 수 없습니다. 계정 권한을 확인해 주세요.' : '현재 계정에는 이 자료를 조회하거나 변경할 권한이 없습니다.',
        }))
      }
      throw error
    }
    return response.json()
  }
  const scopedSql = sql => workspaceToken
    ? sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|E?'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|\b(datetime|julianday|group_concat)\s*\(/gi,
      (match, name) => name ? `public.${name}(` : match)
    : sql
  const queryRpc = (sql) => actorEmail
    ? rpc('ilson_actor_query', { p_actor: actorEmail, p_sql: sql })
    : workspaceToken
    ? rpc('ilson_workspace_query', { p_token: workspaceToken, p_sql: scopedSql(sql) })
    : rpc('ilson_execute', { p_sql: sql })
  const owner = {}
  const prepare = (sql, binds = []) => {
    const statement = {
      bind: (...values) => prepare(sql, values),
      all: async () => resultOf(await queryRpc(compileSql(sql, binds))),
      first: async column => {
        const { results } = await statement.all()
        return column === undefined ? (results[0] ?? null) : (results[0]?.[column] ?? null)
      },
      run: async () => statement.all(),
    }
    statementData.set(statement, { sql, binds, owner })
    return statement
  }
  return {
    provider: 'supabase', prepare,
    actorEmail,
    forActor: email => {
      if (workspaceToken) throw new Error('A demonstration database cannot switch to production actor scope')
      const normalized = String(email).trim().toLowerCase()
      if (actorEmail && normalized !== actorEmail) throw new Error('Database actor scope cannot be switched')
      return createSupabaseDb(url, key, null, normalized)
    },
    workspace: Boolean(workspaceToken),
    toolRunScope: async () => {
      const identity = actorEmail ? `actor:${actorEmail}` : workspaceToken ? `workspace:${workspaceToken}` : 'legacy:public'
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    },
    recordToolRun: (slug, bucket, requestId, fingerprint, run) => rpc('ilson_record_tool_run', {
      p_token: workspaceToken, p_actor: actorEmail, p_slug: slug, p_bucket: bucket,
      p_request_id: requestId, p_fingerprint: fingerprint, p_run: run,
    }),
    recordBetaRound: (applicationId, requestId, fingerprint, round) => rpc('ilson_record_beta_round', {
      p_token: workspaceToken, p_actor: actorEmail, p_application: applicationId,
      p_request_id: requestId, p_fingerprint: fingerprint, p_round: round,
    }),
    workspaceOpen: (token, applications) => rpc('ilson_workspace_open', { p_token: token, p_applications: applications }),
    workspaceReset: (token, applications, newToken) => rpc('ilson_workspace_reset', { p_token: token, p_applications: applications, p_new_token: newToken }),
    claimRateLimit: (bucket, maxHits, windowSeconds) => rpc(actorEmail ? 'ilson_actor_claim_rate_limit' : 'ilson_claim_rate_limit', {
      ...(actorEmail ? { p_actor: actorEmail } : { p_token: workspaceToken }), p_bucket: bucket, p_max: maxHits, p_window: windowSeconds,
    }),
    ...(actorEmail ? {
      assignApplicationOwner: ({ applicationId, expectedOwnerEmail, newOwnerEmail, reason, requestId }) => rpc('ilson_assign_application_owner', {
        p_actor: actorEmail, p_application: applicationId, p_expected_owner: expectedOwnerEmail,
        p_new_owner: newOwnerEmail, p_reason: reason, p_request_id: requestId,
      }),
      rateLimitState: (bucket, maxHits, windowSeconds) => rpc('ilson_actor_rate_state', {
        p_actor: actorEmail, p_bucket: bucket, p_max: maxHits, p_window: windowSeconds,
      }),
      releaseRateLimit: (bucket, ticket) => rpc('ilson_actor_release_rate_limit', {
        p_actor: actorEmail, p_bucket: bucket, p_ticket: ticket,
      }),
    } : {}),
    readiness: () => rpc('ilson_readiness', { p_token: workspaceToken }),
    mutationReceipt: (requestId, fingerprint) => rpc(actorEmail ? 'ilson_actor_receipt' : 'ilson_mutation_receipt', {
      ...(actorEmail ? { p_actor: actorEmail } : { p_token: workspaceToken }), p_request_id: requestId, p_fingerprint: fingerprint,
    }),
    commitMutation: (requestId, fingerprint, reads, writes, response) => rpc(actorEmail ? 'ilson_actor_commit' : 'ilson_commit_mutation', {
      ...(actorEmail ? { p_actor: actorEmail } : { p_token: workspaceToken }), p_request_id: requestId, p_fingerprint: fingerprint,
      p_reads: reads.map(row => ({ sql: scopedSql(compileSql(row.sql, row.binds)), rows: row.rows })),
      p_writes: writes.map(row => scopedSql(compileSql(row.sql, row.binds))), p_response: response,
    }),
    async batch(statements) {
      const sql = statements.map(statement => {
        const data = statementData.get(statement)
        if (!data || data.owner !== owner) throw new Error('Invalid batch statement')
        return compileSql(data.sql, data.binds)
      })
      if (!sql.length) return []
      // One RPC = one PostgreSQL transaction. Any failure rolls back the batch.
      const data = actorEmail
        ? await rpc('ilson_actor_batch', { p_actor: actorEmail, p_statements: sql })
        : workspaceToken
        ? await rpc('ilson_workspace_batch', { p_token: workspaceToken, p_statements: sql.map(scopedSql) })
        : await rpc('ilson_batch', { p_statements: sql })
      if (!Array.isArray(data) || data.length !== sql.length) throw new Error('Invalid Supabase batch response')
      return data.map(resultOf)
    },
  }
}

export async function withDbBinding(env) {
  const hasUrl = Boolean(env?.SUPABASE_URL?.trim())
  const hasKey = Boolean(env?.SUPABASE_SERVICE_ROLE_KEY?.trim())
  if (hasUrl !== hasKey) throw new Error('Incomplete Supabase configuration')
  if (hasUrl) return createSupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  return env?.DB // Local or pre-cutover binding only; production removes D1.
}
