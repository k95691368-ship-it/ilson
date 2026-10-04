-- Application creation, its success quota, and its replay receipt commit once.
-- Additive ILSON-only change. Existing data, schema/role ACLs and Auth are untouched.
BEGIN;
SELECT pg_advisory_xact_lock(72413014);

CREATE FUNCTION public.ilson_record_application(p_token text,p_actor text,p_bucket text,
  p_request_id text,p_fingerprint text,p_application jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE target text; receipt_scope text; prior jsonb; response jsonb; quota_ticket bigint;
  field text; max_length integer; required boolean; submitted jsonb; applicant text;
BEGIN
  IF p_actor IS NOT NULL AND p_token IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting identity scopes' USING ERRCODE='22023';
  END IF;
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  receipt_scope:=CASE WHEN p_actor IS NULL THEN target ELSE ilson_private.scope_begin(p_actor) END;
  -- Use the existing mutation lock order, then the existing per-quota lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(target || ':override-mutation',0));
  prior:=CASE WHEN p_actor IS NULL THEN public.ilson_mutation_receipt(p_token,p_request_id,p_fingerprint)
    ELSE ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint) END;
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('response',prior,'replayed',true); END IF;

  IF p_bucket IS NULL OR length(p_bucket)>256 OR p_bucket !~ '^apply:.+' OR p_bucket ~ '[[:cntrl:]]'
    OR jsonb_typeof(p_application) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid application payload' USING ERRCODE='22023';
  END IF;
  FOR field,max_length,required IN SELECT * FROM (VALUES
    ('id',100,true),('ticket_no',20,true),('dept',40,true),('applicant_label',40,true),
    ('contact',80,false),('title',80,true),('bottleneck',1000,false),('problem',1500,false),
    ('wish',1000,false),('current_frequency',30,false),('impact_if_wrong',600,false),('source_ip_hash',32,false)
  ) AS fields(name,max_length,required) LOOP
    submitted:=p_application->field;
    IF (required AND (jsonb_typeof(submitted) IS DISTINCT FROM 'string' OR length(btrim(p_application->>field))=0))
      OR (submitted IS NOT NULL AND submitted<>'null'::jsonb AND (jsonb_typeof(submitted)<>'string' OR length(p_application->>field)>max_length)) THEN
      RAISE EXCEPTION 'Invalid application field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_application->>'id' !~ '^app_[a-zA-Z0-9_-]{16,90}$'
    OR p_application->>'ticket_no' !~ '^AX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$'
    OR p_application->>'dept' NOT IN ('재무','마케팅','영업','SCM','운영','인사','기타')
    OR (p_application->>'current_frequency' IS NOT NULL AND p_application->>'current_frequency' NOT IN ('하루 여러 번','매일','주 2~3회','주 1회','격주','매월','분기','비정기'))
    OR (p_application->>'source_ip_hash' IS NOT NULL AND p_application->>'source_ip_hash' !~ '^[a-f0-9]{32}$') THEN
    RAISE EXCEPTION 'Invalid application fields' USING ERRCODE='22023';
  END IF;
  FOR field,max_length IN SELECT * FROM (VALUES ('current_minutes',7200),('current_people',500)) AS fields(name,maximum) LOOP
    submitted:=p_application->field;
    IF submitted IS NOT NULL AND submitted<>'null'::jsonb THEN
      IF jsonb_typeof(submitted)<>'number' OR (p_application->>field) !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'Invalid application measurement' USING ERRCODE='22023';
      END IF;
      IF (p_application->>field)::integer NOT BETWEEN 1 AND max_length THEN
        RAISE EXCEPTION 'Invalid application measurement' USING ERRCODE='22023';
      END IF;
    END IF;
  END LOOP;
  applicant:=p_application->>'applicant_label';
  IF p_actor IS NOT NULL THEN
    -- Ownership and attribution never come from the form body.
    SELECT display_name INTO applicant FROM public.override_actor WHERE email=p_actor AND active=1 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active applicant required' USING ERRCODE='28000'; END IF;
  END IF;

  quota_ticket:=CASE WHEN p_actor IS NULL THEN public.ilson_claim_rate_limit(p_token,p_bucket,12,3600)
    ELSE public.ilson_actor_claim_rate_limit(p_actor,p_bucket,12,3600) END;
  IF quota_ticket=0 THEN
    RETURN jsonb_build_object('response',jsonb_build_object('status',429,'body',jsonb_build_object(
      'error','신청은 시간당 12건까지 받습니다. 잠시 후 같은 내용으로 다시 시도해주세요.','notSaved',true)),'replayed',false);
  END IF;
  EXECUTE format('INSERT INTO %I.application(id,ticket_no,dept,applicant_label,contact,title,bottleneck,problem,wish,
      current_minutes,current_people,current_frequency,impact_if_wrong,status,source_ip_hash,owner_email)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,''접수'',$14,$15)',target)
    USING p_application->>'id',p_application->>'ticket_no',p_application->>'dept',applicant,
      p_application->>'contact',p_application->>'title',coalesce(p_application->>'bottleneck',''),coalesce(p_application->>'problem',''),
      p_application->>'wish',(p_application->>'current_minutes')::bigint,(p_application->>'current_people')::bigint,
      p_application->>'current_frequency',p_application->>'impact_if_wrong',p_application->>'source_ip_hash',p_actor;
  response:=jsonb_build_object('status',201,'body',jsonb_build_object('id',p_application->>'id','ticket_no',p_application->>'ticket_no','message','접수됐습니다.'));
  IF p_actor IS NULL THEN
    INSERT INTO ilson_private.mutation_receipts(scope,request_id,fingerprint,response) VALUES(receipt_scope,p_request_id,p_fingerprint,response);
  ELSE
    PERFORM ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint,response);
  END IF;
  RETURN jsonb_build_object('response',response,'replayed',false);
END $$;
-- Only this NEW function loses the default public execute privilege. Do not
-- change any existing function, role, schema or default ACL. Production requires
-- the user's separately coordinated approval for this narrowly scoped ACL.
REVOKE ALL ON FUNCTION public.ilson_record_application(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.ilson_record_application(text,text,text,text,text,jsonb) TO service_role;
-- A shared project's default privileges may also grant unrelated roles. Never
-- revoke their rights implicitly: fail and coordinate instead of publishing an
-- unexpectedly callable SECURITY DEFINER entry point.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.ilson_record_application(text,text,text,text,text,jsonb)'::regprocedure
      AND acl.privilege_type='EXECUTE' AND acl.grantee NOT IN (p.proowner,'service_role'::regrole)) THEN
    RAISE EXCEPTION 'Unexpected inherited execute grant on new ILSON application RPC; coordinate before applying' USING ERRCODE='42501';
  END IF;
END $$;

-- Replace in place so ilson_readiness keeps its existing owner and ACL. Retain
-- every 0013 review-revision check, including the three table triggers.
CREATE OR REPLACE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text; migrated boolean; BEGIN
  result:=public.ilson_readiness_v12(p_token);
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  migrated:=(result->>'schemaReady')::boolean
    AND to_regprocedure('public.ilson_lock_review_revision(text,bigint)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=target AND table_name='application' AND column_name='review_revision')
    AND 3=(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=target AND (c.relname,t.tgname) IN (('application','review_status_revision'),('review','review_evidence_revision'),('decision_log','review_resubmission_revision')))
    AND to_regprocedure('public.ilson_record_application(text,text,text,text,text,jsonb)') IS NOT NULL;
  RETURN result||jsonb_build_object('migration','0014','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
