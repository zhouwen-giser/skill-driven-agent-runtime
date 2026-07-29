-- 0131_v13_artifact_retrieval_audit.up.sql
-- P07: immutable, non-authoritative audit projection for a P02 artifact_match_log decision.

BEGIN;

CREATE TABLE runtime_candidate_decision (
  decision_id text PRIMARY KEY,
  match_id text REFERENCES artifact_match_log(match_id) ON DELETE SET NULL,
  request_id text NOT NULL,
  path text NOT NULL CHECK (path IN (
    'compiled_fast','template_adapt','case_adapt','small_model','cognitive_runtime','human_input','denied'
  )),
  selected_artifact_ref text,
  parameter_bindings jsonb NOT NULL CHECK (
    jsonb_typeof(parameter_bindings) = 'object'
    AND octet_length(parameter_bindings::text) <= 262144
    AND sdar_jsonb_depth(parameter_bindings) <= 16
  ),
  missing_parameters jsonb NOT NULL CHECK (
    jsonb_typeof(missing_parameters) = 'array'
    AND jsonb_array_length(missing_parameters) <= 4096
  ),
  required_confirmations jsonb NOT NULL CHECK (
    jsonb_typeof(required_confirmations) = 'array'
    AND jsonb_array_length(required_confirmations) <= 4096
  ),
  reason_codes jsonb NOT NULL CHECK (
    jsonb_typeof(reason_codes) = 'array'
    AND jsonb_array_length(reason_codes) <= 4096
  ),
  matcher_snapshot_hash text NOT NULL CHECK (matcher_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_snapshot_hash text NOT NULL CHECK (policy_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX runtime_candidate_decision_request_idx
  ON runtime_candidate_decision(request_id, created_at DESC, decision_id);

INSERT INTO schema_migration(version)
VALUES ('0131_v13_artifact_retrieval_audit');

COMMIT;
