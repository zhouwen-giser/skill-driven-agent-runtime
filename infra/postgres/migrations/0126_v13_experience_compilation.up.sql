BEGIN;

CREATE TABLE experience_trace_source (
  trace_id text PRIMARY KEY REFERENCES experience_trace(trace_id) ON DELETE CASCADE,
  source_episode_id text NOT NULL REFERENCES goal_experience_episode(episode_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  user_scope_id text,
  normalizer_version text NOT NULL CHECK (length(normalizer_version) BETWEEN 1 AND 128),
  source_hash text NOT NULL CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  data_classification text NOT NULL CHECK (
    data_classification IN ('public', 'internal', 'user_scoped', 'restricted')
  ),
  redaction_codes jsonb NOT NULL CHECK (
    jsonb_typeof(redaction_codes) = 'array'
    AND jsonb_array_length(redaction_codes) <= 128
    AND octet_length(redaction_codes::text) <= 16384
  ),
  created_at timestamptz NOT NULL,
  UNIQUE (source_episode_id, normalizer_version, source_hash)
);
CREATE INDEX experience_trace_source_cohort_idx
  ON experience_trace_source(tenant_id, created_at, trace_id);
CREATE INDEX experience_trace_source_user_scope_idx
  ON experience_trace_source(user_scope_id, trace_id)
  WHERE user_scope_id IS NOT NULL;

CREATE TABLE pattern_candidate_support (
  pattern_id text NOT NULL REFERENCES pattern_candidate(pattern_id) ON DELETE CASCADE,
  trace_id text NOT NULL REFERENCES experience_trace(trace_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  support_kind text NOT NULL CHECK (support_kind IN ('support', 'contradiction')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (pattern_id, trace_id, support_kind)
);
CREATE INDEX pattern_candidate_support_trace_idx
  ON pattern_candidate_support(trace_id, pattern_id);
CREATE INDEX pattern_candidate_support_tenant_idx
  ON pattern_candidate_support(tenant_id, pattern_id, support_kind);

CREATE TABLE compilation_run (
  run_id text PRIMARY KEY,
  run_type text NOT NULL CHECK (run_type IN ('normalization', 'process_mining')),
  source_episode_id text REFERENCES goal_experience_episode(episode_id) ON DELETE CASCADE,
  source_event_id text UNIQUE REFERENCES cognitive_runtime_outbox(event_id),
  tenant_id text,
  user_scope_id text,
  cohort_fingerprint text CHECK (
    cohort_fingerprint IS NULL OR cohort_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL CHECK (
    status IN ('pending', 'leased', 'retry_wait', 'completed', 'dead_letter')
  ),
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 32),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 262144
    AND sdar_jsonb_depth(payload) <= 16
  ),
  result_ref text,
  last_error_code text,
  last_error_summary text CHECK (
    last_error_summary IS NULL OR length(last_error_summary) BETWEEN 1 AND 2048
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (status = 'leased') = (
      lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
    )
  ),
  CHECK (
    status = 'leased'
    OR (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (run_type = 'normalization' AND source_episode_id IS NOT NULL)
    OR (run_type = 'process_mining' AND cohort_fingerprint IS NOT NULL)
  )
);
CREATE INDEX compilation_run_claimable_idx
  ON compilation_run(run_type, status, available_at, run_id);
CREATE INDEX compilation_run_expired_lease_idx
  ON compilation_run(run_type, lease_expires_at, run_id)
  WHERE status = 'leased';
CREATE INDEX compilation_run_user_scope_idx
  ON compilation_run(user_scope_id, run_id)
  WHERE user_scope_id IS NOT NULL;

CREATE FUNCTION sdar_reject_experience_compilation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Experience Trace and Pattern Candidate content is immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER experience_trace_immutability
BEFORE UPDATE ON experience_trace
FOR EACH ROW EXECUTE FUNCTION sdar_reject_experience_compilation_mutation();

CREATE TRIGGER experience_trace_source_immutability
BEFORE UPDATE ON experience_trace_source
FOR EACH ROW EXECUTE FUNCTION sdar_reject_experience_compilation_mutation();

CREATE TRIGGER pattern_candidate_immutability
BEFORE UPDATE ON pattern_candidate
FOR EACH ROW EXECUTE FUNCTION sdar_reject_experience_compilation_mutation();

CREATE TRIGGER pattern_candidate_support_immutability
BEFORE UPDATE ON pattern_candidate_support
FOR EACH ROW EXECUTE FUNCTION sdar_reject_experience_compilation_mutation();

INSERT INTO schema_migration(version)
VALUES ('0126_v13_experience_compilation');

COMMIT;
