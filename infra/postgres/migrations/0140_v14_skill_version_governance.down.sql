BEGIN;

DROP TRIGGER IF EXISTS runtime_skill_governance_command_immutable
  ON runtime_skill_governance_command;
DROP FUNCTION IF EXISTS reject_runtime_skill_governance_command_mutation();
DROP TABLE IF EXISTS runtime_skill_governance_command;
DROP TABLE IF EXISTS runtime_skill_version_governance;

DELETE FROM schema_migration WHERE version='0140_v14_skill_version_governance';

COMMIT;
