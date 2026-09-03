// OverrideLoop에서 화면과 서버가 함께 쓰는 판정 규칙.
//
// 원인·우선순위·실험 통과 여부를 화면과 API가 각각 계산하면 같은 사건이
// 화면에서는 P0인데 저장할 때는 P1이 되는 식으로 갈라진다. 그래서 입력을
// 받아 결과만 돌려주는 순수 함수는 이 파일 한 곳에 둔다.

export const DECISION_ACTIONS = [
  { key: 'approve', label: '승인', isOverride: false },
  { key: 'modify', label: '수정', isOverride: true },
  { key: 'reject', label: '거절', isOverride: true },
  { key: 'escalate', label: '전문 담당자 이관', isOverride: true },
  { key: 'correct_after', label: '사후 정정', isOverride: true },
]

export const CAUSES = [
  { key: 'model', label: '모델 판단 오류', owner: 'ML 플랫폼' },
  { key: 'policy_retrieval', label: '오래되거나 잘못된 정책 검색', owner: '정책 데이터' },
  { key: 'data', label: '데이터 누락·오류', owner: '데이터 플랫폼' },
  { key: 'policy_gap', label: '정책 공백', owner: '정책·준법' },
  { key: 'process', label: '업무 절차 문제', owner: '업무 운영' },
  { key: 'system', label: 'API·권한·시스템 문제', owner: '서비스 개발' },
  { key: 'ux', label: '직원·고객 UX 문제', owner: 'Product Design' },
  { key: 'legitimate_exception', label: '정당한 개별 예외', owner: '업무 운영' },
  { key: 'human_error', label: '사람의 잘못된 수정', owner: '교육·품질' },
  { key: 'unknown', label: '원인 미확인', owner: 'AI Product' },
]

export const EXPERIMENT_PHASES = [
  { key: 'historical', label: 'Historical Replay', short: '과거 재생' },
  { key: 'shadow', label: 'Shadow Test', short: '섀도 테스트' },
  { key: 'limited', label: '제한 배포', short: '제한 배포' },
]

export const OVERRIDE_ROLES = [
  { key: 'reviewer', label: '현업 검토자' },
  { key: 'operations', label: '운영 리더' },
  { key: 'product', label: 'AI Product Lead' },
  { key: 'ml', label: 'ML·Data' },
  { key: 'engineer', label: '개발자' },
  { key: 'policy', label: '정책·준법' },
  { key: 'audit', label: '보안·감사' },
  { key: 'executive', label: '사업 책임자' },
]

export const ROLE_PERMISSIONS = {
  reviewer: ['capture_event', 'validate_event'],
  operations: ['capture_event', 'validate_event', 'update_cluster', 'record_volume'],
  product: [
    'capture_event',
    'validate_event',
    'update_cluster',
    'create_product',
    'create_experiment',
    'approve_experiment',
    'record_run',
    'decide_experiment',
    'record_volume',
    'save_integration',
    'sync_integration',
    'ai_assist',
  ],
  ml: [
    'validate_event',
    'update_cluster',
    'create_product',
    'create_experiment',
    'record_run',
    'record_volume',
    'save_integration',
    'sync_integration',
    'ai_assist',
  ],
  engineer: [
    'update_cluster',
    'create_experiment',
    'record_run',
    'save_integration',
    'sync_integration',
    'ai_assist',
  ],
  policy: [
    'validate_event',
    'update_cluster',
    'create_experiment',
    'approve_experiment',
    'record_run',
    'decide_experiment',
    'ai_assist',
  ],
  audit: ['validate_event', 'approve_experiment', 'decide_experiment', 'save_actor'],
  executive: ['approve_experiment', 'decide_experiment', 'save_actor'],
}

export function roleCan(role, action) {
  return Boolean(ROLE_PERMISSIONS[role]?.includes(action))
}

export function causeByKey(key) {
  return CAUSES.find((cause) => cause.key === key) ?? CAUSES[CAUSES.length - 1]
}

export function actionByKey(key) {
  return DECISION_ACTIONS.find((action) => action.key === key) ?? DECISION_ACTIONS[1]
}

function words(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .replace(/[^0-9a-z가-힣_\-\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 1)
  )
}

export function textSimilarity(a, b) {
  const left = words(a)
  const right = words(b)
  if (left.size === 0 || right.size === 0) return 0
  let same = 0
  for (const word of left) if (right.has(word)) same += 1
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : same / union
}

export function recommendCluster(event, clusters = []) {
  const eventText = [event.reasonDetail, event.aiDecision, event.humanDecision, event.policyRefs]
    .filter(Boolean)
    .join(' ')

  let best = null
  for (const cluster of clusters) {
    const base = textSimilarity(eventText, `${cluster.title ?? ''} ${cluster.sample_text ?? ''}`)
    const sameCause = event.causeKey && cluster.cause_code === event.causeKey ? 0.22 : 0
    const samePolicy =
      event.policyRefs && cluster.policy_refs_json?.includes?.(String(event.policyRefs)) ? 0.12 : 0
    const score = Math.min(1, base + sameCause + samePolicy)
    if (!best || score > best.score) best = { cluster, score }
  }
  return best
}

