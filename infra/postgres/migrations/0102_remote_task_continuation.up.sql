BEGIN;

ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','waiting_external','succeeded','failed','canceled','invalidated')
);

ALTER TABLE skill_call_workflow DROP CONSTRAINT IF EXISTS skill_call_workflow_status_check;
ALTER TABLE skill_call_workflow ADD CONSTRAINT skill_call_workflow_status_check CHECK(
  status IN (
    'awaiting_confirmation','running','waiting_external','succeeded','failed','canceled',
    'rejected','invalidated'
  )
);
CREATE INDEX skill_call_workflow_child_instance_continuation_idx
  ON skill_call_workflow(child_instance_id,status)
  WHERE child_instance_id IS NOT NULL;

ALTER TABLE remote_task_control_event
  ADD COLUMN continuation_claim_token text,
  ADD COLUMN continuation_claim_expires_at timestamptz,
  ADD COLUMN continuation_claim_attempt integer NOT NULL DEFAULT 0
    CHECK (continuation_claim_attempt >= 0);

ALTER TABLE remote_task_control_event ADD CONSTRAINT remote_task_control_continuation_claim_check
  CHECK (
    (continuation_claim_token IS NULL AND continuation_claim_expires_at IS NULL)
    OR
    (length(btrim(continuation_claim_token)) BETWEEN 1 AND 256
      AND claimed_at IS NOT NULL
      AND continuation_claim_expires_at > claimed_at)
  );

CREATE UNIQUE INDEX remote_task_control_continuation_claim_token_idx
  ON remote_task_control_event(continuation_claim_token)
  WHERE continuation_claim_token IS NOT NULL;
CREATE INDEX remote_task_control_continuation_inbox_idx
  ON remote_task_control_event(status,continuation_claim_expires_at,created_at,event_id)
  WHERE status IN ('pending','claimed');

CREATE TABLE workflow_continuation_snapshot (
  snapshot_id text PRIMARY KEY CHECK (length(btrim(snapshot_id)) BETWEEN 1 AND 256),
  continuation_id text NOT NULL CHECK (length(btrim(continuation_id)) BETWEEN 1 AND 256),
  state_version bigint NOT NULL CHECK (state_version > 0),
  predecessor_snapshot_id text
    REFERENCES workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT,
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  lifecycle text NOT NULL CHECK (
    lifecycle IN ('building','active','superseded','invalidated','terminal')
  ),
  agent_task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  context_id text NOT NULL REFERENCES conversation_context(context_id) ON DELETE RESTRICT,
  workflow_control_id text NOT NULL REFERENCES workflow_control(control_id) ON DELETE RESTRICT,
  goal_id text NOT NULL REFERENCES goal(goal_id) ON DELETE RESTRICT,
  goal_version integer NOT NULL CHECK (goal_version > 0),
  workflow_plan_id text NOT NULL REFERENCES workflow_plan(plan_id) ON DELETE RESTRICT,
  workflow_definition_id text NOT NULL CHECK (length(btrim(workflow_definition_id)) > 0),
  workflow_definition_version integer NOT NULL CHECK (workflow_definition_version > 0),
  workflow_definition_hash text NOT NULL CHECK (workflow_definition_hash ~ '^[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  workflow_instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  state_json jsonb NOT NULL CHECK (octet_length(state_json::text) <= 1048576),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (continuation_id,state_version),
  UNIQUE (workflow_instance_id,state_version),
  UNIQUE (snapshot_id,continuation_id,state_version),
  CHECK (
    (state_version = 1 AND predecessor_snapshot_id IS NULL)
    OR (state_version > 1 AND predecessor_snapshot_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workflow_continuation_snapshot_predecessor_idx
  ON workflow_continuation_snapshot(predecessor_snapshot_id)
  WHERE predecessor_snapshot_id IS NOT NULL;
CREATE UNIQUE INDEX workflow_continuation_snapshot_active_idx
  ON workflow_continuation_snapshot(continuation_id)
  WHERE lifecycle = 'active';
CREATE UNIQUE INDEX workflow_continuation_snapshot_active_instance_idx
  ON workflow_continuation_snapshot(workflow_instance_id)
  WHERE lifecycle = 'active';
CREATE INDEX workflow_continuation_snapshot_instance_idx
  ON workflow_continuation_snapshot(workflow_instance_id,state_version DESC);
CREATE INDEX workflow_continuation_snapshot_reconcile_idx
  ON workflow_continuation_snapshot(lifecycle,updated_at,continuation_id)
  WHERE lifecycle IN ('building','active');

CREATE TABLE workflow_continuation_wait_binding (
  snapshot_id text NOT NULL,
  wait_id text NOT NULL CHECK (length(btrim(wait_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  wait_kind text NOT NULL CHECK (wait_kind = 'remote_task'),
  node_id text NOT NULL CHECK (length(btrim(node_id)) BETWEEN 1 AND 256),
  node_run_id text NOT NULL CHECK (length(btrim(node_run_id)) BETWEEN 1 AND 1024),
  wait_state text NOT NULL CHECK (wait_state IN ('waiting','awaiting_input')),
  PRIMARY KEY (snapshot_id,wait_id),
  UNIQUE (snapshot_id,binding_id),
  UNIQUE (snapshot_id,node_run_id)
);

CREATE INDEX workflow_continuation_wait_binding_lookup_idx
  ON workflow_continuation_wait_binding(binding_id,snapshot_id);

CREATE TABLE workflow_continuation_attempt (
  attempt_id text PRIMARY KEY CHECK (length(btrim(attempt_id)) BETWEEN 1 AND 256),
  event_id text NOT NULL REFERENCES remote_task_control_event(event_id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL
    REFERENCES workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT,
  continuation_id text NOT NULL CHECK (length(btrim(continuation_id)) BETWEEN 1 AND 256),
  workflow_instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  snapshot_state_version bigint NOT NULL CHECK (snapshot_state_version > 0),
  claim_token text NOT NULL CHECK (length(btrim(claim_token)) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (
    status IN ('claimed','running','waiting_external','succeeded','failed','canceled','stale')
  ),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  UNIQUE (claim_token),
  FOREIGN KEY (snapshot_id,continuation_id,snapshot_state_version)
    REFERENCES workflow_continuation_snapshot(snapshot_id,continuation_id,state_version)
    ON DELETE RESTRICT,
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (
    completed_at IS NULL
    OR (started_at IS NOT NULL AND completed_at >= started_at)
    OR (status = 'stale' AND completed_at >= created_at)
  ),
  CHECK (
    (status = 'claimed' AND started_at IS NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('waiting_external','succeeded','canceled')
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'stale'
      AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed'
      AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND length(btrim(error_code)) > 0)
  )
);

CREATE INDEX workflow_continuation_attempt_continuation_idx
  ON workflow_continuation_attempt(continuation_id,created_at,attempt_id);
CREATE INDEX workflow_continuation_attempt_status_idx
  ON workflow_continuation_attempt(status,created_at,attempt_id)
  WHERE status IN ('claimed','running');

INSERT INTO schema_migration(version) VALUES('0102_remote_task_continuation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
