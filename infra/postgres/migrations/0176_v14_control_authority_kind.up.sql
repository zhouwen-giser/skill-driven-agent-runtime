BEGIN;

ALTER TABLE governed_control_confirmation
  ADD COLUMN authority_kind text NOT NULL DEFAULT 'physical_control',
  ADD CONSTRAINT governed_control_confirmation_authority_kind_check CHECK(
    authority_kind IN ('physical_control','emergency_stop','weapon_control')
  );

CREATE OR REPLACE FUNCTION protect_governed_control_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_CONFIRMATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id OR
     NEW.authority_kind IS DISTINCT FROM OLD.authority_kind OR
     NEW.task_id IS DISTINCT FROM OLD.task_id OR
     NEW.capability_binding_id IS DISTINCT FROM OLD.capability_binding_id OR
     NEW.capability_id IS DISTINCT FROM OLD.capability_id OR
     NEW.capability_version IS DISTINCT FROM OLD.capability_version OR
     NEW.capability_attempt_id IS DISTINCT FROM OLD.capability_attempt_id OR
     NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
     NEW.plan_hash IS DISTINCT FROM OLD.plan_hash OR
     NEW.skill_id IS DISTINCT FROM OLD.skill_id OR
     NEW.skill_version IS DISTINCT FROM OLD.skill_version OR
     NEW.provider_binding_id IS DISTINCT FROM OLD.provider_binding_id OR
     NEW.server_id IS DISTINCT FROM OLD.server_id OR
     NEW.tool_name IS DISTINCT FROM OLD.tool_name OR
     NEW.arguments_hash IS DISTINCT FROM OLD.arguments_hash OR
     NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
     NEW.actor_kind IS DISTINCT FROM OLD.actor_kind OR
     NEW.authentication_method IS DISTINCT FROM OLD.authentication_method OR
     NEW.actor_roles_json IS DISTINCT FROM OLD.actor_roles_json OR
     NEW.reason IS DISTINCT FROM OLD.reason OR
     NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     (OLD.revoked_at IS NOT NULL AND
       (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)) OR
     (OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL AND NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) OR
     (OLD.consumed_at IS NOT NULL AND
       (NEW.consumed_invocation_id IS DISTINCT FROM OLD.consumed_invocation_id OR
        NEW.consumed_dispatch_hash IS DISTINCT FROM OLD.consumed_dispatch_hash OR
        NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)) OR
     (OLD.consumed_at IS NULL AND NEW.consumed_at IS NULL AND
       (NEW.consumed_invocation_id IS DISTINCT FROM OLD.consumed_invocation_id OR
        NEW.consumed_dispatch_hash IS DISTINCT FROM OLD.consumed_dispatch_hash)) OR
     (OLD.revoked_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) OR
     (OLD.revoked_at IS NULL AND OLD.consumed_at IS NULL AND
       NEW.revoked_at IS NOT NULL AND NEW.consumed_at IS NOT NULL) OR
     (OLD.consumed_at IS NOT NULL AND
       (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by)) THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_CONFIRMATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migration(version)
VALUES ('0176_v14_control_authority_kind');

COMMIT;
