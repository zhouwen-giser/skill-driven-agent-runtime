BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_usage_record) THEN
    RAISE EXCEPTION 'ROLLBACK_0122_REFUSED_EXPERIENCE_USAGE_EXISTS';
  END IF;
END $$;

DROP INDEX experience_usage_record_final_outcome_idx;
DROP INDEX experience_usage_record_plan_candidate_idx;

ALTER TABLE experience_usage_record
  DROP CONSTRAINT experience_usage_record_validator_result_check,
  DROP CONSTRAINT experience_usage_record_user_action_check,
  DROP COLUMN affected_skill_goal_ids;

DELETE FROM schema_migration
WHERE version = '0122_v123_experience_enriched_planning';

COMMIT;
