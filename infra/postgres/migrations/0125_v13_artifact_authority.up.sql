BEGIN;

CREATE FUNCTION sdar_jsonb_depth(value jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  nested_depth integer;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(MAX(sdar_jsonb_depth(child)),0)
    INTO nested_depth
    FROM jsonb_each(value) AS entry(key,child);
    RETURN nested_depth + 1;
  END IF;
  IF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(MAX(sdar_jsonb_depth(child)),0)
    INTO nested_depth
    FROM jsonb_array_elements(value) AS entry(child);
    RETURN nested_depth + 1;
  END IF;
  RETURN 1;
END
$$;

CREATE TABLE compiled_artifact (
  artifact_id text PRIMARY KEY,
  artifact_key text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  artifact_type text NOT NULL CHECK (artifact_type IN (
    'intent_route', 'plan_template', 'decision_rule', 'case_template', 'model_route'
  )),
  tenant_id text,
  domain text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'discovered', 'candidate', 'validating', 'awaiting_approval', 'active',
    'revalidating', 'deprecated', 'archived', 'rejected'
  )),
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  definition jsonb NOT NULL CHECK (
    jsonb_typeof(definition) = 'object'
    AND octet_length(definition::text) <= 1048576
    AND sdar_jsonb_depth(definition) <= 32
  ),
  applicability jsonb NOT NULL CHECK (
    jsonb_typeof(applicability) = 'object'
    AND octet_length(applicability::text) <= 262144
    AND sdar_jsonb_depth(applicability) <= 32
  ),
  dependency_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(dependency_snapshot) = 'object'
    AND octet_length(dependency_snapshot::text) <= 262144
    AND sdar_jsonb_depth(dependency_snapshot) <= 16
  ),
  lineage_id text NOT NULL,
  validation_summary_id text,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (artifact_key, version),
  UNIQUE (artifact_id, version),
  UNIQUE (artifact_key, artifact_id, version)
);

CREATE UNIQUE INDEX compiled_artifact_one_active_per_key
  ON compiled_artifact(artifact_key)
  WHERE status = 'active';
CREATE INDEX compiled_artifact_active_index
  ON compiled_artifact(tenant_id, domain, artifact_type, artifact_key, version)
  WHERE status = 'active';
CREATE INDEX compiled_artifact_dependency_gin
  ON compiled_artifact USING gin(dependency_snapshot);

CREATE TABLE artifact_active_pointer (
  artifact_key text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  lock_version integer NOT NULL CHECK (lock_version >= 1),
  FOREIGN KEY (artifact_key, artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_key, artifact_id, version)
);

CREATE TABLE artifact_lineage (
  lineage_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  source_episode_refs jsonb NOT NULL CHECK (
    jsonb_typeof(source_episode_refs) = 'array' AND jsonb_array_length(source_episode_refs) <= 4096
    AND octet_length(source_episode_refs::text) <= 262144
    AND sdar_jsonb_depth(source_episode_refs) <= 16
  ),
  source_knowledge_refs jsonb NOT NULL CHECK (
    jsonb_typeof(source_knowledge_refs) = 'array'
    AND jsonb_array_length(source_knowledge_refs) <= 4096
    AND octet_length(source_knowledge_refs::text) <= 262144
    AND sdar_jsonb_depth(source_knowledge_refs) <= 16
  ),
  source_correction_refs jsonb NOT NULL CHECK (
    jsonb_typeof(source_correction_refs) = 'array'
    AND jsonb_array_length(source_correction_refs) <= 4096
    AND octet_length(source_correction_refs::text) <= 262144
    AND sdar_jsonb_depth(source_correction_refs) <= 16
  ),
  source_pattern_refs jsonb NOT NULL CHECK (
    jsonb_typeof(source_pattern_refs) = 'array'
    AND jsonb_array_length(source_pattern_refs) <= 4096
    AND octet_length(source_pattern_refs::text) <= 262144
    AND sdar_jsonb_depth(source_pattern_refs) <= 16
  ),
  generation_methods jsonb NOT NULL CHECK (
    jsonb_typeof(generation_methods) = 'array' AND jsonb_array_length(generation_methods) <= 4096
    AND octet_length(generation_methods::text) <= 262144
    AND sdar_jsonb_depth(generation_methods) <= 16
  ),
  compiler_version text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  UNIQUE (artifact_id, artifact_version)
);

