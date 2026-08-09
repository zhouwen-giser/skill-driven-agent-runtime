CREATE TABLE sdar_control.node_control_evidence_observation (
  observation_sequence bigserial PRIMARY KEY,
  record_type text NOT NULL CHECK (record_type IN (
    'node_control.profile_revision','node_control.health_observation',
    'node_control.configuration_revision','node_control.configuration_apply_ack',
    'node_control.configuration_lkg_transition','node_control.llm_provider_revision',
    'node_control.model_route_revision','node_control.smpp_source_revision',
    'node_control.mcp_provider_binding_revision','node_control.skill_governance',
    'node_control.plan_template_governance','node_control.capability_revision',
    'node_control.capability_readiness','node_control.a2a_exposure',
    'node_control.agent_card_revision','node_control.management_operation',
    'node_control.audit_event','node_control.node_event',
    'node_control.telemetry_configuration'
  )),
  source_table text NOT NULL,
  source_record_id text NOT NULL CHECK (length(btrim(source_record_id)) > 0),
  authority_payload jsonb NOT NULL CHECK (jsonb_typeof(authority_payload)='object'),
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX node_control_evidence_observation_cursor_idx
  ON sdar_control.node_control_evidence_observation(observation_sequence,record_type,source_record_id);
CREATE INDEX node_control_evidence_observation_identity_idx
  ON sdar_control.node_control_evidence_observation(record_type,source_record_id,observation_sequence DESC);

CREATE TRIGGER node_control_evidence_observation_immutable
BEFORE UPDATE OR DELETE ON sdar_control.node_control_evidence_observation
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE TABLE sdar_control.node_health_observation (
  observation_id text PRIMARY KEY,
  node_id text NOT NULL,
  health_status text NOT NULL CHECK(health_status IN ('healthy','degraded','unavailable','maintenance')),
  components jsonb NOT NULL CHECK(jsonb_typeof(components)='array' AND pg_column_size(components)<=65536),
  active_tasks integer NOT NULL CHECK(active_tasks>=0),
  observation_revision bigint NOT NULL CHECK(observation_revision>0),
  observed_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  actor_id text,
  UNIQUE(node_id,observation_revision)
);

CREATE INDEX node_health_observation_node_idx
  ON sdar_control.node_health_observation(node_id,observation_revision DESC);

CREATE TRIGGER node_health_observation_immutable
BEFORE UPDATE OR DELETE ON sdar_control.node_health_observation
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE OR REPLACE FUNCTION sdar_control.capture_node_control_evidence_observation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source jsonb := to_jsonb(NEW);
  identity_fields text[] := string_to_array(TG_ARGV[1], ',');
  occurred_fields text[] := string_to_array(TG_ARGV[2], ',');
  source_record_id text := '';
  occurred_at timestamptz;
  field text;
  field_value text;
BEGIN
  IF TG_OP='UPDATE' AND source IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF TG_ARGV[0]='node_control.telemetry_configuration' THEN
    IF source->>'status' IS DISTINCT FROM 'published' OR
       (TG_OP='UPDATE' AND to_jsonb(OLD)->>'status'='published') THEN
      RETURN NEW;
    END IF;
    -- Evidence owns the immutable publication fact, not later mutable apply state.
    source := source || jsonb_build_object('status','published');
  END IF;
  IF array_length(TG_ARGV,1)>=6 THEN
    field_value := source ->> TG_ARGV[3];
    IF TG_ARGV[4]='eq' AND field_value IS DISTINCT FROM TG_ARGV[5] THEN RETURN NEW; END IF;
    IF TG_ARGV[4]='prefix' AND (field_value IS NULL OR field_value NOT LIKE TG_ARGV[5] || '%') THEN
      RETURN NEW;
    END IF;
    IF TG_ARGV[4]='not_null' AND field_value IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF array_length(TG_ARGV,1)>=9 THEN
    field_value := source ->> TG_ARGV[6];
    IF TG_ARGV[7]='eq' AND field_value IS DISTINCT FROM TG_ARGV[8] THEN RETURN NEW; END IF;
    IF TG_ARGV[7]='prefix' AND (field_value IS NULL OR field_value NOT LIKE TG_ARGV[8] || '%') THEN
      RETURN NEW;
    END IF;
    IF TG_ARGV[7]='not_null' AND field_value IS NULL THEN RETURN NEW; END IF;
  END IF;
  FOREACH field IN ARRAY identity_fields LOOP
    field_value := source ->> field;
    IF field_value IS NULL OR btrim(field_value)='' THEN
      RAISE EXCEPTION 'NODE_CONTROL_EVIDENCE_SOURCE_ID_MISSING:%:%',TG_ARGV[0],field
        USING ERRCODE='23514';
    END IF;
    source_record_id := source_record_id || CASE WHEN source_record_id='' THEN '' ELSE ':' END || field_value;
  END LOOP;
  FOREACH field IN ARRAY occurred_fields LOOP
    field_value := source ->> field;
    IF field_value IS NOT NULL THEN
      occurred_at := field_value::timestamptz;
      EXIT;
    END IF;
  END LOOP;
  IF occurred_at IS NULL THEN
    RAISE EXCEPTION 'NODE_CONTROL_EVIDENCE_OCCURRED_AT_MISSING:%',TG_ARGV[0]
      USING ERRCODE='23514';
  END IF;
  IF TG_ARGV[0] IN ('node_control.node_event','node_control.capability_readiness') THEN
    source := source || jsonb_build_object('sequence',source->>'sequence');
  END IF;
  INSERT INTO sdar_control.node_control_evidence_observation(
    record_type,source_table,source_record_id,authority_payload,occurred_at)
  VALUES(TG_ARGV[0],TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,source_record_id,source,occurred_at);
  RETURN NEW;
END $$;

CREATE TRIGGER evidence_observe_profile_revision
AFTER INSERT OR UPDATE ON sdar_control.node_profile_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.profile_revision','node_id,revision','updated_at,created_at');
CREATE TRIGGER evidence_observe_health
AFTER INSERT ON sdar_control.node_health_observation
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.health_observation','observation_id','observed_at');
CREATE TRIGGER evidence_observe_configuration
AFTER INSERT OR UPDATE ON sdar_control.configuration_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.configuration_revision','configuration_id,revision','published_at,created_at');
CREATE TRIGGER evidence_observe_telemetry_configuration
AFTER INSERT OR UPDATE ON sdar_control.configuration_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.telemetry_configuration','configuration_id,revision','published_at,created_at',
  'target_type','eq','telemetry_link','status','eq','published');
