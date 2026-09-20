-- Explicit collaboration grants and actor-bound quota receipts. No legacy grants are inferred.
BEGIN;
SELECT pg_advisory_xact_lock(72413009);

CREATE TABLE ilson_private.participation_departments (id text PRIMARY KEY);
INSERT INTO ilson_private.participation_departments(id) VALUES ('재무'),('마케팅'),('영업'),('SCM'),('운영'),('인사'),('기타');
REVOKE ALL ON ilson_private.participation_departments FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;

CREATE TABLE public.application_participation (
  id text PRIMARY KEY REFERENCES public.decision_log(id),
  application_id text NOT NULL REFERENCES public.application(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES ilson_private.participation_departments(id),
  granted_by_email text NOT NULL REFERENCES public.override_actor(email),
  granted_at text NOT NULL DEFAULT public.datetime('now'),
  revoked_at text,
  revoked_by_email text REFERENCES public.override_actor(email)
);
CREATE UNIQUE INDEX application_active_participation ON public.application_participation(application_id,department_id) WHERE revoked_at IS NULL;
ALTER TABLE public.application_participation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_participation FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.application_participation TO ilson_scoped_executor;
GRANT ALL ON public.application_participation TO service_role;

CREATE FUNCTION ilson_private.scope_participates(p_application text,p_department text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.application_participation p JOIN public.application a ON a.id=p.application_id
    WHERE p.application_id=p_application AND a.owner_email IS NOT NULL AND p.revoked_at IS NULL
      AND (p_department IS NULL OR p.department_id=p_department)
      AND (ilson_private.scope_actor()->>'departments_json')::jsonb ? p.department_id)
$$;
CREATE FUNCTION ilson_private.participation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; owner_email text;
BEGIN
  -- This function is reached only by an explicit participation INSERT/UPDATE,
  -- never by free-form decision_log text. The verified identity is set by the RPC.
  actor := ilson_private.scope_actor();
  IF actor IS NULL OR actor->>'role' NOT IN ('operations','product','policy','audit','executive')
    OR NOT ilson_private.scope_can_app(NEW.application_id) THEN
    RAISE EXCEPTION 'Application manager required' USING ERRCODE='42501';
  END IF;
  SELECT a.owner_email INTO owner_email FROM public.application a WHERE a.id=NEW.application_id;
  IF owner_email IS NULL THEN RAISE EXCEPTION 'An administrator must verify the legacy application owner first' USING ERRCODE='22023'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.granted_by_email IS DISTINCT FROM actor->>'email' OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by_email IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid participation identity' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.decision_log l WHERE l.id=NEW.id AND l.application_id=NEW.application_id AND l.link_kind='같은건손듦') THEN
      RAISE EXCEPTION 'A matching participation record is required' USING ERRCODE='23514';
    END IF;
    NEW.granted_at := public.datetime('now');
  ELSE
    IF ROW(NEW.id,NEW.application_id,NEW.department_id,NEW.granted_by_email,NEW.granted_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.application_id,OLD.department_id,OLD.granted_by_email,OLD.granted_at)
       OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by_email IS DISTINCT FROM actor->>'email' THEN
      RAISE EXCEPTION 'Only revocation is allowed' USING ERRCODE='42501';
    END IF;
    NEW.revoked_at := public.datetime('now');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participation_verified BEFORE INSERT OR UPDATE ON public.application_participation FOR EACH ROW EXECUTE FUNCTION ilson_private.participation_guard();
CREATE POLICY participation_read ON public.application_participation FOR SELECT TO ilson_scoped_executor
  USING(ilson_private.scope_can_app(application_id) OR ilson_private.scope_participates(application_id));
CREATE POLICY participation_create ON public.application_participation FOR INSERT TO ilson_scoped_executor
  WITH CHECK(ilson_private.scope_can_app(application_id));
CREATE POLICY participation_revoke ON public.application_participation FOR UPDATE TO ilson_scoped_executor
  USING(ilson_private.scope_can_app(application_id)) WITH CHECK(ilson_private.scope_can_app(application_id));

-- Collaboration is not an assignment to manage another department's raw data.
-- Keep scope_can_app and its existing write policies unchanged.
CREATE POLICY participant_application_read ON public.application FOR SELECT TO ilson_scoped_executor USING(ilson_private.scope_participates(id));
CREATE POLICY participant_criteria_read ON public.acceptance_criterion FOR SELECT TO ilson_scoped_executor USING(ilson_private.scope_participates(application_id));
CREATE POLICY participant_decisions_read ON public.decision_log FOR SELECT TO ilson_scoped_executor USING(ilson_private.scope_participates(application_id));
CREATE POLICY participant_signoff ON public.decision_log FOR INSERT TO ilson_scoped_executor WITH CHECK (
  actor='human' AND stage='협의안' AND (
    (link_kind='기준서명' AND ilson_private.scope_participates(application_id,link_id)) OR
    (link_kind='기준이의' AND ilson_private.scope_participates(application_id,alternatives)
      AND EXISTS(SELECT 1 FROM public.acceptance_criterion c WHERE c.id=link_id AND c.application_id=decision_log.application_id))
  )
);
REVOKE ALL ON FUNCTION ilson_private.scope_participates(text,text),ilson_private.participation_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION ilson_private.scope_participates(text,text) TO ilson_scoped_executor;

CREATE TABLE ilson_private.actor_rate_tickets (
  ticket bigint PRIMARY KEY REFERENCES public.rate_limit_hits(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  bucket text NOT NULL
);
ALTER TABLE ilson_private.actor_rate_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ilson_private.actor_rate_tickets FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;

CREATE FUNCTION ilson_private.actor_rate_bucket(p_actor text,p_bucket text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tool_slug text; normalized_bucket text;
BEGIN
  PERFORM ilson_private.scope_begin(p_actor);
  IF p_bucket IS NULL OR length(p_bucket)>256 OR p_bucket ~ '[[:cntrl:]]'
    OR p_bucket !~ '^(write|apply|track|join|answer|deptask|betasay|holdlift|signoff|resubmit|outconf|accept|teach|report|unclear|bug|tool):.+' THEN
    RAISE EXCEPTION 'Invalid server quota bucket' USING ERRCODE='22023';
  END IF;
  IF starts_with(p_bucket,'tool:') THEN
    tool_slug := split_part(p_bucket,':',2);
    IF NOT EXISTS(SELECT 1 FROM public.handover h WHERE h.slug=tool_slug AND ilson_private.scope_can_app(h.application_id)) THEN
      RAISE EXCEPTION 'Unknown or inaccessible tool' USING ERRCODE='42501';
    END IF;
  END IF;
  -- Real users keep the same quota across network changes. A tool has its own
  -- quota; other actions are keyed by their server-owned operation prefix.
  normalized_bucket := CASE WHEN tool_slug IS NULL THEN split_part(p_bucket,':',1) ELSE 'tool:' || tool_slug END;
  RETURN 'actor-rate:' || encode(sha256(convert_to(p_actor || E'\n' || normalized_bucket,'UTF8')),'hex');
END $$;
CREATE FUNCTION public.ilson_actor_claim_rate_limit(p_actor text,p_bucket text,p_max integer,p_window integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bucket text; ticket bigint;
BEGIN
  bucket := ilson_private.actor_rate_bucket(p_actor,p_bucket);
  ticket := public.ilson_claim_rate_limit(NULL,bucket,p_max,p_window);
  IF ticket>0 THEN INSERT INTO ilson_private.actor_rate_tickets VALUES(ticket,p_actor,bucket); END IF;
  RETURN ticket;
END $$;
CREATE FUNCTION public.ilson_actor_rate_state(p_actor text,p_bucket text,p_max integer,p_window integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target_bucket text; hits bigint; first_hit text;
BEGIN
  target_bucket := ilson_private.actor_rate_bucket(p_actor,p_bucket);
  IF p_max IS NULL OR p_window IS NULL OR p_max NOT BETWEEN 1 AND 10000 OR p_window NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit' USING ERRCODE='22023';
  END IF;
  SELECT count(*),min(h.created_at) INTO hits,first_hit FROM public.rate_limit_hits h
    WHERE h.bucket=target_bucket AND h.created_at>=public.datetime('now','-' || p_window || ' seconds');
  RETURN jsonb_build_object('remaining',greatest(0,p_max-hits),'nextFreeAt',CASE WHEN hits>=p_max THEN public.datetime(first_hit,'+' || p_window || ' seconds') ELSE NULL END);
END $$;
CREATE FUNCTION public.ilson_actor_release_rate_limit(p_actor text,p_bucket text,p_ticket bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target_bucket text; changed bigint;
BEGIN
  target_bucket := ilson_private.actor_rate_bucket(p_actor,p_bucket);
  IF p_ticket IS NULL OR p_ticket<=0 THEN RETURN false; END IF;
  DELETE FROM public.rate_limit_hits h USING ilson_private.actor_rate_tickets t
    WHERE h.id=p_ticket AND t.ticket=h.id AND h.bucket=target_bucket AND t.bucket=target_bucket AND t.actor_email=p_actor;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION ilson_private.actor_rate_bucket(text,text) FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;
REVOKE ALL ON FUNCTION public.ilson_actor_claim_rate_limit(text,text,integer,integer),public.ilson_actor_rate_state(text,text,integer,integer),public.ilson_actor_release_rate_limit(text,text,bigint) FROM PUBLIC,anon,authenticated,ilson_scoped_executor;
GRANT EXECUTE ON FUNCTION public.ilson_actor_claim_rate_limit(text,text,integer,integer),public.ilson_actor_rate_state(text,text,integer,integer),public.ilson_actor_release_rate_limit(text,text,bigint) TO service_role;

-- Preserve the prior migration's readiness checks, including demo history tables.
ALTER FUNCTION public.ilson_readiness(text) RENAME TO ilson_readiness_v8;
REVOKE ALL ON FUNCTION public.ilson_readiness_v8(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; migrated boolean;
BEGIN
  result := public.ilson_readiness_v8(p_token);
  migrated := (result->>'schemaReady')::boolean
    AND to_regclass('public.application_participation') IS NOT NULL
    AND to_regclass('ilson_private.actor_rate_tickets') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_claim_rate_limit(text,text,integer,integer)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_rate_state(text,text,integer,integer)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_release_rate_limit(text,text,bigint)') IS NOT NULL;
  RETURN result || jsonb_build_object('migration','0009','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
