BEGIN;
CREATE SCHEMA gowm_device;
CREATE SCHEMA gowm_task;
CREATE SCHEMA gowm_execution;
CREATE SCHEMA gowm_business_v1;
CREATE TABLE gowm_device.device (
 device_id text PRIMARY KEY, data_scope_key text NOT NULL,
 identifier_namespace text NOT NULL CHECK(identifier_namespace<>''), device_identifier text NOT NULL CHECK(device_identifier<>''),
 device_name text NOT NULL, device_type text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 properties jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(properties)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(data_scope_key,device_id), UNIQUE(data_scope_key,identifier_namespace,device_identifier),
 FOREIGN KEY(data_scope_key,device_id) REFERENCES public.world_object(data_scope_key,id)
);
CREATE TABLE gowm_device.mqtt_endpoint (
 endpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_key text NOT NULL UNIQUE,
 broker_url text NOT NULL CHECK(broker_url ~ '^(mqtts?|wss?)://'), client_id_prefix text NOT NULL,
 credential_ref text, connection_options jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(connection_options)='object'),
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.datastream ADD CONSTRAINT datastream_device_scope_unique UNIQUE(data_scope_key,datastream_key);
CREATE TABLE gowm_device.device_stream (
 stream_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_scope_key text NOT NULL, device_id text NOT NULL,
 endpoint_id uuid NOT NULL REFERENCES gowm_device.mqtt_endpoint, stream_key text NOT NULL, topic_filter text NOT NULL,
 identity_mode text NOT NULL CHECK(identity_mode IN ('BOUND_DEVICE','TOPIC','PAYLOAD')),
 identity_rule jsonb NOT NULL CHECK(jsonb_typeof(identity_rule)='object'), message_profile text NOT NULL,
 mapper_config jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(mapper_config)='object'), datastream_key text NOT NULL,
 qos smallint NOT NULL DEFAULT 1 CHECK(qos BETWEEN 0 AND 2), enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,endpoint_id,stream_key),
 FOREIGN KEY(data_scope_key,device_id) REFERENCES gowm_device.device(data_scope_key,device_id),
 FOREIGN KEY(data_scope_key,datastream_key) REFERENCES public.datastream(data_scope_key,datastream_key)
);
CREATE TABLE gowm_device.device_service_binding (
 binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_scope_key text NOT NULL, device_id text NOT NULL,
 binding_role text NOT NULL DEFAULT 'PRIMARY' CHECK(binding_role='PRIMARY'), smpp_service_key text NOT NULL CHECK(smpp_service_key<>''),
 provider_id text NOT NULL, resource_id text NOT NULL, sdar_service_key text, agent_profile_id text, sdar_mcp_server_id text,
 valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_to IS NULL OR valid_to>valid_from), CHECK((sdar_service_key IS NULL)=(sdar_mcp_server_id IS NULL)),
 UNIQUE(device_id,binding_id), UNIQUE(data_scope_key,device_id,binding_id),
 FOREIGN KEY(data_scope_key,device_id) REFERENCES gowm_device.device(data_scope_key,device_id)
);
CREATE UNIQUE INDEX device_binding_current ON gowm_device.device_service_binding(device_id,binding_role) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX device_resource_current ON gowm_device.device_service_binding(smpp_service_key,provider_id,resource_id) WHERE valid_to IS NULL;
CREATE FUNCTION gowm_device.validate_service_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(718078);
 IF NEW.valid_from>clock_timestamp() THEN RAISE EXCEPTION 'FUTURE_BINDING_UNSUPPORTED'; END IF;
 IF NEW.valid_to IS NULL AND NEW.sdar_service_key IS NOT NULL AND EXISTS(
 SELECT 1 FROM gowm_device.device_service_binding b WHERE b.valid_to IS NULL AND b.binding_id<>NEW.binding_id
 AND b.sdar_service_key=NEW.sdar_service_key AND b.sdar_mcp_server_id=NEW.sdar_mcp_server_id AND b.smpp_service_key<>NEW.smpp_service_key)
 THEN RAISE EXCEPTION 'MCP_SERVER_SERVICE_CONFLICT'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'valid_to') IS DISTINCT FROM (to_jsonb(OLD)-'valid_to') THEN RAISE EXCEPTION 'BINDING_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_binding BEFORE INSERT OR UPDATE ON gowm_device.device_service_binding FOR EACH ROW EXECUTE FUNCTION gowm_device.validate_service_binding();
