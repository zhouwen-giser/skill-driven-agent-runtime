BEGIN;
DELETE FROM workflow_control_round
WHERE evaluation_decision NOT IN ('achieved','adjust_plan','unachievable');
UPDATE workflow_control_round
SET evaluation_decision='replan', replan_instruction=evaluation_detail_json->>'actionInstruction'
WHERE evaluation_decision='adjust_plan';
ALTER TABLE workflow_control_round DROP CONSTRAINT IF EXISTS workflow_control_round_evaluation_decision_check;
ALTER TABLE workflow_control_round ADD CONSTRAINT workflow_control_round_evaluation_decision_check
CHECK(evaluation_decision IN ('achieved','replan','unachievable'));
ALTER TABLE workflow_control_round DROP COLUMN IF EXISTS evaluation_detail_json;
DELETE FROM workflow_control WHERE status IN ('awaiting_input','capability_gap');
ALTER TABLE workflow_control DROP CONSTRAINT IF EXISTS workflow_control_status_check;
ALTER TABLE workflow_control ADD CONSTRAINT workflow_control_status_check CHECK(status IN (
  'running','awaiting_confirmation','achieved','unachievable','failed','replan_budget_exhausted'
));
DELETE FROM schema_migration WHERE version='0029_goal_evaluation_decisions';
COMMIT;
