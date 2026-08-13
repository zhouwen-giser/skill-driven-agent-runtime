BEGIN;

-- Task revisions are bigint and an explicit precondition is persisted on the
-- Cognitive action. Keep the two authorities representationally identical.
ALTER TABLE cognitive_management_action
  ALTER COLUMN expected_version TYPE bigint;

ALTER TABLE agent_task
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_command_token uuid,
  ADD COLUMN IF NOT EXISTS command_action_id text,
  ADD COLUMN IF NOT EXISTS command_operation text,
  ADD COLUMN IF NOT EXISTS command_idempotency_key text,
  ADD COLUMN IF NOT EXISTS command_lease_attempt integer,
  ADD COLUMN IF NOT EXISTS command_lease_token text,
  ADD COLUMN IF NOT EXISTS command_claimed_revision bigint,
  ADD COLUMN IF NOT EXISTS command_precondition_json jsonb,
  ADD COLUMN IF NOT EXISTS command_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS command_execution_phase text,
  ADD COLUMN IF NOT EXISTS command_result_json jsonb,
  ADD COLUMN IF NOT EXISTS command_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS command_recovery_disposition text;

CREATE TABLE IF NOT EXISTS runtime_task_command_effect (
  action_id text NOT NULL REFERENCES cognitive_management_action(action_id) ON DELETE RESTRICT,
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  command_token uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('pause','resume','cancel','goal-patch')),
  idempotency_key text NOT NULL,
  effect_kind text NOT NULL,
  effect_ref text NOT NULL,
  effect_json jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY(action_id,effect_kind,effect_ref),
  CHECK(btrim(effect_kind) <> '' AND btrim(effect_ref) <> '')
);
CREATE INDEX IF NOT EXISTS runtime_task_command_effect_task_idx
  ON runtime_task_command_effect(task_id,action_id,effect_kind);

ALTER TABLE agent_task
  DROP CONSTRAINT IF EXISTS agent_task_revision_nonnegative,
  DROP CONSTRAINT IF EXISTS agent_task_command_identity_complete;

ALTER TABLE agent_task
  ADD CONSTRAINT agent_task_revision_nonnegative CHECK (revision >= 0),
  ADD CONSTRAINT agent_task_command_identity_complete CHECK (
    (
      active_command_token IS NULL
      AND command_action_id IS NULL AND command_operation IS NULL
      AND command_idempotency_key IS NULL AND command_lease_attempt IS NULL
      AND command_lease_token IS NULL AND command_claimed_revision IS NULL
      AND command_precondition_json IS NULL AND command_claimed_at IS NULL
      AND command_execution_phase IS NULL AND command_result_json IS NULL
      AND command_completed_at IS NULL AND command_recovery_disposition IS NULL
    ) OR (
      command_action_id IS NOT NULL AND btrim(command_action_id) <> ''
      AND command_operation IN ('pause','resume','cancel','goal-patch')
      AND command_idempotency_key IS NOT NULL AND btrim(command_idempotency_key) <> ''
      AND command_lease_attempt >= 1
      AND command_lease_token IS NOT NULL AND btrim(command_lease_token) <> ''
      AND command_claimed_revision >= 1
      AND command_precondition_json IS NOT NULL AND command_claimed_at IS NOT NULL
      AND (
        (active_command_token IS NOT NULL
          AND command_execution_phase IN ('claimed','dispatch_started')
          AND command_result_json IS NULL AND command_completed_at IS NULL
          AND command_recovery_disposition IS NULL)
        OR
        (active_command_token IS NULL
          AND command_execution_phase='completed'
          AND command_result_json IS NOT NULL AND command_completed_at IS NOT NULL
          AND command_recovery_disposition IS NULL)
        OR
        (active_command_token IS NULL
          AND command_execution_phase='recovered_applied'
          AND command_result_json IS NOT NULL AND command_completed_at IS NOT NULL
          AND command_recovery_disposition='applied')
        OR
        (active_command_token IS NULL
          AND command_execution_phase='recovered_unapplied'
          AND command_result_json IS NULL AND command_completed_at IS NULL
          AND command_recovery_disposition='unapplied')
      )
    )
  ) NOT VALID;
ALTER TABLE agent_task VALIDATE CONSTRAINT agent_task_command_identity_complete;