CREATE TABLE gowm_task.target_geometry (
 target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_group_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 data_scope_key text NOT NULL REFERENCES public.data_scope(scope_key), source_domain text NOT NULL CHECK(source_domain IN ('SDAR','SMPP','UGV_PROVIDER','GOWM_USER')),
 source_record_identity jsonb NOT NULL CHECK(jsonb_typeof(source_record_identity)='object'),
 geometry_kind text NOT NULL CHECK(geometry_kind IN ('POINT','LINESTRING','POLYGON','MULTIPOINT','MULTILINESTRING','MULTIPOLYGON')),
 native_geometry jsonb NOT NULL CHECK(jsonb_typeof(native_geometry)='object'), native_crs text NOT NULL CHECK(native_crs<>''),
 geometry_wgs84 public.geometry(Geometry,4326), normalization_state text NOT NULL CHECK(normalization_state IN ('NATIVE_ONLY','NORMALIZED','INVALID')),
 transform_info jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(transform_info)='object'), supersedes_target_id uuid REFERENCES gowm_task.target_geometry,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(target_group_id,revision), UNIQUE(data_scope_key,target_id),
 CHECK((normalization_state='NORMALIZED')=(geometry_wgs84 IS NOT NULL)),
 CHECK(geometry_wgs84 IS NULL OR (NOT public.ST_IsEmpty(geometry_wgs84) AND public.ST_IsValid(geometry_wgs84)
 AND upper(public.GeometryType(geometry_wgs84))=geometry_kind AND public.ST_XMin(public.Box3D(geometry_wgs84))>=-180
 AND public.ST_XMax(public.Box3D(geometry_wgs84))<=180 AND public.ST_YMin(public.Box3D(geometry_wgs84))>=-90 AND public.ST_YMax(public.Box3D(geometry_wgs84))<=90))
);
CREATE FUNCTION gowm_task.validate_target_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'TARGET_REVISION_IMMUTABLE'; END IF;
 IF NEW.supersedes_target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gowm_task.target_geometry t WHERE t.target_id=NEW.supersedes_target_id AND t.target_group_id=NEW.target_group_id AND t.data_scope_key=NEW.data_scope_key AND t.revision<NEW.revision) THEN RAISE EXCEPTION 'TARGET_REVISION_SCOPE_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER target_revision BEFORE INSERT OR UPDATE ON gowm_task.target_geometry FOR EACH ROW EXECUTE FUNCTION gowm_task.validate_target_revision();
