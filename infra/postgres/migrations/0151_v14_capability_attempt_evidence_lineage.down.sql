BEGIN;

ALTER TABLE runtime_terminal_outcome
  DROP CONSTRAINT runtime_terminal_outcome_capability_attempt_fk,
  DROP CONSTRAINT runtime_terminal_outcome_capability_attempt_task_check,
  DROP COLUMN capability_attempt_id;

DROP INDEX mcp_invocation_capability_attempt_idx;

ALTER TABLE mcp_invocation
  DROP CONSTRAINT mcp_invocation_capability_attempt_fk,
  DROP CONSTRAINT mcp_invocation_capability_attempt_task_check,
  DROP COLUMN capability_attempt_id;

ALTER TABLE task_capability_execution_attempt
  DROP CONSTRAINT task_capability_attempt_identity_unique;

DELETE FROM schema_migration
WHERE version = '0151_v14_capability_attempt_evidence_lineage';

COMMIT;
