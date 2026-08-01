// 알려 준 상품코드를 담당자가 확인하고 정정한다.
//
// 부서가 알려준 것은 바로 쓴다. 승인을 받아야 쓰이게 하면 부서가 알려주고
// 며칠씩 기다리게 되고, 그러면 알려주지 않는다.
//
// 대신 여기 "아직 확인 안 한 것"으로 쌓인다. 코드 하나를 잘못 이어 두면
// 그 코드로 팔린 것이 전부 엉뚱한 상품 매출로 잡힌다. 격리된 줄은 눈에
// 띄지만 잘못 이어진 줄은 조용히 섞인다. 빠르되 눈감지는 않는다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../_lib/http.js'
import { logDecision } from '../_lib/decisions.js'
import {
  annotate,
  sortForReview,
  summarize,
  validateCorrection,
  CONFIRM_KIND,
  CORRECT_KIND,
} from '../../shared/codes.js'
import { SKU_BY_CODE, SKUS } from '../../shared/master.js'

export async function onRequestGet({ env }) {
  try {
    const [aliases, decisions] = await Promise.all([
      env.DB.prepare('SELECT * FROM sku_alias ORDER BY created_at DESC LIMIT 500').all(),
      env.DB.prepare(
        `SELECT id, title, what, why, link_kind, link_id, created_at
         FROM decision_log WHERE link_kind IN (?, ?) ORDER BY created_at`
      )
        .bind(CONFIRM_KIND, CORRECT_KIND)
        .all(),
    ])

    const annotated = annotate(aliases.results, decisions.results)

    return jsonResponse({
      codes: sortForReview(annotated).map((a) => ({
        ...a,
        product_name: a.product_name ?? SKU_BY_CODE[a.canonical_code]?.name_ko ?? null,
      })),
      summary: summarize(annotated),
      catalog: SKUS.map((s) => ({ code: s.canonical_code, name: s.name_ko })),
    })
  } catch (err) {
    return failUnexpected(err, '알려 준 코드를 불러오지 못했습니다.')
  }
}

export async function onRequestPost({ env, request }) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const externalCode = String(body.externalCode ?? '').trim()
  const action = String(body.action ?? '').trim()
  const author = String(body.author ?? '').trim().slice(0, 60) || 'AX 담당자'

  if (!externalCode) return jsonError('어느 코드인지 알려주세요.', 400)

  try {
    const alias = await env.DB.prepare('SELECT * FROM sku_alias WHERE external_code = ?')
      .bind(externalCode)
      .first()
    if (!alias) return jsonError('그 코드를 찾지 못했습니다.', 404)

    // 맞다고 확인만 한다.
    if (action === 'confirm') {
      const id = await logDecision(env, {
        applicationId: null,
        stage: '제작',
        actor: 'human',
        title: author,
        what: `${externalCode} → ${alias.product_name ?? alias.canonical_code} 가 맞습니다.`,
        why: String(body.why ?? '').trim() || '원본 파일과 맞춰 확인했습니다.',
        linkKind: CONFIRM_KIND,
        linkId: externalCode,
      })
      return jsonResponse({ ok: true, id, action })
    }

    // 다른 상품으로 바꾼다.
    if (action === 'correct') {
      const canonicalCode = String(body.canonicalCode ?? '').trim().toUpperCase()
      const why = String(body.why ?? '').trim().slice(0, 2000)
      const fields = validateCorrection({
        canonicalCode,
        why,
        author,
        knownCodes: Object.keys(SKU_BY_CODE),
      })
      if (Object.keys(fields).length > 0) {
        return failFields(fields, '적어주신 것을 다시 확인해주세요.')
      }
      if (canonicalCode === alias.canonical_code) {
        return jsonError('지금과 같은 상품입니다. 바꿀 것이 없습니다.', 400)
      }

      const sku = SKU_BY_CODE[canonicalCode]
      const before = alias.product_name ?? alias.canonical_code

      await env.DB.prepare(
        `UPDATE sku_alias
         SET canonical_code = ?, product_name = ?, taught_by = ?, created_at = datetime('now')
         WHERE external_code = ?`
      )
        .bind(canonicalCode, sku.name_ko, author, externalCode)
        .run()

      // 무엇에서 무엇으로 바꿨는지를 남긴다. 코드를 바꾸는 것은 지난 숫자까지
      // 같이 움직이는 일이라, 나중에 정산이 달라진 이유를 여기서 찾는다.
      const id = await logDecision(env, {
        applicationId: null,
        stage: '제작',
        actor: 'human',
        title: author,
        what: `${externalCode} 를 ${before} 에서 ${sku.name_ko}(${canonicalCode}) 로 바꿨습니다.`,
        why,
        linkKind: CORRECT_KIND,
        linkId: externalCode,
      })

      return jsonResponse({ ok: true, id, action, canonicalCode, productName: sku.name_ko })
    }

    return jsonError('무엇을 하실지 알려주세요.', 400)
  } catch (err) {
    return failUnexpected(err, '처리하지 못했습니다.')
  }
}
