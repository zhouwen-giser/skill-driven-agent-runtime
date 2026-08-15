BEGIN;

-- Quarantine is fail-closed recovery evidence and remains irreversible.
DELETE FROM schema_migration
WHERE version='0169_v14_postfix_terminal_callback_quarantine';

COMMIT;
