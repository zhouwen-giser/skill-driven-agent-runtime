BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM planning_correction_fact)
     OR EXISTS (SELECT 1 FROM planning_interaction_episode) THEN
    RAISE EXCEPTION 'MIGRATION_0114_ROLLBACK_REQUIRES_NO_PLANNING_CORRECTION_DATA';
  END IF;
  IF EXISTS (
    SELECT 1 FROM memory_item
    WHERE scope_type <> 'global' OR scope_user_id IS NOT NULL OR authority = 'user_instruction'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_0114_ROLLBACK_REQUIRES_NO_SCOPED_USER_MEMORY';
  END IF;
END $$;

DROP INDEX memory_item_scope_search_idx;
ALTER TABLE memory_item DROP CONSTRAINT memory_item_authority_check;
ALTER TABLE memory_item ADD CONSTRAINT memory_item_authority_check CHECK (
  authority IN ('mcp', 'skill_experience', 'admin', 'model_inferred')
);
ALTER TABLE memory_item
  DROP CONSTRAINT memory_item_scope_identity_check,
  DROP COLUMN scope_user_id,
  DROP COLUMN scope_type;

ALTER TABLE planning_interaction_episode
  DROP CONSTRAINT planning_interaction_episode_goal_identity_check,
  DROP COLUMN source_refs,
  DROP COLUMN induction_fingerprint,
  DROP COLUMN counterexample_refs,
  DROP COLUMN outcome_ref,
  DROP COLUMN original_request,
  DROP COLUMN user_id,
  DROP COLUMN tenant_id,
  DROP COLUMN goal_version,
  DROP COLUMN goal_id;

DROP INDEX planning_correction_fact_scope_lookup_idx;
ALTER TABLE planning_correction_fact
  DROP CONSTRAINT planning_correction_fact_validation_object_check,
  DROP CONSTRAINT planning_correction_fact_after_object_check,
  DROP CONSTRAINT planning_correction_fact_patch_object_check,
  DROP CONSTRAINT planning_correction_fact_before_object_check,
  DROP CONSTRAINT planning_correction_fact_goal_identity_check,
  DROP COLUMN correction_hash,
  DROP COLUMN counterexample_refs,
  DROP COLUMN final_outcome_ref,
  DROP COLUMN preference_category,
  DROP COLUMN accepted,
  DROP COLUMN target_scope,
  DROP COLUMN actor_id,
  DROP COLUMN turn_id,
  DROP COLUMN session_id,
  DROP COLUMN goal_version,
  DROP COLUMN goal_id;

DELETE FROM schema_migration WHERE version = '0114_v123_planning_corrections';

COMMIT;
