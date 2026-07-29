-- 0128_v13_candidate_generation_runtime.up.sql
-- P04R: PostgreSQL-authoritative candidate generation runs and V1.2 validation projections.

CREATE TABLE IF NOT EXISTS fused_pattern (
  fused_pattern_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workflow_pattern_id TEXT NOT NULL,
  source_process_pattern_ref TEXT NOT NULL REFERENCES pattern_candidate(pattern_id),
  source_trace_refs JSONB NOT NULL CHECK (
    jsonb_typeof(source_trace_refs) = 'array'
    AND jsonb_array_length(source_trace_refs) > 0
  ),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  fusion_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fused_pattern_source
  ON fused_pattern (tenant_id, source_process_pattern_ref, workflow_pattern_id);

ALTER TABLE candidate_generation_run
  ADD COLUMN IF NOT EXISTS source_event_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_summary TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE candidate_generation_run
SET idempotency_key = COALESCE(idempotency_key, 'legacy:' || run_id),
    available_at = COALESCE(available_at, started_at),
    created_at = COALESCE(created_at, started_at),
    updated_at = COALESCE(updated_at, completed_at, started_at);

ALTER TABLE candidate_generation_run
  ALTER COLUMN idempotency_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_generation_run_status_check'
  ) THEN
    ALTER TABLE candidate_generation_run
      ADD CONSTRAINT candidate_generation_run_status_check
      CHECK (status IN ('pending','leased','retry_wait','completed','dead_letter'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_generation_run_idempotency
  ON candidate_generation_run (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_generation_run_source_event
  ON candidate_generation_run (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_generation_run_requeue
  ON candidate_generation_run (status, available_at, run_id);

ALTER TABLE candidate_static_validation
  ADD COLUMN IF NOT EXISTS activity_identity_valid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parallel_semantics_valid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capability_catalog_aligned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parameter_schema_aligned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applicability_evaluable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lineage_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_semantics_valid BOOLEAN NOT NULL DEFAULT false;

INSERT INTO schema_migration(version)
VALUES('0128_v13_candidate_generation_runtime')
ON CONFLICT (version) DO NOTHING;
