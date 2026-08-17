BEGIN;

-- Quarantine is fail-closed recovery evidence and remains irreversible.
DELETE FROM schema_migration
WHERE version='0170_v14_terminal_guard_callback_quarantine';

COMMIT;
