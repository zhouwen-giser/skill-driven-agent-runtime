BEGIN;
DROP TABLE IF EXISTS goal_input_inference;
DELETE FROM schema_migration WHERE version='0032_goal_input_inference';
COMMIT;
