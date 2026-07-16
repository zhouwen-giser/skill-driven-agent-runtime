BEGIN;

ALTER TABLE workflow_plan ADD COLUMN IF NOT EXISTS goal_contract_json jsonb;
ALTER TABLE workflow_plan_attempt ADD COLUMN IF NOT EXISTS goal_contract_json jsonb;
ALTER TABLE skill_selection_record ADD COLUMN IF NOT EXISTS goal_contract_json jsonb;
ALTER TABLE skill_replacement_plan ADD COLUMN IF NOT EXISTS goal_contract_json jsonb;

UPDATE workflow_plan AS plan
SET goal_contract_json = COALESCE(
  (
    SELECT patch.after_goal_json
    FROM goal_patch AS patch
    WHERE patch.goal_id = plan.goal_id AND patch.to_version = plan.goal_version
    ORDER BY patch.created_at DESC LIMIT 1
  ),
  (
    SELECT patch.before_goal_json
    FROM goal_patch AS patch
    WHERE patch.goal_id = plan.goal_id AND patch.from_version = plan.goal_version
    ORDER BY patch.created_at DESC LIMIT 1
  ),
  (
    SELECT jsonb_build_object(
      'goalId', goal.goal_id,
      'version', plan.goal_version,
      'title', goal.title,
      'description', goal.description,
      'constraints', goal.constraints_json,
      'successCriteria', goal.success_criteria_json
    )
    FROM goal WHERE goal.goal_id = plan.goal_id
  ),
  jsonb_build_object(
    'goalId', plan.goal_id,
    'version', plan.goal_version,
    'title', plan.goal_id,
    'description', 'Legacy plan created before Goal execution contract snapshots.',
    'constraints', '[]'::jsonb,
    'successCriteria', '[]'::jsonb
  )
)
WHERE goal_contract_json IS NULL;

UPDATE workflow_plan_attempt AS attempt
SET goal_contract_json = plan.goal_contract_json
FROM workflow_plan AS plan
WHERE attempt.plan_id = plan.plan_id AND attempt.goal_contract_json IS NULL;

UPDATE skill_selection_record AS selection
SET goal_contract_json = COALESCE(
  (
    SELECT COALESCE(
      (
        SELECT patch.after_goal_json
        FROM goal_patch AS patch
        WHERE patch.goal_id = task.goal_id AND patch.to_version = task.goal_version
        ORDER BY patch.created_at DESC LIMIT 1
      ),
      (
        SELECT patch.before_goal_json
        FROM goal_patch AS patch
        WHERE patch.goal_id = task.goal_id AND patch.from_version = task.goal_version
        ORDER BY patch.created_at DESC LIMIT 1
      ),
      jsonb_build_object(
        'goalId', goal.goal_id,
        'version', task.goal_version,
        'title', goal.title,
        'description', goal.description,
        'constraints', goal.constraints_json,
        'successCriteria', goal.success_criteria_json
      )
    )
    FROM agent_task AS task
    JOIN goal ON goal.goal_id = task.goal_id
    WHERE task.skill_selection_id = selection.selection_id
    ORDER BY task.created_at DESC LIMIT 1
  ),
  jsonb_build_object(
    'goalId', 'legacy-selection-' || selection.selection_id,
    'version', 1,
    'title', selection.goal_description,
    'description', selection.goal_description,
    'constraints', '[]'::jsonb,
    'successCriteria', '[]'::jsonb
  )
)
WHERE goal_contract_json IS NULL;

UPDATE skill_replacement_plan AS replacement
SET goal_contract_json = selection.goal_contract_json
FROM skill_selection_record AS selection
WHERE replacement.selection_id = selection.selection_id
  AND replacement.goal_contract_json IS NULL;

UPDATE skill_selection_record
SET candidates_json = COALESCE(
  (
    SELECT jsonb_agg(
      candidate || jsonb_build_object(
        'inputSchemaSummary', jsonb_build_object(
          'type', 'unspecified', 'requiredFields', '[]'::jsonb,
          'propertyNames', '[]'::jsonb, 'allowsAdditionalProperties', 'unspecified'
        ),
        'outputSchemaSummary', jsonb_build_object(
          'type', 'unspecified', 'requiredFields', '[]'::jsonb,
          'propertyNames', '[]'::jsonb, 'allowsAdditionalProperties', 'unspecified'
        ),
        'toolPolicy', jsonb_build_object(
          'required', '[]'::jsonb, 'optional', '[]'::jsonb, 'forbidden', '[]'::jsonb
        ),
        'workflowGuidanceSummary', '',
        'runtimePolicy', jsonb_build_object(
          'autoConfirmPlan', COALESCE((candidate->>'autoConfirmPlan')::boolean, false)
        ),
        'activeMcpDependencyWarnings', '[]'::jsonb
      )
    )
    FROM jsonb_array_elements(candidates_json) AS candidate
  ),
  '[]'::jsonb
)
WHERE NOT (candidates_json @> '[{"inputSchemaSummary": {}}]'::jsonb);

UPDATE skill_replacement_plan
SET candidates_json = COALESCE(
  (
    SELECT jsonb_agg(
      candidate || jsonb_build_object(
        'inputSchemaSummary', jsonb_build_object(
          'type', 'unspecified', 'requiredFields', '[]'::jsonb,
          'propertyNames', '[]'::jsonb, 'allowsAdditionalProperties', 'unspecified'
        ),
        'outputSchemaSummary', jsonb_build_object(
          'type', 'unspecified', 'requiredFields', '[]'::jsonb,
          'propertyNames', '[]'::jsonb, 'allowsAdditionalProperties', 'unspecified'
        ),
        'toolPolicy', jsonb_build_object(
          'required', '[]'::jsonb, 'optional', '[]'::jsonb, 'forbidden', '[]'::jsonb
        ),
        'workflowGuidanceSummary', '',
        'runtimePolicy', jsonb_build_object(
          'autoConfirmPlan', COALESCE((candidate->>'autoConfirmPlan')::boolean, false)
        ),
        'activeMcpDependencyWarnings', '[]'::jsonb
      )
    )
    FROM jsonb_array_elements(candidates_json) AS candidate
  ),
  '[]'::jsonb
)
WHERE NOT (candidates_json @> '[{"inputSchemaSummary": {}}]'::jsonb);

ALTER TABLE workflow_plan ALTER COLUMN goal_contract_json SET NOT NULL;
ALTER TABLE workflow_plan_attempt ALTER COLUMN goal_contract_json SET NOT NULL;
ALTER TABLE skill_selection_record ALTER COLUMN goal_contract_json SET NOT NULL;
ALTER TABLE skill_replacement_plan ALTER COLUMN goal_contract_json SET NOT NULL;

ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_goal_contract_identity_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_goal_contract_identity_check CHECK (
  goal_contract_json->>'goalId' = goal_id
  AND (goal_contract_json->>'version')::integer = goal_version
);

INSERT INTO schema_migration(version) VALUES('0061_goal_execution_contract')
ON CONFLICT(version) DO NOTHING;

COMMIT;
