import { mutationFingerprint } from './atomicMutation.js'

// Hash the values a person is acting on, not hydrated labels or live aggregates.
// The token is a precondition, never a substitute for scoped reads/permissions.
const FIELDS = {
  cluster: 'id title summary cause_code cause_status owner_team customer_impact_score operations_cost_krw regulatory_risk_score priority_score status cause_confirmed_at assignee_email assignee_label assigned_at acknowledged_at next_response_on updated_at',
  event: 'id validity validity_reason updated_at',
  experiment: 'id change_version mutation_version approval_id approved_at status current_phase',
  integration: 'id kind name endpoint_url secret_binding',
  actor: 'email display_name role active departments_json product_ids_json',
  volume: 'id product_id measured_on segment total_cases applicable_cases',
}

export async function overrideEditVersion(kind, row) {
  if (!row) return null
  if (!FIELDS[kind]) throw new Error('Unknown editable OverrideLoop entity')
  return mutationFingerprint({ kind, values: FIELDS[kind].split(' ').map(key => [key, row[key] ?? null]) })
}

export async function withOverrideEditVersion(kind, row) {
  return { ...row, edit_version: await overrideEditVersion(kind, row) }
}

export async function assertOverrideEditVersion(kind, row, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || supplied !== await overrideEditVersion(kind, row)) {
    const error = new Error('열어 둔 자료가 변경되었습니다. 작성 내용은 유지되며, 최신 자료를 확인한 뒤 다시 저장할 수 있습니다.')
    error.status = 409
    error.code = 'OVERRIDE_EDIT_CONFLICT'
    throw error
  }
}
