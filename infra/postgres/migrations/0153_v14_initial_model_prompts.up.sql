BEGIN;

-- Persisted baseline Prompts are database authority, not an in-process fallback.
-- Existing Prompt ownership for a stage always wins and is never overwritten.
CREATE TEMP TABLE initial_model_prompt_seeded ON COMMIT DROP AS
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
inserted_prompts AS (
  INSERT INTO prompt(prompt_id, stage, current_version, created_at, updated_at)
  SELECT prompt_id, stage, NULL, clock_timestamp(), clock_timestamp()
  FROM seed
  ON CONFLICT DO NOTHING
  RETURNING prompt_id, stage, created_at
)
SELECT prompt_id, stage, created_at
FROM inserted_prompts;

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
FROM initial_model_prompt_seeded;

UPDATE prompt AS target
SET current_version = 1,
    updated_at = seeded.created_at
FROM initial_model_prompt_seeded AS seeded
WHERE target.prompt_id = seeded.prompt_id;

INSERT INTO schema_migration(version)
VALUES ('0153_v14_initial_model_prompts');

COMMIT;
