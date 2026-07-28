-- 0128_v13_candidate_generation_runtime.down.sql
-- Rollback removes only P04R additions; candidate/artifact authority remains untouched.

DROP INDEX IF EXISTS idx_candidate_generation_run_requeue;
DROP INDEX IF EXISTS uq_candidate_generation_run_source_event;
DROP INDEX IF EXISTS uq_candidate_generation_run_idempotency;

ALTER TABLE candidate_generation_run
  DROP CONSTRAINT IF EXISTS candidate_generation_run_status_check,
  DROP COLUMN IF EXISTS source_event_id,
  DROP COLUMN IF EXISTS attempt,
  DROP COLUMN IF EXISTS max_attempts,
  DROP COLUMN IF EXISTS available_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS payload,
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS last_error_summary,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

ALTER TABLE candidate_static_validation
  DROP COLUMN IF EXISTS activity_identity_valid,
  DROP COLUMN IF EXISTS parallel_semantics_valid,
  DROP COLUMN IF EXISTS capability_catalog_aligned,
  DROP COLUMN IF EXISTS parameter_schema_aligned,
  DROP COLUMN IF EXISTS applicability_evaluable,
  DROP COLUMN IF EXISTS lineage_complete,
  DROP COLUMN IF EXISTS recovery_semantics_valid;

DROP INDEX IF EXISTS idx_fused_pattern_source;
DROP TABLE IF EXISTS fused_pattern;

DELETE FROM schema_migration
WHERE version = '0128_v13_candidate_generation_runtime';
