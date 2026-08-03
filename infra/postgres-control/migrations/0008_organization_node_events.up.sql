CREATE TABLE sdar_control.node_profile_revision (
  node_id text NOT NULL,
  node_type text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  environment text NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_endpoint_ref text NOT NULL,
  telemetry_source_id text,
  status text NOT NULL CHECK(status IN ('draft','active','maintenance','retired')),
  revision bigint NOT NULL CHECK(revision > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  validated_at timestamptz,
  published_at timestamptz,
  PRIMARY KEY(node_id,revision)
);

INSERT INTO sdar_control.node_profile_revision(
  node_id,node_type,display_name,description,environment,labels,authority_scopes,
  runtime_endpoint_ref,telemetry_source_id,status,revision,created_by,created_at,updated_at,
  validated_at,published_at)
SELECT node_id,node_type,display_name,description,environment,labels,authority_scopes,
       runtime_endpoint_ref,telemetry_source_id,status,revision,'migration-0008',created_at,updated_at,
       CASE WHEN status='draft' THEN NULL ELSE updated_at END,
       CASE WHEN status='draft' THEN NULL ELSE updated_at END
  FROM sdar_control.node_profile;

CREATE TABLE sdar_control.node_profile_command_receipt (
  scope text NOT NULL,
  idempotency_key_hash char(64) NOT NULL CHECK(idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK(revision > 0),
  operation_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(scope,idempotency_key_hash)
);

CREATE OR REPLACE FUNCTION sdar_control.reject_published_profile_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('active','maintenance','retired') THEN
    RAISE EXCEPTION 'NODE_PROFILE_REVISION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER node_profile_revision_immutable
BEFORE UPDATE OR DELETE ON sdar_control.node_profile_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_published_profile_mutation();

CREATE TABLE sdar_control.node_event_outbox (
  sequence bigserial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK(event_type IN (
    'node.profile.changed','node.health.changed',
    'node.configuration.revision_published','node.configuration.revision_applied',
    'node.configuration.revision_rejected','node.llm.provider_changed',
    'node.smpp.source_changed','node.mcp.provider_binding_changed',
    'node.skill.version_changed','node.plan_template.version_changed',
    'node.capability.version_published','node.capability.version_suspended',
    'node.capability.version_deprecated','node.capability.version_retired',
    'node.capability.readiness_changed','node.a2a.exposure_changed',
    'node.agent_card.activated','node.task.capability_bound',
    'node.management_operation.completed','node.telemetry_export.status_changed'
  )),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  node_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_revision bigint NOT NULL CHECK(aggregate_revision > 0),
  correlation_id text NOT NULL,
  causation_id text,
  actor_id text,
  data_classification text NOT NULL DEFAULT 'internal'
    CHECK(data_classification IN ('public','internal','restricted')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=65536)
);

CREATE INDEX node_event_outbox_recorded_idx
  ON sdar_control.node_event_outbox(sequence,event_id);

CREATE TABLE sdar_control.node_event_source_cursor (
  source_name text PRIMARY KEY,
  last_sequence bigint NOT NULL CHECK(last_sequence >= 0),
  updated_at timestamptz NOT NULL
);

INSERT INTO sdar_control.node_event_source_cursor(source_name,last_sequence,updated_at)
VALUES('runtime-cognitive-outbox',0,clock_timestamp());

CREATE TRIGGER node_event_outbox_immutable
BEFORE UPDATE OR DELETE ON sdar_control.node_event_outbox
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE OR REPLACE FUNCTION sdar_control.project_audit_node_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  projected_event_type text;
  managed_node_id text;
BEGIN
  SELECT node_id INTO managed_node_id FROM sdar_control.node_profile LIMIT 1;
  IF managed_node_id IS NULL THEN RETURN NEW; END IF;

  projected_event_type := CASE
    WHEN NEW.action LIKE 'node.profile.%' THEN 'node.profile.changed'
    WHEN NEW.action='configuration.published' THEN 'node.configuration.revision_published'
    WHEN NEW.action LIKE 'llm_provider.%' OR NEW.action LIKE 'model_route.%'
      THEN 'node.llm.provider_changed'
    WHEN NEW.action LIKE 'smpp_source.%' THEN 'node.smpp.source_changed'
    WHEN NEW.action LIKE 'mcp_provider_binding.%' THEN 'node.mcp.provider_binding_changed'
    WHEN NEW.action LIKE 'skill.%' THEN 'node.skill.version_changed'
    WHEN NEW.action LIKE 'plan_template.%' OR NEW.action LIKE 'plan-template.%'
      THEN 'node.plan_template.version_changed'
    WHEN NEW.action LIKE 'a2a.exposure_%' THEN 'node.a2a.exposure_changed'
    WHEN NEW.action='node_capability.command' AND NEW.result_code ILIKE '%PUBLISHED%'
      THEN 'node.capability.version_published'
    WHEN NEW.action='node_capability.command' AND NEW.result_code ILIKE '%SUSPENDED%'
      THEN 'node.capability.version_suspended'
    WHEN NEW.action='node_capability.command' AND NEW.result_code ILIKE '%DEPRECATED%'
      THEN 'node.capability.version_deprecated'
    WHEN NEW.action='node_capability.command' AND NEW.result_code ILIKE '%RETIRED%'
      THEN 'node.capability.version_retired'
    ELSE NULL
  END;
  IF projected_event_type IS NULL THEN RETURN NEW; END IF;

  INSERT INTO sdar_control.node_event_outbox(
    event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
    aggregate_revision,correlation_id,causation_id,actor_id,payload)
  VALUES(
    'audit:' || NEW.audit_id,projected_event_type,NEW.created_at,managed_node_id,
    NEW.aggregate_type,NEW.aggregate_id,
    GREATEST(COALESCE(NEW.result_revision,NEW.expected_revision,1),1),
    NEW.request_hash::text,NEW.audit_id,NEW.actor_id,
    jsonb_build_object(
      'resourceRef',jsonb_build_object(
        'type',NEW.aggregate_type,'id',NEW.aggregate_id,
        'revision',GREATEST(COALESCE(NEW.result_revision,NEW.expected_revision,1),1)),
      'changeCode',NEW.result_code))
  ON CONFLICT(event_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER control_audit_to_node_event
AFTER INSERT ON sdar_control.control_audit_event
FOR EACH ROW EXECUTE FUNCTION sdar_control.project_audit_node_event();

CREATE OR REPLACE FUNCTION sdar_control.project_operation_node_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  managed_node_id text;
  projected_revision bigint;
BEGIN
  IF NEW.status NOT IN ('succeeded','failed','canceled') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT node_id INTO managed_node_id FROM sdar_control.node_profile LIMIT 1;
  IF managed_node_id IS NULL THEN RETURN NEW; END IF;
  projected_revision := GREATEST(COALESCE(
    NEW.target_revision,
    CASE WHEN COALESCE(NEW.target_version,'') ~ '^[0-9]+$' THEN NEW.target_version::bigint END,
    1),1);
  INSERT INTO sdar_control.node_event_outbox(
    event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
    aggregate_revision,correlation_id,causation_id,actor_id,payload)
  VALUES(
    'operation:' || NEW.operation_id || ':' || NEW.status,
    'node.management_operation.completed',COALESCE(NEW.completed_at,NEW.created_at),
    managed_node_id,'management_operation',NEW.operation_id,
    projected_revision,NEW.idempotency_key_hash::text,
    NEW.operation_id,NEW.actor_id,
    jsonb_build_object(
      'resourceRef',jsonb_build_object('type','management_operation','id',NEW.operation_id),
      'status',NEW.status,'operationType',NEW.operation_type))
  ON CONFLICT(event_id) DO NOTHING;
  IF NEW.status='succeeded' AND NEW.operation_type='capability.readiness.evaluate' THEN
    INSERT INTO sdar_control.node_event_outbox(
      event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
      aggregate_revision,correlation_id,causation_id,actor_id,payload)
    VALUES(
      'readiness:' || NEW.operation_id,'node.capability.readiness_changed',
      COALESCE(NEW.completed_at,NEW.created_at),managed_node_id,'capability_readiness',
      NEW.target_id,projected_revision,NEW.idempotency_key_hash::text,NEW.operation_id,NEW.actor_id,
      jsonb_build_object(
        'resourceRef',jsonb_build_object(
          'type','capability_readiness','id',NEW.target_id,'revision',projected_revision),
        'changeCode','READINESS_EVALUATED'))
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
  IF NEW.status='succeeded' AND NEW.operation_type='agent_card.rebuild' THEN
    INSERT INTO sdar_control.node_event_outbox(
      event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
      aggregate_revision,correlation_id,causation_id,actor_id,payload)
    VALUES(
      'agent-card:' || NEW.operation_id,'node.agent_card.activated',
      COALESCE(NEW.completed_at,NEW.created_at),managed_node_id,'agent_card_revision',
      NEW.target_id,projected_revision,NEW.idempotency_key_hash::text,NEW.operation_id,NEW.actor_id,
      jsonb_build_object(
        'resourceRef',jsonb_build_object(
          'type','agent_card_revision','id',NEW.target_id,'revision',projected_revision),
        'changeCode','AGENT_CARD_ACTIVATED'))
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER management_operation_to_node_event
AFTER INSERT OR UPDATE OF status ON sdar_control.management_operation
FOR EACH ROW EXECUTE FUNCTION sdar_control.project_operation_node_event();

CREATE OR REPLACE FUNCTION sdar_control.project_configuration_ack_node_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  managed_node_id text;
  target record;
  projected_event_type text;
BEGIN
  SELECT node_id INTO managed_node_id FROM sdar_control.node_profile LIMIT 1;
  IF managed_node_id IS NULL THEN RETURN NEW; END IF;
  SELECT target_type,target_id INTO target
    FROM sdar_control.configuration_revision
   WHERE configuration_id=NEW.configuration_id AND revision=NEW.revision;
  projected_event_type := CASE WHEN NEW.status='applied'
    THEN 'node.configuration.revision_applied'
    ELSE 'node.configuration.revision_rejected' END;
  INSERT INTO sdar_control.node_event_outbox(
    event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
    aggregate_revision,correlation_id,causation_id,payload)
  VALUES(
    'configuration-application:' || NEW.application_id || ':' || NEW.status,
    projected_event_type,NEW.acknowledged_at,managed_node_id,
    'configuration_revision',NEW.configuration_id,NEW.revision,NEW.application_id,
    NEW.application_id,
    jsonb_build_object(
      'resourceRef',jsonb_build_object(
        'type','configuration_revision','id',NEW.configuration_id,'revision',NEW.revision),
      'targetType',target.target_type,'status',NEW.status))
  ON CONFLICT(event_id) DO NOTHING;
  IF target.target_type='telemetry_link' THEN
    INSERT INTO sdar_control.node_event_outbox(
      event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
      aggregate_revision,correlation_id,causation_id,payload)
    VALUES(
      'telemetry-status:' || NEW.application_id || ':' || NEW.status,
      'node.telemetry_export.status_changed',NEW.acknowledged_at,managed_node_id,
      'telemetry_export',target.target_id,NEW.revision,NEW.application_id,NEW.application_id,
      jsonb_build_object(
        'resourceRef',jsonb_build_object(
          'type','telemetry_export','id',target.target_id,'revision',NEW.revision),
        'status',NEW.status))
    ON CONFLICT(event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER configuration_application_to_node_event
AFTER INSERT OR UPDATE OF status ON sdar_control.configuration_application
FOR EACH ROW EXECUTE FUNCTION sdar_control.project_configuration_ack_node_event();
