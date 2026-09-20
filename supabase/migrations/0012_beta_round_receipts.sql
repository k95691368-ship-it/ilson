-- Keep old rounds intact. New rounds validate the current gate and commit once.
BEGIN;
SELECT pg_advisory_xact_lock(72413012);

CREATE FUNCTION ilson_private.beta_criteria_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE app_id text; old_id text; new_id text;
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN old_id:=OLD.application_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.application_id; END IF;
  -- Every criteria writer takes the same application row lock as round saving.
  -- This also serializes insert/delete phantoms, not just existing criteria rows.
  FOR app_id IN SELECT DISTINCT value FROM unnest(ARRAY[old_id,new_id]) value WHERE value IS NOT NULL ORDER BY value LOOP
    EXECUTE format('UPDATE %I.application SET beta_criteria_revision=beta_criteria_revision+1 WHERE id=$1',TG_TABLE_SCHEMA) USING app_id;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ilson_private.beta_criteria_changed() FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;

CREATE FUNCTION ilson_private.install_beta_rounds(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target<>'public' AND NOT EXISTS(SELECT 1 FROM ilson_private.workspaces WHERE schema_name=target) THEN
    RAISE EXCEPTION 'Unknown schema' USING ERRCODE='42501';
  END IF;
  EXECUTE format('ALTER TABLE %I.application ADD COLUMN IF NOT EXISTS beta_criteria_revision bigint NOT NULL DEFAULT 0 CHECK(beta_criteria_revision>=0)',target);
  EXECUTE format('CREATE TRIGGER beta_criteria_revision BEFORE INSERT OR UPDATE OR DELETE ON %I.acceptance_criterion FOR EACH ROW EXECUTE FUNCTION ilson_private.beta_criteria_changed()',target);
END $$;
REVOKE ALL ON FUNCTION ilson_private.install_beta_rounds(text) FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;
DO $$ DECLARE target text; BEGIN
  FOR target IN SELECT 'public' UNION ALL SELECT schema_name FROM ilson_private.workspaces LOOP
    PERFORM ilson_private.install_beta_rounds(target);
  END LOOP;
END $$;

CREATE FUNCTION public.ilson_record_beta_round(p_token text,p_actor text,p_application text,
  p_request_id text,p_fingerprint text,p_round jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE target text; scope text; prior jsonb; actor_row public.override_actor%ROWTYPE;
  app record; criteria jsonb; criterion jsonb; submitted jsonb; canonical jsonb:='[]';
  check_kind text; safety boolean; claimed text; overall text; round_id text; seq bigint;
  total integer; passed integer; failed integer; safety_failed integer; human_needed integer; unjudged integer; machine integer;
  summary jsonb; response jsonb; broken text;
BEGIN
  IF p_actor IS NOT NULL AND p_token IS NOT NULL THEN RAISE EXCEPTION 'Conflicting identity scopes' USING ERRCODE='22023'; END IF;
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  scope:=CASE WHEN p_actor IS NULL THEN target ELSE ilson_private.scope_begin(p_actor) END;
  PERFORM pg_advisory_xact_lock(hashtextextended(target || ':override-mutation',0));
  IF p_actor IS NOT NULL THEN
    SELECT * INTO actor_row FROM public.override_actor WHERE email=p_actor AND active=1 AND role IN ('product','ml','engineer','audit','executive') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active builder required' USING ERRCODE='42501'; END IF;
    IF NOT ilson_private.scope_can_app(p_application) THEN RAISE EXCEPTION 'Unknown application' USING ERRCODE='42501'; END IF;
  END IF;
  EXECUTE format('SELECT id,status,beta_criteria_revision FROM %I.application WHERE id=$1 FOR UPDATE',target) INTO app USING p_application;
  IF app IS NULL THEN RAISE EXCEPTION 'Unknown application' USING ERRCODE='P0002'; END IF;
  prior:=CASE WHEN p_actor IS NULL THEN public.ilson_mutation_receipt(p_token,p_request_id,p_fingerprint)
    ELSE ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint) END;
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('response',prior,'replayed',true); END IF;

  IF jsonb_typeof(p_round) IS DISTINCT FROM 'object' OR jsonb_typeof(p_round->'graded') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_round->'graded') NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_round->'criteria_revision') IS DISTINCT FROM 'number'
    OR (p_round->>'criteria_revision') !~ '^[0-9]{1,16}$'
    OR ((p_round->>'duration_ms') IS NOT NULL AND ((p_round->>'duration_ms') !~ '^[0-9]{1,10}$' OR (p_round->>'duration_ms')::bigint>2147483647)) THEN
    RAISE EXCEPTION 'Invalid beta payload' USING ERRCODE='22023';
  END IF;
  IF (p_round->>'criteria_revision')::bigint<>app.beta_criteria_revision THEN
    RAISE EXCEPTION 'Criteria changed; grade the current criteria' USING ERRCODE='PBT01';
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.ord,c.id),''[]'') FROM (SELECT id,ord,body,check_kind,check_key,is_required_safety FROM %I.acceptance_criterion WHERE application_id=$1 AND confirmed_at IS NOT NULL) c',target)
    INTO criteria USING p_application;
  total:=jsonb_array_length(criteria);
  IF total=0 OR total<>jsonb_array_length(p_round->'graded')
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_round->'graded'))<>total THEN
    RAISE EXCEPTION 'Every confirmed criterion is required exactly once' USING ERRCODE='PBT01';
  END IF;
  IF nullif(p_round->>'build_run_id','') IS NOT NULL THEN
    EXECUTE format('SELECT id FROM %I.build_run WHERE id=$1 AND application_id=$2 FOR SHARE',target) INTO broken USING p_round->>'build_run_id',p_application;
    IF broken IS NULL THEN RAISE EXCEPTION 'Build does not belong to this application' USING ERRCODE='22023'; END IF;
  END IF;
  FOR criterion IN SELECT value FROM jsonb_array_elements(criteria) LOOP
    SELECT value INTO submitted FROM jsonb_array_elements(p_round->'graded') WHERE value->>'id'=criterion->>'id';
    check_kind:=CASE WHEN criterion->>'check_kind'='rule' AND nullif(criterion->>'check_key','') IS NOT NULL THEN 'rule' ELSE 'human' END;
    safety:=(criterion->>'is_required_safety')::bigint=1;
    IF submitted IS NULL OR jsonb_typeof(submitted) IS DISTINCT FROM 'object'
      OR submitted->>'body' IS DISTINCT FROM criterion->>'body'
      OR submitted->>'ord' IS DISTINCT FROM criterion->>'ord'
      OR submitted->>'check_key' IS DISTINCT FROM criterion->>'check_key'
      OR submitted->>'kind' IS DISTINCT FROM check_kind
      OR jsonb_typeof(submitted->'is_required_safety') IS DISTINCT FROM 'boolean'
      OR (submitted->>'is_required_safety')::boolean IS DISTINCT FROM safety THEN
      RAISE EXCEPTION 'Criteria metadata changed; grade the current criteria' USING ERRCODE='PBT01';
    END IF;
    IF (check_kind='rule' AND coalesce(submitted->>'verdict','') NOT IN ('통과','실패','판정불가'))
      OR (check_kind='human' AND submitted->>'verdict' IS DISTINCT FROM '사람확인')
      OR jsonb_typeof(submitted->'samples') IS DISTINCT FROM 'array' OR jsonb_array_length(submitted->'samples')>100
      OR length(coalesce(submitted->>'evidence',''))>10000 THEN
      RAISE EXCEPTION 'Invalid criterion verdict' USING ERRCODE='22023';
    END IF;
    canonical:=canonical||jsonb_build_array(criterion||jsonb_build_object('kind',check_kind,'is_required_safety',safety,
      'verdict',submitted->>'verdict','evidence',submitted->>'evidence','samples',submitted->'samples'));
  END LOOP;
  SELECT count(*) FILTER(WHERE value->>'kind'='rule'),count(*) FILTER(WHERE value->>'kind'='rule' AND value->>'verdict'='통과'),
    count(*) FILTER(WHERE value->>'kind'='rule' AND value->>'verdict'='실패'),
    count(*) FILTER(WHERE value->>'kind'='rule' AND value->>'verdict'='실패' AND (value->>'is_required_safety')::boolean),
    count(*) FILTER(WHERE value->>'kind'='human'),count(*) FILTER(WHERE value->>'kind'='rule' AND value->>'verdict'='판정불가')
    INTO machine,passed,failed,safety_failed,human_needed,unjudged FROM jsonb_array_elements(canonical);
  overall:=CASE WHEN failed>0 THEN CASE WHEN safety_failed>0 THEN '차단' ELSE '조건부' END WHEN unjudged>0 THEN '조건부' ELSE '통과' END;
  claimed:=CASE WHEN p_round->>'claimed' IN ('통과','조건부','차단') THEN p_round->>'claimed' ELSE NULL END;
  EXECUTE format('SELECT coalesce(max(seq),0)+1 FROM %I.beta_round WHERE application_id=$1',target) INTO seq USING p_application;
  round_id:='bta_' || md5(scope || ':' || p_request_id || ':' || p_application);
  EXECUTE format('INSERT INTO %I.beta_round(id,application_id,seq,build_run_id,overall,total,passed,failed,safety_failed,human_needed,duration_ms,fixed_what,note)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',target)
    USING round_id,p_application,seq,nullif(p_round->>'build_run_id',''),overall,total,passed,failed,safety_failed,human_needed,
      (p_round->>'duration_ms')::bigint,nullif(left(p_round->>'fixed_what',10000),''),nullif(left(p_round->>'note',10000),'');
  FOR criterion IN SELECT value FROM jsonb_array_elements(canonical) LOOP
    EXECUTE format('INSERT INTO %I.beta_result(id,round_id,criterion_id,ord,body,check_key,check_kind,is_required_safety,verdict,evidence,samples_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',target)
      USING 'bres_'||md5(round_id||':'||(criterion->>'id')),round_id,criterion->>'id',(criterion->>'ord')::bigint,
        criterion->>'body',criterion->>'check_key',criterion->>'kind',CASE WHEN (criterion->>'is_required_safety')::boolean THEN 1 ELSE 0 END,
        criterion->>'verdict',criterion->>'evidence',(criterion->'samples')::text;
  END LOOP;
  IF overall='통과' THEN
    EXECUTE format('UPDATE %I.application SET status=''진행중'',updated_at=public.datetime(''now'') WHERE id=$1 AND status IN (''수용'',''진행중'')',target) USING p_application;
  END IF;
  IF overall='차단' THEN
    SELECT string_agg(value->>'body',' / ') INTO broken FROM jsonb_array_elements(canonical) WHERE value->>'verdict'='실패' AND (value->>'is_required_safety')::boolean;
    EXECUTE format('INSERT INTO %I.decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES($1,$2,''베타테스트'',''human'',$3,$4,$5,''beta_round'',$6)',target)
      USING 'dec_beta_block_'||md5(round_id),p_application,seq||'차 베타에서 배포를 막았다',
        '필수 안전 기준 '||safety_failed||'개가 깨졌다: '||broken,'필수 안전 기준은 하나만 깨져도 통과하지 못합니다.',round_id;
  END IF;
  IF claimed IS NOT NULL AND claimed<>overall THEN
    EXECUTE format('INSERT INTO %I.decision_log(id,application_id,stage,actor,title,what,why,link_kind,link_id) VALUES($1,$2,''베타테스트'',''human'',$3,$4,$5,''beta_round'',$6)',target)
      USING 'dec_beta_tally_'||md5(round_id),p_application,seq||'차 채점의 합격 판정을 다시 셌다',
        '보내온 판정은 "'||claimed||'"였지만 서버가 확인한 기준의 판정은 "'||overall||'"입니다.','합격 여부는 현재 확정 기준과 필수 안전 속성으로 서버에서 다시 계산합니다.',round_id;
  END IF;
  summary:=jsonb_build_object('total',total,'machineChecked',machine,'passed',passed,'failed',failed,'safetyFailed',safety_failed,
    'humanNeeded',human_needed,'unjudged',unjudged,'overall',overall,'durationMs',p_round->'duration_ms');
  response:=jsonb_build_object('status',201,'body',jsonb_build_object('ok',true,'round_id',round_id,'seq',seq,'overall',overall,'summary',summary,
    'overruled',CASE WHEN claimed<>overall THEN claimed ELSE NULL END));
  IF p_actor IS NULL THEN INSERT INTO ilson_private.mutation_receipts(scope,request_id,fingerprint,response) VALUES(target,p_request_id,p_fingerprint,response);
  ELSE PERFORM ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint,response); END IF;
  RETURN jsonb_build_object('response',response,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.ilson_record_beta_round(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.ilson_record_beta_round(text,text,text,text,text,jsonb) TO service_role;

ALTER FUNCTION public.ilson_workspace_open(text,jsonb) RENAME TO ilson_workspace_open_v11;
REVOKE ALL ON FUNCTION public.ilson_workspace_open_v11(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_workspace_open(p_token text,p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
  result:=public.ilson_workspace_open_v11(p_token,p_applications);
  IF result->>'created'='true' THEN PERFORM ilson_private.install_beta_rounds(public.ilson_workspace_schema(p_token)); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_workspace_open(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_open(text,jsonb) TO service_role;
ALTER FUNCTION public.ilson_readiness(text) RENAME TO ilson_readiness_v11;
REVOKE ALL ON FUNCTION public.ilson_readiness_v11(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text; migrated boolean; BEGIN
  result:=public.ilson_readiness_v11(p_token);
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  migrated:=(result->>'schemaReady')::boolean
    AND to_regprocedure('public.ilson_record_beta_round(text,text,text,text,text,jsonb)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=target AND table_name='application' AND column_name='beta_criteria_revision')
    AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=target AND c.relname='acceptance_criterion' AND t.tgname='beta_criteria_revision');
  RETURN result||jsonb_build_object('migration','0012','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
