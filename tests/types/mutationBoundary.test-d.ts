import { atomicMutation } from '../../functions/_lib/atomicMutation.ts'
import type { Database } from '../../functions/_lib/runtimeTypes.ts'
import { boundRequestBody } from '../../functions/_lib/requestBody.ts'
import { validReviewRevision } from '../../functions/_lib/reviewMutation.ts'

export async function mutationBoundaryContract(db: Database, input: unknown, request: Request): Promise<Response> {
  const bounded = boundRequestBody(request)
  const exceeded: boolean = bounded.exceeded
  void exceeded
  if (validReviewRevision(input)) {
    const revision: number = input
    void revision
  }
  // @ts-expect-error Request wrappers require a real Request, not arbitrary JSON.
  boundRequestBody({ body: 'not a Request' })
  return atomicMutation(db, 'contract-only-request', 'f'.repeat(64), async tx => {
    const row = await tx.prepare('SELECT count FROM example').first()
    if (row) {
      // @ts-expect-error Unspecified SQL rows are unknown until narrowed.
      const unchecked: number = row.count
      void unchecked
    }
    const rawColumn = await tx.prepare('SELECT count FROM example').first('count')
    // @ts-expect-error Unspecified SQL columns must not become implicit any.
    const uncheckedColumn: number = rawColumn
    void uncheckedColumn
    const count = await tx.prepare('SELECT count FROM example').first<number>('count')
    const checked: number | null = count
    void checked
    // @ts-expect-error SQL parameters cannot include arbitrary objects.
    tx.prepare('SELECT ?').bind({ secret: 'object' })
    return Response.json({ ok: true })
  })
}
