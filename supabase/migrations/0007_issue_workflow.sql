-- Preserve original evidence while connecting unresolved feedback to owned work.
BEGIN;
SELECT pg_advisory_xact_lock(72413003);
CREATE TABLE public.issue_followup (
  id text PRIMARY KEY,
  cluster_id text NOT NULL REFERENCES public.issue_cluster(id),
  source_kind text NOT NULL CHECK(source_kind IN ('feedback','quality_sample')),
  source_id text NOT NULL,
  product_id text NOT NULL REFERENCES public.override_product(id),
  event_id text NOT NULL REFERENCES public.override_event(id),
  reason text NOT NULL CHECK(length(trim(reason))>0),
  evidence_refs text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution text,
  created_by text NOT NULL,
  created_at text NOT NULL DEFAULT public.datetime('now'),
  resolved_at text,
  resolved_by text,
  UNIQUE(source_kind,source_id),
  CHECK((status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL AND length(trim(resolution))>0))
);
CREATE INDEX ON public.issue_followup(cluster_id,status,created_at);
CREATE INDEX ON public.issue_followup(event_id);
CREATE INDEX ON public.issue_followup(product_id,status);

CREATE FUNCTION public.ilson_guard_issue_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending boolean;
BEGIN
  IF NEW.status IN ('resolved','accepted_exception') THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.issue_followup WHERE cluster_id=$1 AND status=''open'')',TG_TABLE_SCHEMA)
      INTO pending USING NEW.id;
    IF pending THEN RAISE EXCEPTION 'Unresolved issue follow-up' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ilson_guard_issue_closure() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ilson_guard_issue_assignee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permitted boolean;
