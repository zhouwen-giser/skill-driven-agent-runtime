BEGIN;
ALTER TABLE stage_model_route DROP CONSTRAINT IF EXISTS stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK(
  stage IN ('intent','goal','tool_enhancement','skill_authoring','skill_selection','workflow_planning',
            'execution_decision','goal_evaluation','evaluation','result_processing')
);
INSERT INTO schema_migration(version) VALUES('0053_mcp_tool_enhancement_stage')
ON CONFLICT(version) DO NOTHING;
COMMIT;
