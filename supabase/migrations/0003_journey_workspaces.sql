-- Private, expiring demonstration schemas. Never copy production rows.
BEGIN;
CREATE TABLE public.application_product_link (
  application_id text NOT NULL REFERENCES public.application(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.override_product(id) ON DELETE CASCADE,
  linked_at text NOT NULL DEFAULT public.datetime('now'),
  PRIMARY KEY (application_id, product_id)
);
ALTER TABLE public.application_product_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_product_link FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_product_link TO service_role;

CREATE SCHEMA ilson_private;
REVOKE ALL ON SCHEMA ilson_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE ilson_private.workspaces (
  token_hash text PRIMARY KEY,
  schema_name text UNIQUE NOT NULL CHECK (schema_name ~ '^ilson_demo_[a-f0-9]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

CREATE FUNCTION public.ilson_workspace_schema(p_token text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ilson_private AS $$
DECLARE target text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid workspace' USING ERRCODE='28000';
  END IF;
  SELECT schema_name INTO target FROM ilson_private.workspaces
    WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND expires_at > now()
    FOR SHARE;
  IF target IS NULL THEN RAISE EXCEPTION 'Expired workspace' USING ERRCODE='28000'; END IF;
  RETURN target;
END $$;

CREATE FUNCTION public.ilson_workspace_query(p_token text, p_sql text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET statement_timeout = '20s' AS $$
DECLARE target text; query text := trim(p_sql); rows_json jsonb; changed bigint; last_id bigint;
BEGIN
  target := public.ilson_workspace_schema(p_token);
  -- No public fallback: missing demo tables must never resolve to production tables.
  PERFORM set_config('search_path', format('%I, pg_catalog', target), true);
  IF query ~* '^(SELECT|WITH)\M' THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*) FROM (%s) q', query) INTO rows_json, changed;
  ELSIF query ~* '^(INSERT|UPDATE|DELETE)\M' THEN
    EXECUTE format('WITH changed AS (%s RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*) FROM changed q', query) INTO rows_json, changed;
    IF query ~* '^INSERT\s+INTO\s+rate_limit_hits\M' AND changed > 0 THEN last_id := (rows_json->0->>'id')::bigint; END IF;
  ELSE RAISE EXCEPTION 'Unsupported database operation' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('rows', rows_json, 'rowCount', changed, 'last_row_id', last_id);
END $$;

CREATE FUNCTION public.ilson_workspace_batch(p_token text, p_statements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE statement text; output jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_statements) IS DISTINCT FROM 'array' OR jsonb_array_length(p_statements) > 1000 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
  FOR statement IN SELECT jsonb_array_elements_text(p_statements) LOOP
    output := output || jsonb_build_array(public.ilson_workspace_query(p_token, statement));
  END LOOP;
  RETURN output;
END $$;

CREATE FUNCTION public.ilson_workspace_open(p_token text, p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET statement_timeout = '25s' AS $$
DECLARE target text; hashed text; t text; fk record; row_data jsonb; expired record;
  tables text[] := ARRAY['application','meeting','requirement','requirement_conflict','stakeholder',
    'review','decision_log','acceptance_criterion','shadow_run','baseline','build_run','build_row',
    'build_quarantine','beta_round','beta_result','beta_feedback','manual','manual_faq','handover',
    'tool_use','outcome','outcome_challenge','sku_alias','rate_limit_hits','override_product',
    'issue_cluster','override_event','change_experiment','experiment_run','override_decision_record',
    'override_volume','override_integration','override_actor','override_audit','override_ai_call','application_product_link'];
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid workspace' USING ERRCODE='28000'; END IF;
  hashed := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  -- Serialize creation so the bounded capacity and duplicate requests are safe.
  PERFORM pg_advisory_xact_lock(72413003);
  SELECT schema_name INTO target FROM ilson_private.workspaces WHERE token_hash=hashed AND expires_at>now();
  IF target IS NOT NULL THEN RETURN jsonb_build_object('created',false,'expiresAt',(SELECT expires_at FROM ilson_private.workspaces WHERE token_hash=hashed)); END IF;
  -- Opportunistic bounded expiry cleanup, only schemas recorded in our private registry.
  FOR expired IN SELECT * FROM ilson_private.workspaces WHERE expires_at<=now() ORDER BY expires_at LIMIT 8 FOR UPDATE LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', expired.schema_name);
    DELETE FROM ilson_private.workspaces WHERE token_hash=expired.token_hash;
  END LOOP;
  IF (SELECT count(*) FROM ilson_private.workspaces)>=128 THEN RAISE EXCEPTION 'Workspace capacity reached' USING ERRCODE='53300'; END IF;
  target := 'ilson_demo_' || substring(hashed,1,32);
  EXECUTE format('CREATE SCHEMA %I', target);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', target);
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)',target,t,t);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',target,t);
  END LOOP;
  -- LIKE copies checks/identities/indexes but not foreign keys. Restore them locally.
  FOR fk IN SELECT c.conname, c.conrelid::regclass::text AS source, r.relname AS table_name,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='f' AND n.nspname='public' AND r.relname=ANY(tables) LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',target,fk.table_name,fk.conname,
      replace(fk.definition,'REFERENCES public.','REFERENCES ' || quote_ident(target) || '.'));
  END LOOP;
  INSERT INTO ilson_private.workspaces(token_hash,schema_name) VALUES(hashed,target);
  IF jsonb_typeof(p_applications) IS DISTINCT FROM 'array' OR jsonb_array_length(p_applications)>3 THEN RAISE EXCEPTION 'Invalid demo seed'; END IF;
  FOR row_data IN SELECT jsonb_array_elements(p_applications) LOOP
    EXECUTE format('INSERT INTO %I.application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,wish,current_minutes,current_people,current_frequency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',target)
      USING row_data->>'id',row_data->>'ticket_no',row_data->>'dept',row_data->>'applicant_label',row_data->>'title',row_data->>'bottleneck',row_data->>'problem',row_data->>'wish',(row_data->>'current_minutes')::bigint,(row_data->>'current_people')::bigint,row_data->>'current_frequency';
  END LOOP;
  RETURN jsonb_build_object('created',true,'expiresAt',(SELECT expires_at FROM ilson_private.workspaces WHERE token_hash=hashed));
END $$;

CREATE FUNCTION public.ilson_workspace_reset(p_token text, p_applications jsonb, p_new_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target text; hashed text;
BEGIN
  PERFORM pg_advisory_xact_lock(72413003);
  target := public.ilson_workspace_schema(p_token);
  hashed := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  PERFORM 1 FROM ilson_private.workspaces WHERE token_hash=hashed FOR UPDATE;
  EXECUTE format('DROP SCHEMA %I CASCADE',target);
  DELETE FROM ilson_private.workspaces WHERE token_hash=hashed;
  IF p_new_token = p_token THEN RAISE EXCEPTION 'Reset requires a new token'; END IF;
  RETURN public.ilson_workspace_open(p_new_token,p_applications);
END $$;

REVOKE ALL ON FUNCTION public.ilson_workspace_schema(text), public.ilson_workspace_query(text,text),
  public.ilson_workspace_batch(text,jsonb), public.ilson_workspace_open(text,jsonb), public.ilson_workspace_reset(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_query(text,text), public.ilson_workspace_batch(text,jsonb),
  public.ilson_workspace_open(text,jsonb), public.ilson_workspace_reset(text,jsonb,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