const CAUSE_HINTS = {
  policy_retrieval: ['최신', '오래된', '정책 검색', '문서 버전', '내규 버전', '검색 결과'],
  data: ['누락', '빈 값', '오류 데이터', '잘못된 값', '동기화', '데이터'],
  policy_gap: ['정책 없음', '규정 없음', '기준 없음', '공백', '해석 불가'],
  process: ['절차', '승인 단계', '중복', '수작업', '이관 순서', '업무 흐름'],
  system: ['api', '권한', '접속', '시스템', 'timeout', '타임아웃', '도구 실패'],
  ux: ['이해', '버튼', '문구', '화면', '찾기 어려', '헷갈'],
  human_error: ['직원 오류', '잘못 수정', '오해', '교육'],
  legitimate_exception: ['개별 예외', '특수 사례', '정당한 예외'],
  model: ['환각', '분류 오류', '추론', '모델', '잘못 추천', '답변 오류'],
}

export function suggestCauses(event) {
  const text = [event.reasonDetail, event.aiDecision, event.humanDecision, event.changedFields]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const ranked = Object.entries(CAUSE_HINTS)
    .map(([key, hints]) => ({
      key,
      hits: hints.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0),
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)

  if (ranked.length === 0) ranked.push({ key: 'unknown', hits: 0 })
  if (!ranked.some((item) => item.key === 'model')) ranked.push({ key: 'model', hits: 0 })
  if (!ranked.some((item) => item.key === 'legitimate_exception')) {
    ranked.push({ key: 'legitimate_exception', hits: 0 })
  }

  const max = Math.max(1, ranked[0].hits)
  return ranked.slice(0, 3).map((item, index) => ({
    ...causeByKey(item.key),
    confidence: Math.max(18, Math.round(((item.hits || 0.35) / max) * 78) - index * 9),
    source: 'rule',
  }))
}

export function priorityScore({
  customerImpact = 0,
  operationsCost = 0,
  regulatoryRisk = 0,
  recurrence = 0,
} = {}) {
  const customer = (Math.min(5, Math.max(0, Number(customerImpact) || 0)) / 5) * 25
  const regulation = (Math.min(5, Math.max(0, Number(regulatoryRisk) || 0)) / 5) * 30
  const repeated = Math.min(1, Math.log2(Math.max(0, Number(recurrence) || 0) + 1) / 5) * 25
  const cost = Math.min(1, Math.log10(Math.max(0, Number(operationsCost) || 0) + 1) / 6) * 20
  return Math.round((customer + regulation + repeated + cost) * 10) / 10
}

export function priorityBand(score) {
  const value = Number(score) || 0
  if (value >= 75) return 'P0'
  if (value >= 55) return 'P1'
  if (value >= 30) return 'P2'
  return '관찰'
}

export function recurringExceptionRate(overrideCount, applicableCount) {
  const denominator = Number(applicableCount) || 0
  if (denominator <= 0) return null
  return Math.round(((Number(overrideCount) || 0) / denominator) * 10000) / 100
}

export function compareDecision(aiDecision, humanDecision) {
  const ai = String(aiDecision ?? '').trim()
  const human = String(humanDecision ?? '').trim()
  if (ai === human) return { changed: false, removed: [], added: [] }
  const aiWords = words(ai)
  const humanWords = words(human)
  return {
    changed: true,
    removed: [...aiWords].filter((word) => !humanWords.has(word)).slice(0, 12),
    added: [...humanWords].filter((word) => !aiWords.has(word)).slice(0, 12),
  }
}

export function evaluateExperimentRun({
  direction = 'lower',
  controlValue = 0,
  variantValue = 0,
  targetImprovement = 0,
  guardrailBreaches = 0,
  sampleSize = 0,
} = {}) {
  const control = Number(controlValue) || 0
  const variant = Number(variantValue) || 0
  const threshold = Math.max(0, Number(targetImprovement) || 0)
  const sample = Math.max(0, Number(sampleSize) || 0)
  const breaches = Math.max(0, Number(guardrailBreaches) || 0)
  const improvement =
    control === 0
      ? 0
      : direction === 'higher'
        ? ((variant - control) / Math.abs(control)) * 100
        : ((control - variant) / Math.abs(control)) * 100

  const status = breaches > 0 ? 'blocked' : sample <= 0 ? 'insufficient' : improvement >= threshold ? 'passed' : 'failed'
  return {
    status,
    improvement: Math.round(improvement * 10) / 10,
    guardrailBreaches: breaches,
  }
}

export function canExpandExperiment(experiment, runs = []) {
  const latestByPhase = new Map()
  for (const run of runs) latestByPhase.set(run.phase, run)
  const missing = EXPERIMENT_PHASES.filter((phase) => !latestByPhase.has(phase.key)).map(
    (phase) => phase.label
  )
  const blocked = [...latestByPhase.values()].filter(
    (run) => run.status !== 'passed' || Number(run.guardrail_breaches ?? run.guardrailBreaches) > 0
  )
  const needsApproval = experiment?.risk_level === 'high' && !experiment?.approved_at
  return {
    ok: missing.length === 0 && blocked.length === 0 && !needsApproval,
    missing,
    blocked: blocked.map((run) => run.phase),
    needsApproval,
  }
}

export function trendSignal(current, previous) {
  const now = Math.max(0, Number(current) || 0)
  const before = Math.max(0, Number(previous) || 0)
  if (before === 0) return { change: now > 0 ? 100 : 0, direction: now > 0 ? 'new' : 'flat' }
  const change = Math.round(((now - before) / before) * 1000) / 10
  return { change, direction: change >= 25 ? 'surge' : change <= -25 ? 'down' : 'flat' }
}

export function safeJson(value, fallback = null) {
  if (value == null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
