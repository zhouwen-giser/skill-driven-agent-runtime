CREATE TABLE sdar_control.a2a_exposure_version (
  exposure_id text NOT NULL,
  version bigint NOT NULL CHECK(version > 0),
  capability_id text NOT NULL,
  capability_version bigint NOT NULL CHECK(capability_version > 0),
  agent_skill_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  tags jsonb NOT NULL CHECK(jsonb_typeof(tags)='array'),
  examples jsonb NOT NULL CHECK(jsonb_typeof(examples)='array'),
  input_modes jsonb NOT NULL CHECK(jsonb_typeof(input_modes)='array'),
  output_modes jsonb NOT NULL CHECK(jsonb_typeof(output_modes)='array'),
  request_schema jsonb NOT NULL CHECK(jsonb_typeof(request_schema)='object'),
  result_schema jsonb NOT NULL CHECK(jsonb_typeof(result_schema)='object'),
  visibility text NOT NULL CHECK(visibility IN ('organization','public')),
  requester_policy jsonb,
  readiness_publication_policy text NOT NULL CHECK(readiness_publication_policy IN ('publish_when_available','publish_degraded','always_publish_with_status')),
  status text NOT NULL CHECK(status IN ('draft','published','suspended','retired')),
  exposure_hash char(64) NOT NULL CHECK(exposure_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(exposure_id,version),
  FOREIGN KEY(capability_id,capability_version)
    REFERENCES sdar_control.node_capability_definition_version(capability_id,version),
  UNIQUE(agent_skill_id,version)
);

CREATE INDEX a2a_exposure_status_idx
  ON sdar_control.a2a_exposure_version(status,visibility,agent_skill_id);

CREATE SEQUENCE sdar_control.agent_card_revision_sequence START WITH 1;

CREATE TABLE sdar_control.agent_card_revision (
  revision bigint PRIMARY KEY CHECK(revision > 0),
  node_id text NOT NULL,
  exposure_refs jsonb NOT NULL CHECK(jsonb_typeof(exposure_refs)='array'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  capability_catalog_hash char(64) NOT NULL CHECK(capability_catalog_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('candidate','staged','active','rejected','superseded')),
  card jsonb NOT NULL CHECK(jsonb_typeof(card)='object'),
  generated_at timestamptz NOT NULL,
  activated_at timestamptz,
  rejection_code text,
  UNIQUE(content_hash,capability_catalog_hash)
);

CREATE UNIQUE INDEX agent_card_single_active_idx
  ON sdar_control.agent_card_revision((status)) WHERE status='active';

CREATE OR REPLACE FUNCTION sdar_control.protect_a2a_definition_content()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.exposure_id IS DISTINCT FROM OLD.exposure_id OR
     NEW.version IS DISTINCT FROM OLD.version OR
     NEW.capability_id IS DISTINCT FROM OLD.capability_id OR
     NEW.capability_version IS DISTINCT FROM OLD.capability_version OR
     NEW.agent_skill_id IS DISTINCT FROM OLD.agent_skill_id OR
     NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description OR
     NEW.tags IS DISTINCT FROM OLD.tags OR NEW.examples IS DISTINCT FROM OLD.examples OR
     NEW.input_modes IS DISTINCT FROM OLD.input_modes OR NEW.output_modes IS DISTINCT FROM OLD.output_modes OR
     NEW.request_schema IS DISTINCT FROM OLD.request_schema OR NEW.result_schema IS DISTINCT FROM OLD.result_schema OR
     NEW.visibility IS DISTINCT FROM OLD.visibility OR NEW.requester_policy IS DISTINCT FROM OLD.requester_policy OR
     NEW.readiness_publication_policy IS DISTINCT FROM OLD.readiness_publication_policy OR
     NEW.exposure_hash IS DISTINCT FROM OLD.exposure_hash THEN
    RAISE EXCEPTION 'A2A_EXPOSURE_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER a2a_exposure_content_immutable
BEFORE UPDATE ON sdar_control.a2a_exposure_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_a2a_definition_content();
CREATE TRIGGER a2a_exposure_no_delete
BEFORE DELETE ON sdar_control.a2a_exposure_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE OR REPLACE FUNCTION sdar_control.protect_agent_card_content()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.node_id IS DISTINCT FROM OLD.node_id OR
     NEW.exposure_refs IS DISTINCT FROM OLD.exposure_refs OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
     NEW.capability_catalog_hash IS DISTINCT FROM OLD.capability_catalog_hash OR
     NEW.card IS DISTINCT FROM OLD.card OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION 'AGENT_CARD_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER agent_card_content_immutable
BEFORE UPDATE ON sdar_control.agent_card_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_agent_card_content();
CREATE TRIGGER agent_card_no_delete
BEFORE DELETE ON sdar_control.agent_card_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();
