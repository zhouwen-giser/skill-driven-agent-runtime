BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM planning_correction_fact)
     OR EXISTS (SELECT 1 FROM planning_interaction_episode) THEN
    RAISE EXCEPTION 'MIGRATION_0114_REQUIRES_EMPTY_UNRELEASED_PLANNING_CORRECTION_DATA';
  END IF;
END $$;

ALTER TABLE planning_correction_fact
  DROP CONSTRAINT planning_correction_fact_scope_check;
ALTER TABLE planning_correction_fact
  ADD CONSTRAINT planning_correction_fact_scope_check CHECK (
    scope IN ('task', 'user', 'tenant', 'global_candidate')
  ),
  ADD COLUMN goal_id text,
  ADD COLUMN goal_version integer CHECK (goal_version >= 1),
  ADD COLUMN session_id text NOT NULL,
  ADD COLUMN turn_id text NOT NULL,
  ADD COLUMN actor_id text NOT NULL,
  ADD COLUMN target_scope text NOT NULL CHECK (
    target_scope IN ('task_understanding', 'goal_contract', 'skill_goal_plan')
  ),
  ADD COLUMN accepted boolean NOT NULL,
  ADD COLUMN preference_category text CHECK (preference_category IN (
    'display', 'interaction', 'report_format', 'detailed_plan',
    'parallel_explanation', 'time_expression', 'language'
  )),
  ADD COLUMN final_outcome_ref text,
  ADD COLUMN counterexample_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(counterexample_refs) = 'array'),
  ADD COLUMN correction_hash text NOT NULL CHECK (correction_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT planning_correction_fact_goal_identity_check CHECK (
    (goal_id IS NULL) = (goal_version IS NULL)
  ),
  ADD CONSTRAINT planning_correction_fact_before_object_check CHECK (
    jsonb_typeof(before_snapshot) = 'object'
  ),
  ADD CONSTRAINT planning_correction_fact_patch_object_check CHECK (
    jsonb_typeof(structured_patch) = 'object'
  ),
  ADD CONSTRAINT planning_correction_fact_after_object_check CHECK (
    jsonb_typeof(after_snapshot) = 'object'
  ),
  ADD CONSTRAINT planning_correction_fact_validation_object_check CHECK (
    jsonb_typeof(validation) = 'object'
  );

CREATE INDEX planning_correction_fact_scope_lookup_idx
  ON planning_correction_fact(scope, tenant_id, user_id, created_at, correction_id);

ALTER TABLE planning_interaction_episode
  ADD COLUMN goal_id text,
  ADD COLUMN goal_version integer CHECK (goal_version >= 1),
  ADD COLUMN tenant_id text,
  ADD COLUMN user_id text,
  ADD COLUMN original_request text NOT NULL CHECK (length(original_request) BETWEEN 1 AND 16384),
  ADD COLUMN outcome_ref text,
  ADD COLUMN counterexample_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(counterexample_refs) = 'array'),
  ADD COLUMN induction_fingerprint text NOT NULL
    CHECK (induction_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT planning_interaction_episode_goal_identity_check CHECK (
    (goal_id IS NULL) = (goal_version IS NULL)
  );

ALTER TABLE memory_item
  ADD COLUMN scope_type text NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'user')),
  ADD COLUMN scope_user_id text,
  ADD CONSTRAINT memory_item_scope_identity_check CHECK (
    (scope_type = 'global' AND scope_user_id IS NULL)
    OR (scope_type = 'user' AND scope_user_id IS NOT NULL)
  );
ALTER TABLE memory_item DROP CONSTRAINT memory_item_authority_check;
ALTER TABLE memory_item ADD CONSTRAINT memory_item_authority_check CHECK (
  authority IN ('mcp', 'skill_experience', 'admin', 'model_inferred', 'user_instruction')
);
CREATE INDEX memory_item_scope_search_idx
  ON memory_item(scope_type, scope_user_id, status, created_at DESC);

INSERT INTO schema_migration(version) VALUES ('0114_v123_planning_corrections');

COMMIT;