CREATE TRIGGER evidence_observe_configuration_application
AFTER INSERT OR UPDATE ON sdar_control.configuration_application
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.configuration_apply_ack','application_id','acknowledged_at',
  'acknowledged_at','not_null','');
CREATE TRIGGER evidence_observe_configuration_lkg
AFTER INSERT OR UPDATE ON sdar_control.configuration_target_state
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.configuration_lkg_transition','target_type,target_id','observed_at',
  'observed_at','not_null','');
CREATE TRIGGER evidence_observe_llm_provider
AFTER INSERT OR UPDATE ON sdar_control.llm_provider_definition
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.llm_provider_revision','provider_id,revision','updated_at,created_at');
CREATE TRIGGER evidence_observe_model_route
AFTER INSERT OR UPDATE ON sdar_control.model_route_definition
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.model_route_revision','route_id,revision','updated_at,created_at');
CREATE TRIGGER evidence_observe_smpp_source
AFTER INSERT OR UPDATE ON sdar_control.smpp_registry_source
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.smpp_source_revision','smpp_source_id,revision','updated_at,created_at');
CREATE TRIGGER evidence_observe_mcp_binding
AFTER INSERT ON sdar_control.mcp_provider_binding
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.mcp_provider_binding_revision','binding_id,revision','created_at');
CREATE TRIGGER evidence_observe_audit
AFTER INSERT ON sdar_control.control_audit_event
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.audit_event','audit_id','created_at');
CREATE TRIGGER evidence_observe_skill_governance
AFTER INSERT ON sdar_control.control_audit_event
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.skill_governance','audit_id','created_at','action','prefix','skill.');
CREATE TRIGGER evidence_observe_plan_template_governance
AFTER INSERT ON sdar_control.control_audit_event
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.plan_template_governance','audit_id','created_at','action','prefix','plan-template.');
CREATE TRIGGER evidence_observe_capability
AFTER INSERT OR UPDATE ON sdar_control.node_capability_definition_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.capability_revision','capability_id,version','updated_at,created_at');
CREATE TRIGGER evidence_observe_a2a_exposure
AFTER INSERT OR UPDATE ON sdar_control.a2a_exposure_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.a2a_exposure','exposure_id,version','updated_at,created_at');
CREATE TRIGGER evidence_observe_agent_card
AFTER INSERT OR UPDATE ON sdar_control.agent_card_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.agent_card_revision','revision','activated_at,generated_at');
CREATE TRIGGER evidence_observe_management_operation
AFTER INSERT OR UPDATE ON sdar_control.management_operation
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.management_operation','operation_id','completed_at,started_at,created_at');
CREATE TRIGGER evidence_observe_node_event
AFTER INSERT ON sdar_control.node_event_outbox
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.node_event','event_id','occurred_at');
CREATE TRIGGER evidence_observe_capability_readiness
AFTER INSERT ON sdar_control.node_event_outbox
FOR EACH ROW EXECUTE FUNCTION sdar_control.capture_node_control_evidence_observation(
  'node_control.capability_readiness','event_id','occurred_at','event_type','eq',
  'node.capability.readiness_changed');

INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.profile_revision','sdar_control.node_profile_revision',
       node_id || ':' || revision::text,to_jsonb(source),updated_at
  FROM sdar_control.node_profile_revision source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.configuration_revision','sdar_control.configuration_revision',
       configuration_id || ':' || revision::text,to_jsonb(source),COALESCE(published_at,created_at)
  FROM sdar_control.configuration_revision source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.telemetry_configuration','sdar_control.configuration_revision',
       configuration_id || ':' || revision::text,
       to_jsonb(source) || jsonb_build_object('status','published'),published_at
 FROM sdar_control.configuration_revision source
 WHERE target_type='telemetry_link' AND published_at IS NOT NULL;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.configuration_apply_ack','sdar_control.configuration_application',
       application_id,to_jsonb(source),acknowledged_at
  FROM sdar_control.configuration_application source WHERE acknowledged_at IS NOT NULL;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.configuration_lkg_transition','sdar_control.configuration_target_state',
       target_type || ':' || target_id,to_jsonb(source),observed_at
  FROM sdar_control.configuration_target_state source WHERE observed_at IS NOT NULL;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.llm_provider_revision','sdar_control.llm_provider_definition',
       provider_id || ':' || revision::text,to_jsonb(source),updated_at
  FROM sdar_control.llm_provider_definition source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.model_route_revision','sdar_control.model_route_definition',
       route_id || ':' || revision::text,to_jsonb(source),updated_at
  FROM sdar_control.model_route_definition source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.smpp_source_revision','sdar_control.smpp_registry_source',
       smpp_source_id || ':' || revision::text,to_jsonb(source),updated_at
  FROM sdar_control.smpp_registry_source source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.mcp_provider_binding_revision','sdar_control.mcp_provider_binding',
       binding_id || ':' || revision::text,to_jsonb(source),created_at
  FROM sdar_control.mcp_provider_binding source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.audit_event','sdar_control.control_audit_event',audit_id,to_jsonb(source),created_at
  FROM sdar_control.control_audit_event source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.skill_governance','sdar_control.control_audit_event',audit_id,to_jsonb(source),created_at
  FROM sdar_control.control_audit_event source WHERE action LIKE 'skill.%';
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.plan_template_governance','sdar_control.control_audit_event',audit_id,to_jsonb(source),created_at
  FROM sdar_control.control_audit_event source WHERE action LIKE 'plan-template.%';
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.capability_revision','sdar_control.node_capability_definition_version',
       capability_id || ':' || version::text,to_jsonb(source),COALESCE(updated_at,created_at)
  FROM sdar_control.node_capability_definition_version source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.a2a_exposure','sdar_control.a2a_exposure_version',
       exposure_id || ':' || version::text,to_jsonb(source),updated_at
  FROM sdar_control.a2a_exposure_version source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.agent_card_revision','sdar_control.agent_card_revision',revision::text,
       to_jsonb(source),COALESCE(activated_at,generated_at)
  FROM sdar_control.agent_card_revision source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.management_operation','sdar_control.management_operation',operation_id,
       to_jsonb(source),COALESCE(completed_at,started_at,created_at)
  FROM sdar_control.management_operation source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.node_event','sdar_control.node_event_outbox',event_id,
       to_jsonb(source) || jsonb_build_object('sequence',sequence::text),occurred_at
  FROM sdar_control.node_event_outbox source;
INSERT INTO sdar_control.node_control_evidence_observation(
  record_type,source_table,source_record_id,authority_payload,occurred_at)
SELECT 'node_control.capability_readiness','sdar_control.node_event_outbox',event_id,
       to_jsonb(source) || jsonb_build_object('sequence',sequence::text),occurred_at
  FROM sdar_control.node_event_outbox source
 WHERE event_type='node.capability.readiness_changed';
