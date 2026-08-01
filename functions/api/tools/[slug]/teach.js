// 부서가 "이 코드는 이 상품입니다"를 알려준다.
//
// 도구가 처리 못 한 줄을 보여 주기는 했다. 그런데 보여 주기만 하고 고칠
// 길이 없었다. 부서는 그 줄이 뭔지 아는데 — 매일 그 일을 하니까 — 말할
// 데가 없어서 결국 그 줄만 따로 손으로 처리한다. 자동화한 보람이 반으로 준다.
//
// 알려준 것은 다음 실행부터 저절로 반영된다. 한 번 알려주면 끝이다.

import { jsonResponse, jsonError, failFields, failUnexpected } from '../../../_lib/http.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { logDecision } from '../../../_lib/decisions.js'
import { validateTeach } from '../../../../shared/teach.js'
import { SKU_BY_CODE } from '../../../../shared/master.js'

export async function onRequestPost({ env, params, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `teach:${ip}`, 60, 600)
  if (!allowed) {
    return jsonError('한 번에 너무 많이 알려주고 계십니다. 잠시 후 다시 시도해주세요.', 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('보내주신 내용을 읽지 못했습니다.', 400)
  }

  const externalCode = String(body.externalCode ?? '').trim().slice(0, 80)
  const canonicalCode = String(body.canonicalCode ?? '').trim().toUpperCase().slice(0, 40)
  const teacher = String(body.teacher ?? '').trim().slice(0, 60)
  const channel = String(body.channel ?? '').trim().slice(0, 40) || null
  const note = String(body.note ?? '').trim().slice(0, 300) || null
  const affected = Math.max(0, Number(body.affected) || 0)

  const fields = validateTeach({ externalCode, canonicalCode, teacher })
  if (Object.keys(fields).length > 0) {
    return failFields(fields, '알려주신 것을 다시 확인해주세요.')
  }

  try {
    const h = await env.DB.prepare(
      `SELECT application_id, handed_to_dept, rolled_back_at FROM handover WHERE slug = ?`
    )
      .bind(params.slug)
      .first()
    if (!h) return jsonError('그 도구를 찾지 못했습니다.', 404)
    if (h.rolled_back_at) {
      return jsonError('이 도구는 이미 내려간 상태입니다.', 409)
    }

    const existing = await env.DB.prepare(
      'SELECT canonical_code, taught_by FROM sku_alias WHERE external_code = ?'
    )
      .bind(externalCode)
      .first()

    // 이미 다른 상품으로 이어져 있으면 조용히 덮어쓰지 않는다.
    //
    // 덮어쓰면 지난달 정산이 이 상품이었다가 이번 달부터 저 상품이 된다.
    // 왜 바뀌었는지 아무 데도 안 남고, 금액이 틀어져도 원인을 못 찾는다.
    if (existing && existing.canonical_code !== canonicalCode) {
      return jsonError(
        `이 코드는 이미 ${SKU_BY_CODE[existing.canonical_code]?.name_ko ?? existing.canonical_code}(으)로 이어져 있습니다. 바꾸시려면 담당자에게 알려주세요 — 지난 정산 숫자가 함께 움직이는 일이라 확인이 필요합니다.`,
        409
      )
    }
    if (existing) {
      return jsonResponse({ ok: true, already: true, affected: 0, canonicalCode })
    }

    const sku = SKU_BY_CODE[canonicalCode]
    await env.DB.prepare(
      `INSERT INTO sku_alias (external_code, canonical_code, channel, product_name, note, taught_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(externalCode, canonicalCode, channel, sku.name_ko, note, teacher)
      .run()

    // 기록에 남긴다. 몇 달 뒤 "이 코드가 왜 이 상품이지"를 물으면
    // 누가 언제 알려줬는지가 답이다.
    await logDecision(env, {
      applicationId: h.application_id,
      stage: '배포',
      actor: 'human',
      title: teacher,
      what: `${externalCode} 는 ${sku.name_ko}(${canonicalCode})입니다.`,
      why: `${h.handed_to_dept}에서 알려줬습니다. 이 코드로 밀려나 있던 ${affected}줄이 다음 실행부터 처리됩니다.`,
      linkKind: '코드알림',
      linkId: externalCode,
    })

    return jsonResponse({
      ok: true,
      already: false,
      canonicalCode,
      productName: sku.name_ko,
      affected,
      // "고맙습니다"만 하고 끝내면 부서는 자기가 한 일이 뭘 바꿨는지 모른다.
      next:
        affected > 0
          ? `이 코드로 밀려나 있던 ${affected}줄이 다음 실행부터 처리됩니다. 지금 다시 돌려보셔도 됩니다.`
          : '다음 실행부터 이 코드가 저절로 처리됩니다.',
    })
  } catch (err) {
    return failUnexpected(err, '알려주신 것을 저장하지 못했습니다.')
  }
}
