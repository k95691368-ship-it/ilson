-- AI는 값을 뽑지 않는다. 실행 계획을 만든다.
--
-- recipe.dag_json이 그 계획이고, 실행은 AI가 짠 코드를 eval하는 것이 아니라
-- 순수 JS 인터프리터가 블록 8종만 해석해서 한다. 이 경계가 이 제품의 가장
-- 중요한 설계 결정이다 — 모델이 무엇을 내놓든 실행되는 것은 우리가 정의한
-- 8종뿐이므로, 계획이 틀려도 임의 코드가 도는 일은 없다.
--
-- recipe_block.confidence와 rationale은 NOT NULL이다. 근거 없는 블록을
-- 만들 수 없게 스키마 차원에서 막는다. origin은 그 블록을 누가 놨는지를
-- 남긴다 — ai(플래너) / human(사람이 고침) / patch(자가수리가 고침).
-- 화면에서 "AI가 요청에 없이 추가한 것" 배지를 띄우는 근거가 이 컬럼이다.
--
-- 버전은 덮어쓰지 않는다. v2는 새 행이고 prev_version_id로 이어진다.
-- 회귀 게이트가 "이전 버전에서 통과하던 케이스"를 찾으려면 이전 버전이
-- 살아 있어야 하고, 롤백은 published 플래그를 되돌리는 일이어야 한다.

CREATE TABLE recipe (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  dag_json TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '초안'
    CHECK (status IN ('초안', '시험중', '발행', '차단', '롤백')),
  prev_version_id TEXT REFERENCES recipe(id) ON DELETE SET NULL,
  reuse_of_recipe_id TEXT REFERENCES recipe(id) ON DELETE SET NULL,
  reuse_ratio REAL,
  prompt_version TEXT,
  published_at TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (slug, version)
);

CREATE INDEX idx_recipe_slug ON recipe(slug, status);
CREATE INDEX idx_recipe_request ON recipe(request_id, version);

CREATE TABLE recipe_block (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('ingest', 'map', 'normalize', 'extract', 'join', 'compute', 'check', 'emit')),
  config_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'human', 'patch')),
  unrequested INTEGER NOT NULL DEFAULT 0,
  rationale TEXT NOT NULL,
  UNIQUE (recipe_id, ord)
);

CREATE INDEX idx_recipe_block_recipe ON recipe_block(recipe_id, ord);
