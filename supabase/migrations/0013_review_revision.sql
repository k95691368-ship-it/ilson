-- A review snapshot covers its verdict, lifecycle state and resubmission links.
-- Existing evidence is retained; conflicting writes fail without partial logs.
BEGIN;
SELECT pg_advisory_xact_lock(72413013);

CREATE FUNCTION ilson_private.review_status_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.review_revision:=OLD.review_revision+1; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION ilson_private.review_evidence_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_id text; new_id text; app_id text;
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN
    IF TG_TABLE_NAME='review' THEN old_id:=OLD.application_id;
    ELSIF OLD.link_kind='재신청됨' THEN old_id:=OLD.application_id; END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
    IF TG_TABLE_NAME='review' THEN new_id:=NEW.application_id;
    ELSIF NEW.link_kind='재신청됨' THEN new_id:=NEW.application_id; END IF;
  END IF;
  FOR app_id IN SELECT DISTINCT value FROM unnest(ARRAY[old_id,new_id]) value WHERE value IS NOT NULL ORDER BY value LOOP
    EXECUTE format('UPDATE %I.application SET review_revision=review_revision+1 WHERE id=$1',TG_TABLE_SCHEMA) USING app_id;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ilson_private.review_status_changed(),ilson_private.review_evidence_changed() FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;

CREATE FUNCTION ilson_private.install_review_revision(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target<>'public' AND NOT EXISTS(SELECT 1 FROM ilson_private.workspaces WHERE schema_name=target) THEN
    RAISE EXCEPTION 'Unknown schema' USING ERRCODE='42501';
  END IF;
  EXECUTE format('ALTER TABLE %I.application ADD COLUMN IF NOT EXISTS review_revision bigint NOT NULL DEFAULT 0 CHECK(review_revision>=0)',target);
  EXECUTE format('CREATE TRIGGER review_status_revision BEFORE UPDATE OF status ON %I.application FOR EACH ROW EXECUTE FUNCTION ilson_private.review_status_changed()',target);
  EXECUTE format('CREATE TRIGGER review_evidence_revision BEFORE INSERT OR UPDATE OR DELETE ON %I.review FOR EACH ROW EXECUTE FUNCTION ilson_private.review_evidence_changed()',target);
  EXECUTE format('CREATE TRIGGER review_resubmission_revision BEFORE INSERT OR UPDATE OR DELETE ON %I.decision_log FOR EACH ROW EXECUTE FUNCTION ilson_private.review_evidence_changed()',target);
END $$;
REVOKE ALL ON FUNCTION ilson_private.install_review_revision(text) FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;
DO $$ DECLARE target text; BEGIN
  FOR target IN SELECT 'public' UNION ALL SELECT schema_name FROM ilson_private.workspaces LOOP
    PERFORM ilson_private.install_review_revision(target);
  END LOOP;
END $$;

-- SECURITY INVOKER deliberately keeps the caller's row-level access and schema.
-- No caller-controlled schema or SECURITY DEFINER escape is accepted here.
CREATE FUNCTION public.ilson_lock_review_revision(p_application text,p_expected bigint) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE target text:=current_schema(); actual bigint;
BEGIN
  IF target<>'public' AND target !~ '^ilson_demo_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Invalid review scope' USING ERRCODE='42501';
  END IF;
  IF p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION 'Review revision required' USING ERRCODE='22023'; END IF;
  EXECUTE format('SELECT review_revision FROM %I.application WHERE id=$1 FOR UPDATE',target) INTO actual USING p_application;
  IF actual IS NULL OR actual<>p_expected THEN RAISE EXCEPTION 'Review snapshot changed' USING ERRCODE='40001'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ilson_lock_review_revision(text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_lock_review_revision(text,bigint) TO service_role,ilson_scoped_executor;

ALTER FUNCTION public.ilson_workspace_open(text,jsonb) RENAME TO ilson_workspace_open_v12;
REVOKE ALL ON FUNCTION public.ilson_workspace_open_v12(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_workspace_open(p_token text,p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
  result:=public.ilson_workspace_open_v12(p_token,p_applications);
  IF result->>'created'='true' THEN PERFORM ilson_private.install_review_revision(public.ilson_workspace_schema(p_token)); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_workspace_open(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_open(text,jsonb) TO service_role;

ALTER FUNCTION public.ilson_readiness(text) RENAME TO ilson_readiness_v12;
REVOKE ALL ON FUNCTION public.ilson_readiness_v12(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text; migrated boolean; BEGIN
  result:=public.ilson_readiness_v12(p_token);
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  migrated:=(result->>'schemaReady')::boolean
    AND to_regprocedure('public.ilson_lock_review_revision(text,bigint)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=target AND table_name='application' AND column_name='review_revision')
    AND 3=(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=target AND (c.relname,t.tgname) IN (('application','review_status_revision'),('review','review_evidence_revision'),('decision_log','review_resubmission_revision')));
  RETURN result||jsonb_build_object('migration','0013','schemaReady',migrated,'ready',migrated AND (result->>'ready')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
