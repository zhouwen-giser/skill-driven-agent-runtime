BEGIN;

CREATE TABLE remote_task_binding (
  binding_id text PRIMARY KEY CHECK (length(btrim(binding_id)) BETWEEN 1 AND 256),
  server_id text NOT NULL CHECK (length(btrim(server_id)) BETWEEN 1 AND 256),
  operation_name text NOT NULL CHECK (length(btrim(operation_name)) BETWEEN 1 AND 512),
  remote_task_id text NOT NULL CHECK (
    length(remote_task_id) BETWEEN 1 AND 512
    AND remote_task_id ~ '^[!-~]+$'
  ),
  agent_task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  context_id text NOT NULL REFERENCES conversation_context(context_id) ON DELETE RESTRICT,
  goal_id text NOT NULL REFERENCES goal(goal_id) ON DELETE RESTRICT,
  goal_version integer NOT NULL CHECK (goal_version > 0),
  workflow_plan_id text NOT NULL REFERENCES workflow_plan(plan_id) ON DELETE RESTRICT,
  workflow_definition_id text NOT NULL CHECK (length(btrim(workflow_definition_id)) > 0),
  workflow_definition_version integer NOT NULL CHECK (workflow_definition_version > 0),
  workflow_instance_id text NOT NULL REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  workflow_node_id text NOT NULL CHECK (length(btrim(workflow_node_id)) > 0),
  workflow_node_run_id text NOT NULL CHECK (length(btrim(workflow_node_run_id)) BETWEEN 1 AND 1024),
  parent_workflow_instance_id text,
  parent_skill_call_id text,
  mcp_invocation_id text NOT NULL UNIQUE REFERENCES mcp_invocation(invocation_id) ON DELETE RESTRICT,
  protocol_status text NOT NULL CHECK (
    protocol_status IN ('working','input_required','completed','failed','cancelled')
  ),
  protocol_revision text NOT NULL CHECK (length(btrim(protocol_revision)) > 0),
  tasks_schema_revision text NOT NULL CHECK (length(btrim(tasks_schema_revision)) > 0),
  provider_substate text CHECK (
    provider_substate IS NULL OR provider_substate IN (
      'scheduled','queued','running','paused','resuming','stopping'
    )
  ),
  remote_revision text,
  last_provider_updated_at timestamptz NOT NULL,
  local_state text NOT NULL CHECK (
    local_state IN (
      'polling','awaiting_input','terminal_event_pending','terminal_event_claimed',
      'reentered','closed','quarantined'
    )
  ),
  requested_timing_json jsonb,
  execution_mode text NOT NULL CHECK (
    execution_mode IN ('live','simulation','historical-replay')
  ),
  simulation_id text,
  credential_revision text NOT NULL CHECK (length(btrim(credential_revision)) > 0),
  session_revision text NOT NULL CHECK (length(btrim(session_revision)) > 0),
  poll_interval_ms integer NOT NULL CHECK (poll_interval_ms BETWEEN 100 AND 86400000),
  next_poll_at timestamptz,
  poll_attempt integer NOT NULL DEFAULT 0 CHECK (poll_attempt >= 0),
  provider_failure_count integer NOT NULL DEFAULT 0 CHECK (provider_failure_count >= 0),
  poll_claim_token text,
  poll_claimed_at timestamptz,
  poll_claim_expires_at timestamptz,
  result_snapshot_json jsonb,
  error_snapshot_json jsonb,
  last_safe_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  terminal_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (server_id, remote_task_id),
  UNIQUE (workflow_instance_id, workflow_node_run_id),
  CHECK (
    (execution_mode = 'live' AND simulation_id IS NULL)
    OR
    (execution_mode IN ('simulation','historical-replay')
      AND length(btrim(simulation_id)) BETWEEN 1 AND 256
      AND simulation_id ~ '^[!-~]+$')
  ),
  CHECK (
    (poll_claim_token IS NULL AND poll_claimed_at IS NULL AND poll_claim_expires_at IS NULL)
    OR
    (length(btrim(poll_claim_token)) > 0
      AND poll_claimed_at IS NOT NULL
      AND poll_claim_expires_at > poll_claimed_at)
  ),
  CHECK (next_poll_at IS NULL OR local_state = 'polling'),
  CHECK (terminal_at IS NULL OR protocol_status IN ('completed','failed','cancelled')),
  CHECK (requested_timing_json IS NULL OR octet_length(requested_timing_json::text) <= 1048576),
  CHECK (result_snapshot_json IS NULL OR octet_length(result_snapshot_json::text) <= 1048576),
  CHECK (error_snapshot_json IS NULL OR octet_length(error_snapshot_json::text) <= 1048576)
);

