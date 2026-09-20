// Server-only scoping. Identity must come from a verified Access assertion,
// never a request body, query string, role selector, or email header.
export function verifiedActorEmail(actor) {
  const email = typeof actor?.email === 'string' ? actor.email.trim().toLowerCase() : ''
  if (actor?.mode !== 'access' || !/^\S+@\S+\.\S+$/.test(email)) {
    const error = new Error('인증된 사내 계정이 필요합니다.')
    error.status = 401
    throw error
  }
  return email
}

export function scopedActorDb(db, actor) {
  const email = verifiedActorEmail(actor)
  if (typeof db?.forActor !== 'function') {
    const error = new Error('사용자별 데이터 접근 설정이 필요합니다.')
    error.status = 503
    throw error
  }
  return db.forActor(email)
}

export function actorAssignments(actor) {
  const list = value => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return Array.isArray(parsed) ? [...new Set(parsed.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))] : []
    } catch { return [] }
  }
  return {
    departments: list(actor?.departments_json),
    productIds: list(actor?.product_ids_json),
    administrator: ['audit', 'executive'].includes(actor?.role),
  }
}
