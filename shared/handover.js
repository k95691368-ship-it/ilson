import { PERIOD } from './master.js'

export const HANDOVER_KIND = '현장인계'
export const STOP_KIND = '인계중단'
export const TOOL_SCOPE = `기존 브라우저 정산 도구입니다. 새 AI 도구나 코드를 자동으로 만들지 않습니다. 지원 기간은 ${PERIOD.start}~${PERIOD.end}이며 시연용 상품 목록과 고정 환율(KRW 1, USD 1385, JPY 8.9)을 사용합니다. 이 범위 밖의 실제 정산에 사용하지 마십시오. 원본 파일은 서버에 저장하지 않습니다.`

export function validateHandover(body, humanCriteria = []) {
  const fields = {}
  if (!['create', 'stop', 'restore'].includes(body?.action)) fields.action = '인계 작업을 선택해주세요.'
  if (typeof body?.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 2000) fields.reason = '판단 근거를 5~2,000자로 적어주세요.'
  if (body?.action === 'stop') return fields
  for (const [key, label, max] of [['title','도구 이름',120],['person','받는 담당자',120],['whenToRun','실행 시점',2000],['afterRun','결과 확인 방법',2000],['contact','문의 담당자',200]]) {
    if (typeof body?.[key] !== 'string' || !body[key].trim() || body[key].length > max) fields[key] = `${label}을 ${max}자 이내로 적어주세요.`
  }
  if (!Number.isSafeInteger(body?.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 100) fields.dailyLimit = '하루 성공 실행 횟수는 1~100회로 정해주세요.'
  if (!Number.isSafeInteger(body?.maxFileMb) || body.maxFileMb < 1 || body.maxFileMb > 10) fields.maxFileMb = '파일 제한은 1~10MB로 정해주세요.'
  if (body?.scopeAccepted !== true) fields.scopeAccepted = '지원 범위와 고정 환율의 제한을 확인해주세요.'
  const checks = body?.humanChecks
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)
    || humanCriteria.some(c => checks[c.id]?.confirmed !== true || typeof checks[c.id]?.evidence !== 'string' || checks[c.id].evidence.trim().length < 5 || checks[c.id].evidence.length > 2000)) {
    if (humanCriteria.length) fields.humanChecks = '사람 확인 기준마다 확인 결과와 근거를 5~2,000자로 남겨주세요.'
  }
  return fields
}
