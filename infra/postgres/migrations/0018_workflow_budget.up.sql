BEGIN;
ALTER TABLE workflow_instance
  ADD COLUMN IF NOT EXISTS skill_versions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_limits_json jsonb NOT NULL DEFAULT '{"maxReplans":3,"maxDurationSeconds":300,"maxLlmCalls":20,"maxMcpCalls":20,"maxCost":100}'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_usage_json jsonb NOT NULL DEFAULT '{"replanCount":0,"durationMs":0,"llmCalls":0,"mcpCalls":0,"cost":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS termination_reason text;
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_termination_reason_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_termination_reason_check CHECK(
  termination_reason IS NULL OR termination_reason IN (
    'duration_exhausted','llm_calls_exhausted','mcp_calls_exhausted','cost_exhausted','replans_exhausted'
  )
);
INSERT INTO schema_migration(version) VALUES('0018_workflow_budget') ON CONFLICT(version) DO NOTHING;
COMMIT;
