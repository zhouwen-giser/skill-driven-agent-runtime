BEGIN;

ALTER TABLE experience_usage_record
  ADD COLUMN affected_skill_goal_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(affected_skill_goal_ids) = 'array'),
  ADD CONSTRAINT experience_usage_record_user_action_check
    CHECK (user_action IS NULL OR user_action IN ('accepted', 'rejected', 'patched', 'canceled')),
  ADD CONSTRAINT experience_usage_record_validator_result_check
    CHECK (validator_result IS NULL OR jsonb_typeof(validator_result) = 'object');

CREATE INDEX experience_usage_record_plan_candidate_idx
  ON experience_usage_record(plan_candidate_id, retrieval_rank, usage_id);
CREATE INDEX experience_usage_record_final_outcome_idx
  ON experience_usage_record(final_outcome_ref)
  WHERE final_outcome_ref IS NOT NULL;

INSERT INTO schema_migration(version)
VALUES ('0122_v123_experience_enriched_planning');

COMMIT;
