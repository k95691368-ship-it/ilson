-- An administrator explicitly verifies or transfers one application's owner.
-- General scoped UPDATEs still cannot change ownership; no owner is inferred.
BEGIN;
SELECT pg_advisory_xact_lock(72413010);

CREATE FUNCTION public.ilson_assign_application_owner(p_actor text,p_application text,p_expected_owner text,
  p_new_owner text,p_reason text,p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE administrator public.override_actor%ROWTYPE; target_actor public.override_actor%ROWTYPE;
  application_row public.application%ROWTYPE; fingerprint text; prior jsonb; result jsonb; audit_id text;
BEGIN
  PERFORM ilson_private.scope_begin(p_actor);
  PERFORM pg_advisory_xact_lock(hashtextextended('public:override-mutation',0));
  SELECT * INTO administrator FROM public.override_actor a WHERE a.email=p_actor AND a.active=1 AND a.role IN ('audit','executive') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE='42501'; END IF;
  IF p_application IS NULL OR length(p_application) NOT BETWEEN 1 AND 100
    OR p_new_owner IS NULL OR p_new_owner<>lower(trim(p_new_owner)) OR length(p_new_owner) NOT BETWEEN 3 AND 240
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 1000
    OR (p_expected_owner IS NOT NULL AND length(p_expected_owner) NOT BETWEEN 3 AND 240) THEN
    RAISE EXCEPTION 'Explicit owner and verification reason required' USING ERRCODE='22023';
  END IF;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('action','assign_application_owner','application',p_application,
    'expected',p_expected_owner,'owner',p_new_owner,'reason',trim(p_reason))::text,'UTF8')),'hex');
  prior := ilson_private.scope_receipt(p_actor,p_request_id,fingerprint);
  IF prior IS NOT NULL THEN RETURN prior->'body' || jsonb_build_object('replayed',true); END IF;
  SELECT * INTO application_row FROM public.application a WHERE a.id=p_application FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown application' USING ERRCODE='P0002'; END IF;
  IF application_row.owner_email IS DISTINCT FROM p_expected_owner THEN
    RAISE EXCEPTION 'Application owner changed; reload before confirming' USING ERRCODE='40001';
  END IF;
  IF application_row.owner_email IS NOT DISTINCT FROM p_new_owner THEN
    RAISE EXCEPTION 'The selected owner is already assigned' USING ERRCODE='40001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ilson_private.participation_departments d WHERE d.id=application_row.dept) THEN
    RAISE EXCEPTION 'The application must belong to a registered department' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target_actor FROM public.override_actor a WHERE a.email=p_new_owner AND a.active=1 FOR SHARE;
  IF NOT FOUND OR NOT ((target_actor.departments_json)::jsonb ? application_row.dept) THEN
    RAISE EXCEPTION 'Choose an active account assigned to the application department' USING ERRCODE='23514';
  END IF;
  UPDATE public.application SET owner_email=p_new_owner,updated_at=public.datetime('now') WHERE id=p_application;
  audit_id := 'ola_owner_' || md5(p_actor || ':' || p_request_id);
  INSERT INTO public.override_audit(id,actor_label,actor_role,action,entity_kind,entity_id,detail_json,actor_email)
    VALUES(audit_id,administrator.display_name,administrator.role,'assign_application_owner','application',p_application,
      jsonb_build_object('previous_owner_email',application_row.owner_email,'new_owner_email',p_new_owner,
        'department',application_row.dept,'reason',trim(p_reason),'request_id',p_request_id)::text,p_actor);
  result := jsonb_build_object('ok',true,'application_id',p_application,'owner_email',p_new_owner,'audit_id',audit_id,'replayed',false);
  PERFORM ilson_private.scope_receipt(p_actor,p_request_id,fingerprint,jsonb_build_object('status',200,'body',result));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_assign_application_owner(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.ilson_assign_application_owner(text,text,text,text,text,text) TO service_role;

ALTER FUNCTION public.ilson_readiness(text) RENAME TO ilson_readiness_v9;
REVOKE ALL ON FUNCTION public.ilson_readiness_v9(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; migrated boolean;
BEGIN
  result := public.ilson_readiness_v9(p_token);
  migrated := (result->>'schemaReady')::boolean
    AND to_regprocedure('public.ilson_assign_application_owner(text,text,text,text,text,text)') IS NOT NULL;
  RETURN result || jsonb_build_object('migration','0010','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
