import { newId } from './ids.js'
import { mutationFingerprint } from './atomicMutation.ts'

// The demo's identity belongs to its isolated visitor workspace, not its role selector.
export function feedbackActorKey(actor) {
  return mutationFingerprint({ identity: actor.mode === 'demo' ? 'workspace-visitor' : actor.email })
}
export async function createFeedbackCase(env, actor, eventId) {
  await env.DB.prepare('INSERT INTO field_feedback_case(id,event_id,reporter_key) VALUES(?,?,?)')
    .bind(newId('ffc'),eventId,await feedbackActorKey(actor)).run()
}
