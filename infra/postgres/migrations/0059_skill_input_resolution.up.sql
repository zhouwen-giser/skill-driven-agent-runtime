BEGIN;

ALTER TABLE stage_model_route DROP CONSTRAINT IF EXISTS stage_model_route_stage_check;
ALTER TABLE stage_model_route ADD CONSTRAINT stage_model_route_stage_check CHECK(
  stage IN ('intent','goal','tool_enhancement','skill_authoring','skill_selection',
            'skill_input_resolution','workflow_planning','execution_decision',
            'goal_evaluation','evaluation','result_processing')
);

ALTER TABLE task_input_request DROP CONSTRAINT IF EXISTS task_input_request_source_check;
ALTER TABLE task_input_request ADD CONSTRAINT task_input_request_source_check CHECK(
  source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow')
);

CREATE TABLE skill_input_resolution (
  resolution_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE CASCADE,
  goal_id text NOT NULL REFERENCES goal(goal_id) ON DELETE RESTRICT,
  goal_version integer NOT NULL CHECK(goal_version > 0),
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK(skill_version > 0),
  structured_input_json jsonb,
  unresolved_fields_json jsonb NOT NULL,
  source_refs_json jsonb NOT NULL,
  decision_summary text NOT NULL CHECK(length(btrim(decision_summary)) > 0),
  status text NOT NULL CHECK(status IN ('resolved','input_required','failed')),
  created_at timestamptz NOT NULL,
  FOREIGN KEY(skill_id,skill_version) REFERENCES skill_version(skill_id,version) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(unresolved_fields_json)='array'),
  CHECK(jsonb_typeof(source_refs_json)='array'),
  CHECK(status<>'resolved' OR (
    structured_input_json IS NOT NULL AND jsonb_array_length(unresolved_fields_json)=0
  )),
  CHECK(status<>'input_required' OR jsonb_array_length(unresolved_fields_json)>0)
);

CREATE INDEX skill_input_resolution_task_history_idx
  ON skill_input_resolution(task_id,created_at,resolution_id);
CREATE INDEX skill_input_resolution_current_idx
  ON skill_input_resolution(task_id,skill_id,skill_version,goal_version,created_at DESC,resolution_id DESC);

INSERT INTO schema_migration(version) VALUES('0059_skill_input_resolution')
ON CONFLICT(version) DO NOTHING;

COMMIT;
