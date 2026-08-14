BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_task_command_effect)
    OR EXISTS (
      SELECT 1 FROM cognitive_management_action
      WHERE expected_version > 2147483647
    )
    OR EXISTS (
      SELECT 1 FROM agent_task
      WHERE revision <> 0 OR active_command_token IS NOT NULL
        OR command_action_id IS NOT NULL OR command_operation IS NOT NULL
        OR command_idempotency_key IS NOT NULL OR command_lease_attempt IS NOT NULL
        OR command_lease_token IS NOT NULL OR command_claimed_revision IS NOT NULL
        OR command_precondition_json IS NOT NULL OR command_claimed_at IS NOT NULL
        OR command_execution_phase IS NOT NULL OR command_result_json IS NOT NULL
        OR command_completed_at IS NOT NULL OR command_recovery_disposition IS NOT NULL
    )
  THEN
    RAISE EXCEPTION '0162 rollback refused: authoritative Task revision evidence exists';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS agent_task_revision_authority ON agent_task;
DROP FUNCTION IF EXISTS enforce_agent_task_revision_authority();
DROP FUNCTION IF EXISTS advance_agent_task_revision();
DROP TRIGGER IF EXISTS agent_task_command_fence ON agent_task;
DROP FUNCTION IF EXISTS fence_agent_task_command_updates();
DROP TABLE IF EXISTS runtime_task_command_effect;
ALTER TABLE cognitive_management_action
  ALTER COLUMN expected_version TYPE integer;
ALTER TABLE agent_task
  DROP CONSTRAINT IF EXISTS agent_task_revision_nonnegative,
  DROP CONSTRAINT IF EXISTS agent_task_command_identity_complete,
  DROP COLUMN IF EXISTS active_command_token,
  DROP COLUMN IF EXISTS command_action_id,
  DROP COLUMN IF EXISTS command_operation,
  DROP COLUMN IF EXISTS command_idempotency_key,
  DROP COLUMN IF EXISTS command_lease_attempt,
  DROP COLUMN IF EXISTS command_lease_token,
  DROP COLUMN IF EXISTS command_claimed_revision,
  DROP COLUMN IF EXISTS command_precondition_json,
  DROP COLUMN IF EXISTS command_claimed_at,
  DROP COLUMN IF EXISTS command_execution_phase,
  DROP COLUMN IF EXISTS command_result_json,
  DROP COLUMN IF EXISTS command_completed_at,
  DROP COLUMN IF EXISTS command_recovery_disposition,
  DROP COLUMN IF EXISTS revision;

DELETE FROM schema_migration
WHERE version = '0162_v14_agent_task_revision_authority';

COMMIT;
