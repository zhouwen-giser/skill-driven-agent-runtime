-- 0132_v13_fast_gateway.up.sql
-- P10 durable Gateway correlation. Formal Goal/Plan/Outcome and Artifact usage
-- remain in their existing authority tables.

BEGIN;

CREATE TABLE fast_gateway_request (
  request_id text PRIMARY KEY,
  task_id text NOT NULL,
  context_id text NOT NULL,
  tenant_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_context jsonb NOT NULL CHECK (
    jsonb_typeof(request_context) = 'object'
    AND octet_length(request_context::text) <= 524288
    AND sdar_jsonb_depth(request_context) <= 16
  ),
  created_at timestamptz NOT NULL
);
CREATE INDEX fast_gateway_request_task_idx
  ON fast_gateway_request(task_id, created_at DESC, request_id);

CREATE TABLE fast_gateway_decision (
  gateway_decision_id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE REFERENCES fast_gateway_request(request_id) ON DELETE CASCADE,
  runtime_decision_id text NOT NULL,
  runtime_decision jsonb NOT NULL CHECK (
    jsonb_typeof(runtime_decision) = 'object'
    AND octet_length(runtime_decision::text) <= 524288
    AND sdar_jsonb_depth(runtime_decision) <= 16
  ),
  decision_record jsonb NOT NULL CHECK (
    jsonb_typeof(decision_record) = 'object'
    AND octet_length(decision_record::text) <= 524288
    AND sdar_jsonb_depth(decision_record) <= 16
  ),
  decision_hash text NOT NULL CHECK (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE fast_gateway_feedback (
  feedback_id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES fast_gateway_request(request_id) ON DELETE CASCADE,
  gateway_decision_id text NOT NULL REFERENCES fast_gateway_decision(gateway_decision_id)
    ON DELETE CASCADE,
  feedback_type text NOT NULL CHECK (feedback_type IN (
    'route_selected','fallback','confirmation','denial','formal_handoff',
    'outcome','correction','recovery','performance','drift'
  )),
  feedback_envelope jsonb NOT NULL CHECK (
    jsonb_typeof(feedback_envelope) = 'object'
    AND octet_length(feedback_envelope::text) <= 524288
    AND sdar_jsonb_depth(feedback_envelope) <= 16
  ),
  created_at timestamptz NOT NULL
);
CREATE INDEX fast_gateway_feedback_decision_idx
  ON fast_gateway_feedback(gateway_decision_id, created_at, feedback_id);

INSERT INTO schema_migration(version)
VALUES ('0132_v13_fast_gateway');

COMMIT;
