BEGIN;
DROP TABLE IF EXISTS memory_status_transition;
DELETE FROM schema_migration WHERE version='0044_memory_status_transition';
COMMIT;
