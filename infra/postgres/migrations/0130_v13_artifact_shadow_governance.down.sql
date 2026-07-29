-- P06 rollback is safe only before P06 governance evidence has been relied on.
-- Production rollback must first deprecate active P06 artifacts and preserve the audit export.

BEGIN;

DELETE FROM schema_migration WHERE version = '0130_v13_artifact_shadow_governance';

ALTER TABLE cognitive_runtime_outbox
  DROP CONSTRAINT cognitive_runtime_outbox_artifact_sequence_check;
ALTER TABLE cognitive_runtime_outbox
  ADD CONSTRAINT cognitive_runtime_outbox_artifact_sequence_check CHECK (
    (
      event_type NOT IN (
        'artifact.validation_started','artifact.validation_completed','artifact.approval_recorded',
        'artifact.activated','artifact.revalidating','artifact.deprecated'
      ) AND NOT (payload ? 'dependencyRef')
    ) OR outbox_sequence IS NOT NULL
  );

CREATE OR REPLACE FUNCTION sdar_assign_artifact_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN (
    'artifact.validation_started','artifact.validation_completed','artifact.approval_recorded',
    'artifact.activated','artifact.revalidating','artifact.deprecated'
  ) OR NEW.payload ? 'dependencyRef' THEN
    PERFORM pg_advisory_xact_lock(53444152,125);
    SELECT COALESCE(MAX(event.outbox_sequence),0)+1 INTO NEW.outbox_sequence
    FROM cognitive_runtime_outbox event;
  END IF;
  RETURN NEW;
END
$$;

DROP TABLE artifact_rollback_record;
DROP TABLE artifact_revalidation_trigger;
DROP TABLE artifact_activation_record;
DROP INDEX artifact_approval_p06_exact_evidence_uq;
ALTER TABLE artifact_approval DROP CONSTRAINT artifact_approval_promotion_hash_check;
ALTER TABLE artifact_approval DROP CONSTRAINT artifact_approval_promotion_package_fk;
ALTER TABLE artifact_approval DROP COLUMN approval_hash;
ALTER TABLE artifact_approval DROP COLUMN promotion_package_hash;
ALTER TABLE artifact_approval DROP COLUMN promotion_package_id;
DROP TABLE artifact_promotion_assessment;
DROP TABLE artifact_promotion_package;
DROP TABLE artifact_promotion_policy;
DROP TABLE artifact_shadow_result;
DROP TABLE artifact_shadow_run;

COMMIT;
