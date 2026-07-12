ALTER TABLE stage_model_route DROP CONSTRAINT IF EXISTS stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK(
  stage IN ('intent','goal','skill_authoring','skill_selection','workflow_planning',
            'execution_decision','goal_evaluation','evaluation','result_processing')
);

CREATE TABLE IF NOT EXISTS processed_result (
  result_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id),
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK(skill_version > 0),
  normalized_json jsonb NOT NULL,
  output_json jsonb NOT NULL,
  facts_json jsonb NOT NULL,
  valuable boolean NOT NULL,
  value_summary text NOT NULL,
  memory_candidates_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS processed_result_task_idx
  ON processed_result(task_id,created_at,result_id);
