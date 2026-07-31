-- 4단계 — 제작.
--
-- 실제로 파일을 합친 기록이 남는다. 언제 무엇을 넣어 무엇이 나왔고, 무엇을
-- 처리하지 못했고, 사람이 무엇을 알려줬는지.
--
-- 합치는 계산 자체는 브라우저에서 돈다. 파일이 서버로 올라가지 않는다.
-- 그렇게 한 이유가 둘이다 — 정산 자료를 굳이 밖으로 내보낼 이유가 없고,
-- 올리고 기다리는 시간이 없어 결과가 즉시 나온다.
-- 서버에는 "무엇이 나왔는가"만 기록으로 남긴다.

CREATE TABLE build_run (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  files_json TEXT NOT NULL,
  rows_out INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  duplicate_suspects INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  totals_json TEXT,
  ran_where TEXT NOT NULL DEFAULT 'browser',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, seq)
);

CREATE INDEX idx_build_run_app ON build_run(application_id, seq DESC);

-- 결과 한 줄. source_* 세 컬럼이 되짚기의 전부다 —
-- 이 값이 없으면 "이 숫자 어디서 나왔냐"에 답할 수 없다.
CREATE TABLE build_row (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES build_run(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  date TEXT NOT NULL,
  iso_week TEXT NOT NULL,
  sku TEXT NOT NULL,
  sku_name TEXT,
  channel TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  return_qty INTEGER NOT NULL DEFAULT 0,
  src_currency TEXT NOT NULL DEFAULT 'KRW',
  fx_rate REAL NOT NULL DEFAULT 1,
  gross_krw REAL NOT NULL DEFAULT 0,
  discount_krw REAL NOT NULL DEFAULT 0,
  return_krw REAL NOT NULL DEFAULT 0,
  net_revenue_krw REAL NOT NULL DEFAULT 0,
  commission_krw REAL NOT NULL DEFAULT 0,
  reported_commission_krw REAL,
  cogs_krw REAL NOT NULL DEFAULT 0,
  logistics_krw REAL NOT NULL DEFAULT 0,
  ad_krw REAL NOT NULL DEFAULT 0,
  contribution_krw REAL NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  source_row_no INTEGER NOT NULL,
  trace_json TEXT,
  has_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT
);

CREATE INDEX idx_build_row_run ON build_row(run_id, row_no);
CREATE INDEX idx_build_row_channel ON build_row(run_id, channel);
CREATE INDEX idx_build_row_source ON build_row(run_id, source_file, source_row_no);

-- 처리하지 못한 줄. 버리지 않고 여기 모아 사람이 본다.
CREATE TABLE build_quarantine (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES build_run(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  source_row_no INTEGER NOT NULL,
  external_code TEXT,
  product_name TEXT,
  raw_json TEXT,
  note TEXT,
  resolved_at TEXT
);

CREATE INDEX idx_build_quarantine_run ON build_quarantine(run_id, reason);

-- 사람이 알려 준 상품코드.
--
-- 한 번 알려 주면 다음 실행부터 자동으로 처리된다. 운영 담당자가 못 견딘다고
-- 한 것은 개입 자체가 아니라 반복이었고, 이 표가 그 반복을 없앤다.
CREATE TABLE sku_alias (
  external_code TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL,
  channel TEXT,
  product_name TEXT,
  note TEXT,
  taught_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
