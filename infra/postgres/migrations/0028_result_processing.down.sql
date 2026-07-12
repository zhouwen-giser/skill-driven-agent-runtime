DROP TABLE IF EXISTS processed_result;
ALTER TABLE stage_model_route DROP CONSTRAINT IF EXISTS stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK(
  stage IN ('intent','goal','skill_authoring','skill_selection','workflow_planning',
            'execution_decision','goal_evaluation','evaluation')
);
