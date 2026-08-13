BEGIN;

CREATE TABLE governed_control_confirmation (
  confirmation_id text PRIMARY KEY CHECK(length(btrim(confirmation_id)) BETWEEN 1 AND 256),
  task_id text NOT NULL REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  capability_binding_id text NOT NULL,
  capability_id text NOT NULL CHECK(length(btrim(capability_id)) BETWEEN 1 AND 256),
  capability_version integer NOT NULL CHECK(capability_version > 0),
  plan_id text NOT NULL REFERENCES workflow_plan(plan_id) ON DELETE RESTRICT,
  plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK(skill_version > 0),
  actor_id text NOT NULL CHECK(length(btrim(actor_id)) BETWEEN 1 AND 256),
  actor_kind text NOT NULL CHECK(actor_kind='human'),
  authentication_method text NOT NULL CHECK(
    length(btrim(authentication_method)) BETWEEN 1 AND 128 AND authentication_method<>'none'
  ),
  actor_roles_json jsonb NOT NULL CHECK(
    jsonb_typeof(actor_roles_json)='array'
    AND actor_roles_json ? 'physical_control_approver'
  ),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2048),
  confirmed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  FOREIGN KEY(capability_binding_id,task_id)
    REFERENCES task_capability_binding(binding_id,task_id) ON DELETE RESTRICT,
  FOREIGN KEY(skill_id,skill_version)
    REFERENCES skill_version(skill_id,version) ON DELETE RESTRICT,
  CHECK(expires_at > confirmed_at AND expires_at <= confirmed_at + interval '15 minutes'),
  CHECK((revoked_at IS NULL)=(revoked_by IS NULL)),
  CHECK(revoked_at IS NULL OR revoked_at >= confirmed_at)
);

CREATE INDEX governed_control_confirmation_scope_idx
  ON governed_control_confirmation(
    task_id,capability_binding_id,plan_id,skill_id,skill_version,confirmed_at DESC
  );

CREATE FUNCTION protect_governed_control_confirmation()
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

CREATE TRIGGER governed_control_confirmation_immutable
BEFORE UPDATE OR DELETE ON governed_control_confirmation
FOR EACH ROW EXECUTE FUNCTION protect_governed_control_confirmation();

INSERT INTO schema_migration(version) VALUES('0157_v14_governed_control_confirmation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
