-- Forward owner migration. Preserve applied native/overlay checksums.
CREATE OR REPLACE FUNCTION ugv_sdar.finalize_task_temporary_skills() RETURNS trigger
LANGUAGE plpgsql SET search_path TO ugv_sdar,public,pg_catalog AS $$
BEGIN
  IF NEW.phase NOT IN ('completed','failed','canceled','invalidated','capability_gap') THEN RETURN NEW; END IF;
  WITH expired AS (
    UPDATE temporary_skill SET status='expired',expired_at=NEW.updated_at
    WHERE task_id=NEW.task_id AND status='active' RETURNING *
  )
  INSERT INTO temporary_skill_experience(experience_id,temporary_skill_id,task_id,context_id,
    capability_fingerprint,successful,outcome_summary,created_at,device_id)
  SELECT 'temporary-terminal:'||length(NEW.task_id)::text||':'||NEW.task_id||':'||temporary_skill_id,
    temporary_skill_id,task_id,context_id,capability_fingerprint,
    COALESCE(NEW.phase='completed' AND NEW.temporary_skill_id=temporary_skill_id AND NEW.error_code IS NULL
      AND (NEW.output_text IS NOT NULL OR NEW.output_structured IS NOT NULL),false),
    NEW.phase||': '||NEW.phase_message,NEW.updated_at,device_id
  FROM expired ON CONFLICT(temporary_skill_id) DO NOTHING;
  RETURN NEW;
END $$;

-- Source handles have the same scope as their authoritative remote binding.
-- ALTER TABLE holds an exclusive lock through the installer transaction; the
-- immutable trigger is suspended only for the existing-row ownership backfill.
ALTER TABLE ugv_sdar.remote_task_provider_execution_link
  ADD device_id text REFERENCES gowm_device.device,
  ADD smpp_service_key text,
  DROP CONSTRAINT remote_task_provider_executio_runtime_server_id_remote_task_key;
ALTER TABLE ugv_sdar.remote_task_provider_execution_link
  DISABLE TRIGGER remote_task_provider_execution_link_immutable;
UPDATE ugv_sdar.remote_task_provider_execution_link link
SET device_id=binding.device_id,smpp_service_key=binding.smpp_service_key
FROM ugv_sdar.remote_task_binding binding WHERE binding.binding_id=link.binding_id;
ALTER TABLE ugv_sdar.remote_task_provider_execution_link
  ENABLE TRIGGER remote_task_provider_execution_link_immutable;
ALTER TABLE ugv_sdar.remote_task_provider_execution_link
  ADD CHECK(device_id IS NULL OR smpp_service_key IS NOT NULL),
  ADD FOREIGN KEY(device_id,binding_id) REFERENCES ugv_sdar.remote_task_binding(device_id,binding_id);
CREATE UNIQUE INDEX remote_provider_link_device_identity
  ON ugv_sdar.remote_task_provider_execution_link(device_id,smpp_service_key,runtime_server_id,remote_task_id)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX remote_provider_link_nondevice_identity
  ON ugv_sdar.remote_task_provider_execution_link(runtime_server_id,remote_task_id)
  WHERE device_id IS NULL;

CREATE FUNCTION gowm_device.derive_remote_provider_link_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path TO ugv_sdar,public,pg_catalog AS $$
DECLARE owner ugv_sdar.remote_task_binding;
BEGIN
  SELECT * INTO owner FROM ugv_sdar.remote_task_binding WHERE binding_id=NEW.binding_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REMOTE_PROVIDER_LINK_BINDING_REQUIRED'; END IF;
  IF NEW.runtime_server_id IS DISTINCT FROM owner.server_id
    OR NEW.remote_task_id IS DISTINCT FROM owner.remote_task_id
    OR NEW.operation_name IS DISTINCT FROM owner.operation_name
    OR (NEW.device_id IS NOT NULL AND NEW.device_id IS DISTINCT FROM owner.device_id)
    OR (NEW.smpp_service_key IS NOT NULL AND NEW.smpp_service_key IS DISTINCT FROM owner.smpp_service_key)
    THEN RAISE EXCEPTION 'REMOTE_PROVIDER_LINK_BINDING_MISMATCH'; END IF;
  NEW.device_id := owner.device_id;
  NEW.smpp_service_key := owner.smpp_service_key;
  RETURN NEW;
END $$;
CREATE TRIGGER gowm_remote_provider_link_owner BEFORE INSERT
  ON ugv_sdar.remote_task_provider_execution_link FOR EACH ROW
  EXECUTE FUNCTION gowm_device.derive_remote_provider_link_owner();
