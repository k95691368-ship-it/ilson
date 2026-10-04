// 알려 준 상품코드를 담당자가 확인하고 정정한다.
//
// 저장된 연결은 이후 계산에 적용된다. 기존 계산 결과를 소급 수정하지는
// 않는다. 현재 연결과 검토 근거의 버전이 일치해야 확인 완료로 표시한다.

import { decodeCodeReviewEvidence, isCodeReviewMetadata } from './codeReviewEvidence.ts'
import { SKU_BY_CODE } from './master.js'

export const CONFIRM_KIND = '코드확인'
export const CORRECT_KIND = '코드정정'
// Builder registration is staff work, not a department's tool feedback.
export const BUILD_ALIAS_KIND = '제작코드등록'

// 기존 표시명을 이용한 이력 분류이다. 이름만으로 실제 권한이나 확인
// 근거를 보증하지 않으며, 확인 완료 여부는 별도 버전 근거로 판정한다.
export function taughtBySide(alias, staffLabels = ['AX 담당자']) {
  const who = String(alias?.taught_by ?? '').trim()
  if (!who) return '알 수 없음'
  return staffLabels.includes(who) ? '담당자' : '부서'
}

// 결정 기록에서 확인·정정 이력을 뽑아 코드에 붙인다.
export function annotate(aliases, decisions, { staffLabels } = {}) {
  const confirmed = new Map()
  const corrected = new Map()

  for (const d of decisions ?? []) {
    if (d.link_kind === CONFIRM_KIND) {
      const list = confirmed.get(d.link_id) ?? []
      list.push({ id: d.id, by: d.title, at: d.created_at, evidence: decodeCodeReviewEvidence(d.alternatives, d),
        legacy: !isCodeReviewMetadata(d) })
      confirmed.set(d.link_id, list)
    }
    if (d.link_kind === CORRECT_KIND) {
      const list = corrected.get(d.link_id) ?? []
      list.push({ id: d.id, by: d.title, at: d.created_at, what: d.what, why: d.why })
      corrected.set(d.link_id, list)
    }
  }

  return (aliases ?? []).map((a) => {
    const side = taughtBySide(a, staffLabels)
    const checks = [...(confirmed.get(a.external_code) ?? [])].sort((x, y) => String(y.at).localeCompare(String(x.at)) || String(y.id ?? '').localeCompare(String(x.id ?? '')))
    const current = a.review_reason !== 'invalid_mapping' && Object.hasOwn(SKU_BY_CODE, a.canonical_code)
      ? checks.find(check => check.evidence?.reviewedMappingRevision === a.mapping_revision
      && check.evidence.afterCanonicalCode === a.canonical_code)
      : undefined
    const historical = current ?? checks[0] ?? null
    const check = historical ? { by: historical.by, at: historical.at, verified: Boolean(current), legacy: historical.legacy } : null
    const fixes = (corrected.get(a.external_code) ?? []).sort((x, y) =>
      String(y.at).localeCompare(String(x.at)) || String(y.id ?? '').localeCompare(String(x.id ?? ''))
    )

    // 확인한 뒤에 누가 또 고쳤으면 그 확인은 낡은 것이다.
    // An old timestamp/name is historical information, not proof that this
    // exact current mapping was reviewed. Opaque revision evidence is required.
    const staleCheck = Boolean(check && !check.verified)

    return {
      ...a,
      side,
      confirmed: check,
      corrections: fixes,
      // A display name must not exempt a row from actual review evidence.
      needsCheck: !check?.verified,
      staleCheck,
    }
  })
}

// 담당자가 훑어봐야 할 것부터.
export function sortForReview(annotated) {
  return [...(annotated ?? [])].sort((a, b) => {
    if (a.needsCheck !== b.needsCheck) return a.needsCheck ? -1 : 1
    // 미확인 항목 안에서는 저장된 연결의 변경 시각 순서로 표시한다.
    return String(b.created_at).localeCompare(String(a.created_at))
  })
}

export function summarize(annotated) {
  const list = annotated ?? []
  return {
    total: list.length,
    byDept: list.filter((a) => a.side === '부서').length,
    byStaff: list.filter((a) => a.side === '담당자').length,
    needsCheck: list.filter((a) => a.needsCheck).length,
    corrected: list.filter((a) => a.corrections.length > 0).length,
  }
}

export function validateCorrection({ canonicalCode, why, author, knownCodes }) {
  const fields = {}
  const canon = String(canonicalCode ?? '').trim().toUpperCase()
  if (!canon) {
    fields.canonicalCode = '어느 상품으로 바꿀지 골라주세요.'
  } else if (knownCodes && !knownCodes.includes(canon)) {
    fields.canonicalCode = '저희 목록에 없는 상품코드입니다.'
  }
  // 이후 계산에 적용되는 연결을 왜 바꿨는지 기록한다.
  if (String(why ?? '').trim().length < 5) {
    fields.why = '왜 바꾸시는지 적어주세요.'
  }
  if (!String(author ?? '').trim()) fields.author = '누가 정정하시는지 적어주세요.'
  return fields
}
