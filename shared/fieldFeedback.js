export const FEEDBACK_KINDS = { reply: '담당자 답변', applied: '개선 적용', declined: '반영하지 않음' }
export const FEEDBACK_VERDICTS = { resolved: '해결됐습니다', not_resolved: '아직 불편합니다', untested: '아직 확인하지 못했습니다' }
export const QUALITY_VERDICTS = { correct: '문제 없음', issue: '문제 발견', insufficient: '근거 부족' }
export const NONUSE_STATES = { paused: '잠시 사용 중단', stopped: '사용 종료', never_started: '사용하지 않음' }
export const NONUSE_REASONS = { accuracy: '결과가 정확하지 않음', speed: '응답이 느림', workflow: '업무 방식과 맞지 않음', access: '접근·권한 문제', privacy: '정보 공유가 우려됨', no_need: '현재 필요한 업무가 없음', other: '기타' }
export function canManageFeedback(role) { return ['operations','product','ml','engineer','policy'].includes(role) }
export function canReviewQuality(role) { return ['operations','product','ml','policy','audit'].includes(role) }
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
}
export function qualitySummary(items) {
  const reviewed = items.filter(item => item.verdict)
  return { selected: items.length, reviewed: reviewed.length, issues: reviewed.filter(item => item.verdict === 'issue').length,
    insufficient: reviewed.filter(item => item.verdict === 'insufficient').length }
}
