BEGIN;

CREATE TABLE task_input_request (
  input_request_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE CASCADE,
  context_id text NOT NULL REFERENCES conversation_context(context_id) ON DELETE CASCADE,
  source text NOT NULL CHECK(source IN ('goal_deliberation','goal_evaluation','workflow')),
  question text NOT NULL CHECK(length(btrim(question)) > 0),
  status text NOT NULL CHECK(status IN ('waiting','answered','expired','canceled')),
  control_id text REFERENCES workflow_control(control_id) ON DELETE RESTRICT,
  control_round_index integer CHECK(control_round_index IS NULL OR control_round_index >= 0),
  created_at timestamptz NOT NULL,
  answered_at timestamptz,
  CHECK((status='answered') = (answered_at IS NOT NULL)),
  CHECK((control_id IS NULL) = (control_round_index IS NULL))
);

CREATE UNIQUE INDEX task_input_request_one_waiting_per_task_idx
  ON task_input_request(task_id) WHERE status='waiting';
CREATE INDEX task_input_request_task_history_idx
  ON task_input_request(task_id,created_at,input_request_id);

CREATE TABLE task_input_response (
  input_response_id text PRIMARY KEY,
  input_request_id text NOT NULL UNIQUE REFERENCES task_input_request(input_request_id) ON DELETE RESTRICT,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE CASCADE,
  content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE task_execution_attempt (
  attempt_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE CASCADE,
  context_id text NOT NULL REFERENCES conversation_context(context_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK(reason IN ('initial','input_response')),
  status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  input_request_id text REFERENCES task_input_request(input_request_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  CHECK((reason='input_response') = (input_request_id IS NOT NULL)),
  CHECK(status <> 'queued' OR (started_at IS NULL AND completed_at IS NULL)),
  CHECK(status <> 'running' OR (started_at IS NOT NULL AND completed_at IS NULL)),
  CHECK(status NOT IN ('completed','failed') OR completed_at IS NOT NULL)
);

CREATE INDEX task_execution_attempt_task_history_idx
  ON task_execution_attempt(task_id,created_at,attempt_id);

INSERT INTO schema_migration(version) VALUES('0055_task_input_continuation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
