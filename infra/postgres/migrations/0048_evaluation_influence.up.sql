BEGIN;
ALTER TABLE workflow_template_occurrence
  ADD COLUMN IF NOT EXISTS quality_report_id text REFERENCES task_quality_report(report_id);

CREATE TABLE IF NOT EXISTS evaluation_influence (
  influence_id text PRIMARY KEY,
  report_id text NOT NULL UNIQUE REFERENCES task_quality_report(report_id),
  task_id text NOT NULL REFERENCES agent_task(task_id),
  experience_id text NOT NULL REFERENCES evolution_experience(experience_id),
  skill_observation_id text REFERENCES skill_quality_observation(observation_id),
  workflow_disposition text NOT NULL CHECK(workflow_disposition IN (
    'quality_occurrence_recorded','rejected_low_quality'
  )),
  workflow_template_id text,
  workflow_template_version integer,
  prompt_disposition text NOT NULL CHECK(prompt_disposition IN ('candidate_created','not_required')),
  prompt_id text,
  prompt_version integer,
  prompt_stage text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY(workflow_template_id,workflow_template_version)
    REFERENCES workflow_template(template_id,version),
  FOREIGN KEY(prompt_id,prompt_version) REFERENCES prompt_version(prompt_id,version),
  CHECK((workflow_template_id IS NULL) = (workflow_template_version IS NULL)),
  CHECK((prompt_disposition='candidate_created') =
    (prompt_id IS NOT NULL AND prompt_version IS NOT NULL AND prompt_stage IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS evaluation_influence_task_idx
  ON evaluation_influence(task_id,created_at,influence_id);
INSERT INTO schema_migration(version) VALUES('0048_evaluation_influence')
  ON CONFLICT(version) DO NOTHING;
COMMIT;
