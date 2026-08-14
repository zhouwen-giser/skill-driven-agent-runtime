BEGIN;

ALTER TABLE mcp_invocation
  DROP CONSTRAINT mcp_invocation_control_confirmation_unique,
  DROP CONSTRAINT mcp_invocation_control_authority_fk,
  DROP CONSTRAINT mcp_invocation_control_authority_shape_check,
  DROP COLUMN control_dispatch_hash,
  DROP COLUMN control_arguments_hash,
  DROP COLUMN control_provider_binding_id,
  DROP COLUMN control_confirmation_id;

CREATE OR REPLACE FUNCTION protect_governed_control_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_CONFIRMATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id OR
     NEW.task_id IS DISTINCT FROM OLD.task_id OR
     NEW.capability_binding_id IS DISTINCT FROM OLD.capability_binding_id OR
     NEW.capability_id IS DISTINCT FROM OLD.capability_id OR
     NEW.capability_version IS DISTINCT FROM OLD.capability_version OR
     NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
     NEW.plan_hash IS DISTINCT FROM OLD.plan_hash OR
     NEW.skill_id IS DISTINCT FROM OLD.skill_id OR
     NEW.skill_version IS DISTINCT FROM OLD.skill_version OR
     NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
     NEW.actor_kind IS DISTINCT FROM OLD.actor_kind OR
     NEW.authentication_method IS DISTINCT FROM OLD.authentication_method OR
     NEW.actor_roles_json IS DISTINCT FROM OLD.actor_roles_json OR
     NEW.reason IS DISTINCT FROM OLD.reason OR
     NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     (OLD.revoked_at IS NOT NULL AND
       (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)) OR
     (OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL AND NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_CONFIRMATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE governed_control_confirmation
  DROP CONSTRAINT governed_control_confirmation_consumed_dispatch_unique,
  DROP CONSTRAINT governed_control_confirmation_consumed_invocation_unique,
  DROP CONSTRAINT governed_control_confirmation_consumption_shape_check,
  DROP CONSTRAINT governed_control_confirmation_tool_fk,
  DROP CONSTRAINT governed_control_confirmation_attempt_fk,
  DROP COLUMN consumed_at,
  DROP COLUMN consumed_dispatch_hash,
  DROP COLUMN consumed_invocation_id,
  DROP COLUMN arguments_hash,
  DROP COLUMN tool_name,
  DROP COLUMN server_id,
  DROP COLUMN provider_binding_id,
  DROP COLUMN capability_attempt_id;

DELETE FROM schema_migration
WHERE version='0158_v14_governed_control_dispatch_consumption';

COMMIT;
