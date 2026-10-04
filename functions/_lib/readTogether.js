import { allScopedReads } from './allScopedReads.ts'

// 서로 기대지 않는 조회 여러 개를 명시적인 readBatch 기능으로 보낸다.
//
// 하나씩 fetch 로 보내면 Worker 가 한 요청 안에서 동시에 열 수 있는 외부 연결(6개)에
// 막힐 수 있다. Supabase readBatch 는 한 번의 왕복이다. 한 트랜잭션이지만
// READ COMMITTED 에서 각 SELECT 의 시점까지 같다고 보장하지는 않는다.
//
// one() 으로 감싼 조회는 .first() 처럼 첫 줄(없으면 null)을, 나머지는 .all() 과 같은
// { results } 를 돌려준다. 준비된 질의 자체에도 first() 메서드가 있어서 표시는 Symbol 로 한다.
const FIRST_ROW = Symbol('first row')

export const one = (statement) => ({ [FIRST_ROW]: statement })

export async function readTogether(DB, reads) {
  if (!reads.length) return []
  if (typeof DB.readBatch === 'function') {
    const results = await DB.readBatch(reads.map((read) => read[FIRST_ROW] ?? read))
    if (!Array.isArray(results) || results.length !== reads.length || !results.every((result) => Array.isArray(result?.results))) {
      throw new Error('Invalid read batch response')
    }
    return results.map((result, index) => (reads[index][FIRST_ROW] ? (result.results[0] ?? null) : result))
  }
  // 일반 batch 는 atomicMutation 등에서 쓰기 전용이다. 조회 기능이 없는 연결만
  // 기존 all/first 경로를 사용한다. 실패하거나 잘못된 batch 응답을 재시도로 숨기지 않는다.
  return allScopedReads(reads.map(async (read) => (read[FIRST_ROW] ? read[FIRST_ROW].first() : read.all())))
}
