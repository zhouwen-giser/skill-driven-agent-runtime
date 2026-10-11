BEGIN;

-- Restore the native remote input source already specified by 0103 and its repositories.
-- GOWM adapters continue to persist source=workflow under the upstream ownership contract.
ALTER TABLE task_input_request DROP CONSTRAINT task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK (
  source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow','remote_task')
);

INSERT INTO schema_migration(version) VALUES ('0184_v14_task_business_input_source');
COMMIT;
