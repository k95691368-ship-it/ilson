// Existing report feed only: bounded originals, complete scoped counts. No new
// RPC, privilege or writer. PostgreSQL evaluates this one SELECT at one statement
// snapshot; a later page request is NOT a persistent snapshot.
import type { Database, SqlRow } from './runtimeTypes.ts'
import { sha256Hex } from './ids.js'

export const REPORT_PAGE_SIZE = 100
export const REPORT_MAX_PAGE = 10000
export interface ReportFeedRequest { number: number; basis: string | null }
export type ReportFeedQuery = { ok: true; value: ReportFeedRequest } | { ok: false }

export function parseReportFeedQuery(request?: { url: string }): ReportFeedQuery {
  let search: URLSearchParams
  try { search = new URL(request?.url ?? 'https://local.invalid/api/reports').searchParams } catch { return { ok: false } }
  for (const key of search.keys()) if (key !== 'page' && key !== 'basis') return { ok: false }
  if (search.getAll('page').length > 1 || search.getAll('basis').length > 1) return { ok: false }
  const raw = search.get('page')
  if (raw !== null && !/^[1-9][0-9]{0,4}$/.test(raw)) return { ok: false }
  const number = raw === null ? 1 : Number(raw)
  if (number > REPORT_MAX_PAGE) return { ok: false }
  const basis = search.get('basis')
  if (basis !== null && !/^[a-f0-9]{64}$/.test(basis)) return { ok: false }
  return { ok: true, value: { number, basis } }
}

// JSON values are explicit known fields, not concatenated arbitrary strings.
// Each row is reduced inside PG, then sorted per application before aggregation.
// MD5 here is only a compact change detector (not authentication, permission,
// tamper resistance or proof that a human fix is correct). SHA-256 scopes the
// resulting feed basis to the current server-selected account/workspace.
const REPORT_FEED_SQL = `WITH latest_fix AS (
  SELECT DISTINCT ON (application_id,link_id) id,application_id,stage,actor,title,what,why,
    alternatives,unrequested,link_kind,link_id,created_at
  FROM decision_log WHERE link_kind='신고처리'
  ORDER BY application_id,link_id,created_at COLLATE "C" DESC,id COLLATE "C" DESC
), report_state AS (
  SELECT r.id,r.application_id,r.stage,r.actor,r.title,r.what,r.why,r.alternatives,r.unrequested,r.link_kind,r.link_id,r.created_at,
    a.ticket_no,a.dept,h.slug,h.title AS tool_title,h.handed_to_dept,
    f.id AS fix_id,f.application_id AS fix_application_id,f.what AS fix_how,f.why AS fix_why,f.created_at AS fix_at,
    CASE WHEN f.id IS NULL THEN 1 ELSE 0 END AS open_rank,
    CASE WHEN r.link_id IN ('wrong_number','missing_rows','wont_run') THEN 1 ELSE 0 END AS urgent_rank,
    md5(jsonb_build_array(
      r.id,r.application_id,r.stage,r.actor,r.title,r.what,r.why,r.alternatives,r.unrequested,r.link_kind,r.link_id,r.created_at,
      a.id,a.ticket_no,a.dept,a.title,a.status,a.owner_email,a.updated_at,
      h.application_id,h.slug,h.title,h.handed_to_dept,h.handed_to_person,h.handed_at,h.accepted_at,h.accepted_by,
      h.daily_limit,h.max_file_mb,h.note,h.rolled_back_at,h.rollback_reason,h.updated_at,
      f.id,f.application_id,f.stage,f.actor,f.title,f.what,f.why,f.alternatives,f.unrequested,f.link_kind,f.link_id,f.created_at
    )::text) AS evidence_digest
  FROM decision_log r JOIN application a ON a.id=r.application_id
  LEFT JOIN handover h ON h.application_id=r.application_id
  LEFT JOIN latest_fix f ON f.link_id=r.id AND f.application_id=r.application_id
  WHERE r.link_kind='신고'
), counts AS (
  SELECT application_id,COUNT(*) AS total,SUM(open_rank) AS open,SUM(open_rank*urgent_rank) AS urgent,
    SUM(1-open_rank) AS fixed,md5(string_agg(evidence_digest,'' ORDER BY id COLLATE "C")) AS digest
  FROM report_state GROUP BY application_id
), bounded AS (
  SELECT id,application_id,stage,actor,title,what,why,alternatives,unrequested,link_kind,link_id,created_at,ticket_no,dept,slug,tool_title,handed_to_dept,
    fix_id,fix_application_id,fix_how,fix_why,fix_at,open_rank,urgent_rank
  FROM report_state ORDER BY open_rank DESC,urgent_rank DESC,created_at COLLATE "C" ASC,id COLLATE "C" ASC
  LIMIT 100 OFFSET ?
)
SELECT jsonb_build_object(
  'counts',COALESCE((SELECT jsonb_agg(to_jsonb(counts) ORDER BY application_id COLLATE "C") FROM counts),'[]'::jsonb),
  'rows',COALESCE((SELECT jsonb_agg(to_jsonb(bounded) ORDER BY open_rank DESC,urgent_rank DESC,created_at COLLATE "C",id COLLATE "C") FROM bounded),'[]'::jsonb)
) AS payload`

