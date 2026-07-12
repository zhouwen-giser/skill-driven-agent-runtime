BEGIN;
DROP TABLE IF EXISTS task_quality_report;
DELETE FROM schema_migration WHERE version='0046_task_quality_report';
COMMIT;
