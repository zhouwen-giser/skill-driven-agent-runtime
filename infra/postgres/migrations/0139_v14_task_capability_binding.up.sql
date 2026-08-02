BEGIN;

CREATE TABLE runtime_agent_card_exposure_snapshot (
  revision bigint NOT NULL REFERENCES runtime_agent_card_revision(revision),
  exposure_id text NOT NULL,
  exposure_version integer NOT NULL CHECK(exposure_version >= 1),
  capability_id text NOT NULL,
  capability_version integer NOT NULL CHECK(capability_version >= 1),
  agent_skill_id text NOT NULL,
  request_schema jsonb NOT NULL CHECK(jsonb_typeof(request_schema)='object'),
  result_schema jsonb NOT NULL CHECK(jsonb_typeof(result_schema)='object'),
  requester_policy jsonb,
  exposure_hash char(64) NOT NULL CHECK(exposure_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(revision,exposure_id,exposure_version)
);

CREATE FUNCTION prevent_runtime_agent_card_exposure_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RUNTIME_AGENT_CARD_EXPOSURE_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000';
END $$;

CREATE TRIGGER runtime_agent_card_exposure_snapshot_immutable
BEFORE UPDATE OR DELETE ON runtime_agent_card_exposure_snapshot
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_agent_card_exposure_snapshot_mutation();

CREATE TABLE task_capability_binding (
  binding_id text PRIMARY KEY,
  task_id text NOT NULL UNIQUE REFERENCES agent_task(task_id),
  requested_capability_id text NOT NULL,
  capability_version integer NOT NULL CHECK(capability_version >= 1),
  exposure_id text,
  exposure_version integer CHECK(exposure_version >= 1),
  input_snapshot jsonb NOT NULL,
  success_criteria_snapshot jsonb NOT NULL CHECK(jsonb_typeof(success_criteria_snapshot)='array' AND jsonb_array_length(success_criteria_snapshot)>0),
  evidence_requirement_snapshot jsonb NOT NULL CHECK(jsonb_typeof(evidence_requirement_snapshot)='array'),
  constraint_snapshot jsonb NOT NULL CHECK(jsonb_typeof(constraint_snapshot)='array'),
  initial_implementation_refs jsonb NOT NULL CHECK(jsonb_typeof(initial_implementation_refs)='array' AND jsonb_array_length(initial_implementation_refs)>0),
  provider_policy_snapshot jsonb,
  binding_hash char(64) NOT NULL UNIQUE CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz NOT NULL,
  CHECK ((exposure_id IS NULL) = (exposure_version IS NULL)),
  UNIQUE(binding_id,task_id)
);

CREATE TABLE task_capability_execution_attempt (
  attempt_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id),
  capability_binding_id text NOT NULL REFERENCES task_capability_binding(binding_id),
  attempt_no integer NOT NULL CHECK(attempt_no > 0),
  plan_id text,
  plan_template_ref text,
  skill_version_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(skill_version_refs)='array'),
  provider_binding_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(provider_binding_refs)='array'),
  reason text NOT NULL CHECK(reason IN ('initial','replan','provider_failover','recovery','manual_change')),
  status text NOT NULL CHECK(status IN ('prepared','running','waiting','succeeded','failed','canceled','superseded')),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(task_id,attempt_no),
  FOREIGN KEY(capability_binding_id,task_id)
    REFERENCES task_capability_binding(binding_id,task_id),
  CHECK (
    (status='prepared' AND started_at IS NULL AND completed_at IS NULL) OR
    (status IN ('running','waiting') AND started_at IS NOT NULL AND completed_at IS NULL) OR
    (status IN ('succeeded','failed','canceled','superseded') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX task_capability_attempt_history_idx
  ON task_capability_execution_attempt(task_id,attempt_no);

CREATE FUNCTION prevent_task_capability_binding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TASK_CAPABILITY_BINDING_IMMUTABLE' USING ERRCODE='55000';
END $$;

CREATE TRIGGER task_capability_binding_immutable
BEFORE UPDATE OR DELETE ON task_capability_binding
FOR EACH ROW EXECUTE FUNCTION prevent_task_capability_binding_mutation();

CREATE FUNCTION protect_task_capability_attempt_content()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
     NEW.task_id IS DISTINCT FROM OLD.task_id OR
     NEW.capability_binding_id IS DISTINCT FROM OLD.capability_binding_id OR
     NEW.attempt_no IS DISTINCT FROM OLD.attempt_no OR
     NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
     NEW.plan_template_ref IS DISTINCT FROM OLD.plan_template_ref OR
     NEW.skill_version_refs IS DISTINCT FROM OLD.skill_version_refs OR
     NEW.provider_binding_refs IS DISTINCT FROM OLD.provider_binding_refs OR
     NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'TASK_CAPABILITY_ATTEMPT_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_capability_attempt_content_immutable
BEFORE UPDATE ON task_capability_execution_attempt
FOR EACH ROW EXECUTE FUNCTION protect_task_capability_attempt_content();

INSERT INTO schema_migration(version) VALUES ('0139_v14_task_capability_binding');
COMMIT;