interface FeedCount { application_id: string; total: number; open: number; urgent: number; fixed: number; digest: string }
export interface FeedRow extends SqlRow {
  id: string; application_id: string; stage: string; actor: string; title: string; what: string; why: string;
  alternatives: string | null; unrequested: 0 | 1; link_kind: '신고'; link_id: string | null;
  created_at: string; ticket_no: string; dept: string; slug: string | null; tool_title: string | null; handed_to_dept: string | null;
  fix_id: string | null; fix_application_id: string | null; fix_how: string | null; fix_why: string | null; fix_at: string | null;
  open_rank: 0 | 1; urgent_rank: 0 | 1
}
export interface ReportFeed {
  rows: FeedRow[]; counts: FeedCount[]; basis: string;
  summary: { total: number; open: number; urgent: number; fixed: number; toolsUntrusted: number };
  page: { number: number; size: 100; total: number; totalPages: number; hasPrevious: boolean; hasMore: boolean; basis: string }
}
function record(value: unknown): value is SqlRow { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function safeCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'

// Fail closed on malformed, missing or truncated database results. A query
// failure is never converted into a zero-report success.
export function decodeReportFeedPayload(value: unknown): { rows: FeedRow[]; counts: FeedCount[] } {
  if (!record(value) || !Array.isArray(value.counts) || !Array.isArray(value.rows) || value.rows.length > REPORT_PAGE_SIZE) throw Error('Invalid report feed')
  const counts: FeedCount[] = [], seenApps = new Set<string>()
  for (const c of value.counts) {
    if (!record(c) || typeof c.application_id !== 'string' || !c.application_id || seenApps.has(c.application_id)
      || !safeCount(c.total) || c.total === 0 || !safeCount(c.open) || !safeCount(c.urgent) || !safeCount(c.fixed)
      || c.open + c.fixed !== c.total || c.urgent > c.open || typeof c.digest !== 'string' || !/^[a-f0-9]{32}$/.test(c.digest)) throw Error('Invalid report counts')
    seenApps.add(c.application_id)
    counts.push({ application_id:c.application_id,total:c.total,open:c.open,urgent:c.urgent,fixed:c.fixed,digest:c.digest })
  }
  const rows: FeedRow[] = [], seenRows = new Set<string>()
  const pageCounts = new Map<string,{ total:number; open:number; urgent:number; fixed:number }>()
  for (const r of value.rows) {
    if (!record(r) || !['id','application_id','stage','actor','title','what','why','created_at','ticket_no','dept'].every(key => typeof r[key] === 'string')
      || !r.id || !seenApps.has(r.application_id as string) || seenRows.has(r.id as string) || r.link_kind !== '신고'
      || !nullableString(r.alternatives) || (r.unrequested !== 0 && r.unrequested !== 1)
      || !['link_id','slug','tool_title','handed_to_dept','fix_id','fix_application_id','fix_how','fix_why','fix_at'].every(key=>nullableString(r[key]))
      || (r.open_rank !== 0 && r.open_rank !== 1) || (r.urgent_rank !== 0 && r.urgent_rank !== 1)) throw Error('Invalid report row')
    const hasFix = r.fix_id !== null
    if (hasFix ? !r.fix_id || r.fix_application_id !== r.application_id || typeof r.fix_how !== 'string'
      || typeof r.fix_why !== 'string' || typeof r.fix_at !== 'string' || r.open_rank !== 0
      : r.fix_application_id !== null || r.fix_how !== null || r.fix_why !== null || r.fix_at !== null || r.open_rank !== 1) throw Error('Invalid report fix')
    if (r.urgent_rank !== (['wrong_number','missing_rows','wont_run'].includes(String(r.link_id)) ? 1 : 0)) throw Error('Invalid report priority')
    seenRows.add(r.id as string)
    rows.push(r as FeedRow)
    const shown = pageCounts.get(r.application_id as string) ?? {total:0,open:0,urgent:0,fixed:0}
    shown.total++;shown.open+=r.open_rank;shown.fixed+=1-r.open_rank;shown.urgent+=r.open_rank*r.urgent_rank
    pageCounts.set(r.application_id as string,shown)
  }
  for(const c of counts){
    const shown=pageCounts.get(c.application_id)
    if(shown && (shown.total>c.total || shown.open>c.open || shown.urgent>c.urgent || shown.fixed>c.fixed)) throw Error('Invalid report page counts')
  }
  return { rows,counts }
}

type FeedDatabase = Database & { provider?: string; toolRunScope?: () => Promise<string> }
export async function loadReportFeed(DB: FeedDatabase, query: ReportFeedRequest): Promise<ReportFeed> {
  if (!Number.isInteger(query.number) || query.number < 1 || query.number > REPORT_MAX_PAGE
    || (query.basis !== null && (typeof query.basis !== 'string' || !/^[a-f0-9]{64}$/.test(query.basis)))) throw Error('Invalid report feed query')
  if (DB.provider !== 'supabase' || typeof DB.toolRunScope !== 'function') throw Error('Report feed adapter unavailable')
  // first() discards the RPC's row count. This statement must return exactly
  // one wrapper even when there are no reports; missing/extra/inconsistent RPC
  // rows are not evidence of a successful empty feed.
  const result = await DB.prepare(REPORT_FEED_SQL).bind((query.number-1)*REPORT_PAGE_SIZE).all<{ payload: unknown }>()
  if (!result || result.success !== true || !Array.isArray(result.results) || result.results.length !== 1
    || result.meta?.row_count !== 1 || result.meta?.changes !== 1) throw Error('Report feed wrapper count invalid')
  const wrapper = result.results[0]
  if (!record(wrapper) || !Object.hasOwn(wrapper,'payload')) throw Error('Report feed query missing')
  const { rows,counts } = decodeReportFeedPayload(wrapper.payload)
  const scope = await DB.toolRunScope()
  if (!/^[a-f0-9]{64}$/.test(scope)) throw Error('Report feed scope unavailable')
  const basis = await sha256Hex(JSON.stringify(['report-feed-v1',scope,counts]))
  const summary = counts.reduce((out,c) => ({ total:out.total+c.total,open:out.open+c.open,urgent:out.urgent+c.urgent,
    fixed:out.fixed+c.fixed,toolsUntrusted:out.toolsUntrusted+(c.urgent>0?1:0) }),{total:0,open:0,urgent:0,fixed:0,toolsUntrusted:0})
  if (!Object.values(summary).every(safeCount)) throw Error('Report feed counts overflow')
  const totalPages = Math.max(1,Math.ceil(summary.total/REPORT_PAGE_SIZE))
  const expected = Math.max(0,Math.min(REPORT_PAGE_SIZE,summary.total-(query.number-1)*REPORT_PAGE_SIZE))
  if (rows.length !== expected) throw Error('Report feed page incomplete')
  return { rows,counts,basis,summary,page:{number:query.number,size:100,total:summary.total,totalPages,
    hasPrevious:query.number>1,hasMore:query.number<totalPages,basis} }
}
