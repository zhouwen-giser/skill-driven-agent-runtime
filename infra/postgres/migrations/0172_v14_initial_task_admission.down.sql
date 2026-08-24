BEGIN;

DROP TRIGGER initial_task_admission_immutable ON initial_task_admission;
DROP FUNCTION prevent_initial_task_admission_mutation();
DROP TABLE initial_task_admission;

DELETE FROM schema_migration WHERE version='0172_v14_initial_task_admission';
COMMIT;