ALTER TABLE compiled_artifact
  ADD CONSTRAINT compiled_artifact_lineage_fk
  FOREIGN KEY (lineage_id) REFERENCES artifact_lineage(lineage_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE artifact_validation_run (
  validation_run_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  validation_type text NOT NULL,
  dataset_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed')),
  result text,
  metrics jsonb NOT NULL CHECK (
    jsonb_typeof(metrics) = 'object'
    AND octet_length(metrics::text) <= 262144
    AND sdar_jsonb_depth(metrics) <= 16
  ),
  counterexample_refs jsonb NOT NULL CHECK (
    jsonb_typeof(counterexample_refs) = 'array'
    AND jsonb_array_length(counterexample_refs) <= 4096
    AND octet_length(counterexample_refs::text) <= 262144
    AND sdar_jsonb_depth(counterexample_refs) <= 16
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  CHECK ((status IN ('pending', 'running')) = (completed_at IS NULL))
);
CREATE INDEX artifact_validation_run_promotion_idx
  ON artifact_validation_run(artifact_id, artifact_version, status, completed_at DESC);

CREATE TABLE artifact_approval (
  approval_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  approver_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 4096),
  validation_summary_hash text NOT NULL CHECK (
    validation_summary_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  UNIQUE (artifact_id, artifact_version, approver_id, decision, validation_summary_hash)
);
CREATE INDEX artifact_approval_lookup_idx
  ON artifact_approval(artifact_id, artifact_version, decision, created_at DESC);

CREATE TABLE artifact_execution (
  artifact_execution_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  task_id text NOT NULL,
  goal_id text,
  goal_version integer CHECK (goal_version >= 1),
  mode text NOT NULL,
  decision_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(decision_snapshot) = 'object'
    AND octet_length(decision_snapshot::text) <= 262144
    AND sdar_jsonb_depth(decision_snapshot) <= 32
  ),
  generated_plan_id text,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'canceled')),
  fallback_reason_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  UNIQUE (artifact_execution_id, artifact_id),
  CHECK ((status = 'started') = (completed_at IS NULL))
);
CREATE INDEX artifact_execution_task_idx
  ON artifact_execution(task_id, started_at DESC, artifact_execution_id);

CREATE TABLE artifact_feedback (
  feedback_id text PRIMARY KEY,
  artifact_execution_id text NOT NULL,
  artifact_id text NOT NULL REFERENCES compiled_artifact(artifact_id),
  feedback_type text NOT NULL,
  reason_code text NOT NULL,
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4096),
  impact jsonb NOT NULL CHECK (
    jsonb_typeof(impact) = 'object'
    AND octet_length(impact::text) <= 262144
    AND sdar_jsonb_depth(impact) <= 16
  ),
  outcome_ref text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_execution_id, artifact_id)
    REFERENCES artifact_execution(artifact_execution_id, artifact_id)
);

