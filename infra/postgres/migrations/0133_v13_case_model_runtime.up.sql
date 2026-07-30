-- 0133_v13_case_model_runtime.up.sql
-- P11 type-specific evidence. P02 core Artifact rows and the existing model
-- provider/credential tables remain authoritative.

BEGIN;

CREATE TABLE case_runtime_match (
  runtime_request_ref text PRIMARY KEY,
  tenant_id text NOT NULL,
  goal_context_ref text NOT NULL,
  task_type_id text NOT NULL,
  request_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(request_snapshot) = 'object'
    AND octet_length(request_snapshot::text) <= 524288
    AND sdar_jsonb_depth(request_snapshot) <= 16
  ),
  matches jsonb NOT NULL CHECK (
    jsonb_typeof(matches) = 'array'
    AND jsonb_array_length(matches) <= 256
    AND octet_length(matches::text) <= 524288
    AND sdar_jsonb_depth(matches) <= 16
  ),
  created_at timestamptz NOT NULL
);
CREATE INDEX case_runtime_match_tenant_task_idx
  ON case_runtime_match(tenant_id, task_type_id, created_at DESC);

CREATE TABLE case_runtime_adaptation (
  adaptation_id text PRIMARY KEY,
  case_ref text NOT NULL,
  goal_context_ref text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  active_pointer_version bigint NOT NULL CHECK (active_pointer_version >= 0),
  request_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(request_snapshot) = 'object'
    AND octet_length(request_snapshot::text) <= 524288
    AND sdar_jsonb_depth(request_snapshot) <= 16
  ),
  adaptation_result jsonb NOT NULL CHECK (
    jsonb_typeof(adaptation_result) = 'object'
    AND octet_length(adaptation_result::text) <= 524288
    AND sdar_jsonb_depth(adaptation_result) <= 16
  ),
  created_at timestamptz NOT NULL
);
CREATE INDEX case_runtime_adaptation_case_idx
  ON case_runtime_adaptation(case_ref, created_at DESC);

CREATE TABLE model_route_decision (
  route_decision_ref text PRIMARY KEY,
  tenant_id text NOT NULL,
  request_ref text NOT NULL,
  artifact_ref text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  active_pointer_version bigint NOT NULL CHECK (active_pointer_version >= 0),
  route_context jsonb NOT NULL CHECK (
    jsonb_typeof(route_context) = 'object'
    AND octet_length(route_context::text) <= 524288
    AND sdar_jsonb_depth(route_context) <= 16
  ),
  route_decision jsonb NOT NULL CHECK (
    jsonb_typeof(route_decision) = 'object'
    AND octet_length(route_decision::text) <= 524288
    AND sdar_jsonb_depth(route_decision) <= 16
  ),
  decision_hash text NOT NULL CHECK (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX model_route_decision_tenant_request_idx
  ON model_route_decision(tenant_id, request_ref, created_at DESC);

CREATE TABLE model_cascade_run (
  cascade_run_id text PRIMARY KEY,
  route_decision_ref text NOT NULL REFERENCES model_route_decision(route_decision_ref),
  decision_hash text NOT NULL CHECK (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  run_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(run_snapshot) = 'object'
    AND octet_length(run_snapshot::text) <= 524288
    AND sdar_jsonb_depth(run_snapshot) <= 16
  ),
  status text NOT NULL CHECK (status IN (
    'running','completed','fallback','cancelled','timed_out','budget_exhausted','failed'
  )),
  completed_at timestamptz
);
CREATE INDEX model_cascade_run_route_idx
  ON model_cascade_run(route_decision_ref, cascade_run_id);

CREATE TABLE model_cascade_step (
  step_ref text PRIMARY KEY,
  cascade_run_id text NOT NULL REFERENCES model_cascade_run(cascade_run_id) ON DELETE CASCADE,
  profile_ref text NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 16),
  status text NOT NULL CHECK (status IN ('accepted','rejected','failed','discarded_stale')),
  step_evidence jsonb NOT NULL CHECK (
    jsonb_typeof(step_evidence) = 'object'
    AND octet_length(step_evidence::text) <= 131072
    AND sdar_jsonb_depth(step_evidence) <= 12
  )
);
CREATE INDEX model_cascade_step_run_idx
  ON model_cascade_step(cascade_run_id, step_ref);

INSERT INTO schema_migration(version)
VALUES ('0133_v13_case_model_runtime');

COMMIT;
