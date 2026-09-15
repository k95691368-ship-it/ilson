-- Additive local migration. Apply before deploying the field-feedback API.
BEGIN;
-- Serialize with workspace open/reset so no newly created schema misses this upgrade.
SELECT pg_advisory_xact_lock(72413003);
CREATE TABLE public.field_feedback_case (
  id text PRIMARY KEY, event_id text NOT NULL UNIQUE REFERENCES public.override_event(id),
  reporter_key text NOT NULL, created_at text NOT NULL DEFAULT public.datetime('now')
);
CREATE INDEX ON public.field_feedback_case(reporter_key, created_at);
CREATE TABLE public.field_feedback_update (
  id text PRIMARY KEY, case_id text NOT NULL REFERENCES public.field_feedback_case(id),
  kind text NOT NULL CHECK(kind IN ('reply','applied','declined')),
  body text NOT NULL, effective_on text, actor_label text NOT NULL,
  created_at text NOT NULL DEFAULT public.datetime('now')
);
CREATE INDEX ON public.field_feedback_update(case_id, created_at);
CREATE TABLE public.field_feedback_receipt (
  update_id text PRIMARY KEY REFERENCES public.field_feedback_update(id),
  seen_at text NOT NULL DEFAULT public.datetime('now'),
  verdict text CHECK(verdict IN ('resolved','not_resolved','untested')),
  note text, responded_at text
);
CREATE TABLE public.quality_sample_batch (
  id text PRIMARY KEY, product_id text NOT NULL REFERENCES public.override_product(id),
  start_at text NOT NULL, end_at text NOT NULL, requested_size integer NOT NULL,
  sample_size integer NOT NULL, eligible_count integer NOT NULL, seed text NOT NULL,
  created_by text NOT NULL, created_at text NOT NULL DEFAULT public.datetime('now')
);
CREATE TABLE public.quality_sample_item (
  id text PRIMARY KEY, batch_id text NOT NULL REFERENCES public.quality_sample_batch(id),
  event_id text NOT NULL UNIQUE REFERENCES public.override_event(id), snapshot_json text NOT NULL,
  verdict text CHECK(verdict IN ('correct','issue','insufficient')), reason text,
  evidence_refs text, reviewed_by text, reviewed_at text
);
CREATE INDEX ON public.quality_sample_item(batch_id);
CREATE TABLE public.tool_nonuse_report (
  id text PRIMARY KEY, product_id text NOT NULL REFERENCES public.override_product(id), reporter_key text NOT NULL,
  usage_state text NOT NULL CHECK(usage_state IN ('paused','stopped','never_started')),
  reason text NOT NULL CHECK(reason IN ('accuracy','speed','workflow','access','privacy','no_need','other')),
  note text, occurred_on text NOT NULL, created_at text NOT NULL DEFAULT public.datetime('now')
);
CREATE INDEX ON public.tool_nonuse_report(reporter_key, created_at);
CREATE INDEX ON public.tool_nonuse_report(product_id, reason);

-- A private helper is shared by the migration and future workspace creation.
CREATE FUNCTION public.ilson_install_field_feedback(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text; fk record;
  tables text[] := ARRAY['field_feedback_case','field_feedback_update','field_feedback_receipt',
    'quality_sample_batch','quality_sample_item','tool_nonuse_report'];
BEGIN
  IF target <> 'public' AND NOT EXISTS(SELECT 1 FROM ilson_private.workspaces WHERE schema_name=target) THEN
    RAISE EXCEPTION 'Unknown workspace' USING ERRCODE='28000';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    IF target <> 'public' THEN
      EXECUTE format('CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)',target,t,t);
    END IF;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',target,t);
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC,anon,authenticated',target,t);
    IF target='public' THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I.%I TO service_role',target,t); END IF;
  END LOOP;
  IF target <> 'public' THEN
    FOR fk IN SELECT c.conname,r.relname AS table_name,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE c.contype='f' AND n.nspname='public' AND r.relname=ANY(tables) LOOP
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',target,fk.table_name,fk.conname,
        replace(fk.definition,'REFERENCES public.','REFERENCES ' || quote_ident(target) || '.'));
    END LOOP;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ilson_install_field_feedback(text) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE target text; BEGIN
  PERFORM public.ilson_install_field_feedback('public');
  FOR target IN SELECT schema_name FROM ilson_private.workspaces LOOP
    PERFORM public.ilson_install_field_feedback(target);
  END LOOP;
END $$;

ALTER FUNCTION public.ilson_workspace_open(text,jsonb) RENAME TO ilson_workspace_open_v4;
REVOKE ALL ON FUNCTION public.ilson_workspace_open_v4(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_workspace_open(p_token text,p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text;
BEGIN
  result := public.ilson_workspace_open_v4(p_token,p_applications);
  target := public.ilson_workspace_schema(p_token);
  IF result->>'created' = 'true' THEN PERFORM public.ilson_install_field_feedback(target); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_workspace_open(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_open(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
