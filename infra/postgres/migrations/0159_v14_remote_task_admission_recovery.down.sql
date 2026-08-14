BEGIN;

DROP TABLE IF EXISTS remote_task_admission_intent;

DELETE FROM schema_migration
WHERE version='0159_v14_remote_task_admission_recovery';

COMMIT;
