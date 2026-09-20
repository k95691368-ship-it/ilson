// 같은 사람이 같은 기능을 너무 자주 부르는 것만 막는다.
//
// 이 사이트는 로그인이 없다. 누구나 신청서를 낼 수 있고 누구나 시연 데이터를
// 심을 수 있다. 그래서 계정이 아니라 요청 자체에 한도를 건다.
//
// 한도는 "몇 번 해냈는가"를 센다. "몇 번 시도했는가"가 아니다.
// AI 호출이 실패했는데 그것도 한 번으로 세면, 몇 번 실패한 사람이 정작
// 제대로 될 때 막힌다. 그래서 실패하면 방금 센 것을 되돌린다.

// 허용되면 방금 기록한 시도의 번호를, 한도를 넘었으면 0을 준다.
// 둘 다 if 문에 그대로 넣을 수 있고(0은 거짓), 이 번호를 release에 넘기면
// 다른 사람 기록은 건드리지 않고 내 것만 지운다.
export async function checkRateLimit(env, bucket, maxHits, windowSeconds) {
  if (env.DB.claimRateLimit) return Number(await env.DB.claimRateLimit(bucket, maxHits, windowSeconds))
  if (env.SUPABASE_URL) throw new Error('Atomic rate-limit migration is required')
  // Legacy SQLite test adapter only; deployed Supabase always uses the locked RPC above.
  await env.DB.prepare(
    `DELETE FROM rate_limit_hits
     WHERE bucket = ? AND created_at < datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .run()

  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = ?'
  )
    .bind(bucket)
    .first()

  if ((row?.n ?? 0) >= maxHits) return 0

  const inserted = await env.DB.prepare('INSERT INTO rate_limit_hits (bucket) VALUES (?)')
    .bind(bucket)
    .run()

  const id = inserted.meta?.last_row_id ?? 1

  // 아주 가끔 오래된 것을 통째로 치운다. 한 번 오고 다시 오지 않는 주소의
  // 기록은 위 DELETE가 영영 지나가지 않아서 계속 쌓인다.
  if (id % 50 === 0) {
    await env.DB.prepare("DELETE FROM rate_limit_hits WHERE created_at < datetime('now', '-1 day')")
      .run()
      .catch(() => {})
  }

  return id
}

// 방금 센 것 하나를 되돌린다.
//
// 번호로 지운다. "가장 최근 것"을 지우면, 같은 종류의 요청이 동시에 둘 들어와
// 하나만 실패했을 때 성공한 쪽의 기록을 지울 수 있다.
export async function releaseRateLimit(env, bucket, ticket) {
  if (!Number.isSafeInteger(ticket) || ticket <= 0) return false
  if (env.DB.releaseRateLimit) return env.DB.releaseRateLimit(bucket, ticket).catch(() => false)
  return env.DB.prepare('DELETE FROM rate_limit_hits WHERE id = ? AND bucket = ?').bind(ticket, bucket)
    .run().then(result => Boolean(result.meta?.changes)).catch(() => false)
}

// 남은 횟수. 화면에 "오늘 남은 실행 12회"처럼 보여 줄 때 쓴다.
export async function remainingQuota(env, bucket, maxHits, windowSeconds) {
  if (env.DB.rateLimitState) return (await env.DB.rateLimitState(bucket, maxHits, windowSeconds)).remaining
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM rate_limit_hits
     WHERE bucket = ? AND created_at >= datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .first()
  return Math.max(0, maxHits - (row?.n ?? 0))
}

// Keep the displayed remaining count and next opening in the same DB snapshot.
// In real mode only a service-only RPC can inspect the actor's exact quota bucket.
export async function quotaState(env, bucket, maxHits, windowSeconds) {
  if (env.DB.rateLimitState) return env.DB.rateLimitState(bucket, maxHits, windowSeconds)
  const [remaining, next] = await Promise.all([
    remainingQuota(env, bucket, maxHits, windowSeconds),
    env.DB.prepare(`SELECT datetime(MIN(created_at), '+' || ? || ' seconds') AS next_free
      FROM rate_limit_hits WHERE bucket = ? AND created_at >= datetime('now', '-' || ? || ' seconds')`)
      .bind(windowSeconds, bucket, windowSeconds).first(),
  ])
  return { remaining, nextFreeAt: remaining > 0 ? null : next?.next_free ?? null }
}
