BEGIN;

-- Never delete or recategorize original input requests to force rollback.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM task_input_request WHERE source='remote_task') THEN
    RAISE EXCEPTION 'TASK_BUSINESS_INPUT_ROLLBACK_REQUIRES_RETAINED_REMOTE_TASK_SOURCE';
  END IF;
END $$;

ALTER TABLE task_input_request DROP CONSTRAINT task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK (
  source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow')
);
DELETE FROM schema_migration WHERE version='0184_v14_task_business_input_source';
COMMIT;
