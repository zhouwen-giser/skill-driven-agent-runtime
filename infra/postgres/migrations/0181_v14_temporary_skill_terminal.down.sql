BEGIN;
LOCK TABLE temporary_skill,temporary_skill_experience IN ACCESS EXCLUSIVE MODE;
-- A downgrade cannot remove lifecycle protection while active task-scoped Skills still depend on it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM temporary_skill WHERE status='active') THEN
    RAISE EXCEPTION 'TEMPORARY_SKILL_TERMINAL_DOWNGRADE_ACTIVE_REFERENCES';
  END IF;
END $$;
DROP TRIGGER temporary_skill_reject_terminal_owner ON temporary_skill;
DROP FUNCTION reject_temporary_skill_after_terminal();
DROP TRIGGER agent_task_finalize_temporary_skills ON agent_task;
DROP FUNCTION finalize_task_temporary_skills();
DROP INDEX temporary_skill_experience_once_idx;
DELETE FROM schema_migration WHERE version='0181_v14_temporary_skill_terminal';
COMMIT;
