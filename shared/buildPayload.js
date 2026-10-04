// Network boundary for browser-calculated build records. Never spread pipeline
// objects here: quarantine cells, buffers, arbitrary headers and extra fields
// belong only to the local browser. Known calculation and review metadata stays.
const ROW_FIELDS = ['date','iso_week','sku','sku_name','channel','country','qty','return_qty','src_currency','fx_rate',
  'gross_krw','discount_krw','return_krw','net_revenue_krw','commission_krw','reported_commission_krw','cogs_krw','logistics_krw','ad_krw','contribution_krw','has_duplicate']
const TOTAL_FIELDS = ['rows','qty','return_qty','gross_krw','net_revenue_krw','commission_krw','reported_commission_krw','contribution_krw']
const FILE_FIELDS = ['name','sheet','sha256','ambiguousName','ok','channel','encoding','encodingConfident','headerRowNo','rowsIn','rowsOut','quarantined','skippedDuplicate','skippedPeriod','warnOnly','note']
const SOURCE_FIELDS = ['file','sheet','rowNo','sha256','ambiguousName']
const scalar = value => value === null || ['string','number','boolean'].includes(typeof value)
const project = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key) && scalar(value[key])).map(key => [key, value[key]]))
const array = value => Array.isArray(value) ? value : []
const source = value => project(value, SOURCE_FIELDS)

export function buildRecordPayload(body) {
  return {
    kind: 'run',
    files: array(body.files).map(file => ({ ...project(file, FILE_FIELDS),
      ...(file?.duplicateOf ? { duplicateOf: project(file.duplicateOf, ['file','sha256']) } : {}) })),
    rows: array(body.rows).map(row => ({ ...project(row, ROW_FIELDS), source: source(row?.source),
      trace: array(row?.trace).map(step => project(step, ['step','value'])),
      ...(row?.duplicate_of ? { duplicate_of: source(row.duplicate_of) } : {}) })),
    quarantine: array(body.quarantine).map(row => ({ ...project(row, ['reason','externalCode','productName','note']), source: source(row?.source) })),
    totals: body.totals == null ? null : {
      all: project(body.totals.all, TOTAL_FIELDS),
      byChannel: array(body.totals.byChannel).map(total => project(total, ['channel', ...TOTAL_FIELDS])),
      byChannelWeek: array(body.totals.byChannelWeek).map(total => project(total, ['channel','iso_week', ...TOTAL_FIELDS])),
    },
    ...project(body, ['duplicate_suspects','duration_ms','note']),
  }
}

export function buildRunPayload(result) {
  return buildRecordPayload({ ...result, duplicate_suspects: result.stats?.duplicateSuspects, duration_ms: result.stats?.durationMs })
}