CREATE INDEX remote_task_binding_poll_idx
  ON remote_task_binding(next_poll_at,binding_id)
  WHERE local_state='polling' AND invalidated_at IS NULL AND terminal_at IS NULL;
CREATE INDEX remote_task_binding_claim_expiry_idx
  ON remote_task_binding(poll_claim_expires_at,binding_id)
  WHERE poll_claim_expires_at IS NOT NULL;
CREATE INDEX remote_task_binding_task_idx
  ON remote_task_binding(agent_task_id,created_at,binding_id);
CREATE INDEX remote_task_binding_context_idx
  ON remote_task_binding(context_id,created_at,binding_id);
CREATE INDEX remote_task_binding_workflow_idx
  ON remote_task_binding(workflow_instance_id,workflow_node_run_id);

CREATE TABLE remote_task_observation (
  observation_id text PRIMARY KEY CHECK (length(btrim(observation_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  observation_type text NOT NULL CHECK (
    observation_type IN (
      'task.accepted','task.snapshot','task.scheduled','task.started','task.paused',
      'task.resumed','task.progress','task.heartbeat','provider_unreachable','schema_invalid'
    )
  ),
  provider_event_id text,
  remote_revision text,
  payload_json jsonb NOT NULL CHECK (octet_length(payload_json::text) <= 1048576),
  accepted boolean NOT NULL,
  rejection_reason text CHECK (
    rejection_reason IS NULL OR rejection_reason IN ('stale_provider_revision','binding_closed')
  ),
  observed_at timestamptz NOT NULL,
  UNIQUE (binding_id, sequence),
  CHECK ((accepted AND rejection_reason IS NULL) OR (NOT accepted AND rejection_reason IS NOT NULL))
);

CREATE UNIQUE INDEX remote_task_observation_provider_event_idx
  ON remote_task_observation(binding_id,provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX remote_task_observation_order_idx
  ON remote_task_observation(binding_id,sequence);

CREATE TABLE remote_task_control_event (
  event_id text PRIMARY KEY CHECK (length(btrim(event_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('task.input_required','task.completed','task.failed','task.cancelled')
  ),
  remote_revision text NOT NULL CHECK (length(btrim(remote_revision)) > 0),
  result_hash text NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL CHECK (octet_length(payload_json::text) <= 1048576),
  status text NOT NULL CHECK (status IN ('pending','claimed','processed','failed')),
  created_at timestamptz NOT NULL,
  claimed_at timestamptz,
  processed_at timestamptz,
  error_code text,
  UNIQUE (binding_id,event_type,remote_revision,result_hash),
  CHECK (
    (status='pending' AND claimed_at IS NULL AND processed_at IS NULL)
    OR (status='claimed' AND claimed_at IS NOT NULL AND processed_at IS NULL)
    OR (status IN ('processed','failed') AND claimed_at IS NOT NULL AND processed_at IS NOT NULL)
  )
);

CREATE INDEX remote_task_control_pending_idx
  ON remote_task_control_event(status,created_at,event_id);
CREATE INDEX remote_task_control_binding_idx
  ON remote_task_control_event(binding_id,created_at,event_id);

CREATE TABLE remote_task_protocol_attempt (
  attempt_id text PRIMARY KEY CHECK (length(btrim(attempt_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method='tasks/get'),
  expected_binding_version bigint NOT NULL CHECK (expected_binding_version > 0),
  protocol_revision text NOT NULL CHECK (length(btrim(protocol_revision)) > 0),
  status text NOT NULL CHECK (
    status IN ('succeeded','provider_unreachable','contract_invalid','provider_protocol')
  ),
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0)
);

CREATE INDEX remote_task_protocol_attempt_binding_idx
  ON remote_task_protocol_attempt(binding_id,started_at,attempt_id);

INSERT INTO schema_migration(version) VALUES('0100_remote_mcp_task_tracking')
ON CONFLICT(version) DO NOTHING;

COMMIT;
