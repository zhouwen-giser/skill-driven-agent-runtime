-- 0127_v13_artifact_candidate_generation.down.sql
BEGIN;

DROP TABLE IF EXISTS candidate_model_invocation;
DROP TABLE IF EXISTS candidate_generation_run;
DROP TABLE IF EXISTS candidate_static_validation;
DROP TABLE IF EXISTS candidate_fingerprint;
DROP TABLE IF EXISTS generalized_pattern;

DELETE FROM schema_migration
WHERE version = '0127_v13_artifact_candidate_generation';

COMMIT;
