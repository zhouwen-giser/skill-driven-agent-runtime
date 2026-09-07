BEGIN;
LOCK TABLE workflow_continuation_snapshot, workflow_continuation_attempt IN ACCESS EXCLUSIVE MODE;
-- Downgrade preserves historical records: it refuses, rather than converting or deleting
-- any version-2 snapshot or paused handoff which the previous code cannot understand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_continuation_snapshot WHERE schema_version='2.0')
    OR EXISTS (SELECT 1 FROM workflow_continuation_attempt WHERE status='paused') THEN
    RAISE EXCEPTION 'WORKFLOW_SCOPED_CONTINUATION_DOWNGRADE_REFERENCES_EXIST';
  END IF;
END $$;
ALTER TABLE workflow_continuation_snapshot
  DROP CONSTRAINT workflow_continuation_snapshot_scopes_check,
  DROP CONSTRAINT workflow_continuation_snapshot_schema_version_check;
ALTER TABLE workflow_continuation_snapshot
  ADD CONSTRAINT workflow_continuation_snapshot_schema_version_check CHECK (schema_version='1.0');
ALTER TABLE workflow_continuation_attempt
  DROP CONSTRAINT workflow_continuation_attempt_status_check,
  DROP CONSTRAINT workflow_continuation_attempt_handoff_check;
ALTER TABLE workflow_continuation_attempt
  ADD CONSTRAINT workflow_continuation_attempt_status_check
    CHECK (status IN ('claimed','running','waiting_external','succeeded','failed','canceled','stale')),
  ADD CONSTRAINT workflow_continuation_attempt_check2 CHECK (
    (status = 'claimed' AND started_at IS NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('waiting_external','succeeded','canceled')
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'stale' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND length(btrim(error_code)) > 0)
  );
DELETE FROM schema_migration WHERE version='0179_v14_workflow_scoped_continuation';
COMMIT;