CREATE TABLE gowm_task.target_binding (
 target_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_id uuid NOT NULL, device_id text NOT NULL, data_scope_key text NOT NULL,
 owner_domain text NOT NULL CHECK(owner_domain IN ('SDAR','SMPP','UGV_PROVIDER')),
 owner_kind text NOT NULL CHECK(owner_kind IN ('TASK','PLAN_NODE','NODE_RUN','MCP_TASK','PROVIDER_DISPATCH')),
 owner_key jsonb NOT NULL CHECK(jsonb_typeof(owner_key)='object'), usage_role text NOT NULL CHECK(usage_role IN ('REQUESTED','PLANNED','DISPATCHED')),
 target_purpose text NOT NULL CHECK(target_purpose<>''), argument_path text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_domain,owner_kind,owner_key,usage_role,argument_path),
 FOREIGN KEY(data_scope_key,device_id) REFERENCES gowm_device.device(data_scope_key,device_id),
 FOREIGN KEY(data_scope_key,target_id) REFERENCES gowm_task.target_geometry(data_scope_key,target_id)
);
CREATE TABLE gowm_execution.device_mission (
 mission_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id text NOT NULL, data_scope_key text NOT NULL,
 mission_channel text NOT NULL CHECK(mission_channel<>''), world_object_id text UNIQUE, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,mission_channel,mission_instance_id), UNIQUE(data_scope_key,device_id,mission_instance_id),
 FOREIGN KEY(data_scope_key,device_id) REFERENCES gowm_device.device(data_scope_key,device_id),
 FOREIGN KEY(data_scope_key,world_object_id) REFERENCES public.world_object(data_scope_key,id)
);
CREATE TABLE gowm_execution.mission_identity (
 identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mission_instance_id uuid NOT NULL, device_id text NOT NULL, mission_channel text NOT NULL,
 authority_key text NOT NULL CHECK(authority_key<>''), identity_kind text NOT NULL CHECK(identity_kind IN ('MISSION_ID_WITH_SESSION','RUN_KEY','EXECUTION_SCOPED_ID')),
 native_session_key text NOT NULL CHECK(native_session_key<>''), native_mission_id text NOT NULL CHECK(native_mission_id<>''),
 evidence_ref jsonb NOT NULL CHECK(jsonb_typeof(evidence_ref)='object' AND evidence_ref<>'{}'), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,mission_channel,authority_key,native_session_key,native_mission_id),
 FOREIGN KEY(device_id,mission_channel,mission_instance_id) REFERENCES gowm_execution.device_mission(device_id,mission_channel,mission_instance_id)
);
CREATE TABLE gowm_execution.execution_mission_link (
 link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id text NOT NULL, data_scope_key text NOT NULL, binding_id uuid NOT NULL,
 mcp_task_id uuid, provider_execution_id text NOT NULL, provider_task_record_id text NOT NULL, provider_dispatch_step_id text NOT NULL,
 mission_instance_id uuid, relation_kind text NOT NULL CHECK(relation_kind IN ('CREATED','CONTROLLED','OBSERVED')),
 link_state text NOT NULL CHECK(link_state IN ('PENDING','LINKED','UNCERTAIN','CONFLICTED')),
 source_system_key text NOT NULL, idempotency_key text NOT NULL, source_evidence_ref jsonb NOT NULL CHECK(jsonb_typeof(source_evidence_ref)='object'),
 unresolved_native_identity jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_id,source_system_key,idempotency_key),
 CHECK(link_state<>'LINKED' OR (mission_instance_id IS NOT NULL AND source_evidence_ref<>'{}')),
 FOREIGN KEY(data_scope_key,device_id,binding_id) REFERENCES gowm_device.device_service_binding(data_scope_key,device_id,binding_id),
 FOREIGN KEY(data_scope_key,device_id,mission_instance_id) REFERENCES gowm_execution.device_mission(data_scope_key,device_id,mission_instance_id)
);
CREATE FUNCTION gowm_task.validate_target_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid boolean=false;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'TARGET_BINDING_IMMUTABLE'; END IF;
 IF NEW.owner_domain='SDAR' AND NEW.owner_kind='TASK' THEN
 SELECT EXISTS(SELECT 1 FROM ugv_sdar.agent_task WHERE task_id=NEW.owner_key->>'taskId' AND device_id=NEW.device_id) INTO valid;
 ELSIF NEW.owner_domain='SDAR' AND NEW.owner_kind='PLAN_NODE' THEN
 SELECT EXISTS(SELECT 1 FROM ugv_sdar.workflow_plan p WHERE p.plan_id=NEW.owner_key->>'planId' AND p.device_id=NEW.device_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.definition_json->'nodes') n WHERE n->>'id'=NEW.owner_key->>'nodeId')) INTO valid;
 ELSIF NEW.owner_domain='SDAR' AND NEW.owner_kind='NODE_RUN' THEN
 SELECT EXISTS(SELECT 1 FROM ugv_sdar.remote_task_binding r WHERE r.binding_id=NEW.owner_key->>'bindingId' AND r.workflow_instance_id=NEW.owner_key->>'instanceId' AND r.workflow_node_id=NEW.owner_key->>'nodeId' AND r.workflow_node_run_id=NEW.owner_key->>'nodeRunId' AND r.device_id=NEW.device_id) INTO valid;
 ELSIF NEW.owner_domain='SMPP' AND NEW.owner_kind='MCP_TASK' THEN
 SELECT EXISTS(SELECT 1 FROM ugv_smpp.provider_task WHERE task_id::text=NEW.owner_key->>'taskId' AND device_id=NEW.device_id) INTO valid;
 ELSIF NEW.owner_domain='UGV_PROVIDER' AND NEW.owner_kind='PROVIDER_DISPATCH' THEN
 SELECT EXISTS(SELECT 1 FROM ugv_smpp.ugv_mutation_journal WHERE task_id=NEW.owner_key->>'taskId' AND step_id=NEW.owner_key->>'stepId' AND device_id=NEW.device_id) INTO valid;
 END IF;
 IF NOT valid THEN RAISE EXCEPTION 'OWNER_NOT_FOUND_OR_DEVICE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gowm_target_owner BEFORE INSERT OR UPDATE ON gowm_task.target_binding FOR EACH ROW EXECUTE FUNCTION gowm_task.validate_target_owner();
COMMIT;
