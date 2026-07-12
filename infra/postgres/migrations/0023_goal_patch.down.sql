BEGIN;
UPDATE agent_task SET phase='failed' WHERE phase='invalidated';
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_phase_check;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_phase_check CHECK(
  phase IN ('queued','context_loading','goal_deliberation','skill_resolution','planning',
    'awaiting_plan_confirmation','awaiting_user_input','paused','executing','evaluating',
    'capability_gap','completed','canceled','failed')
);
DROP TABLE IF EXISTS goal_patch;
UPDATE workflow_plan SET confirmation_status='failed' WHERE confirmation_status='invalidated';
ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_confirmation_status_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_confirmation_status_check CHECK(
  confirmation_status IN ('awaiting_confirmation','confirmed','failed','superseded')
);
UPDATE workflow_instance SET status='failed' WHERE status='invalidated';
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed')
);
DELETE FROM schema_migration WHERE version='0023_goal_patch';
COMMIT;
