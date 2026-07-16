BEGIN;

ALTER TABLE task_input_request DROP CONSTRAINT IF EXISTS task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK(
  source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow','remote_task')
);

ALTER TABLE remote_task_binding DROP CONSTRAINT remote_task_binding_local_state_check;
ALTER TABLE remote_task_binding ADD CONSTRAINT remote_task_binding_local_state_check CHECK(
  local_state IN (
    'polling','cancel_observing','awaiting_input','terminal_event_pending',
    'terminal_event_claimed','reentered','closed','quarantined'
  )
);

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid='remote_task_binding'::regclass
    AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%next_poll_at IS NULL%local_state%polling%';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'remote_task_binding next_poll_at constraint was not found';
  END IF;
  EXECUTE format('ALTER TABLE remote_task_binding DROP CONSTRAINT %I', constraint_name);
END $$;

ALTER TABLE remote_task_binding ADD CONSTRAINT remote_task_binding_next_poll_state_check CHECK(
  next_poll_at IS NULL OR local_state IN ('polling','cancel_observing')
);

CREATE INDEX remote_task_binding_cancel_observation_idx
  ON remote_task_binding(next_poll_at,binding_id)
  WHERE local_state='cancel_observing' AND terminal_at IS NULL;

ALTER TABLE remote_task_binding ADD CONSTRAINT remote_task_binding_input_authority_unique
  UNIQUE(binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id);

CREATE TABLE remote_task_input_link (
  input_request_id text PRIMARY KEY
    REFERENCES task_input_request(input_request_id) ON DELETE RESTRICT,
  control_event_id text NOT NULL UNIQUE
    REFERENCES remote_task_control_event(event_id) ON DELETE RESTRICT,
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  remote_task_id text NOT NULL CHECK(
    length(remote_task_id) BETWEEN 1 AND 512 AND remote_task_id ~ '^[!-~]+$'
  ),
  workflow_instance_id text NOT NULL
    REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  workflow_node_id text NOT NULL CHECK(length(btrim(workflow_node_id)) BETWEEN 1 AND 256),
  workflow_node_run_id text NOT NULL
    CHECK(length(btrim(workflow_node_run_id)) BETWEEN 1 AND 1024),
  remote_revision text NOT NULL CHECK(length(btrim(remote_revision)) BETWEEN 1 AND 1024),
  result_hash text NOT NULL CHECK(result_hash ~ '^[0-9a-f]{64}$'),
  input_requests_json jsonb NOT NULL
    CHECK(octet_length(input_requests_json::text) <= 1048576),
  status text NOT NULL CHECK(
    status IN ('waiting','answered','update_acknowledged','update_uncertain','provider_advanced')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(binding_id,remote_revision,result_hash),
  UNIQUE(input_request_id,binding_id),
  FOREIGN KEY(binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id)
    REFERENCES remote_task_binding(
      binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id
    ) ON DELETE RESTRICT
);

CREATE FUNCTION enforce_remote_task_input_context_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM task_input_request request
    JOIN remote_task_binding binding ON binding.binding_id=NEW.binding_id
    WHERE request.input_request_id=NEW.input_request_id
      AND request.task_id=binding.agent_task_id
      AND request.context_id=binding.context_id
  ) THEN
    RAISE EXCEPTION 'REMOTE_TASK_INPUT_CONTEXT_AUTHORITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER remote_task_input_context_authority_trigger
BEFORE INSERT OR UPDATE ON remote_task_input_link
FOR EACH ROW EXECUTE FUNCTION enforce_remote_task_input_context_authority();

CREATE INDEX remote_task_input_link_binding_idx
  ON remote_task_input_link(binding_id,created_at,input_request_id);
CREATE INDEX remote_task_input_link_status_idx
  ON remote_task_input_link(status,updated_at,input_request_id)
  WHERE status IN ('waiting','answered','update_uncertain');

