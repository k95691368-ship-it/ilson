import { onRequestGet as getRecord } from './record.js'
import { jsonResponse, jsonError, failUnexpected } from '../../../_lib/http.js'
import { atomicMutation, mutationFingerprint } from '../../../_lib/atomicMutation.js'
import { resolveOverrideActor, requireOverridePermission, auditOverride } from '../../../_lib/override.js'
import { buildJourney } from '../../../../shared/journey.js'

export async function onRequestGet(context) {
  context = { ...context, env: context.data?.requestEnv ?? context.env }
  try {
    const response = await getRecord(context)
    if (!response.ok) return response
    const record = await response.json()
    const db = context.env.DB
    const id = record.application.id
    const products = (await db.prepare(`SELECT p.*, l.linked_at FROM application_product_link l
      JOIN override_product p ON p.id=l.product_id WHERE l.application_id=? ORDER BY l.linked_at,p.id`).bind(id).all()).results
    const events = (await db.prepare(`SELECT e.* FROM override_event e JOIN application_product_link l
      ON l.product_id=e.product_id WHERE l.application_id=? ORDER BY e.occurred_at,e.id`).bind(id).all()).results
    const experiments = (await db.prepare(`SELECT x.* FROM change_experiment x WHERE EXISTS
      (SELECT 1 FROM override_event e JOIN application_product_link l ON l.product_id=e.product_id
       WHERE l.application_id=? AND e.cluster_id=x.cluster_id) ORDER BY x.created_at,x.id`).bind(id).all()).results
    const runs = [], decisions = []
    if (experiments.length) {
      const holes = experiments.map(() => '?').join(',')
      const ids = experiments.map(row => row.id)
      runs.push(...(await db.prepare(`SELECT * FROM experiment_run WHERE experiment_id IN (${holes}) ORDER BY created_at,id`).bind(...ids).all()).results)
      decisions.push(...(await db.prepare(`SELECT * FROM override_decision_record WHERE experiment_id IN (${holes}) ORDER BY created_at,id`).bind(...ids).all()).results)
    }
    const availableProducts = (await db.prepare('SELECT id,name,owner_team FROM override_product ORDER BY name,id').all()).results
    const history = (await db.prepare("SELECT * FROM override_audit WHERE entity_kind='application_product_link' AND entity_id=? ORDER BY created_at,id").bind(id).all()).results
    const linkHistory = history.map(row=>({...row,detail:JSON.parse(row.detail_json || '{}')}))
    const operations = { products, events, experiments, runs, decisions, linkHistory }
    return jsonResponse({ application: record.application, done: record.done, money: record.money,
      moneyLabel: record.moneyLabel, operations, availableProducts, entries: buildJourney(record, operations) })
  } catch (error) { return failUnexpected(error, '통합 이력을 불러오지 못했습니다.') }
}

export async function onRequestPost({ env, data: requestData, request, params }) {
  env = requestData?.requestEnv ?? env
  try {
    const body = await request.json()
    const actor = env.DEMO_WORKSPACE ? {label:'개인 체험 사용자',role:'product',mode:'demo'} : await resolveOverrideActor({ ...env, OVERRIDE_DEMO_MODE:'false' }, request, body)
    requireOverridePermission(actor,'create_product')
    if (typeof body.productId !== 'string' || body.productId.length > 100) return jsonError('운영 제품을 선택해 주세요.', 400)
    if (body.action && !['link', 'unlink'].includes(body.action)) return jsonError('지원하지 않는 연결 작업입니다.', 400)
    const requestId = request.headers.get('X-Idempotency-Key') || crypto.randomUUID()
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return jsonError('중복 방지 요청 번호가 올바르지 않습니다.',400)
    return await atomicMutation(env.DB,requestId,await mutationFingerprint({body,actor,application:params.id}),async DB => {
    env = {...env,DB}
    const app = await env.DB.prepare('SELECT id FROM application WHERE id=? OR ticket_no=?').bind(params.id, params.id).first()
    const product = await env.DB.prepare('SELECT id,name FROM override_product WHERE id=?').bind(body.productId).first()
    if (!app || !product) return jsonError('현재 공간에서 신청서 또는 제품을 찾을 수 없습니다.', 404)
    if (body.action === 'unlink') {
      await env.DB.prepare('DELETE FROM application_product_link WHERE application_id=? AND product_id=?').bind(app.id, product.id).run()
    } else {
      await env.DB.prepare(`INSERT INTO application_product_link(application_id,product_id) VALUES(?,?)
        ON CONFLICT(application_id,product_id) DO NOTHING`).bind(app.id, product.id).run()
    }
    await auditOverride(env,actor,body.action==='unlink'?'unlink_product':'link_product','application_product_link',app.id,{product_id:product.id,product_name:product.name})
    return jsonResponse({ ok: true })
    })
  } catch (error) {
    if (error.status) return jsonError(error.message, error.status)
    return failUnexpected(error, '운영 제품을 연결하지 못했습니다.')
  }
}
