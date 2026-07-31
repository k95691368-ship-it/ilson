export async function logAdminAction(env, { actorId, action, targetUserId, targetRoomId, detail }) {
  await env.DB.prepare(
    `INSERT INTO admin_audit_log (actor_user_id, action, target_user_id, target_room_id, detail)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(actorId, action, targetUserId || null, targetRoomId || null, detail || null)
    .run()
}
