BEGIN;

-- Quarantine is fail-closed recovery evidence and remains irreversible.
DELETE FROM schema_migration
WHERE version='0171_v14_claimed_terminal_guard_quarantine';

COMMIT;
