BEGIN;

ALTER TABLE skill_input_resolution
  ADD CONSTRAINT skill_input_resolution_identity_unique
  UNIQUE(resolution_id,task_id,goal_version,skill_id,skill_version);

ALTER TABLE agent_task ADD COLUMN skill_input_resolution_id text;

UPDATE agent_task task
SET skill_input_resolution_id=(
  SELECT candidate.resolution_id
  FROM skill_input_resolution candidate
  WHERE candidate.task_id=task.task_id
    AND candidate.goal_version=task.goal_version
    AND candidate.skill_id=task.selected_skill_id
    AND candidate.skill_version=task.selected_skill_version
    AND candidate.status='resolved'
  ORDER BY candidate.created_at DESC,candidate.resolution_id DESC
  LIMIT 1
)
WHERE task.plan_id IS NOT NULL AND task.selected_skill_id IS NOT NULL;

ALTER TABLE agent_task
  ADD CONSTRAINT agent_task_skill_input_resolution_identity_fkey
  FOREIGN KEY(skill_input_resolution_id,task_id,goal_version,selected_skill_id,selected_skill_version)
  REFERENCES skill_input_resolution(resolution_id,task_id,goal_version,skill_id,skill_version)
  ON DELETE RESTRICT;

CREATE INDEX agent_task_skill_input_resolution_idx
  ON agent_task(skill_input_resolution_id)
  WHERE skill_input_resolution_id IS NOT NULL;

INSERT INTO schema_migration(version) VALUES('0060_task_skill_input_resolution_binding')
ON CONFLICT(version) DO NOTHING;

COMMIT;
