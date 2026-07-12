BEGIN;
DROP TABLE IF EXISTS memory_retention_policy;
DELETE FROM schema_migration WHERE version='0045_memory_retention_policy';
COMMIT;
