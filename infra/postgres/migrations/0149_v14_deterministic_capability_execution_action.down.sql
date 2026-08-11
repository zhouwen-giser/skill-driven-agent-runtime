BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cognitive_management_action
    WHERE operation = 'deterministic_capability_execution'
  ) THEN
    RAISE EXCEPTION
      '0149 rollback refused: deterministic Capability execution audit records would be invalidated';
  END IF;
END;
$$;

ALTER TABLE cognitive_management_action
  DROP CONSTRAINT cognitive_management_action_operation_check;
ALTER TABLE cognitive_management_action
  ADD CONSTRAINT cognitive_management_action_operation_check CHECK (operation IN (
    'goal_session_action','planning_session_action','capability_rebuild',
    'capability_card_rebuild','experience_dead_letter_replay','knowledge_promote',
    'knowledge_reject','knowledge_revalidate','knowledge_deprecate',
    'artifact_request_validation','artifact_record_approval','artifact_activate',
    'artifact_request_revalidation','artifact_deprecate','artifact_rollback',
    'artifact_kill_switch','artifact_build_promotion_package'
  ));

DELETE FROM schema_migration
WHERE version = '0149_v14_deterministic_capability_execution_action';

COMMIT;
