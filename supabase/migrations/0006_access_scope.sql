-- Additive access isolation. Existing records with unknown ownership stay admin-only.
-- Run as the migration owner, never through the public application query RPC.
BEGIN;
SELECT pg_advisory_xact_lock(72413003);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ilson_scoped_executor') THEN
    CREATE ROLE ilson_scoped_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
  -- Supabase's migration owner is not a superuser. Even setting an already
  -- false SUPERUSER/BYPASSRLS attribute requires superuser privileges, so reject
  -- unsafe existing roles instead of attempting to change those attributes.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ilson_scoped_executor'
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe scoped executor role' USING ERRCODE='42501';
  END IF;
  ALTER ROLE ilson_scoped_executor NOLOGIN NOINHERIT;
  EXECUTE format('GRANT ilson_scoped_executor TO %I',current_user);
END $$;

DO $$ DECLARE target text; BEGIN
  FOR target IN SELECT 'public' UNION ALL SELECT schema_name FROM ilson_private.workspaces LOOP
    EXECUTE format('ALTER TABLE %I.override_actor ADD COLUMN departments_json text NOT NULL DEFAULT ''[]'', ADD COLUMN product_ids_json text NOT NULL DEFAULT ''[]''',target);
    EXECUTE format('ALTER TABLE %I.application ADD COLUMN owner_email text',target);
    EXECUTE format('ALTER TABLE %I.override_event ADD COLUMN reporter_email text',target);
    EXECUTE format('ALTER TABLE %I.issue_cluster ADD COLUMN scope_product_id text, ADD COLUMN created_by_email text',target);
    EXECUTE format('ALTER TABLE %I.override_audit ADD COLUMN actor_email text',target);
    EXECUTE format('ALTER TABLE %I.override_ai_call ADD COLUMN actor_email text',target);
    EXECUTE format('ALTER TABLE %I.override_integration ADD COLUMN owner_email text',target);
    EXECUTE format('ALTER TABLE %I.sku_alias ADD COLUMN owner_email text',target);
    EXECUTE format('UPDATE %I.issue_cluster c SET scope_product_id=s.product_id FROM (SELECT cluster_id,min(product_id) product_id FROM %I.override_event GROUP BY cluster_id HAVING count(DISTINCT product_id)=1) s WHERE c.id=s.cluster_id',target,target);
  END LOOP;
END $$;
CREATE INDEX ON public.application(owner_email);
CREATE INDEX ON public.override_event(reporter_email);
CREATE INDEX ON public.issue_cluster(scope_product_id);
CREATE INDEX ON ilson_private.mutation_receipts(request_id,scope);

CREATE FUNCTION ilson_private.scope_valid_list(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(value::jsonb)='array' THEN
    jsonb_array_length(value::jsonb)<=200 AND NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(value::jsonb) item WHERE jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 200)
    ELSE false END
$$;
ALTER TABLE public.override_actor ADD CONSTRAINT actor_departments_valid CHECK(ilson_private.scope_valid_list(departments_json)),
  ADD CONSTRAINT actor_products_valid CHECK(ilson_private.scope_valid_list(product_ids_json));

-- Helpers run as their migration owner to avoid recursive RLS. They return only
-- predicates/identity, never unfiltered business rows. All names are qualified.
CREATE FUNCTION ilson_private.scope_actor() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT to_jsonb(a) FROM public.override_actor a
  WHERE a.email=current_setting('ilson.actor_email',true) AND a.active=1
