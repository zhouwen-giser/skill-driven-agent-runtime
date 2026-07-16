BEGIN;

ALTER TABLE mcp_tool ADD COLUMN IF NOT EXISTS task_execution_json jsonb;

CREATE TABLE task_execution_readiness (
  readiness_id text PRIMARY KEY CHECK (length(btrim(readiness_id)) BETWEEN 1 AND 256),
  workflow_plan_id text NOT NULL,
  plan_attempt integer NOT NULL CHECK (plan_attempt > 0),
  check_phase text NOT NULL CHECK (check_phase IN ('planning','pre_invocation')),
  workflow_instance_id text,
  workflow_node_run_id text,
  dsl_hash text NOT NULL CHECK (dsl_hash ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL CHECK (
    disposition IN ('ready','confirmation_required','revision_required','blocked')
  ),
  permitted_actions_json jsonb NOT NULL,
  model_decision_json jsonb,
  guard_action text NOT NULL CHECK (
    guard_action IN ('proceed','reschedule','revise_dsl','request_confirmation','abort')
  ),
  guard_reason_codes_json jsonb NOT NULL,
  confirmation_required boolean NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (workflow_plan_id,plan_attempt)
    REFERENCES workflow_plan_attempt(plan_id,attempt) ON DELETE RESTRICT,
  CHECK (octet_length(permitted_actions_json::text) <= 1048576),
  CHECK (model_decision_json IS NULL OR octet_length(model_decision_json::text) <= 1048576),
  CHECK (octet_length(guard_reason_codes_json::text) <= 1048576),
  CHECK (
    (check_phase='planning' AND workflow_instance_id IS NULL AND workflow_node_run_id IS NULL)
    OR
    (check_phase='pre_invocation'
      AND length(btrim(workflow_instance_id)) > 0
      AND length(btrim(workflow_node_run_id)) > 0)
  ),
  CHECK (
    (disposition='confirmation_required' AND confirmation_required)
    OR (disposition<>'confirmation_required' AND NOT confirmation_required)
  )
);

CREATE INDEX task_execution_readiness_plan_idx
  ON task_execution_readiness(workflow_plan_id,created_at DESC,readiness_id);
CREATE INDEX task_execution_readiness_instance_idx
  ON task_execution_readiness(workflow_instance_id,workflow_node_run_id)
  WHERE check_phase='pre_invocation';

CREATE TABLE task_availability_snapshot (
  snapshot_id text PRIMARY KEY CHECK (length(btrim(snapshot_id)) BETWEEN 1 AND 256),
  readiness_id text NOT NULL REFERENCES task_execution_readiness(readiness_id) ON DELETE RESTRICT,
  node_id text NOT NULL CHECK (length(btrim(node_id)) BETWEEN 1 AND 256),
  server_id text NOT NULL CHECK (length(btrim(server_id)) BETWEEN 1 AND 256),
  operation_name text NOT NULL CHECK (length(btrim(operation_name)) BETWEEN 1 AND 512),
  arguments_snapshot_json jsonb NOT NULL,
  arguments_hash text NOT NULL CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  timing_snapshot_json jsonb,
  result_json jsonb NOT NULL,
  availability text NOT NULL CHECK (availability IN ('available','restricted','disabled','unknown')),
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  reservation_mode text NOT NULL CHECK (reservation_mode IN ('none','best_effort','guaranteed')),
  reservation_ref text,
  valid_until timestamptz,
  source_revision text NOT NULL CHECK (length(btrim(source_revision)) > 0),
  checked_at timestamptz NOT NULL,
  normalization_reason_codes_json jsonb NOT NULL,
  UNIQUE(readiness_id,node_id),
  CHECK (octet_length(arguments_snapshot_json::text) <= 1048576),
  CHECK (timing_snapshot_json IS NULL OR octet_length(timing_snapshot_json::text) <= 1048576),
  CHECK (octet_length(result_json::text) <= 1048576),
  CHECK (octet_length(normalization_reason_codes_json::text) <= 1048576),
  CHECK (
    (reservation_mode='guaranteed' AND reservation_ref IS NOT NULL AND length(btrim(reservation_ref)) > 0)
    OR (reservation_mode<>'guaranteed')
  )
);

CREATE INDEX task_availability_snapshot_lookup_idx
  ON task_availability_snapshot(readiness_id,node_id);
CREATE INDEX task_availability_snapshot_validity_idx
  ON task_availability_snapshot(server_id,operation_name,valid_until);

INSERT INTO schema_migration(version) VALUES('0101_task_execution_readiness')
ON CONFLICT(version) DO NOTHING;

COMMIT;
