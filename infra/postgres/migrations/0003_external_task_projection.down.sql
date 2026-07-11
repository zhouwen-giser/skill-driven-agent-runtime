BEGIN;
DROP TABLE IF EXISTS external_task_projection;
DELETE FROM schema_migration WHERE version = '0003_external_task_projection';
COMMIT;
