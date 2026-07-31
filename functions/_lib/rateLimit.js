// 허용되면 방금 기록한 시도의 id를, 한도를 넘었으면 0을 돌려준다.
// 두 값 모두 조건문에서 그대로 쓸 수 있고(0은 거짓), 이 id를 releaseRateLimit에
// 넘기면 다른 요청의 기록을 건드리지 않고 내 것만 되돌릴 수 있다.
export async function checkRateLimit(env, bucket, maxHits, windowSeconds) {
  await env.DB.prepare(
    `DELETE FROM rate_limit_hits WHERE bucket = ? AND created_at < datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .run()

  // 가끔 전역 청소: 다시 조회되지 않는 콜드 버킷(예: 1회성 IP)의 오래된 행이
  // 무한히 누적되는 것을 막는다. 가장 긴 윈도가 1시간이므로 1일 지난 행은 항상 무의미.
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limit_hits WHERE created_at < datetime('now', '-1 day')")
      .run()
      .catch(() => {})
  }

  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM rate_limit_hits WHERE bucket = ?')
    .bind(bucket)
    .first()
  if (row.count >= maxHits) return 0

  const inserted = await env.DB.prepare('INSERT INTO rate_limit_hits (bucket) VALUES (?)')
    .bind(bucket)
    .run()
  return inserted.meta?.last_row_id ?? 1
}

// 방금 기록한 시도 하나를 되돌린다.
//
// 한도는 "몇 번 해냈는가"를 세는 것이지 "몇 번 틀렸는가"를 세는 것이 아니다.
// 이력서 형식을 잘못 고른 사람이 두어 번 되돌려 받고 나면 정작 제대로 된
// 파일로는 낼 수 없게 되는데, 그건 막으려던 남용이 아니라 그냥 지원 실패다.
// 그래서 요청이 실패로 끝나면 그 시도는 세지 않는다.
//
// ticket은 checkRateLimit이 돌려준 id다. 같은 버킷으로 두 요청이 동시에 들어와
// 그중 하나만 실패하면, "가장 최근 기록"을 지우는 방식은 성공한 쪽의 기록을
// 지울 수 있다. 내 것을 정확히 지우기 위해 id로 지운다.
export async function releaseRateLimit(env, bucket, ticket) {
  const statement = ticket
    ? env.DB.prepare('DELETE FROM rate_limit_hits WHERE id = ?').bind(ticket)
    : env.DB.prepare(
        `DELETE FROM rate_limit_hits WHERE id = (
           SELECT id FROM rate_limit_hits WHERE bucket = ? ORDER BY id DESC LIMIT 1
         )`
      ).bind(bucket)
  await statement.run().catch(() => {})
}