$$;
CREATE FUNCTION ilson_private.scope_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce(ilson_private.scope_actor()->>'role' IN ('audit','executive'),false)
$$;
CREATE FUNCTION ilson_private.scope_can_product(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT ilson_private.scope_is_admin() OR coalesce((
    SELECT a->>'role'<>'reviewer' AND ((a->>'product_ids_json')::jsonb ? p.id OR (a->>'departments_json')::jsonb ? p.owner_team)
    FROM public.override_product p CROSS JOIN LATERAL (SELECT ilson_private.scope_actor() a) who WHERE p.id=p_id),false)
$$;
CREATE FUNCTION ilson_private.scope_can_application(p_id text,p_dept text,p_owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT ilson_private.scope_is_admin() OR coalesce(p_owner IS NOT NULL AND (
    p_owner=ilson_private.scope_actor()->>'email' OR (
      ilson_private.scope_actor()->>'role'<>'reviewer' AND (
        (ilson_private.scope_actor()->>'departments_json')::jsonb ? p_dept OR EXISTS (
          SELECT 1 FROM public.application_product_link l WHERE l.application_id=p_id AND ilson_private.scope_can_product(l.product_id)
        )
      )
    )
  ),false)
$$;
CREATE FUNCTION ilson_private.scope_can_app(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT ilson_private.scope_can_application(id,dept,owner_email) FROM public.application WHERE id=p_id),false)
$$;
CREATE FUNCTION ilson_private.scope_can_event(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT ilson_private.scope_is_admin() OR coalesce((SELECT reporter_email IS NOT NULL AND
    (reporter_email=ilson_private.scope_actor()->>'email' OR ilson_private.scope_can_product(product_id)) FROM public.override_event WHERE id=p_id),false)
$$;
CREATE FUNCTION ilson_private.scope_can_cluster(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT ilson_private.scope_is_admin() OR coalesce((SELECT
    created_by_email=ilson_private.scope_actor()->>'email' OR ilson_private.scope_can_product(scope_product_id)
    FROM public.issue_cluster WHERE id=p_id),false)
$$;
CREATE FUNCTION ilson_private.scope_can_experiment(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT ilson_private.scope_can_cluster(cluster_id) FROM public.change_experiment WHERE id=p_id),false)
$$;
CREATE FUNCTION ilson_private.scope_cluster_totals(p_id text)
RETURNS TABLE(n bigint,customer double precision,cost double precision,regulation double precision,first_seen text,last_seen text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT ilson_private.scope_can_cluster(p_id) THEN
    RAISE EXCEPTION 'Unknown or inaccessible issue' USING ERRCODE='42501';
  END IF;
  -- A reviewer sees only their own events, but must not overwrite shared issue
  -- totals with that partial view. Return aggregate numbers, never source rows.
  RETURN QUERY SELECT count(*),avg(e.customer_impact_score),sum(e.operations_cost_krw),
    max(e.regulatory_risk_score),min(e.occurred_at),max(e.occurred_at)
    FROM public.override_event e WHERE e.cluster_id=p_id AND e.is_override=1 AND e.validity='valid';
END $$;
CREATE FUNCTION ilson_private.scope_reporter_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to('{"identity":'||to_jsonb(ilson_private.scope_actor()->>'email')::text||'}','UTF8')),'hex')
$$;

-- Validate every RPC, including cached responses. Scope changes invalidate the
-- actor receipt namespace without changing or deleting historical receipts.
CREATE FUNCTION ilson_private.scope_begin(p_actor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record;
BEGIN
  SELECT email,role,departments_json,product_ids_json,updated_at INTO a FROM public.override_actor
    WHERE email=p_actor AND active=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inactive or unknown actor' USING ERRCODE='28000'; END IF;
  PERFORM set_config('ilson.actor_email',a.email,true);
  RETURN 'actor:'||a.email||':'||encode(sha256(convert_to(jsonb_build_array(a.role,a.departments_json,a.product_ids_json,a.updated_at)::text,'UTF8')),'hex');
END $$;

-- Stamp ownership at the database boundary as well as the API. Clients cannot
-- claim another reporter; pre-existing unknown owners are never guessed.
CREATE FUNCTION ilson_private.scope_stamp_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE identity text; before_value text; after_value text;
BEGIN
  IF current_user<>'ilson_scoped_executor' THEN RETURN NEW; END IF;
  identity:=current_setting('ilson.actor_email',true);
  IF identity IS NULL OR ilson_private.scope_actor() IS NULL THEN RAISE EXCEPTION 'Unknown actor' USING ERRCODE='28000'; END IF;
  after_value:=to_jsonb(NEW)->>TG_ARGV[0];
  IF TG_OP='INSERT' THEN
    IF after_value IS NOT NULL AND after_value<>identity THEN RAISE EXCEPTION 'Invalid record owner' USING ERRCODE='42501'; END IF;
    NEW:=jsonb_populate_record(NEW,jsonb_build_object(TG_ARGV[0],identity));
  ELSE
    before_value:=to_jsonb(OLD)->>TG_ARGV[0];
    IF before_value IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'Record ownership cannot be changed here' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.application FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('owner_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.override_event FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('reporter_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.issue_cluster FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('created_by_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.override_audit FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('actor_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.override_ai_call FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('actor_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.override_integration FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('owner_email');
CREATE TRIGGER scope_owner BEFORE INSERT OR UPDATE ON public.sku_alias FOR EACH ROW EXECUTE FUNCTION ilson_private.scope_stamp_owner('owner_email');

GRANT USAGE ON SCHEMA public,ilson_private TO ilson_scoped_executor;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ilson_scoped_executor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.datetime(text,text),public.julianday(text),public.group_concat(text),public.ilson_concat(text,text) TO ilson_scoped_executor;

-- Direct rows and their children use the same predicate. Unknown future tables
-- remain denied by RLS until a migration gives them an explicit policy.
DO $$ DECLARE t text; condition text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    condition:=NULL;
    IF t='application' THEN condition:='ilson_private.scope_can_application(id,dept,owner_email)';
    ELSIF t IN ('meeting','requirement','requirement_conflict','acceptance_criterion','baseline','build_run','beta_round','beta_feedback','decision_log','handover','manual','manual_faq','outcome','outcome_challenge','review','shadow_run','stakeholder','tool_use') THEN
      condition:='ilson_private.scope_can_app(application_id)';
    ELSIF t='beta_result' THEN condition:='EXISTS(SELECT 1 FROM public.beta_round b WHERE b.id=round_id AND ilson_private.scope_can_app(b.application_id))';
    ELSIF t IN ('build_row','build_quarantine') THEN condition:='EXISTS(SELECT 1 FROM public.build_run b WHERE b.id=run_id AND ilson_private.scope_can_app(b.application_id))';
    ELSIF t='override_product' THEN condition:='ilson_private.scope_can_product(id)';
    ELSIF t='override_event' THEN condition:='reporter_email IS NOT NULL AND (reporter_email=ilson_private.scope_actor()->>''email'' OR ilson_private.scope_can_product(product_id))';
    ELSIF t='issue_cluster' THEN condition:='created_by_email=ilson_private.scope_actor()->>''email'' OR ilson_private.scope_can_product(scope_product_id)';
    ELSIF t='change_experiment' THEN condition:='ilson_private.scope_can_cluster(cluster_id)';
    ELSIF t IN ('experiment_run','override_decision_record') THEN condition:='ilson_private.scope_can_experiment(experiment_id)';
    ELSIF t IN ('override_volume','quality_sample_batch') THEN condition:='ilson_private.scope_can_product(product_id)';
    ELSIF t='application_product_link' THEN condition:='ilson_private.scope_can_app(application_id) AND ilson_private.scope_can_product(product_id)';
    ELSIF t='field_feedback_case' THEN condition:='ilson_private.scope_can_event(event_id)';
    ELSIF t='field_feedback_update' THEN condition:='EXISTS(SELECT 1 FROM public.field_feedback_case c WHERE c.id=case_id AND ilson_private.scope_can_event(c.event_id))';
    ELSIF t='field_feedback_receipt' THEN condition:='EXISTS(SELECT 1 FROM public.field_feedback_update u JOIN public.field_feedback_case c ON c.id=u.case_id WHERE u.id=update_id AND ilson_private.scope_can_event(c.event_id))';
    ELSIF t='quality_sample_item' THEN condition:='ilson_private.scope_can_event(event_id)';
    ELSIF t='tool_nonuse_report' THEN condition:='reporter_key=ilson_private.scope_reporter_key() OR ilson_private.scope_can_product(product_id)';
    ELSIF t IN ('override_integration','sku_alias') THEN condition:='owner_email=ilson_private.scope_actor()->>''email''';
    ELSIF t='override_ai_call' THEN condition:='actor_email=ilson_private.scope_actor()->>''email''';
    ELSIF t='override_actor' THEN condition:='email=ilson_private.scope_actor()->>''email''';
    END IF;
    IF t='override_product' THEN
      CREATE POLICY actor_product_read ON public.override_product FOR SELECT TO ilson_scoped_executor USING (
        ilson_private.scope_is_admin() OR (ilson_private.scope_actor()->>'role'<>'reviewer' AND ((ilson_private.scope_actor()->>'product_ids_json')::jsonb ? id OR (ilson_private.scope_actor()->>'departments_json')::jsonb ? owner_team))
        OR EXISTS(SELECT 1 FROM public.override_event e WHERE e.product_id=override_product.id AND e.reporter_email=ilson_private.scope_actor()->>'email')
        OR EXISTS(SELECT 1 FROM public.tool_nonuse_report n WHERE n.product_id=override_product.id AND n.reporter_key=ilson_private.scope_reporter_key()));
      CREATE POLICY actor_product_insert ON public.override_product FOR INSERT TO ilson_scoped_executor WITH CHECK (
        ilson_private.scope_is_admin() OR (ilson_private.scope_actor()->>'role'<>'reviewer' AND (ilson_private.scope_actor()->>'departments_json')::jsonb ? owner_team));
      CREATE POLICY actor_product_update ON public.override_product FOR UPDATE TO ilson_scoped_executor USING(ilson_private.scope_can_product(id)) WITH CHECK(
        ilson_private.scope_is_admin() OR (ilson_private.scope_actor()->>'role'<>'reviewer' AND ((ilson_private.scope_actor()->>'product_ids_json')::jsonb ? id OR (ilson_private.scope_actor()->>'departments_json')::jsonb ? owner_team)));
    ELSIF t='override_audit' THEN
      CREATE POLICY actor_audit_read ON public.override_audit FOR SELECT TO ilson_scoped_executor
        USING(ilson_private.scope_is_admin() OR actor_email=ilson_private.scope_actor()->>'email');
      CREATE POLICY actor_audit_insert ON public.override_audit FOR INSERT TO ilson_scoped_executor
        WITH CHECK(actor_email=ilson_private.scope_actor()->>'email');
    ELSIF t='override_actor' THEN
      CREATE POLICY actor_identity_read ON public.override_actor FOR SELECT TO ilson_scoped_executor
        USING(ilson_private.scope_is_admin() OR email=ilson_private.scope_actor()->>'email');
      CREATE POLICY actor_identity_insert ON public.override_actor FOR INSERT TO ilson_scoped_executor WITH CHECK(ilson_private.scope_is_admin());
      CREATE POLICY actor_identity_update ON public.override_actor FOR UPDATE TO ilson_scoped_executor USING(ilson_private.scope_is_admin()) WITH CHECK(ilson_private.scope_is_admin());
    ELSIF condition IS NOT NULL THEN
      EXECUTE format('CREATE POLICY actor_scope ON public.%I TO ilson_scoped_executor USING (ilson_private.scope_is_admin() OR (%s)) WITH CHECK (ilson_private.scope_is_admin() OR (%s))',t,condition,condition);
    END IF;
  END LOOP;
END $$;

-- SECURITY DEFINER uses an explicitly non-owner, non-BYPASSRLS role. Do not call
-- the older unrestricted SECURITY DEFINER commit from any of these functions.
CREATE FUNCTION public.ilson_actor_query(p_actor text,p_sql text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE query text:=trim(p_sql); rows_json jsonb; changed bigint;
BEGIN
  PERFORM ilson_private.scope_begin(p_actor);
  PERFORM set_config('search_path','public,pg_catalog',true);
  IF query ~* '^(SELECT|WITH)\M' THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb),count(*) FROM (%s) q',query) INTO rows_json,changed;
  ELSIF query ~* '^(INSERT|UPDATE|DELETE)\M' THEN
    EXECUTE format('WITH changed AS (%s RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb),count(*) FROM changed q',query) INTO rows_json,changed;
  ELSE RAISE EXCEPTION 'Unsupported scoped operation' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('rows',rows_json,'rowCount',changed,'last_row_id',NULL);
END $$;
CREATE FUNCTION public.ilson_actor_batch(p_actor text,p_statements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE statement text; output jsonb:='[]';
BEGIN
  PERFORM ilson_private.scope_begin(p_actor);
  IF jsonb_typeof(p_statements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_statements)>1000 THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
  FOR statement IN SELECT jsonb_array_elements_text(p_statements) LOOP
    output:=output||jsonb_build_array(public.ilson_actor_query(p_actor,statement));
  END LOOP;
  RETURN output;
END $$;

-- Receipt access is mediated by a private helper, not a grant to the receipts
-- table. The execution role cannot use arbitrary SELECT to inspect old replies.
CREATE FUNCTION ilson_private.scope_receipt(p_actor text,p_request_id text,p_fingerprint text,p_response jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; prior record;
BEGIN
  target:=ilson_private.scope_begin(p_actor);
  IF p_request_id IS NULL OR p_request_id !~ '^[a-zA-Z0-9_-]{16,100}$' OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid mutation identity' USING ERRCODE='22023';
  END IF;
  SELECT * INTO prior FROM ilson_private.mutation_receipts WHERE scope=target AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'Request identity conflict' USING ERRCODE='40001'; END IF;
    RETURN prior.response;
  END IF;
  -- Scope changes must neither expose the old response nor make an already
  -- used external idempotency key look fresh. A fresh user request is required;
  -- an uncertain old external side effect must be reconciled by an operator.
  IF EXISTS(SELECT 1 FROM ilson_private.mutation_receipts
    WHERE request_id=p_request_id AND scope<>target AND starts_with(scope,'actor:'||p_actor||':')) THEN
    RAISE EXCEPTION 'Request belongs to an earlier authorization scope' USING ERRCODE='40001';
  END IF;
  IF p_response IS NOT NULL THEN
    INSERT INTO ilson_private.mutation_receipts(scope,request_id,fingerprint,response) VALUES(target,p_request_id,p_fingerprint,p_response);
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION public.ilson_actor_receipt(p_actor text,p_request_id text,p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RETURN ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint); END $$;
CREATE FUNCTION public.ilson_actor_commit(p_actor text,p_request_id text,p_fingerprint text,p_reads jsonb,p_writes jsonb,p_response jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE prior jsonb; item jsonb; actual jsonb; statement text;
BEGIN
  PERFORM ilson_private.scope_begin(p_actor);
  -- Shared lock with legacy production mutations; scoped actors may touch the same row.
  PERFORM pg_advisory_xact_lock(hashtextextended('public:override-mutation',0));
  prior:=ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint);
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('response',prior,'replayed',true); END IF;
  IF jsonb_typeof(p_reads) IS DISTINCT FROM 'array' OR jsonb_typeof(p_writes) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_reads)>100 OR jsonb_array_length(p_writes)>1000 OR jsonb_typeof(p_response) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid mutation' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_reads) LOOP
    actual:=public.ilson_actor_query(p_actor,item->>'sql');
    IF actual->'rows' IS DISTINCT FROM item->'rows' THEN RAISE EXCEPTION 'Data changed; reload before retrying' USING ERRCODE='40001'; END IF;
  END LOOP;
  FOR statement IN SELECT jsonb_array_elements_text(p_writes) LOOP PERFORM public.ilson_actor_query(p_actor,statement); END LOOP;
  PERFORM ilson_private.scope_receipt(p_actor,p_request_id,p_fingerprint,p_response);
  RETURN jsonb_build_object('response',p_response,'replayed',false);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ilson_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION ilson_private.scope_valid_list(text),ilson_private.scope_actor(),ilson_private.scope_is_admin(),
  ilson_private.scope_can_product(text),ilson_private.scope_can_application(text,text,text),ilson_private.scope_can_app(text),
  ilson_private.scope_can_event(text),ilson_private.scope_can_cluster(text),ilson_private.scope_can_experiment(text),ilson_private.scope_cluster_totals(text),
  ilson_private.scope_reporter_key(),ilson_private.scope_begin(text),ilson_private.scope_stamp_owner(),
  ilson_private.scope_receipt(text,text,text,jsonb) TO ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION ilson_private.scope_valid_list(text) TO service_role;
-- Apply ACLs while still owning these functions. A NOINHERIT migration owner
-- cannot revoke a function's default PUBLIC grant after transferring ownership.
REVOKE ALL ON FUNCTION public.ilson_actor_query(text,text),public.ilson_actor_batch(text,jsonb),public.ilson_actor_receipt(text,text,text),public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_actor_query(text,text),public.ilson_actor_batch(text,jsonb),public.ilson_actor_receipt(text,text,text),public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb) TO service_role;
-- A non-superuser can transfer ownership only when the new owner can CREATE
-- in the function's schema. This temporary grant and its revocation are in the
-- same transaction: the runtime role never retains schema creation privileges.
GRANT CREATE ON SCHEMA public TO ilson_scoped_executor;
ALTER FUNCTION public.ilson_actor_query(text,text) OWNER TO ilson_scoped_executor;
ALTER FUNCTION public.ilson_actor_batch(text,jsonb) OWNER TO ilson_scoped_executor;
ALTER FUNCTION public.ilson_actor_receipt(text,text,text) OWNER TO ilson_scoped_executor;
ALTER FUNCTION public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb) OWNER TO ilson_scoped_executor;
REVOKE CREATE ON SCHEMA public FROM ilson_scoped_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
