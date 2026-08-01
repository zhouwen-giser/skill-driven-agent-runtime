BEGIN;

DELETE FROM schema_migration WHERE version = '0132_v13_fast_gateway';
DROP TABLE fast_gateway_feedback;
DROP TABLE fast_gateway_decision;
DROP TABLE fast_gateway_request;

COMMIT;
