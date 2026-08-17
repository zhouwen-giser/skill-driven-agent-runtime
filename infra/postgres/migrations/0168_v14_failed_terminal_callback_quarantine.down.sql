BEGIN;

-- Terminal callback quarantine is a fail-closed recovery fact and must not be
-- reversed into an active continuation state during rollback.
DELETE FROM schema_migration
WHERE version='0168_v14_failed_terminal_callback_quarantine';

COMMIT;
