-- Keep every quality review while allowing evidence-insufficient samples to reopen.
BEGIN;
SELECT pg_advisory_xact_lock(72413003);
CREATE TABLE public.quality_sample_review_history (
  item_id text NOT NULL REFERENCES public.quality_sample_item(id),
  revision integer NOT NULL CHECK(revision>0),
  verdict text NOT NULL CHECK(verdict IN ('correct','issue','insufficient')),
  reason text,
  evidence_refs text,
  reviewed_by text,
  reviewed_at text NOT NULL,
  PRIMARY KEY(item_id,revision)
);

CREATE FUNCTION public.ilson_guard_sample_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    RAISE EXCEPTION 'The original quality sample is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.verdict,NEW.reason,NEW.evidence_refs,NEW.reviewed_by,NEW.reviewed_at)
    IS DISTINCT FROM ROW(OLD.verdict,OLD.reason,OLD.evidence_refs,OLD.reviewed_by,OLD.reviewed_at) THEN
    IF OLD.verdict IN ('correct','issue') OR (OLD.reviewed_at IS NOT NULL AND OLD.verdict IS DISTINCT FROM 'insufficient') THEN
      RAISE EXCEPTION 'The sample already has a final verdict' USING ERRCODE='23514';
    END IF;
    IF NEW.verdict IS NULL OR NEW.reviewed_at IS NULL OR nullif(trim(NEW.reason),'') IS NULL
      OR nullif(trim(NEW.reviewed_by),'') IS NULL
      OR (NEW.verdict<>'insufficient' AND nullif(trim(NEW.evidence_refs),'') IS NULL) THEN
      RAISE EXCEPTION 'A review requires its original evidence and attribution' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.ilson_record_sample_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.reviewed_at IS NULL OR NEW.verdict IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.verdict,NEW.reason,NEW.evidence_refs,NEW.reviewed_by,NEW.reviewed_at)
    IS NOT DISTINCT FROM ROW(OLD.verdict,OLD.reason,OLD.evidence_refs,OLD.reviewed_by,OLD.reviewed_at) THEN RETURN NEW; END IF;
  -- Updating the parent row serializes revisions; its history cannot be edited.
  EXECUTE format('INSERT INTO %1$I.quality_sample_review_history(item_id,revision,verdict,reason,evidence_refs,reviewed_by,reviewed_at)
    SELECT $1,coalesce(max(revision),0)+1,$2,$3,$4,$5,$6 FROM %1$I.quality_sample_review_history WHERE item_id=$1',TG_TABLE_SCHEMA)
    USING NEW.id,NEW.verdict,NEW.reason,NEW.evidence_refs,NEW.reviewed_by,NEW.reviewed_at;
  RETURN NEW;
END $$;

CREATE FUNCTION public.ilson_guard_sample_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Quality review history is append-only' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.ilson_guard_sample_review(),public.ilson_record_sample_review(),public.ilson_guard_sample_history()
  FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;

CREATE FUNCTION public.ilson_install_feedback_rechecks(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE fk record;
BEGIN
  IF target<>'public' AND NOT EXISTS(SELECT 1 FROM ilson_private.workspaces WHERE schema_name=target) THEN
    RAISE EXCEPTION 'Unknown workspace' USING ERRCODE='28000';
  END IF;
  IF target<>'public' THEN
    EXECUTE format('CREATE TABLE %I.quality_sample_review_history (LIKE public.quality_sample_review_history INCLUDING ALL)',target);
    FOR fk IN SELECT c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      WHERE c.contype='f' AND c.conrelid='public.quality_sample_review_history'::regclass LOOP
      EXECUTE format('ALTER TABLE %I.quality_sample_review_history ADD CONSTRAINT %I %s',target,fk.conname,
        replace(fk.definition,'REFERENCES public.','REFERENCES ' || quote_ident(target) || '.'));
    END LOOP;
  END IF;
  EXECUTE format('ALTER TABLE %I.quality_sample_review_history ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON %I.quality_sample_review_history FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor',target);
  IF target='public' THEN GRANT SELECT ON public.quality_sample_review_history TO service_role,ilson_scoped_executor; END IF;
  -- Backfill the exact stored verdict; do not invent missing legacy evidence.
  EXECUTE format('INSERT INTO %1$I.quality_sample_review_history(item_id,revision,verdict,reason,evidence_refs,reviewed_by,reviewed_at)
    SELECT id,1,verdict,reason,evidence_refs,reviewed_by,reviewed_at FROM %1$I.quality_sample_item
    WHERE verdict IS NOT NULL AND reviewed_at IS NOT NULL',target);
  EXECUTE format('CREATE TRIGGER sample_review_guard BEFORE UPDATE ON %I.quality_sample_item
    FOR EACH ROW EXECUTE FUNCTION public.ilson_guard_sample_review()',target);
  EXECUTE format('CREATE TRIGGER sample_review_history AFTER INSERT OR UPDATE ON %I.quality_sample_item
    FOR EACH ROW EXECUTE FUNCTION public.ilson_record_sample_review()',target);
  EXECUTE format('CREATE TRIGGER sample_history_immutable BEFORE UPDATE OR DELETE ON %I.quality_sample_review_history
    FOR EACH ROW EXECUTE FUNCTION public.ilson_guard_sample_history()',target);
  EXECUTE format('CREATE INDEX IF NOT EXISTS field_feedback_case_created_at_id_idx ON %I.field_feedback_case(created_at DESC,id DESC)',target);
  EXECUTE format('CREATE INDEX IF NOT EXISTS field_feedback_case_reporter_key_created_at_id_idx ON %I.field_feedback_case(reporter_key,created_at DESC,id DESC)',target);
  EXECUTE format('CREATE INDEX IF NOT EXISTS quality_sample_batch_created_at_id_idx ON %I.quality_sample_batch(created_at DESC,id DESC)',target);
END $$;
REVOKE ALL ON FUNCTION public.ilson_install_feedback_rechecks(text) FROM PUBLIC,anon,authenticated,service_role,ilson_scoped_executor;
DO $$ DECLARE target text; BEGIN
  PERFORM public.ilson_install_feedback_rechecks('public');
  FOR target IN SELECT schema_name FROM ilson_private.workspaces LOOP
    PERFORM public.ilson_install_feedback_rechecks(target);
  END LOOP;
END $$;
CREATE POLICY quality_sample_review_history_scope ON public.quality_sample_review_history FOR SELECT TO ilson_scoped_executor
USING (EXISTS(SELECT 1 FROM public.quality_sample_item i WHERE i.id=item_id AND ilson_private.scope_can_event(i.event_id)));

ALTER FUNCTION public.ilson_workspace_open(text,jsonb) RENAME TO ilson_workspace_open_v7;
REVOKE ALL ON FUNCTION public.ilson_workspace_open_v7(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_workspace_open(p_token text,p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text;
BEGIN
  result:=public.ilson_workspace_open_v7(p_token,p_applications);
  target:=public.ilson_workspace_schema(p_token);
  IF result->>'created'='true' THEN PERFORM public.ilson_install_feedback_rechecks(target); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_workspace_open(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_open(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; n bigint; migrated boolean;
BEGIN
  target:=CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  SELECT count(*) INTO n FROM ilson_private.workspaces WHERE expires_at>now();
  SELECT count(*)=8 INTO migrated FROM information_schema.columns WHERE table_schema=target AND (
    (table_name='override_actor' AND column_name IN ('departments_json','product_ids_json')) OR
    (table_name='issue_cluster' AND column_name IN ('assignee_email','assignee_label','assigned_at','acknowledged_at','next_response_on')) OR
    (table_name='experiment_run' AND column_name='approval_id'));
  migrated:=migrated AND to_regclass(format('%I.issue_followup',target)) IS NOT NULL
    AND to_regclass(format('%I.quality_sample_review_history',target)) IS NOT NULL
    AND to_regprocedure('public.ilson_workspace_open(text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_workspace_query(text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_claim_rate_limit(text,text,integer,integer)') IS NOT NULL
    AND to_regprocedure('public.ilson_commit_mutation(text,text,text,jsonb,jsonb,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_query(text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_batch(text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_receipt(text,text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb)') IS NOT NULL;
  RETURN jsonb_build_object('migration','0008','schemaReady',migrated,'activeWorkspaces',n,'workspaceCapacity',128,
    'capacityAvailable',n<128,'ready',migrated AND (p_token IS NOT NULL OR n<128));
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
