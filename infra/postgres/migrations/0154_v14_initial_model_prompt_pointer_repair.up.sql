BEGIN;

-- 0153 originally inserted Prompt rows and versions through a data-modifying
-- CTE. PostgreSQL statement snapshots prevented its final UPDATE from seeing
-- the newly inserted Prompt targets. Repair only the exact untouched seed
-- shape; existing operator-owned current pointers are never changed.
UPDATE prompt AS target
SET current_version = 1,
    updated_at = version.created_at
FROM prompt_version AS version
WHERE target.current_version IS NULL
  AND target.prompt_id = version.prompt_id
  AND target.stage = version.stage
  AND version.version = 1
  AND version.previous_version IS NULL
  AND version.content = '{{instruction}}'
  AND version.status = 'enabled'
  AND version.source = 'admin'
  AND target.prompt_id IN (
    'prompt.runtime-default.intent',
    'prompt.runtime-default.goal',
    'prompt.runtime-default.goal_planning',
    'prompt.runtime-default.tool_enhancement',
    'prompt.runtime-default.skill_authoring',
    'prompt.runtime-default.skill_selection',
    'prompt.runtime-default.skill_input_resolution',
    'prompt.runtime-default.workflow_planning',
    'prompt.runtime-default.execution_decision',
    'prompt.runtime-default.goal_evaluation',
    'prompt.runtime-default.evaluation',
    'prompt.runtime-default.result_processing',
    'prompt.runtime-default.task_understanding',
    'prompt.runtime-default.task_clarification',
    'prompt.runtime-default.goal_contract_generation',
    'prompt.runtime-default.interactive_plan_patch',
    'prompt.runtime-default.experience_observation',
    'prompt.runtime-default.experience_reflection',
    'prompt.runtime-default.task_type_induction',
    'prompt.runtime-default.capability_pattern_induction',
    'prompt.runtime-default.knowledge_promotion_assessment'
  );

INSERT INTO schema_migration(version)
VALUES ('0154_v14_initial_model_prompt_pointer_repair');

COMMIT;
