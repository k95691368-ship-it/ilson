-- Additive migration: public data and existing visitor schemas are preserved.
BEGIN;
CREATE TABLE ilson_private.mutation_receipts (
  scope text NOT NULL, request_id text NOT NULL, fingerprint text NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, request_id)
);
ALTER TABLE ilson_private.mutation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ilson_private.mutation_receipts FROM PUBLIC, anon, authenticated, service_role;

DO $$ DECLARE target text; BEGIN
  FOR target IN SELECT 'public' UNION ALL SELECT schema_name FROM ilson_private.workspaces LOOP
    EXECUTE format('ALTER TABLE %I.change_experiment ADD COLUMN evaluation_plan_json text, ADD COLUMN change_version text NOT NULL DEFAULT ''1'', ADD COLUMN approval_id text, ADD COLUMN mutation_version bigint NOT NULL DEFAULT 0', target);
    EXECUTE format('ALTER TABLE %I.experiment_run ADD COLUMN change_version text, ADD COLUMN approval_id text, ADD COLUMN evidence_refs_json text, ADD COLUMN measurement_start text, ADD COLUMN measurement_end text, ADD COLUMN source_kind text NOT NULL DEFAULT ''manual'', ADD COLUMN run_sequence bigint GENERATED ALWAYS AS IDENTITY', target);
    EXECUTE format('CREATE INDEX ON %I.experiment_run (experiment_id, approval_id, run_sequence)', target);
  END LOOP;
END $$;

CREATE FUNCTION public.ilson_mutation_receipt(p_token text, p_request_id text, p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; prior record;
BEGIN
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  IF p_request_id IS NULL OR p_request_id !~ '^[a-zA-Z0-9_-]{16,100}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid mutation identity' USING ERRCODE='22023';
  END IF;
  SELECT * INTO prior FROM ilson_private.mutation_receipts WHERE scope=target AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'Request identity conflict' USING ERRCODE='40001'; END IF;
    RETURN prior.response;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.ilson_commit_mutation(p_token text, p_request_id text, p_fingerprint text,
  p_reads jsonb, p_writes jsonb, p_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE target text; prior jsonb; item jsonb; actual jsonb; statement text;
BEGIN
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  PERFORM pg_advisory_xact_lock(hashtextextended(target || ':override-mutation', 0));
  prior := public.ilson_mutation_receipt(p_token,p_request_id,p_fingerprint);
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('response',prior,'replayed',true); END IF;
  IF jsonb_typeof(p_reads) IS DISTINCT FROM 'array' OR jsonb_typeof(p_writes) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_reads)>100 OR jsonb_array_length(p_writes)>1000
      OR jsonb_typeof(p_response) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid mutation' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_reads) LOOP
    actual := CASE WHEN p_token IS NULL THEN public.ilson_execute(item->>'sql') ELSE public.ilson_workspace_query(p_token,item->>'sql') END;
    IF actual->'rows' IS DISTINCT FROM item->'rows' THEN
      RAISE EXCEPTION 'Data changed; reload before retrying' USING ERRCODE='40001';
    END IF;
  END LOOP;
  FOR statement IN SELECT jsonb_array_elements_text(p_writes) LOOP
    IF p_token IS NULL THEN PERFORM public.ilson_execute(statement);
    ELSE PERFORM public.ilson_workspace_query(p_token,statement); END IF;
  END LOOP;
  INSERT INTO ilson_private.mutation_receipts(scope,request_id,fingerprint,response)
    VALUES(target,p_request_id,p_fingerprint,p_response);
  -- Bound receipt retention without modifying business or audit records.
  DELETE FROM ilson_private.mutation_receipts WHERE created_at < now()-interval '7 days';
  RETURN jsonb_build_object('response',p_response,'replayed',false);
END $$;

CREATE FUNCTION public.ilson_claim_rate_limit(p_token text, p_bucket text, p_max integer, p_window integer)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; count_hits bigint; ticket bigint;
BEGIN
  IF p_bucket IS NULL OR length(p_bucket)>256 OR p_max IS NULL OR p_window IS NULL OR p_max NOT BETWEEN 1 AND 10000 OR p_window NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit' USING ERRCODE='22023';
  END IF;
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  PERFORM pg_advisory_xact_lock(hashtextextended(target || ':rate:' || p_bucket, 0));
  EXECUTE format('DELETE FROM %I.rate_limit_hits WHERE bucket=$1 AND created_at < public.datetime(''now'', $2)',target)
    USING p_bucket, '-' || p_window || ' seconds';
  EXECUTE format('SELECT count(*) FROM %I.rate_limit_hits WHERE bucket=$1',target) INTO count_hits USING p_bucket;
  IF count_hits>=p_max THEN RETURN 0; END IF;
  EXECUTE format('INSERT INTO %I.rate_limit_hits(bucket) VALUES($1) RETURNING id',target) INTO ticket USING p_bucket;
  IF ticket%50=0 THEN EXECUTE format('DELETE FROM %I.rate_limit_hits WHERE created_at < public.datetime(''now'',''-1 day'')',target); END IF;
  RETURN ticket;
END $$;

CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; n bigint; migrated boolean;
BEGIN
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  SELECT count(*) INTO n FROM ilson_private.workspaces WHERE expires_at>now();
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=target AND table_name='experiment_run' AND column_name='approval_id') INTO migrated;
  migrated := migrated AND to_regprocedure('public.ilson_workspace_open(text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_workspace_query(text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_claim_rate_limit(text,text,integer,integer)') IS NOT NULL
    AND to_regprocedure('public.ilson_commit_mutation(text,text,text,jsonb,jsonb,jsonb)') IS NOT NULL;
  RETURN jsonb_build_object('migration','0004','schemaReady',migrated,'activeWorkspaces',n,'workspaceCapacity',128,'capacityAvailable',n<128,'ready',migrated AND (p_token IS NOT NULL OR n<128));
END $$;

REVOKE ALL ON FUNCTION public.ilson_mutation_receipt(text,text,text), public.ilson_commit_mutation(text,text,text,jsonb,jsonb,jsonb),
  public.ilson_claim_rate_limit(text,text,integer,integer), public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_mutation_receipt(text,text,text), public.ilson_commit_mutation(text,text,text,jsonb,jsonb,jsonb),
  public.ilson_claim_rate_limit(text,text,integer,integer), public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
