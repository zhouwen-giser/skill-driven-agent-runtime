BEGIN;

-- Quarantine is a fail-closed recovery fact and must not be reversed into an
-- active continuation state during rollback.
DELETE FROM schema_migration
WHERE version = '0166_v14_failed_remote_continuation_quarantine';

COMMIT;