CREATE TABLE artifact_match_log (
  match_id text PRIMARY KEY,
  request_id text NOT NULL,
  task_id text NOT NULL,
  candidate_artifact_id text NOT NULL REFERENCES compiled_artifact(artifact_id),
  score jsonb NOT NULL CHECK (
    jsonb_typeof(score) = 'object'
    AND octet_length(score::text) <= 262144
    AND sdar_jsonb_depth(score) <= 16
  ),
  applicability jsonb NOT NULL CHECK (
    jsonb_typeof(applicability) = 'object'
    AND octet_length(applicability::text) <= 262144
    AND sdar_jsonb_depth(applicability) <= 16
  ),
  decision text NOT NULL,
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array' AND jsonb_array_length(reason_codes) <= 4096
    AND octet_length(reason_codes::text) <= 262144
    AND sdar_jsonb_depth(reason_codes) <= 16
  ),
  policy_snapshot_hash text NOT NULL CHECK (policy_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX artifact_match_log_task_idx
  ON artifact_match_log(task_id, created_at DESC, match_id);

CREATE TABLE experience_trace (
  trace_id text PRIMARY KEY,
  source_episode_id text NOT NULL,
  task_type_refs jsonb NOT NULL CHECK (
    jsonb_typeof(task_type_refs) = 'array' AND jsonb_array_length(task_type_refs) <= 4096
    AND octet_length(task_type_refs::text) <= 262144
    AND sdar_jsonb_depth(task_type_refs) <= 16
  ),
  goal_fingerprint text NOT NULL,
  capability_fingerprint text NOT NULL,
  environment_fingerprint text NOT NULL,
  trace jsonb NOT NULL CHECK (
    jsonb_typeof(trace) = 'object'
    AND octet_length(trace::text) <= 1048576
    AND sdar_jsonb_depth(trace) <= 32
  ),
  completeness numeric(5,4) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL
);

CREATE TABLE pattern_candidate (
  pattern_id text PRIMARY KEY,
  pattern_type text NOT NULL,
  cohort_fingerprint text NOT NULL,
  definition jsonb NOT NULL CHECK (
    jsonb_typeof(definition) = 'object'
    AND octet_length(definition::text) <= 1048576
    AND sdar_jsonb_depth(definition) <= 32
  ),
  support_refs jsonb NOT NULL CHECK (
    jsonb_typeof(support_refs) = 'array' AND jsonb_array_length(support_refs) <= 4096
    AND octet_length(support_refs::text) <= 262144
    AND sdar_jsonb_depth(support_refs) <= 16
  ),
  contradiction_refs jsonb NOT NULL CHECK (
    jsonb_typeof(contradiction_refs) = 'array'
    AND jsonb_array_length(contradiction_refs) <= 4096
    AND octet_length(contradiction_refs::text) <= 262144
    AND sdar_jsonb_depth(contradiction_refs) <= 16
  ),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL CHECK (status IN ('discovered', 'candidate', 'rejected')),
  created_at timestamptz NOT NULL
);

CREATE FUNCTION sdar_enforce_compiled_artifact_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.artifact_id,NEW.artifact_key,NEW.version,NEW.artifact_type,NEW.tenant_id,
    NEW.domain,NEW.risk_level,NEW.definition,NEW.applicability,NEW.dependency_snapshot,
    NEW.lineage_id,NEW.content_hash,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.artifact_id,OLD.artifact_key,OLD.version,OLD.artifact_type,OLD.tenant_id,
    OLD.domain,OLD.risk_level,OLD.definition,OLD.applicability,OLD.dependency_snapshot,
    OLD.lineage_id,OLD.content_hash,OLD.created_at
  ) THEN
    RAISE EXCEPTION 'compiled Artifact immutable content cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compiled_artifact_immutability
BEFORE UPDATE ON compiled_artifact
FOR EACH ROW EXECUTE FUNCTION sdar_enforce_compiled_artifact_immutability();

ALTER TABLE cognitive_management_action
  DROP CONSTRAINT cognitive_management_action_operation_check;
ALTER TABLE cognitive_management_action
  ADD CONSTRAINT cognitive_management_action_operation_check CHECK (operation IN (
    'goal_session_action',
    'planning_session_action',
    'capability_rebuild',
    'capability_card_rebuild',
    'experience_dead_letter_replay',
    'knowledge_promote',
    'knowledge_reject',
    'knowledge_revalidate',
    'knowledge_deprecate',
    'artifact_request_validation',
    'artifact_record_approval',
    'artifact_activate',
    'artifact_request_revalidation',
    'artifact_deprecate',
    'artifact_rollback',
    'artifact_kill_switch'
  ));

INSERT INTO schema_migration(version)
VALUES ('0125_v13_artifact_authority');

COMMIT;
