-- 0134_v13_artifact_management_projection.up.sql
-- P12 read-audit support only. P02-P11 tables remain business authority.

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
    'artifact_kill_switch','artifact_build_promotion_package'
  ));

CREATE OR REPLACE FUNCTION sdar_assign_artifact_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN (
    'compiler.artifact_candidate_created','artifact.validation_started',
    'artifact.validation_completed','artifact.shadow_completed','artifact.promotion_ready',
    'artifact.approval_recorded','artifact.activated','artifact.revalidating',
    'artifact.deprecated','gateway.route_selected','gateway.confirmation_required',
    'gateway.fallback_started','gateway.formal_handoff','artifact.rule_evaluated',
    'template.instantiated','case.adapted','model_route.selected','model_cascade.escalated',
    'artifact.feedback_recorded'
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

WITH unsequenced AS (
  SELECT event_id,
         COALESCE((SELECT MAX(outbox_sequence) FROM cognitive_runtime_outbox),0)
           + row_number() OVER (ORDER BY occurred_at,event_id) AS next_sequence
  FROM cognitive_runtime_outbox
  WHERE outbox_sequence IS NULL
    AND event_type IN (
      'compiler.artifact_candidate_created','artifact.validation_started',
      'artifact.validation_completed','artifact.shadow_completed','artifact.promotion_ready',
      'artifact.approval_recorded','artifact.activated','artifact.revalidating',
      'artifact.deprecated','gateway.route_selected','gateway.confirmation_required',
      'gateway.fallback_started','gateway.formal_handoff','artifact.rule_evaluated',
      'template.instantiated','case.adapted','model_route.selected','model_cascade.escalated',
      'artifact.feedback_recorded'
    )
)
UPDATE cognitive_runtime_outbox outbox
SET outbox_sequence=unsequenced.next_sequence
FROM unsequenced
WHERE outbox.event_id=unsequenced.event_id;

CREATE TABLE artifact_management_read_audit (
  audit_id text PRIMARY KEY,
  actor_id text NOT NULL,
  roles jsonb NOT NULL CHECK (
    jsonb_typeof(roles) = 'array'
    AND jsonb_array_length(roles) BETWEEN 1 AND 16
  ),
  tenant_id text,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 128),
  target text NOT NULL CHECK (length(target) BETWEEN 1 AND 512),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 512),
  result text NOT NULL CHECK (result IN ('allowed','denied','not_found')),
  source_ip text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (actor_id, request_id, operation, target)
);
CREATE INDEX artifact_management_read_audit_tenant_time_idx
  ON artifact_management_read_audit(tenant_id, occurred_at DESC, audit_id);

CREATE FUNCTION sdar_reject_artifact_management_read_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'artifact management read audit is append-only';
END;
$$;

CREATE TRIGGER artifact_management_read_audit_immutability
BEFORE UPDATE OR DELETE ON artifact_management_read_audit
FOR EACH ROW EXECUTE FUNCTION sdar_reject_artifact_management_read_audit_mutation();

INSERT INTO schema_migration(version)
VALUES ('0134_v13_artifact_management_projection');

COMMIT;
