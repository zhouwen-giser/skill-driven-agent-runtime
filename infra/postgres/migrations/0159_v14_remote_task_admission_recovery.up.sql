BEGIN;

CREATE TABLE remote_task_admission_intent (
  intent_id text PRIMARY KEY CHECK (length(btrim(intent_id)) BETWEEN 1 AND 256),
  invocation_id text NOT NULL UNIQUE CHECK (length(btrim(invocation_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL UNIQUE CHECK (length(btrim(binding_id)) BETWEEN 1 AND 256),
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  capability_attempt_id text,
  context_id text NOT NULL REFERENCES conversation_context(context_id) ON DELETE RESTRICT,
  server_id text NOT NULL,
  operation_name text NOT NULL,
  arguments_hash char(64) NOT NULL CHECK (arguments_hash ~ '^[a-f0-9]{64}$'),
  local_envelope_json jsonb NOT NULL
    CHECK (octet_length(local_envelope_json::text) <= 1048576),
  status text NOT NULL CHECK (
    status IN (
      'prepared','dispatching','receipt_recorded','materialized','uncertain','closed'
    )
  ),
  dispatch_hash varchar(71),
  dispatched_at timestamptz,
  recorded_invocation_id text UNIQUE REFERENCES mcp_invocation(invocation_id) ON DELETE RESTRICT,
  remote_receipt_json jsonb
    CHECK (remote_receipt_json IS NULL OR octet_length(remote_receipt_json::text) <= 2097152),
  receipt_recorded_at timestamptz,
  materialized_binding_id text UNIQUE REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  materialized_snapshot_id text
    REFERENCES workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT,
  materialized_at timestamptz,
  reason_code text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT remote_task_admission_attempt_fk
    FOREIGN KEY(capability_attempt_id,task_id)
    REFERENCES task_capability_execution_attempt(attempt_id,task_id) ON DELETE RESTRICT,
  CONSTRAINT remote_task_admission_tool_fk
    FOREIGN KEY(server_id,operation_name)
    REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (
    (dispatch_hash IS NULL AND dispatched_at IS NULL)
    OR
    (dispatch_hash ~ '^sha256:[a-f0-9]{64}$' AND dispatched_at IS NOT NULL)
  ),
  CHECK (
    (recorded_invocation_id IS NULL AND remote_receipt_json IS NULL AND receipt_recorded_at IS NULL)
    OR
    (recorded_invocation_id = invocation_id
      AND remote_receipt_json IS NOT NULL
      AND (jsonb_typeof(remote_receipt_json->'continuation'->'snapshot') = 'object') IS TRUE
      AND ((remote_receipt_json->'continuation'->>'completeness')
        IN ('exact_single','requires_graph_merge','exact_final')) IS TRUE
      AND (jsonb_typeof(
        remote_receipt_json->'continuation'->'snapshot'->'waitingNodeRuns'
      ) = 'array') IS TRUE
      AND receipt_recorded_at IS NOT NULL)
  ),
  CHECK (
    (materialized_binding_id IS NULL AND materialized_snapshot_id IS NULL AND materialized_at IS NULL)
    OR
    (materialized_binding_id = binding_id
      AND materialized_snapshot_id IS NOT NULL
      AND materialized_at IS NOT NULL)
  ),
  CHECK (
    (status='prepared'
      AND dispatch_hash IS NULL
      AND recorded_invocation_id IS NULL
      AND materialized_binding_id IS NULL
      AND materialized_snapshot_id IS NULL
      AND reason_code IS NULL
      AND closed_at IS NULL)
    OR
    (status='dispatching'
      AND dispatch_hash IS NOT NULL
      AND recorded_invocation_id IS NULL
      AND materialized_binding_id IS NULL
      AND materialized_snapshot_id IS NULL
      AND reason_code IS NULL
      AND closed_at IS NULL)
    OR
    (status='receipt_recorded'
      AND dispatch_hash IS NOT NULL
      AND recorded_invocation_id IS NOT NULL
      AND materialized_binding_id IS NULL
      AND materialized_snapshot_id IS NULL
      AND reason_code IS NULL
      AND closed_at IS NULL)
    OR
    (status='materialized'
      AND dispatch_hash IS NOT NULL
      AND recorded_invocation_id IS NOT NULL
      AND materialized_binding_id IS NOT NULL
      AND materialized_snapshot_id IS NOT NULL
      AND reason_code IS NULL
      AND closed_at IS NOT NULL)
    OR
    (status='uncertain'
      AND dispatch_hash IS NOT NULL
      AND materialized_binding_id IS NULL
      AND materialized_snapshot_id IS NULL
      AND (
        (recorded_invocation_id IS NULL AND materialized_binding_id IS NULL)
        OR
        recorded_invocation_id = invocation_id
      )
      AND length(btrim(reason_code)) > 0
      AND closed_at IS NOT NULL)
    OR
    (status='closed'
      AND recorded_invocation_id IS NULL
      AND materialized_binding_id IS NULL
      AND materialized_snapshot_id IS NULL
      AND length(btrim(reason_code)) > 0
      AND closed_at IS NOT NULL)
  )
);

CREATE INDEX remote_task_admission_recovery_idx
  ON remote_task_admission_intent(status,updated_at,intent_id)
  WHERE status IN ('prepared','dispatching','receipt_recorded');
CREATE INDEX remote_task_admission_task_idx
  ON remote_task_admission_intent(task_id,created_at,intent_id);

CREATE INDEX remote_task_admission_binding_idx
  ON remote_task_admission_intent(binding_id);
CREATE INDEX remote_task_admission_snapshot_idx
  ON remote_task_admission_intent(materialized_snapshot_id)
  WHERE materialized_snapshot_id IS NOT NULL;

INSERT INTO schema_migration(version)
VALUES('0159_v14_remote_task_admission_recovery');

COMMIT;
