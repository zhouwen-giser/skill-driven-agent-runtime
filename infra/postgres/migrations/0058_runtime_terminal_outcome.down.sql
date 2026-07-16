BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_terminal_outcome) OR
     EXISTS (SELECT 1 FROM workflow_control WHERE status='canceled') THEN
    RAISE EXCEPTION '0058 rollback requires exported and removed terminal outcome/canceled-control evidence';
  END IF;
END $$;

ALTER TABLE workflow_control_round DROP COLUMN terminal_outcome_id;
ALTER TABLE workflow_control DROP COLUMN terminal_outcome_id;
DROP TABLE runtime_terminal_outcome;

ALTER TABLE workflow_control DROP CONSTRAINT workflow_control_status_check;
ALTER TABLE workflow_control ADD CONSTRAINT workflow_control_status_check CHECK(status IN (
  'running','awaiting_confirmation','awaiting_input','capability_gap',
  'achieved','unachievable','failed','replan_budget_exhausted'
));

DELETE FROM schema_migration WHERE version='0058_runtime_terminal_outcome';

COMMIT;
