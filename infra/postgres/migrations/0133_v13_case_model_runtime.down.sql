BEGIN;

DELETE FROM schema_migration WHERE version = '0133_v13_case_model_runtime';
DROP TABLE model_cascade_step;
DROP TABLE model_cascade_run;
DROP TABLE model_route_decision;
DROP TABLE case_runtime_adaptation;
DROP TABLE case_runtime_match;

COMMIT;
