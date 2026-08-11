BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cognitive_management_action
    WHERE status = 'pending'
  ) THEN
    RAISE EXCEPTION
      '0150 rollback refused: active cognitive management leases would lose fencing authority';
  END IF;
END;
$$;

DROP INDEX cognitive_management_action_pending_lease_idx;

ALTER TABLE cognitive_management_action
  DROP CONSTRAINT cognitive_management_action_lease_state_check,
  DROP COLUMN provider_dispatch_hash,
  DROP COLUMN provider_dispatch_id,
  DROP COLUMN execution_phase,
  DROP COLUMN lease_token,
  DROP COLUMN lease_attempt,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_owner;

DELETE FROM schema_migration
WHERE version = '0150_v14_cognitive_management_action_lease_recovery';

COMMIT;
