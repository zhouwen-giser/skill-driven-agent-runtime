BEGIN;
DROP TABLE IF EXISTS memory_item;
DELETE FROM schema_migration WHERE version='0031_global_memory';
COMMIT;