DROP TRIGGER IF EXISTS agent_task_command_fence ON agent_task;
DROP FUNCTION IF EXISTS fence_agent_task_command_updates();
DROP TRIGGER IF EXISTS agent_task_revision_authority ON agent_task;
DROP FUNCTION IF EXISTS advance_agent_task_revision();
DROP FUNCTION IF EXISTS enforce_agent_task_revision_authority();

CREATE OR REPLACE FUNCTION enforce_agent_task_revision_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  setting_task_id text := NULLIF(current_setting('sdar.runtime_task_command_task_id', true), '');
  setting_token text := NULLIF(current_setting('sdar.runtime_task_command_token', true), '');
  setting_action_id text := NULLIF(current_setting('sdar.runtime_task_command_action_id', true), '');
  setting_operation text := NULLIF(current_setting('sdar.runtime_task_command_operation', true), '');
  setting_idempotency_key text := NULLIF(current_setting('sdar.runtime_task_command_idempotency_key', true), '');
  setting_lease_attempt_text text := NULLIF(current_setting('sdar.runtime_task_command_lease_attempt', true), '');
  setting_lease_token text := NULLIF(current_setting('sdar.runtime_task_command_lease_token', true), '');
  setting_expected_revision_text text := NULLIF(current_setting('sdar.runtime_task_command_expected_revision', true), '');
  recovery_disposition text := NULLIF(current_setting('sdar.runtime_task_command_recovery', true), '');
  setting_lease_attempt integer;
  setting_expected_revision bigint;
  expected_audit_operation text;
  old_token text;
  new_token text;
  old_business jsonb;
  new_business jsonb;
  business_content_changed boolean;
  stable_command_metadata_changed boolean;
  current_lease_valid boolean := false;
  prior_action_terminal boolean := true;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision <> 0 OR NEW.active_command_token IS NOT NULL
      OR NEW.command_action_id IS NOT NULL OR NEW.command_operation IS NOT NULL
      OR NEW.command_idempotency_key IS NOT NULL OR NEW.command_lease_attempt IS NOT NULL
      OR NEW.command_lease_token IS NOT NULL OR NEW.command_claimed_revision IS NOT NULL
      OR NEW.command_precondition_json IS NOT NULL OR NEW.command_claimed_at IS NOT NULL
      OR NEW.command_execution_phase IS NOT NULL OR NEW.command_result_json IS NOT NULL
      OR NEW.command_completed_at IS NOT NULL OR NEW.command_recovery_disposition IS NOT NULL
    THEN
      RAISE EXCEPTION 'AGENT_TASK_COMMAND_INSERT_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  IF setting_lease_attempt_text ~ '^[1-9][0-9]*$' THEN
    setting_lease_attempt := setting_lease_attempt_text::integer;
  END IF;
  IF setting_expected_revision_text ~ '^-?[0-9]+$' THEN
    setting_expected_revision := setting_expected_revision_text::bigint;
  END IF;
  expected_audit_operation := CASE setting_operation
    WHEN 'pause' THEN 'task_pause'
    WHEN 'resume' THEN 'task_resume'
    WHEN 'cancel' THEN 'task_cancel'
    WHEN 'goal-patch' THEN 'task_goal_patch'
    ELSE NULL
  END;
  old_token := OLD.active_command_token::text;
  new_token := NEW.active_command_token::text;
  old_business := to_jsonb(OLD)
    - 'revision' - 'active_command_token' - 'command_action_id' - 'command_operation'
    - 'command_idempotency_key' - 'command_lease_attempt' - 'command_lease_token'
    - 'command_claimed_revision' - 'command_precondition_json' - 'command_claimed_at'
    - 'command_execution_phase' - 'command_result_json' - 'command_completed_at'
    - 'command_recovery_disposition';
  new_business := to_jsonb(NEW)
    - 'revision' - 'active_command_token' - 'command_action_id' - 'command_operation'
    - 'command_idempotency_key' - 'command_lease_attempt' - 'command_lease_token'
    - 'command_claimed_revision' - 'command_precondition_json' - 'command_claimed_at'
    - 'command_execution_phase' - 'command_result_json' - 'command_completed_at'
    - 'command_recovery_disposition';
  business_content_changed := new_business IS DISTINCT FROM old_business;
  stable_command_metadata_changed := ROW(
    NEW.command_action_id,NEW.command_operation,NEW.command_idempotency_key,
    NEW.command_lease_attempt,NEW.command_lease_token,NEW.command_claimed_revision,
    NEW.command_precondition_json,NEW.command_claimed_at
  ) IS DISTINCT FROM ROW(
    OLD.command_action_id,OLD.command_operation,OLD.command_idempotency_key,
    OLD.command_lease_attempt,OLD.command_lease_token,OLD.command_claimed_revision,
    OLD.command_precondition_json,OLD.command_claimed_at
  );

  IF setting_action_id IS NOT NULL AND setting_lease_attempt IS NOT NULL
    AND setting_lease_token IS NOT NULL AND expected_audit_operation IS NOT NULL
    AND setting_expected_revision IS NOT NULL AND setting_task_id IS NOT NULL
  THEN
    SELECT true INTO current_lease_valid
      FROM cognitive_management_action action
      WHERE action.action_id=setting_action_id
        AND action.operation=expected_audit_operation
        AND action.subject_id='runtime-task-control:' || setting_task_id
        AND action.idempotency_key=setting_idempotency_key
        AND action.expected_version=CASE WHEN setting_expected_revision=-1 THEN 0 ELSE setting_expected_revision END
        AND action.status='pending'
        AND action.lease_attempt=setting_lease_attempt
        AND action.lease_token=setting_lease_token
        AND action.lease_expires_at>clock_timestamp()
      FOR UPDATE;
  END IF;

  -- Exact durable claim. A previous single-slot result may not be overwritten
  -- while its Cognitive action is still pending between Task release and Gate completion.
  IF old_token IS NULL AND new_token IS NOT NULL THEN
    IF OLD.command_action_id IS NOT NULL THEN
      SELECT status IN ('completed','failed') INTO prior_action_terminal
        FROM cognitive_management_action WHERE action_id=OLD.command_action_id;
    END IF;
    IF NOT COALESCE(current_lease_valid,false) OR NOT COALESCE(prior_action_terminal,false)
      OR setting_task_id IS DISTINCT FROM OLD.task_id
      OR setting_token IS DISTINCT FROM new_token
      OR setting_action_id IS DISTINCT FROM NEW.command_action_id
      OR setting_operation IS DISTINCT FROM NEW.command_operation
      OR setting_idempotency_key IS DISTINCT FROM NEW.command_idempotency_key
      OR setting_lease_attempt IS DISTINCT FROM NEW.command_lease_attempt
      OR setting_lease_token IS DISTINCT FROM NEW.command_lease_token
      OR (setting_expected_revision <> -1 AND setting_expected_revision IS DISTINCT FROM OLD.revision)
      OR NEW.command_claimed_revision <> OLD.revision + 1
      OR NEW.command_precondition_json IS DISTINCT FROM old_business
      OR NEW.command_claimed_at IS NULL OR NEW.command_execution_phase <> 'claimed'
      OR NEW.command_result_json IS NOT NULL OR NEW.command_completed_at IS NOT NULL
      OR NEW.command_recovery_disposition IS NOT NULL OR business_content_changed
      OR NEW.revision <> OLD.revision + 1
    THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_CLAIM_INVALID'; END IF;
    RETURN NEW;
  END IF;

  IF old_token IS NOT NULL THEN
    IF recovery_disposition IN ('applied','unapplied') AND new_token IS NULL THEN
      IF NOT COALESCE(current_lease_valid,false)
        OR setting_task_id IS DISTINCT FROM OLD.task_id
        OR setting_action_id IS DISTINCT FROM OLD.command_action_id
        OR setting_operation IS DISTINCT FROM OLD.command_operation
        OR setting_idempotency_key IS DISTINCT FROM OLD.command_idempotency_key
        OR stable_command_metadata_changed OR business_content_changed
        OR NEW.revision <> OLD.revision
        OR NEW.command_recovery_disposition IS DISTINCT FROM recovery_disposition
        OR (recovery_disposition='applied' AND (
          NEW.command_execution_phase <> 'recovered_applied'
          OR NEW.command_result_json IS NULL OR NEW.command_completed_at IS NULL))
        OR (recovery_disposition='unapplied' AND (
          OLD.command_execution_phase <> 'claimed'
          OR NEW.command_execution_phase <> 'recovered_unapplied'
          OR NEW.command_result_json IS NOT NULL OR NEW.command_completed_at IS NOT NULL))
      THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_RECOVERY_INVALID'; END IF;
      RETURN NEW;
    END IF;

    IF NOT COALESCE(current_lease_valid,false)
      OR setting_task_id IS DISTINCT FROM OLD.task_id
      OR setting_token IS DISTINCT FROM old_token
      OR setting_action_id IS DISTINCT FROM OLD.command_action_id
      OR setting_operation IS DISTINCT FROM OLD.command_operation
      OR setting_idempotency_key IS DISTINCT FROM OLD.command_idempotency_key
      OR setting_lease_attempt IS DISTINCT FROM OLD.command_lease_attempt
      OR setting_lease_token IS DISTINCT FROM OLD.command_lease_token
      OR (setting_expected_revision <> -1
        AND setting_expected_revision IS DISTINCT FROM OLD.command_claimed_revision - 1)
    THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_FENCED'; END IF;

    IF new_token IS NULL THEN
      IF stable_command_metadata_changed OR business_content_changed OR NEW.revision <> OLD.revision
        OR OLD.command_execution_phase <> 'dispatch_started'
        OR NEW.command_execution_phase <> 'completed'
        OR NEW.command_result_json IS NULL OR NEW.command_completed_at IS NULL
        OR NEW.command_recovery_disposition IS NOT NULL
      THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_RELEASE_INVALID'; END IF;
      RETURN NEW;
    END IF;
    IF new_token IS DISTINCT FROM old_token OR stable_command_metadata_changed
      OR NEW.command_result_json IS DISTINCT FROM OLD.command_result_json
      OR NEW.command_completed_at IS DISTINCT FROM OLD.command_completed_at
      OR NEW.command_recovery_disposition IS DISTINCT FROM OLD.command_recovery_disposition
      OR NEW.command_execution_phase NOT IN (OLD.command_execution_phase,'dispatch_started')
      OR (OLD.command_execution_phase='dispatch_started'
        AND NEW.command_execution_phase IS DISTINCT FROM OLD.command_execution_phase)
    THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_TOKEN_MUTATION_FORBIDDEN'; END IF;
    IF NEW.command_execution_phase='dispatch_started'
      AND OLD.command_execution_phase='claimed' AND business_content_changed
    THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_DISPATCH_INVALID'; END IF;
    IF business_content_changed THEN
      IF NEW.revision <> OLD.revision THEN RAISE EXCEPTION 'AGENT_TASK_REVISION_WRITE_FORBIDDEN'; END IF;
      NEW.revision := OLD.revision + 1;
    ELSIF NEW.revision <> OLD.revision THEN
      RAISE EXCEPTION 'AGENT_TASK_REVISION_WRITE_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  -- A queued stale command writer must never degrade into an ordinary writer
  -- after recovery clears its target Task. Goal Patch may still update sibling
  -- Tasks under the same session identity.
  IF setting_task_id IS NOT NULL AND setting_task_id=OLD.task_id AND (
    setting_token IS NOT NULL OR setting_action_id IS NOT NULL OR setting_operation IS NOT NULL
  ) THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_STALE_WRITER'; END IF;
  IF new_token IS NOT NULL THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_CLAIM_INVALID'; END IF;
  IF stable_command_metadata_changed
    OR NEW.command_execution_phase IS DISTINCT FROM OLD.command_execution_phase
    OR NEW.command_result_json IS DISTINCT FROM OLD.command_result_json
    OR NEW.command_completed_at IS DISTINCT FROM OLD.command_completed_at
    OR NEW.command_recovery_disposition IS DISTINCT FROM OLD.command_recovery_disposition
  THEN RAISE EXCEPTION 'AGENT_TASK_COMMAND_METADATA_WRITE_FORBIDDEN'; END IF;
  IF business_content_changed THEN
    IF NEW.revision <> OLD.revision THEN RAISE EXCEPTION 'AGENT_TASK_REVISION_WRITE_FORBIDDEN'; END IF;
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.revision <> OLD.revision THEN
    RAISE EXCEPTION 'AGENT_TASK_REVISION_WRITE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_task_revision_authority
BEFORE INSERT OR UPDATE ON agent_task
FOR EACH ROW EXECUTE FUNCTION enforce_agent_task_revision_authority();

INSERT INTO schema_migration (version)
VALUES ('0162_v14_agent_task_revision_authority')
ON CONFLICT (version) DO NOTHING;

COMMIT;
