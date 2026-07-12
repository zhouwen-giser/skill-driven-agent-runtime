BEGIN;
ALTER TABLE workflow_control DROP CONSTRAINT IF EXISTS workflow_control_status_check;
ALTER TABLE workflow_control ADD CONSTRAINT workflow_control_status_check CHECK(status IN (
  'running','awaiting_confirmation','awaiting_input','capability_gap',
  'achieved','unachievable','failed','replan_budget_exhausted'
));
ALTER TABLE workflow_control_round
  ADD COLUMN IF NOT EXISTS evaluation_detail_json jsonb;
UPDATE workflow_control_round
SET evaluation_detail_json=jsonb_strip_nulls(jsonb_build_object(
  'decision', CASE WHEN evaluation_decision='replan' THEN 'adjust_plan' ELSE evaluation_decision END,
  'summary', evaluation_summary,
  'actionInstruction', replan_instruction
))
WHERE evaluation_detail_json IS NULL;
ALTER TABLE workflow_control_round ALTER COLUMN evaluation_detail_json SET NOT NULL;
ALTER TABLE workflow_control_round DROP CONSTRAINT IF EXISTS workflow_control_round_evaluation_decision_check;
UPDATE workflow_control_round SET evaluation_decision='adjust_plan' WHERE evaluation_decision='replan';
ALTER TABLE workflow_control_round ADD CONSTRAINT workflow_control_round_evaluation_decision_check
CHECK(evaluation_decision IN (
  'achieved','request_input','adjust_plan','replace_skill','invoke_additional_skill',
  'capability_gap','unachievable'
));
INSERT INTO schema_migration(version) VALUES('0029_goal_evaluation_decisions')
ON CONFLICT(version) DO NOTHING;
COMMIT;
