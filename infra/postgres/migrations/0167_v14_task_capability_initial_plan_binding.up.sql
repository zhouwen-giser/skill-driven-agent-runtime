BEGIN;

CREATE OR REPLACE FUNCTION protect_task_capability_attempt_content()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
     NEW.task_id IS DISTINCT FROM OLD.task_id OR
     NEW.capability_binding_id IS DISTINCT FROM OLD.capability_binding_id OR
     NEW.attempt_no IS DISTINCT FROM OLD.attempt_no OR
     NEW.plan_template_ref IS DISTINCT FROM OLD.plan_template_ref OR
     NEW.skill_version_refs IS DISTINCT FROM OLD.skill_version_refs OR
     NEW.provider_binding_refs IS DISTINCT FROM OLD.provider_binding_refs OR
     NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'TASK_CAPABILITY_ATTEMPT_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id AND NOT (
    OLD.status='prepared' AND NEW.status='prepared' AND
    OLD.plan_id IS NULL AND NEW.plan_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'TASK_CAPABILITY_ATTEMPT_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migration(version) VALUES ('0167_v14_task_capability_initial_plan_binding');
COMMIT;