CREATE TABLE remote_task_input_attempt (
  attempt_id text PRIMARY KEY CHECK(length(btrim(attempt_id)) BETWEEN 1 AND 256),
  input_request_id text NOT NULL,
  binding_id text NOT NULL,
  expected_binding_version bigint NOT NULL CHECK(expected_binding_version > 0),
  method text NOT NULL CHECK(method='tasks/update'),
  status text NOT NULL CHECK(
    status IN ('acknowledged','provider_unreachable','contract_invalid','provider_protocol')
  ),
  protocol_revision text CHECK(
    protocol_revision IS NULL OR length(btrim(protocol_revision)) BETWEEN 1 AND 256
  ),
  error_code text CHECK(error_code IS NULL OR length(btrim(error_code)) BETWEEN 1 AND 256),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK(completed_at >= started_at),
  duration_ms bigint NOT NULL CHECK(duration_ms >= 0),
  CHECK(
    (status='acknowledged' AND protocol_revision IS NOT NULL AND error_code IS NULL)
    OR (status<>'acknowledged' AND error_code IS NOT NULL)
  ),
  FOREIGN KEY(input_request_id,binding_id)
    REFERENCES remote_task_input_link(input_request_id,binding_id) ON DELETE RESTRICT
);

CREATE INDEX remote_task_input_attempt_request_idx
  ON remote_task_input_attempt(input_request_id,started_at,attempt_id);

CREATE TABLE remote_task_cancel_request (
  cancel_request_id text PRIMARY KEY CHECK(length(btrim(cancel_request_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 1 AND 256),
  source text NOT NULL CHECK(source IN ('task','goal','workflow','management','compensation')),
  reason_code text NOT NULL CHECK(length(btrim(reason_code)) BETWEEN 1 AND 128),
  summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 2048),
  delivery_status text NOT NULL CHECK(delivery_status IN ('requested','acknowledged','uncertain')),
  provider_terminal_status text CHECK(
    provider_terminal_status IS NULL OR provider_terminal_status IN ('completed','failed','cancelled')
  ),
  protocol_revision text CHECK(
    protocol_revision IS NULL OR length(btrim(protocol_revision)) BETWEEN 1 AND 256
  ),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  claim_token text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_safe_error_code text CHECK(
    last_safe_error_code IS NULL OR length(btrim(last_safe_error_code)) BETWEEN 1 AND 256
  ),
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK(updated_at >= requested_at),
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(binding_id,idempotency_key),
  UNIQUE(cancel_request_id,binding_id),
  CHECK(
    (claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
    OR (length(btrim(claim_token)) BETWEEN 1 AND 256
      AND claimed_at IS NOT NULL AND claim_expires_at > claimed_at)
  ),
  CHECK(
    (delivery_status='acknowledged' AND protocol_revision IS NOT NULL AND acknowledged_at IS NOT NULL)
    OR delivery_status<>'acknowledged'
  ),
  CHECK(
    (provider_terminal_status IS NULL AND resolved_at IS NULL)
    OR (provider_terminal_status IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX remote_task_cancel_request_active_idx
  ON remote_task_cancel_request(binding_id)
  WHERE provider_terminal_status IS NULL;
CREATE INDEX remote_task_cancel_request_delivery_idx
  ON remote_task_cancel_request(delivery_status,claim_expires_at,updated_at,cancel_request_id)
  WHERE provider_terminal_status IS NULL AND delivery_status IN ('requested','uncertain');

CREATE TABLE remote_task_cancel_attempt (
  attempt_id text PRIMARY KEY CHECK(length(btrim(attempt_id)) BETWEEN 1 AND 256),
  cancel_request_id text NOT NULL,
  binding_id text NOT NULL,
  expected_request_version bigint NOT NULL CHECK(expected_request_version > 0),
  method text NOT NULL CHECK(method='tasks/cancel'),
  protocol_revision text NOT NULL CHECK(length(btrim(protocol_revision)) BETWEEN 1 AND 256),
  status text NOT NULL CHECK(
    status IN (
      'acknowledged','provider_unreachable','contract_invalid','provider_protocol','stale_terminal'
    )
  ),
  error_code text CHECK(error_code IS NULL OR length(btrim(error_code)) BETWEEN 1 AND 256),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK(completed_at >= started_at),
  duration_ms bigint NOT NULL CHECK(duration_ms >= 0),
  CHECK(
    (status='acknowledged' AND error_code IS NULL)
    OR (status<>'acknowledged' AND error_code IS NOT NULL)
  ),
  FOREIGN KEY(cancel_request_id,binding_id)
    REFERENCES remote_task_cancel_request(cancel_request_id,binding_id) ON DELETE RESTRICT
);

CREATE INDEX remote_task_cancel_attempt_request_idx
  ON remote_task_cancel_attempt(cancel_request_id,started_at,attempt_id);

INSERT INTO schema_migration(version) VALUES('0103_remote_task_input_and_cancellation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
