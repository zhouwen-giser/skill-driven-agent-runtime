BEGIN;

DELETE FROM schema_migration WHERE version = '0131_v13_artifact_retrieval_audit';
DROP TABLE runtime_candidate_decision;

COMMIT;
