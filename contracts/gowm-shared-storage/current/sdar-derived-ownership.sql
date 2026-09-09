-- Local Task provenance that upstream intentionally stores without a physical
-- Task FK (for replay/retention) still requires explicit device attribution.
-- The trigger compares an existing parent; delayed external identities remain
-- explicit and are never inferred from the current worker or global defaults.
CREATE FUNCTION gowm_device.validate_optional_task_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_device text; present boolean;
BEGIN
 SELECT t.device_id,true INTO parent_device,present FROM ugv_sdar.agent_task t WHERE t.task_id=NEW.task_id FOR KEY SHARE;
 IF present AND parent_device IS DISTINCT FROM NEW.device_id THEN RAISE EXCEPTION 'TASK_PROVENANCE_DEVICE_MISMATCH'; END IF;
 IF TG_OP='UPDATE' AND NEW.device_id IS DISTINCT FROM OLD.device_id THEN RAISE EXCEPTION 'BUSINESS_OWNERSHIP_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['external_task_projection','artifact_execution','artifact_match_log','episode_evidence_manifest','evidence_expected_record','evidence_outbox','fast_gateway_request','planning_correction_fact','planning_interaction_episode','runtime_task_configuration_binding','runtime_task_model_route_binding','temporary_skill','temporary_skill_experience'] LOOP
 EXECUTE format('ALTER TABLE ugv_sdar.%I ADD device_id text REFERENCES gowm_device.device(device_id)',t);
 EXECUTE format('CREATE TRIGGER gowm_task_provenance BEFORE INSERT OR UPDATE ON ugv_sdar.%I FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_optional_task_provenance()',t);
 END LOOP;
END $$;
ALTER TABLE ugv_sdar.workflow_plan_attempt ADD device_id text REFERENCES gowm_device.device,
 ADD FOREIGN KEY(device_id,plan_id) REFERENCES ugv_sdar.workflow_plan(device_id,plan_id);
CREATE TRIGGER gowm_attempt_plan_device BEFORE INSERT OR UPDATE ON ugv_sdar.workflow_plan_attempt FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('workflow_plan','plan_id','plan_id');
ALTER TABLE ugv_sdar.business_event_subscription ADD device_id text REFERENCES gowm_device.device,
 ADD smpp_service_key text,
 ADD CHECK((device_id IS NULL)=(smpp_service_key IS NULL)),
 DROP CONSTRAINT business_event_subscription_provider_id_stream_id_generatio_key;
DROP INDEX ugv_sdar.business_event_subscription_current_idx;
CREATE UNIQUE INDEX business_event_subscription_current_idx ON ugv_sdar.business_event_subscription(device_id,smpp_service_key,provider_id) WHERE status='current' AND device_id IS NOT NULL;
CREATE UNIQUE INDEX business_event_subscription_global_current ON ugv_sdar.business_event_subscription(provider_id) WHERE status='current' AND device_id IS NULL;
CREATE UNIQUE INDEX business_event_subscription_device_generation ON ugv_sdar.business_event_subscription(device_id,smpp_service_key,provider_id,stream_id,generation) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX business_event_subscription_global_generation ON ugv_sdar.business_event_subscription(provider_id,stream_id,generation) WHERE device_id IS NULL;
