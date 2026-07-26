BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM knowledge_promotion_evaluation) THEN
    RAISE EXCEPTION 'ROLLBACK_0120_REFUSED_PROMOTION_EVALUATION_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM planning_heuristic
    WHERE status IN ('active', 'deprecated', 'rejected')
    UNION ALL
    SELECT 1 FROM task_type_definition
    WHERE status IN ('active', 'deprecated', 'rejected')
    UNION ALL
    SELECT 1 FROM capability_pattern_definition
    WHERE status IN ('active', 'deprecated', 'rejected')
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_0120_REFUSED_PROMOTED_KNOWLEDGE_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage_model_route WHERE stage = 'knowledge_promotion_assessment'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_0120_REQUIRES_NO_PROMOTION_ROUTES';
  END IF;
END $$;

ALTER TABLE stage_model_route DROP CONSTRAINT stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK (stage IN (
  'intent', 'goal', 'goal_planning', 'tool_enhancement', 'skill_authoring',
  'skill_selection', 'skill_input_resolution', 'workflow_planning', 'execution_decision',
  'goal_evaluation', 'evaluation', 'result_processing', 'task_understanding',
  'task_clarification', 'goal_contract_generation', 'interactive_plan_patch',
  'experience_observation', 'experience_reflection', 'task_type_induction',
  'capability_pattern_induction'
));

DROP INDEX task_type_definition_active_projection_idx;
DROP INDEX capability_pattern_definition_one_active_revision_idx;
DROP INDEX task_type_definition_one_active_revision_idx;
DROP INDEX planning_heuristic_one_active_revision_idx;
DROP INDEX planning_heuristic_active_projection_idx;
DROP INDEX knowledge_promotion_evaluation_review_idx;
DROP INDEX knowledge_promotion_one_terminal_evaluation_idx;

DELETE FROM schema_migration
WHERE version = '0120_v123_knowledge_promotion';

COMMIT;