BEGIN
  -- Visitor workspaces use an explicit synthetic assignee, never real accounts.
  IF TG_TABLE_SCHEMA <> 'public' OR NEW.assignee_email IS NULL THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM public.override_actor a JOIN public.override_product p ON p.id=NEW.scope_product_id
    WHERE a.email=NEW.assignee_email AND a.active=1 AND a.role IN ('operations','product','ml','engineer','policy')
      AND (a.product_ids_json::jsonb ? p.id OR a.departments_json::jsonb ? p.owner_team)) INTO permitted;
  IF NOT permitted OR NEW.assigned_at IS NULL OR NEW.assignee_label IS NULL OR NEW.next_response_on IS NULL THEN
    RAISE EXCEPTION 'Invalid issue assignee' USING ERRCODE='23514';
  END IF;
  IF NEW.next_response_on::date::text <> NEW.next_response_on THEN
    RAISE EXCEPTION 'Invalid response date' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ilson_guard_issue_assignee() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ilson_install_issue_workflow(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE fk record; source record; linked_cluster text;
BEGIN
  IF target <> 'public' AND NOT EXISTS(SELECT 1 FROM ilson_private.workspaces WHERE schema_name=target) THEN
    RAISE EXCEPTION 'Unknown workspace' USING ERRCODE='28000';
  END IF;
  EXECUTE format('ALTER TABLE %I.issue_cluster ADD COLUMN IF NOT EXISTS assignee_email text, ADD COLUMN IF NOT EXISTS assignee_label text,
    ADD COLUMN IF NOT EXISTS assigned_at text, ADD COLUMN IF NOT EXISTS acknowledged_at text, ADD COLUMN IF NOT EXISTS next_response_on text',target);
  -- Unrecorded impact is unknown, not a measured zero. Existing values are not rewritten.
  EXECUTE format('ALTER TABLE %I.issue_cluster ALTER COLUMN customer_impact_score DROP NOT NULL,
    ALTER COLUMN customer_impact_score DROP DEFAULT, ALTER COLUMN operations_cost_krw DROP NOT NULL,
    ALTER COLUMN operations_cost_krw DROP DEFAULT, ALTER COLUMN regulatory_risk_score DROP NOT NULL,
    ALTER COLUMN regulatory_risk_score DROP DEFAULT',target);
  EXECUTE format('ALTER TABLE %I.override_event ALTER COLUMN customer_impact_score DROP NOT NULL,
    ALTER COLUMN operations_cost_krw DROP NOT NULL, ALTER COLUMN regulatory_risk_score DROP NOT NULL,
    ALTER COLUMN recording_seconds DROP NOT NULL',target);
  IF target <> 'public' THEN
    EXECUTE format('CREATE TABLE %I.issue_followup (LIKE public.issue_followup INCLUDING ALL)',target);
    FOR fk IN SELECT c.conname,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='public.issue_followup'::regclass LOOP
      EXECUTE format('ALTER TABLE %I.issue_followup ADD CONSTRAINT %I %s',target,fk.conname,
        replace(fk.definition,'REFERENCES public.','REFERENCES ' || quote_ident(target) || '.'));
    END LOOP;
  END IF;
  EXECUTE format('ALTER TABLE %I.issue_followup ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('REVOKE ALL ON %I.issue_followup FROM PUBLIC,anon,authenticated',target);
  IF target='public' THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.issue_followup TO service_role,ilson_scoped_executor;
  END IF;
  EXECUTE format('CREATE TRIGGER issue_closure_guard BEFORE UPDATE OF status ON %I.issue_cluster
    FOR EACH ROW EXECUTE FUNCTION public.ilson_guard_issue_closure()',target);
  EXECUTE format('CREATE TRIGGER issue_assignee_guard BEFORE INSERT OR UPDATE OF assignee_email,assigned_at,assignee_label,next_response_on ON %I.issue_cluster
    FOR EACH ROW EXECUTE FUNCTION public.ilson_guard_issue_assignee()',target);
  -- Previously recorded unresolved responses must not disappear from the new queue.
  FOR source IN EXECUTE format($query$
    SELECT 'feedback'::text AS kind,u.id AS source_id,e.id AS event_id,e.product_id,e.cluster_id,
      e.ai_decision,e.human_decision,e.policy_refs_json,p.domain,p.owner_team,e.reporter_email,
      r.note AS reason,'개선 안내 ' || u.id || '; 원본 사건 ' || e.id AS evidence_refs,
      e.reviewer_label AS author,r.responded_at AS recorded_at
    FROM %1$I.field_feedback_receipt r JOIN %1$I.field_feedback_update u ON u.id=r.update_id
    JOIN %1$I.field_feedback_case c ON c.id=u.case_id JOIN %1$I.override_event e ON e.id=c.event_id
    JOIN %1$I.override_product p ON p.id=e.product_id WHERE r.verdict='not_resolved'
    UNION ALL
    SELECT 'quality_sample',i.id,e.id,e.product_id,e.cluster_id,
      coalesce(i.snapshot_json::jsonb->>'ai_decision',e.ai_decision),coalesce(i.snapshot_json::jsonb->>'human_decision',e.human_decision),
      coalesce(i.snapshot_json::jsonb->>'policy_refs_json',e.policy_refs_json),p.domain,p.owner_team,NULL,
      i.reason,coalesce(i.evidence_refs,''),coalesce(i.reviewed_by,'기존 표본 점검'),i.reviewed_at
    FROM %1$I.quality_sample_item i JOIN %1$I.override_event e ON e.id=i.event_id
    JOIN %1$I.override_product p ON p.id=e.product_id WHERE i.verdict='issue'
  $query$,target) LOOP
    linked_cluster := source.cluster_id;
    IF linked_cluster IS NULL THEN
      linked_cluster := 'olc_followup_' || md5(source.kind || ':' || source.source_id);
      EXECUTE format('INSERT INTO %I.issue_cluster(id,title,summary,sample_text,cause_code,cause_status,policy_refs_json,affected_workflow,owner_team,status,scope_product_id,created_by_email)
        VALUES($1,$2,$3,$4,''unknown'',''candidate'',$5,$6,$7,''open'',$8,$9)',target)
      USING linked_cluster,left(CASE WHEN source.kind='quality_sample' THEN '승인 표본 오류 · ' ELSE '현장 재검토 · ' END || source.reason,160),
        source.reason,source.ai_decision || E'\n' || source.human_decision,coalesce(source.policy_refs_json,'[]'),source.domain,source.owner_team,source.product_id,source.reporter_email;
    ELSE
      EXECUTE format('UPDATE %I.issue_cluster SET acknowledged_at=CASE WHEN status IN (''resolved'',''accepted_exception'') THEN NULL ELSE acknowledged_at END,status=CASE WHEN status IN (''resolved'',''accepted_exception'') THEN ''open'' ELSE status END,updated_at=public.datetime(''now'') WHERE id=$1',target) USING linked_cluster;
    END IF;
    EXECUTE format('INSERT INTO %I.issue_followup(id,cluster_id,source_kind,source_id,product_id,event_id,reason,evidence_refs,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',target)
    USING 'ifu_' || md5(source.kind || ':' || source.source_id),linked_cluster,source.kind,source.source_id,source.product_id,source.event_id,
      source.reason,source.evidence_refs,source.author,coalesce(source.recorded_at,public.datetime('now'));
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ilson_install_issue_workflow(text) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE target text; BEGIN
  PERFORM public.ilson_install_issue_workflow('public');
  FOR target IN SELECT schema_name FROM ilson_private.workspaces LOOP
    PERFORM public.ilson_install_issue_workflow(target);
  END LOOP;
END $$;

CREATE POLICY issue_followup_scope ON public.issue_followup TO ilson_scoped_executor
USING (ilson_private.scope_is_admin() OR ilson_private.scope_can_product(product_id) OR ilson_private.scope_can_event(event_id))
WITH CHECK (ilson_private.scope_is_admin() OR ilson_private.scope_can_product(product_id) OR ilson_private.scope_can_event(event_id));

ALTER FUNCTION public.ilson_workspace_open(text,jsonb) RENAME TO ilson_workspace_open_v6;
REVOKE ALL ON FUNCTION public.ilson_workspace_open_v6(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ilson_workspace_open(p_token text,p_applications jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target text;
BEGIN
  result := public.ilson_workspace_open_v6(p_token,p_applications);
  target := public.ilson_workspace_schema(p_token);
  IF result->>'created'='true' THEN PERFORM public.ilson_install_issue_workflow(target); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ilson_workspace_open(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_workspace_open(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ilson_readiness(p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; n bigint; migrated boolean;
BEGIN
  target := CASE WHEN p_token IS NULL THEN 'public' ELSE public.ilson_workspace_schema(p_token) END;
  SELECT count(*) INTO n FROM ilson_private.workspaces WHERE expires_at>now();
  SELECT count(*)=8 INTO migrated FROM information_schema.columns WHERE table_schema=target AND (
    (table_name='override_actor' AND column_name IN ('departments_json','product_ids_json')) OR
    (table_name='issue_cluster' AND column_name IN ('assignee_email','assignee_label','assigned_at','acknowledged_at','next_response_on')) OR
    (table_name='experiment_run' AND column_name='approval_id'));
  migrated := migrated AND to_regclass(format('%I.issue_followup',target)) IS NOT NULL
    AND to_regprocedure('public.ilson_workspace_open(text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_workspace_query(text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_claim_rate_limit(text,text,integer,integer)') IS NOT NULL
    AND to_regprocedure('public.ilson_commit_mutation(text,text,text,jsonb,jsonb,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_query(text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_batch(text,jsonb)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_receipt(text,text,text)') IS NOT NULL
    AND to_regprocedure('public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb)') IS NOT NULL;
  RETURN jsonb_build_object('migration','0007','schemaReady',migrated,'activeWorkspaces',n,'workspaceCapacity',128,
    'capacityAvailable',n<128,'ready',migrated AND (p_token IS NOT NULL OR n<128));
END $$;
REVOKE ALL ON FUNCTION public.ilson_readiness(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ilson_readiness(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
