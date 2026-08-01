BEGIN;

ALTER TABLE cognitive_management_action
  DROP CONSTRAINT cognitive_management_action_operation_check;
ALTER TABLE cognitive_management_action
  ADD CONSTRAINT cognitive_management_action_operation_check CHECK (operation IN (
    'goal_session_action','planning_session_action','capability_rebuild',
    'capability_card_rebuild','experience_dead_letter_replay','knowledge_promote',
    'knowledge_reject','knowledge_revalidate','knowledge_deprecate',
    'artifact_request_validation','artifact_record_approval','artifact_activate',
    'artifact_request_revalidation','artifact_deprecate','artifact_rollback',
    'artifact_kill_switch'
  ));

CREATE OR REPLACE FUNCTION sdar_assign_artifact_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN (
    'artifact.validation_started','artifact.validation_completed','artifact.shadow_started',
    'artifact.shadow_completed','artifact.promotion_ready','artifact.approval_recorded',
    'artifact.activated','artifact.revalidating','artifact.deprecated'
  )
     OR NEW.payload ? 'dependencyRef'
  THEN
    PERFORM pg_advisory_xact_lock(53444152,125);
    SELECT COALESCE(MAX(event.outbox_sequence),0)+1
    INTO NEW.outbox_sequence
    FROM cognitive_runtime_outbox event;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM artifact_management_read_audit LIMIT 1) THEN
    RAISE EXCEPTION '0134 rollback refused: artifact management read audit is not empty';
  END IF;
END
$$;

DROP TABLE artifact_management_read_audit;
DROP FUNCTION sdar_reject_artifact_management_read_audit_mutation();
DELETE FROM schema_migration WHERE version='0134_v13_artifact_management_projection';

COMMIT;
