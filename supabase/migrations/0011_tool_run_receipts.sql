-- A run, its success quota and its retry receipt have one commit boundary.
BEGIN;
SELECT pg_advisory_xact_lock(72413011);

CREATE FUNCTION public.ilson_record_tool_run(
  p_token text, p_actor text, p_slug text, p_bucket text,
  p_request_id text, p_fingerprint text, p_run jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE target text; receipt_scope text; h record; prior jsonb; response jsonb;
  rate_bucket text; ticket bigint; hits bigint; successful boolean;
BEGIN
  IF p_actor IS NOT NULL AND p_token IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting identity scopes' USING ERRCODE='22023';
  END IF;
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  receipt_scope := CASE WHEN p_actor IS NULL THEN target ELSE ilson_private.scope_begin(p_actor) END;
  PERFORM pg_advisory_xact_lock(hashtextextended(target || ':override-mutation',0));
  EXECUTE format('SELECT application_id,daily_limit,rolled_back_at FROM %I.handover WHERE slug=$1 FOR UPDATE',target)
    INTO h USING p_slug;
  IF h IS NULL OR (p_actor IS NOT NULL AND NOT ilson_private.scope_can_app(h.application_id)) THEN
    RAISE EXCEPTION 'Unknown or inaccessible tool' USING ERRCODE='42501';
  END IF;
  prior := CASE WHEN p_actor IS NULL THEN public.ilson_mutation_receipt(p_token,p_request_id,p_fingerprint)
    ELSE ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint) END;
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('response',prior,'replayed',true); END IF;
  IF h.rolled_back_at IS NOT NULL THEN
    RETURN jsonb_build_object('response',jsonb_build_object('status',409,'body',jsonb_build_object('error','이 도구는 잠시 내려가 있습니다.')),'replayed',false);
  END IF;
  IF p_bucket IS NULL OR NOT starts_with(p_bucket,'tool:' || p_slug || ':') OR length(p_bucket)>256
    OR jsonb_typeof(p_run) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_run->'ok') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_run->'files') IS DISTINCT FROM 'array'
    OR p_run->>'id' IS NULL OR length(p_run->>'id') NOT BETWEEN 10 AND 100
    OR p_run->>'actor_label' IS NULL OR length(p_run->>'actor_label')>40
    OR jsonb_typeof(p_run->'rows_out') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_run->'quarantined') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_run->'duration_ms') IS DISTINCT FROM 'number'
    OR (p_run->>'rows_out')::bigint NOT BETWEEN 0 AND 2147483647
    OR (p_run->>'quarantined')::bigint NOT BETWEEN 0 AND 2147483647
    OR (p_run->>'duration_ms')::bigint NOT BETWEEN 0 AND 2147483647 THEN
    RAISE EXCEPTION 'Invalid tool run' USING ERRCODE='22023';
  END IF;
  successful := (p_run->>'ok')::boolean;
  rate_bucket := CASE WHEN p_actor IS NULL THEN p_bucket ELSE ilson_private.actor_rate_bucket(p_actor,p_bucket) END;
  IF successful THEN
    ticket := CASE WHEN p_actor IS NULL THEN public.ilson_claim_rate_limit(p_token,p_bucket,h.daily_limit::integer,86400)
      ELSE public.ilson_actor_claim_rate_limit(p_actor,p_bucket,h.daily_limit::integer,86400) END;
    IF ticket=0 THEN
      RETURN jsonb_build_object('response',jsonb_build_object('status',429,'body',jsonb_build_object('error',
        '최근 24시간의 성공 실행 한도를 모두 사용했습니다. 가장 오래된 성공 기록이 24시간을 넘긴 뒤 같은 기록을 다시 저장해 주십시오.')),'replayed',false);
    END IF;
  END IF;
  EXECUTE format('INSERT INTO %I.tool_use(id,application_id,actor_label,files_json,rows_out,quarantined,duration_ms,ok,fail_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',target)
    USING p_run->>'id',h.application_id,p_run->>'actor_label',(p_run->'files')::text,
      (p_run->>'rows_out')::integer,(p_run->>'quarantined')::integer,(p_run->>'duration_ms')::integer,
      CASE WHEN successful THEN 1 ELSE 0 END,nullif(left(p_run->>'fail_reason',200),'');
  EXECUTE format('SELECT count(*) FROM %I.rate_limit_hits WHERE bucket=$1 AND created_at>=public.datetime(''now'',''-86400 seconds'')',target)
    INTO hits USING rate_bucket;
  response := jsonb_build_object('status',201,'body',jsonb_build_object('ok',true,'id',p_run->>'id',
    'remainingToday',greatest(0,h.daily_limit-hits)));
  IF p_actor IS NULL THEN
    INSERT INTO ilson_private.mutation_receipts(scope,request_id,fingerprint,response)
      VALUES(receipt_scope,p_request_id,p_fingerprint,response);
  ELSE
    PERFORM ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint,response);
  END IF;
  RETURN jsonb_build_object('response',response,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.ilson_record_tool_run(text,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.ilson_record_tool_run(text,text,text,text,text,text,jsonb) TO service_role;

ALTER FUNCTION public.ilson_readiness(text) RENAME TO ilson_readiness_v10;
REVOKE ALL ON FUNCTION public.ilson_readiness_v10(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; migrated boolean;
BEGIN
  result := public.ilson_readiness_v10(p_token);
  migrated := (result->>'schemaReady')::boolean
    AND to_regprocedure('public.ilson_record_tool_run(text,text,text,text,text,text,jsonb)') IS NOT NULL;
  RETURN result || jsonb_build_object('migration','0011','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
