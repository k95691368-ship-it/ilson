-- 완결시킬 레시피 1종(다채널 정산 통합)이 적재하는 곳. 스타 스키마다 —
-- fact 하나에 dim 넷.
--
-- UNIQUE (source_file_id, source_row_no)가 멱등 재적재의 전부다. 같은 파일을
-- 두 번 올려도 합계가 두 배가 되지 않는다. 정산 데이터에서 이건 선택이 아니다
-- — 담당자는 "아까 올린 게 맞나?" 싶으면 반드시 다시 올린다.
--
-- metric_def를 문서가 아니라 표로 둔 이유: "경영진이 보는 숫자와 실무진이 보는
-- 숫자가 다르다"는 문제는 지표 정의가 사람 머릿속에만 있어서 생긴다. 정의문과
-- SQL 원문과 소유 부서와 기준일과 '알려진 한계'가 데이터로 있어야 대시보드에서
-- [정의]를 펼칠 수 있고, 정의를 바꾸면 과거 수치가 어떻게 달라지는지 diff를
-- 보여줄 수 있다. bq_dialect_note는 같은 계산을 BigQuery에서는 어떻게 쓰는지를
-- 나란히 적어 둔 것이다.

CREATE TABLE dim_date (
  id TEXT PRIMARY KEY,
  y INTEGER NOT NULL,
  m INTEGER NOT NULL,
  d INTEGER NOT NULL,
  iso_week TEXT NOT NULL,
  is_business_day INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE dim_sku (
  id TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL UNIQUE,
  name_ko TEXT NOT NULL,
  line TEXT,
  volume_ml INTEGER,
  std_cogs_krw INTEGER NOT NULL DEFAULT 0,
  shelf_life_months INTEGER
);

CREATE TABLE dim_channel (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('D2C', '오프라인', '오픈마켓', '해외', '어필리에이트')),
  nominal_commission_rate REAL NOT NULL DEFAULT 0,
  settlement_cycle_days INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE dim_country (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ko TEXT NOT NULL,
  currency TEXT NOT NULL
);

CREATE TABLE fact_sales_line (
  id TEXT PRIMARY KEY,
  date_id TEXT NOT NULL REFERENCES dim_date(id),
  sku_id TEXT REFERENCES dim_sku(id),
  channel_id TEXT NOT NULL REFERENCES dim_channel(id),
  country_id TEXT REFERENCES dim_country(id),
  qty INTEGER NOT NULL DEFAULT 0,
  gross_krw REAL NOT NULL DEFAULT 0,
  discount_krw REAL NOT NULL DEFAULT 0,
  return_qty INTEGER NOT NULL DEFAULT 0,
  return_krw REAL NOT NULL DEFAULT 0,
  commission_krw REAL NOT NULL DEFAULT 0,
  net_revenue_krw REAL NOT NULL DEFAULT 0,
  cogs_krw REAL NOT NULL DEFAULT 0,
  logistics_krw REAL NOT NULL DEFAULT 0,
  ad_krw REAL NOT NULL DEFAULT 0,
  contribution_krw REAL NOT NULL DEFAULT 0,
  fx_rate REAL NOT NULL DEFAULT 1,
  src_currency TEXT NOT NULL DEFAULT 'KRW',
  source_file_id TEXT NOT NULL REFERENCES source_file(id) ON DELETE CASCADE,
  source_row_no INTEGER NOT NULL,
  run_row_id TEXT REFERENCES run_row(id) ON DELETE SET NULL,
  load_batch_id TEXT NOT NULL,
  UNIQUE (source_file_id, source_row_no)
);

CREATE INDEX idx_fact_sales_date ON fact_sales_line(date_id);
CREATE INDEX idx_fact_sales_channel ON fact_sales_line(channel_id, date_id);
CREATE INDEX idx_fact_sales_sku ON fact_sales_line(sku_id, date_id);
CREATE INDEX idx_fact_sales_batch ON fact_sales_line(load_batch_id);

CREATE TABLE fact_inventory_snapshot (
  id TEXT PRIMARY KEY,
  date_id TEXT NOT NULL REFERENCES dim_date(id),
  sku_id TEXT NOT NULL REFERENCES dim_sku(id),
  on_hand INTEGER NOT NULL DEFAULT 0,
  in_transit INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  UNIQUE (date_id, sku_id)
);

CREATE TABLE metric_def (
  key TEXT PRIMARY KEY,
  name_ko TEXT NOT NULL,
  definition TEXT NOT NULL,
  sql_expr TEXT NOT NULL,
  bq_dialect_note TEXT,
  unit TEXT NOT NULL,
  owner_dept TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL,
  known_limits TEXT,
  min_sample INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE metric_def_history (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  sql_expr TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  change_note TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_metric_def_history_key ON metric_def_history(key, version DESC);
