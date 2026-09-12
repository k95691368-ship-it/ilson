-- Server-only PostgreSQL compatibility and atomic query RPC.
-- The website's service role is the only API role allowed to execute SQL.
BEGIN;
CREATE OR REPLACE FUNCTION public.datetime(p_value text, p_modifier text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL ELSE
    to_char(((CASE WHEN lower(p_value) = 'now' THEN CURRENT_TIMESTAMP
                   ELSE p_value::timestamptz END)
      + coalesce(p_modifier::interval, interval '0 seconds')) AT TIME ZONE 'UTC',
      'YYYY-MM-DD HH24:MI:SS') END
$$;
CREATE OR REPLACE FUNCTION public.julianday(p_value text)
RETURNS double precision LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT extract(epoch FROM CASE WHEN lower(p_value)='now' THEN CURRENT_TIMESTAMP
                                 ELSE p_value::timestamptz END)::double precision / 86400 + 2440587.5
$$;
CREATE OR REPLACE FUNCTION public.ilson_concat(state text, value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN state IS NULL THEN value WHEN value IS NULL THEN state ELSE state || ',' || value END
$$;
DO $$ BEGIN
  IF to_regprocedure('public.group_concat(text)') IS NULL THEN
    CREATE AGGREGATE public.group_concat(text) (SFUNC=public.ilson_concat, STYPE=text);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ilson_execute(p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog
SET statement_timeout = '20s'
AS $$
DECLARE
  query text := trim(p_sql);
  rows_json jsonb;
  changed bigint;
  last_id bigint;
BEGIN
  IF query ~* '^(SELECT|WITH)\M' THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*) FROM (%s) q', query)
      INTO rows_json, changed;
  ELSIF query ~* '^(INSERT|UPDATE|DELETE)\M' THEN
    -- Callers supply one statement, without RETURNING. Data lives in quoted literals.
    EXECUTE format('WITH changed AS (%s RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*) FROM changed q', query)
      INTO rows_json, changed;
    IF query ~* '^INSERT\s+INTO\s+rate_limit_hits\M' AND changed > 0 THEN
      last_id := (rows_json->0->>'id')::bigint;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported database operation' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('rows', rows_json, 'rowCount', changed, 'last_row_id', last_id);
END $$;

CREATE OR REPLACE FUNCTION public.ilson_batch(p_statements jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $$
DECLARE statement text; output jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_statements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_statements) > 1000 THEN
    RAISE EXCEPTION 'Invalid batch';
  END IF;
  FOR statement IN SELECT jsonb_array_elements_text(p_statements) LOOP
    output := output || jsonb_build_array(public.ilson_execute(statement));
  END LOOP;
  RETURN output;
END $$;

REVOKE ALL ON FUNCTION public.datetime(text,text), public.julianday(text),
  public.ilson_concat(text,text), public.group_concat(text),
  public.ilson_execute(text), public.ilson_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datetime(text,text), public.julianday(text),
  public.ilson_concat(text,text), public.group_concat(text),
  public.ilson_execute(text), public.ilson_batch(jsonb) TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- Retire the unsafe legacy RPC if it was installed previously.
DO $$ BEGIN
  IF to_regprocedure('public.execute_sql(text,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.execute_sql(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
