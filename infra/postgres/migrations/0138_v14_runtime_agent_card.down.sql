BEGIN;
DROP TRIGGER runtime_agent_card_content_immutable ON runtime_agent_card_revision;
DROP FUNCTION prevent_runtime_agent_card_content_mutation();
DROP TABLE runtime_agent_card_command_receipt;
DROP TABLE runtime_agent_card_revision;
DELETE FROM schema_migration WHERE version='0138_v14_runtime_agent_card';
COMMIT;
