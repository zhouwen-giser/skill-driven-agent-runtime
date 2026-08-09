BEGIN;

DROP INDEX IF EXISTS artifact_match_log_artifact_version_idx;

ALTER TABLE artifact_match_log
  DROP CONSTRAINT IF EXISTS artifact_match_log_candidate_artifact_version_fkey,
  DROP CONSTRAINT IF EXISTS artifact_match_log_artifact_version_check,
  DROP COLUMN IF EXISTS artifact_version,
  ADD CONSTRAINT artifact_match_log_candidate_artifact_id_fkey
    FOREIGN KEY (candidate_artifact_id)
    REFERENCES compiled_artifact(artifact_id);

DELETE FROM schema_migration
WHERE version='0145_v14_artifact_match_exact_version';

COMMIT;
