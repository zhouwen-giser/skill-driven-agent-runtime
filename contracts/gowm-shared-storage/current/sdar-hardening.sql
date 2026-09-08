CREATE OR REPLACE FUNCTION gowm_device.reject_business_ownership_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)->'device_id') IS DISTINCT FROM (to_jsonb(OLD)->'device_id') OR
 (to_jsonb(NEW)->'gowm_binding_id') IS DISTINCT FROM (to_jsonb(OLD)->'gowm_binding_id') OR
 (to_jsonb(NEW)->'smpp_service_key') IS DISTINCT FROM (to_jsonb(OLD)->'smpp_service_key') OR
 (to_jsonb(NEW)->'sdar_service_key') IS DISTINCT FROM (to_jsonb(OLD)->'sdar_service_key')
 THEN RAISE EXCEPTION 'BUSINESS_OWNERSHIP_IMMUTABLE'; END IF; RETURN NEW;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT table_schema,table_name FROM information_schema.columns WHERE table_schema IN ('ugv_sdar') AND column_name='device_id' LOOP
 EXECUTE format('CREATE TRIGGER gowm_ownership_immutable BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION gowm_device.reject_business_ownership_mutation()',r.table_schema,r.table_name);
 END LOOP;
END $$;
-- SDAR nullable ownership supports non-device work, but cannot escape a device parent.
CREATE FUNCTION gowm_device.validate_sdar_parent_device() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text; v text;
BEGIN
 v=to_jsonb(NEW)->>TG_ARGV[1];
 IF v IS NULL THEN RETURN NEW; END IF;
 EXECUTE format('SELECT device_id FROM ugv_sdar.%I WHERE %I=$1 FOR KEY SHARE',TG_ARGV[0],TG_ARGV[2]) INTO p USING v;
 IF p IS DISTINCT FROM NEW.device_id THEN RAISE EXCEPTION 'PARENT_DEVICE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gowm_parent_task BEFORE INSERT OR UPDATE ON ugv_sdar.workflow_plan FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('agent_task','gowm_task_id','task_id');
CREATE TRIGGER gowm_parent_plan BEFORE INSERT OR UPDATE ON ugv_sdar.workflow_instance FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('workflow_plan','plan_id','plan_id');
CREATE TRIGGER gowm_parent_instance BEFORE INSERT OR UPDATE ON ugv_sdar.workflow_node_event FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('workflow_instance','instance_id','instance_id');
CREATE TRIGGER gowm_parent_task BEFORE INSERT OR UPDATE ON ugv_sdar.mcp_invocation FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('agent_task','task_id','task_id');
CREATE TRIGGER gowm_parent_task BEFORE INSERT OR UPDATE ON ugv_sdar.remote_task_binding FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('agent_task','agent_task_id','task_id');
CREATE TRIGGER gowm_parent_instance BEFORE INSERT OR UPDATE ON ugv_sdar.remote_task_binding FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('workflow_instance','workflow_instance_id','instance_id');
CREATE TRIGGER gowm_parent_invocation BEFORE INSERT OR UPDATE ON ugv_sdar.remote_task_binding FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_sdar_parent_device('mcp_invocation','mcp_invocation_id','invocation_id');
