BEGIN;

DROP TABLE IF EXISTS runtime_event;
DROP TABLE IF EXISTS agent_task;
DROP INDEX IF EXISTS goal_one_active_per_context;
DROP TABLE IF EXISTS goal;
DROP TABLE IF EXISTS conversation_context;
DELETE FROM schema_migration WHERE version = '0002_protocol_domain';

COMMIT;
