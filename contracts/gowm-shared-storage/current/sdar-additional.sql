-- SDAR initial admission accepts a caller-local idempotency string. Global Task
-- UUIDs do not make that string global: preserve non-device work separately.
ALTER TABLE ugv_sdar.initial_task_admission
 ADD admission_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD device_id text REFERENCES gowm_device.device,
 ADD sdar_service_key text,
 DROP CONSTRAINT initial_task_admission_pkey,
 ADD PRIMARY KEY(admission_id),
 ADD CHECK((device_id IS NULL)=(sdar_service_key IS NULL)),
 ADD FOREIGN KEY(device_id,task_id) REFERENCES ugv_sdar.agent_task(device_id,task_id);
CREATE UNIQUE INDEX initial_admission_device_key ON ugv_sdar.initial_task_admission(device_id,sdar_service_key,idempotency_key) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX initial_admission_nondevice_key ON ugv_sdar.initial_task_admission(idempotency_key) WHERE device_id IS NULL;
CREATE TRIGGER gowm_initial_admission_device BEFORE INSERT OR UPDATE ON ugv_sdar.initial_task_admission FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('agent_task','task_id','task_id');
ALTER TABLE ugv_sdar.remote_task_binding DROP CONSTRAINT remote_task_binding_server_id_remote_task_id_key;
CREATE UNIQUE INDEX remote_task_device_source_identity ON ugv_sdar.remote_task_binding(device_id,smpp_service_key,server_id,remote_task_id) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX remote_task_nondevice_source_identity ON ugv_sdar.remote_task_binding(server_id,remote_task_id) WHERE device_id IS NULL;
CREATE OR REPLACE FUNCTION gowm_device.validate_native_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b gowm_device.device_service_binding; service text;
BEGIN
 IF NEW.device_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO b FROM gowm_device.device_service_binding WHERE binding_id=NEW.gowm_binding_id AND device_id=NEW.device_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_BINDING_MISMATCH'; END IF;
 IF TG_TABLE_SCHEMA='ugv_sdar' THEN service=to_jsonb(NEW)->>'sdar_service_key'; IF service IS DISTINCT FROM b.sdar_service_key THEN RAISE EXCEPTION 'SDAR_SERVICE_BINDING_MISMATCH'; END IF;
 ELSE service=to_jsonb(NEW)->>'smpp_service_key'; IF service IS DISTINCT FROM b.smpp_service_key THEN RAISE EXCEPTION 'SMPP_SERVICE_BINDING_MISMATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gowm_native_binding BEFORE INSERT OR UPDATE ON ugv_sdar.agent_task FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_native_binding();
CREATE FUNCTION gowm_device.validate_remote_canonical_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.canonical_mcp_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ugv_smpp.provider_task m WHERE m.task_id=NEW.canonical_mcp_task_id AND m.device_id=NEW.device_id AND m.smpp_service_key=NEW.smpp_service_key) THEN RAISE EXCEPTION 'MCP_TASK_DEVICE_SERVICE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gowm_remote_canonical BEFORE INSERT OR UPDATE ON ugv_sdar.remote_task_binding FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_remote_canonical_identity();
