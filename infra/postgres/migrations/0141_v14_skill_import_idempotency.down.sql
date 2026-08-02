BEGIN;

DROP TRIGGER IF EXISTS runtime_skill_import_command_transition
  ON runtime_skill_import_command;
DROP FUNCTION IF EXISTS enforce_runtime_skill_import_command_transition();
DROP TABLE IF EXISTS runtime_skill_import_command;

DELETE FROM schema_migration WHERE version='0141_v14_skill_import_idempotency';

COMMIT;
