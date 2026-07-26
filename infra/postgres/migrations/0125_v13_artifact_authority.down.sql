BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compiled_artifact LIMIT 1)
    OR EXISTS (SELECT 1 FROM artifact_validation_run LIMIT 1)
    OR EXISTS (SELECT 1 FROM artifact_approval LIMIT 1)
    OR EXISTS (SELECT 1 FROM artifact_execution LIMIT 1)
    OR EXISTS (SELECT 1 FROM artifact_feedback LIMIT 1)
    OR EXISTS (SELECT 1 FROM artifact_match_log LIMIT 1)
    OR EXISTS (SELECT 1 FROM experience_trace LIMIT 1)
    OR EXISTS (SELECT 1 FROM pattern_candidate LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM cognitive_management_action
      WHERE operation LIKE 'artifact_%'
      LIMIT 1
    )
  THEN
    RAISE EXCEPTION
      '0125 rollback refused: Artifact authority or governance evidence would be destroyed';
  END IF;
END
$$;

ALTER TABLE cognitive_management_action
  DROP CONSTRAINT cognitive_management_action_operation_check;
ALTER TABLE cognitive_management_action
  ADD CONSTRAINT cognitive_management_action_operation_check CHECK (operation IN (
    'goal_session_action',
    'planning_session_action',
    'capability_rebuild',
    'capability_card_rebuild',
    'experience_dead_letter_replay',
    'knowledge_promote',
    'knowledge_reject',
    'knowledge_revalidate',
    'knowledge_deprecate'
  ));

ALTER TABLE compiled_artifact
  DROP CONSTRAINT compiled_artifact_lineage_fk;
DROP TABLE pattern_candidate;
DROP TABLE experience_trace;
DROP TABLE artifact_match_log;
DROP TABLE artifact_feedback;
DROP TABLE artifact_execution;
DROP TABLE artifact_approval;
DROP TABLE artifact_validation_run;
DROP TABLE artifact_lineage;
DROP TABLE artifact_active_pointer;
DROP TABLE compiled_artifact;
DROP FUNCTION sdar_jsonb_depth(jsonb);

DELETE FROM schema_migration
WHERE version = '0125_v13_artifact_authority';

COMMIT;
