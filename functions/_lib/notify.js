// 인앱 알림 생성 헬퍼. 알림 실패가 본 작업을 깨뜨리지 않도록 항상 삼킨다.
export async function notifyUser(env, userId, { type, message, link }) {
  if (!userId || !message) return
  try {
    await env.DB.prepare(
      'INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)'
    )
      .bind(userId, type || 'info', String(message).slice(0, 300), link || null)
      .run()
  } catch (err) {
    console.error('notifyUser failed:', err)
  }
}
