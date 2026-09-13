import { causeByKey, trendSignal } from '../../shared/override.js'

// List pagination must never change analytical totals. All aggregates run in PostgreSQL.
export async function overrideMetrics(db, products) {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30)
  const previous = new Date(start); previous.setUTCDate(previous.getUTCDate() - 30)
  const from = start.toISOString().slice(0, 10), until = end.toISOString().slice(0, 10)
  const [totals, bins, policies, common, trends, edges, clusterCounts] = await Promise.all([
    db.prepare(`SELECT count(*) AS total_decisions,
      count(*) FILTER(WHERE is_override=1 AND validity='valid') AS overrides,
      count(*) FILTER(WHERE validity='pending') AS pending_validation,
      round(100.0*count(*) FILTER(WHERE coalesce(reason_detail,'')<>'')/nullif(count(*),0),1) AS reason_confirmation_rate,
      round(100.0*count(*) FILTER(WHERE coalesce(ai_decision,'')<>'' AND coalesce(human_decision,'')<>''
        AND coalesce(reason_detail,'')<>'' AND coalesce(model_version,'')<>'' AND coalesce(prompt_version,'')<>''
        AND coalesce(policy_refs_json,'[]')::jsonb<>'[]'::jsonb)/nullif(count(*),0),1) AS capture_completeness,
      avg(recording_seconds) AS average_recording_seconds,
      coalesce(sum(operations_cost_krw) FILTER(WHERE is_override=1 AND validity='valid'),0) AS rework_cost_krw
      FROM override_event`).first(),
    db.prepare(`WITH e AS (SELECT product_id,segment,substr(occurred_at,1,10) AS day,count(*) AS n
        FROM override_event WHERE is_override=1 AND validity='valid' AND occurred_at>=? AND occurred_at<?
        GROUP BY product_id,segment,substr(occurred_at,1,10)),
      v AS (SELECT product_id,segment,measured_on AS day,applicable_cases AS applicable
        FROM override_volume WHERE measured_on>=? AND measured_on<?)
      SELECT coalesce(e.product_id,v.product_id) AS product_id,coalesce(e.segment,v.segment) AS segment,
        sum(coalesce(e.n,0)) AS overrides,sum(coalesce(v.applicable,0)) AS applicable,
        sum(CASE WHEN v.applicable IS NULL OR coalesce(e.n,0)>v.applicable THEN coalesce(e.n,0) ELSE 0 END) AS unmatched
      FROM e FULL OUTER JOIN v ON e.product_id=v.product_id AND e.segment=v.segment AND e.day=v.day
      GROUP BY coalesce(e.product_id,v.product_id),coalesce(e.segment,v.segment)`)
      .bind(from, until, from, until).all(),
    db.prepare(`SELECT ref AS policy,count(*) AS events,count(DISTINCT product_id) AS products,
        count(*) FILTER(WHERE regulatory_risk_score>=4) AS high_risk,coalesce(sum(operations_cost_krw),0) AS cost_krw
      FROM override_event CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(policy_refs_json,'[]')::jsonb) AS ref
      WHERE is_override=1 AND validity='valid' GROUP BY ref ORDER BY events DESC,ref`).all(),
    db.prepare(`SELECT coalesce(c.cause_code,'unknown') AS cause_code,count(*) AS events,
        jsonb_agg(DISTINCT p.name) AS products
      FROM override_event e JOIN issue_cluster c ON c.id=e.cluster_id JOIN override_product p ON p.id=e.product_id
      WHERE e.is_override=1 AND e.validity='valid' GROUP BY c.cause_code
      HAVING count(DISTINCT e.product_id)>1 ORDER BY events DESC,c.cause_code`).all(),
    db.prepare(`SELECT cluster_id,count(*) FILTER(WHERE occurred_at>=?) AS recent,
        count(*) FILTER(WHERE occurred_at<?) AS previous
      FROM override_event WHERE is_override=1 AND validity='valid' AND occurred_at>=? AND occurred_at<?
      GROUP BY cluster_id`).bind(from, from, previous.toISOString().slice(0,10), until).all(),
    db.prepare(`SELECT DISTINCT product_id,cluster_id FROM override_event
      WHERE cluster_id IS NOT NULL ORDER BY product_id,cluster_id`).all(),
    db.prepare(`SELECT cluster_id,count(*) AS n FROM override_event WHERE is_override=1 AND validity='valid' GROUP BY cluster_id`).all(),
  ])
  const names = new Map(products.map(row => [row.id,row.name]))
  const fairness = bins.results.map(row => ({ ...row, product_name: names.get(row.product_id),
    rate: Number(row.applicable)>0 && Number(row.unmatched)===0 ? Math.round(10000*Number(row.overrides)/Number(row.applicable))/100 : null }))
  const applicable = fairness.reduce((sum,row)=>sum+Number(row.applicable),0)
  const overrides = fairness.reduce((sum,row)=>sum+Number(row.overrides),0)
  const unmatched = fairness.reduce((sum,row)=>sum+Number(row.unmatched),0)
  return {
    metrics: { ...totals, confirmed_override_rate: applicable>0 && !unmatched ? Math.round(10000*overrides/applicable)/100 : null,
      rate_window: { from, until, timezone: 'UTC', applicable, overrides, unmatched,
        definition: '최근 30일 · 동일 제품·측정일·고객군의 확인된 수정 사건 / 등록된 적용 가능 건수. 미대응 사건이 있으면 미산출.',
      }, totals_scope: '전체 저장 이력 · 유효 판정만 수정 사건에 포함' },
    fairness, policy_impact: policies.results,
    common_issues: common.results.map(row=>({...row,cause_label:causeByKey(row.cause_code).label})),
    trends: new Map(trends.results.map(row=>[row.cluster_id,trendSignal(Number(row.recent),Number(row.previous))])),
    edges: edges.results,
    clusterCounts: new Map(clusterCounts.results.map(row=>[row.cluster_id,Number(row.n)])),
  }
}
