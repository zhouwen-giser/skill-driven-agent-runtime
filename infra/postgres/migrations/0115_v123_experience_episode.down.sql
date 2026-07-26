BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM goal_experience_episode)
     OR EXISTS (SELECT 1 FROM experience_job)
     OR EXISTS (SELECT 1 FROM experience_dead_letter) THEN
    RAISE EXCEPTION 'ROLLBACK_0115_REFUSED_EXPERIENCE_DATA_EXISTS';
  END IF;
END $$;

DROP INDEX IF EXISTS experience_job_expired_lease_idx;
ALTER TABLE experience_dead_letter
  DROP CONSTRAINT IF EXISTS experience_dead_letter_error_summary_size_check;
ALTER TABLE experience_job
  DROP CONSTRAINT IF EXISTS experience_job_payload_size_check,
  DROP COLUMN IF EXISTS result_ref,
  DROP COLUMN IF EXISTS source_event_id;

DROP INDEX IF EXISTS goal_experience_episode_scope_idx;
DROP INDEX IF EXISTS goal_experience_episode_task_idx;
ALTER TABLE goal_experience_episode
  DROP CONSTRAINT IF EXISTS goal_experience_episode_contract_fk,
  DROP COLUMN IF EXISTS user_scope_id,
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS source_hash,
  DROP COLUMN IF EXISTS terminal_outcome_ref,
  DROP COLUMN IF EXISTS episode_type,
  DROP COLUMN IF EXISTS context_id,
  DROP COLUMN IF EXISTS task_id;

DELETE FROM schema_migration WHERE version = '0115_v123_experience_episode';

COMMIT;
