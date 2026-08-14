BEGIN;

-- Repair databases whose 0153/0154 ledger entries survived while the reserved
-- baseline Prompt rows were removed. Existing stage ownership and operator
-- content always win; this migration only fills completely missing stages.
CREATE TEMP TABLE initial_model_prompt_seed_repair ON COMMIT DROP AS
WITH seed(prompt_id, stage) AS (
  VALUES
    ('prompt.runtime-default.intent', 'intent'),
    ('prompt.runtime-default.goal', 'goal'),
    ('prompt.runtime-default.goal_planning', 'goal_planning'),
    ('prompt.runtime-default.tool_enhancement', 'tool_enhancement'),
    ('prompt.runtime-default.skill_authoring', 'skill_authoring'),
    ('prompt.runtime-default.skill_selection', 'skill_selection'),
    ('prompt.runtime-default.skill_input_resolution', 'skill_input_resolution'),
    ('prompt.runtime-default.workflow_planning', 'workflow_planning'),
    ('prompt.runtime-default.execution_decision', 'execution_decision'),
    ('prompt.runtime-default.goal_evaluation', 'goal_evaluation'),
    ('prompt.runtime-default.evaluation', 'evaluation'),
    ('prompt.runtime-default.result_processing', 'result_processing'),
    ('prompt.runtime-default.task_understanding', 'task_understanding'),
    ('prompt.runtime-default.task_clarification', 'task_clarification'),
    ('prompt.runtime-default.goal_contract_generation', 'goal_contract_generation'),
    ('prompt.runtime-default.interactive_plan_patch', 'interactive_plan_patch'),
    ('prompt.runtime-default.experience_observation', 'experience_observation'),
    ('prompt.runtime-default.experience_reflection', 'experience_reflection'),
    ('prompt.runtime-default.task_type_induction', 'task_type_induction'),
    ('prompt.runtime-default.capability_pattern_induction', 'capability_pattern_induction'),
    ('prompt.runtime-default.knowledge_promotion_assessment', 'knowledge_promotion_assessment')
),
inserted AS (
  INSERT INTO prompt(prompt_id, stage, current_version, created_at, updated_at)
  SELECT seed.prompt_id, seed.stage, NULL, clock_timestamp(), clock_timestamp()
  FROM seed
  WHERE NOT EXISTS (SELECT 1 FROM prompt existing WHERE existing.stage = seed.stage)
  ON CONFLICT DO NOTHING
  RETURNING prompt_id, stage, created_at
)
SELECT prompt_id, stage, created_at FROM inserted;

INSERT INTO prompt_version(
  prompt_id,
  stage,
  version,
  previous_version,
  content,
  status,
  source,
  created_at
)
SELECT prompt_id, stage, 1, NULL, '{{instruction}}', 'enabled', 'admin', created_at
FROM initial_model_prompt_seed_repair;

UPDATE prompt AS target
SET current_version = 1,
    updated_at = seeded.created_at
FROM initial_model_prompt_seed_repair AS seeded
WHERE target.prompt_id = seeded.prompt_id
  AND target.stage = seeded.stage
  AND target.current_version IS NULL;

INSERT INTO schema_migration(version)
VALUES ('0163_v14_initial_model_prompt_seed_repair');

COMMIT;
