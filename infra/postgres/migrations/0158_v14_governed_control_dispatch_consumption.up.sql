BEGIN;

-- The pre-0158 shape did not bind confirmations to an exact attempt or dispatch.
-- Such rows cannot be upgraded without inventing authority; require explicit
-- reconciliation/reissue instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM governed_control_confirmation) THEN
    RAISE EXCEPTION 'GOVERNED_CONTROL_CONFIRMATION_SCOPE_MIGRATION_REQUIRES_REISSUE'
      USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE governed_control_confirmation
  ADD COLUMN capability_attempt_id text NOT NULL,
  ADD COLUMN provider_binding_id text NOT NULL CHECK(length(btrim(provider_binding_id)) BETWEEN 1 AND 256),
  ADD COLUMN server_id text NOT NULL,
  ADD COLUMN tool_name text NOT NULL,
  ADD COLUMN arguments_hash char(64) NOT NULL CHECK(arguments_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN consumed_invocation_id text,
  ADD COLUMN consumed_dispatch_hash varchar(71),
  ADD COLUMN consumed_at timestamptz,
  ADD CONSTRAINT governed_control_confirmation_attempt_fk
    FOREIGN KEY(capability_attempt_id,task_id)
    REFERENCES task_capability_execution_attempt(attempt_id,task_id) ON DELETE RESTRICT,
  ADD CONSTRAINT governed_control_confirmation_tool_fk
    FOREIGN KEY(server_id,tool_name)
    REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT,
  ADD CONSTRAINT governed_control_confirmation_consumption_shape_check CHECK(
    (consumed_invocation_id IS NULL AND consumed_dispatch_hash IS NULL AND consumed_at IS NULL)
    OR
    (consumed_invocation_id IS NOT NULL
      AND consumed_dispatch_hash IS NOT NULL
      AND consumed_at IS NOT NULL
      AND length(btrim(consumed_invocation_id)) BETWEEN 1 AND 256
      AND consumed_dispatch_hash ~ '^sha256:[a-f0-9]{64}$'
      AND consumed_at >= confirmed_at)
  ),
  ADD CONSTRAINT governed_control_confirmation_consumed_invocation_unique
    UNIQUE(consumed_invocation_id),
  ADD CONSTRAINT governed_control_confirmation_consumed_dispatch_unique
    UNIQUE(
      confirmation_id,task_id,capability_attempt_id,provider_binding_id,server_id,tool_name,
      arguments_hash,consumed_invocation_id,consumed_dispatch_hash
    );

ALTER TABLE mcp_invocation
  ADD COLUMN control_confirmation_id text,
  ADD COLUMN control_provider_binding_id text,
  ADD COLUMN control_arguments_hash char(64),
  ADD COLUMN control_dispatch_hash varchar(71),
  ADD CONSTRAINT mcp_invocation_control_authority_shape_check CHECK(
    (control_confirmation_id IS NULL
      AND control_provider_binding_id IS NULL
      AND control_arguments_hash IS NULL
      AND control_dispatch_hash IS NULL)
    OR
    (control_confirmation_id IS NOT NULL
      AND task_id IS NOT NULL
      AND capability_attempt_id IS NOT NULL
      AND control_provider_binding_id IS NOT NULL
      AND control_arguments_hash IS NOT NULL
      AND control_dispatch_hash IS NOT NULL
      AND length(btrim(control_confirmation_id)) BETWEEN 1 AND 256
      AND length(btrim(control_provider_binding_id)) BETWEEN 1 AND 256
      AND control_arguments_hash ~ '^[a-f0-9]{64}$'
      AND control_dispatch_hash ~ '^sha256:[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT mcp_invocation_control_authority_fk
    FOREIGN KEY(
      control_confirmation_id,task_id,capability_attempt_id,control_provider_binding_id,
      server_id,tool_name,control_arguments_hash,invocation_id,control_dispatch_hash
    )
    REFERENCES governed_control_confirmation(
      confirmation_id,task_id,capability_attempt_id,provider_binding_id,server_id,tool_name,
      arguments_hash,consumed_invocation_id,consumed_dispatch_hash
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT mcp_invocation_control_confirmation_unique UNIQUE(control_confirmation_id);

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
VALUES('0158_v14_governed_control_dispatch_consumption');

COMMIT;
