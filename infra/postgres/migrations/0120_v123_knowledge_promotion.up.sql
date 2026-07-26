BEGIN;

CREATE UNIQUE INDEX knowledge_promotion_one_terminal_evaluation_idx
  ON knowledge_promotion_evaluation(knowledge_kind, knowledge_id, knowledge_revision)
  WHERE status IN ('passed', 'failed', 'rejected');

CREATE INDEX knowledge_promotion_evaluation_review_idx
  ON knowledge_promotion_evaluation(status, created_at DESC, evaluation_id);

CREATE INDEX planning_heuristic_active_projection_idx
  ON planning_heuristic(status, risk, knowledge_id, revision DESC)
  WHERE status = 'active';
CREATE UNIQUE INDEX planning_heuristic_one_active_revision_idx
  ON planning_heuristic(knowledge_id)
  WHERE status = 'active';

CREATE INDEX task_type_definition_active_projection_idx
  ON task_type_definition(status, fingerprint, knowledge_id, revision DESC)
  WHERE status = 'active';
CREATE UNIQUE INDEX task_type_definition_one_active_revision_idx
  ON task_type_definition(knowledge_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX capability_pattern_definition_one_active_revision_idx
  ON capability_pattern_definition(knowledge_id)
  WHERE status = 'active';

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection', 'task_type_induction',
  'capability_pattern_induction', 'knowledge_promotion_assessment'
));

INSERT INTO schema_migration(version)
VALUES ('0120_v123_knowledge_promotion');

COMMIT;
