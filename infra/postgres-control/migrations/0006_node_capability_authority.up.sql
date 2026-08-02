CREATE TABLE sdar_control.node_capability_definition_version (
  capability_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  domain text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  input_schema jsonb NOT NULL CHECK (jsonb_typeof(input_schema)='object'),
  output_schema jsonb NOT NULL CHECK (jsonb_typeof(output_schema)='object'),
  success_criteria jsonb NOT NULL CHECK (jsonb_typeof(success_criteria)='array'),
  required_evidence jsonb NOT NULL CHECK (jsonb_typeof(required_evidence)='array'),
  effects jsonb NOT NULL CHECK (jsonb_typeof(effects)='array'),
  artifacts jsonb NOT NULL CHECK (jsonb_typeof(artifacts)='array'),
  constraints jsonb NOT NULL CHECK (jsonb_typeof(constraints)='array'),
  supported_modes jsonb NOT NULL CHECK (jsonb_typeof(supported_modes)='array'),
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  status text NOT NULL CHECK (status IN ('draft','validating','published','suspended','deprecated','retired')),
  definition_hash char(64) NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  previous_version bigint CHECK (previous_version IS NULL OR previous_version > 0),
  created_by text,
  created_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (capability_id, version),
  CHECK (previous_version IS NULL OR previous_version < version)
);

CREATE INDEX node_capability_definition_status_idx
  ON sdar_control.node_capability_definition_version(status, capability_id, version DESC);

CREATE TABLE sdar_control.capability_implementation_binding (
  binding_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  capability_id text NOT NULL,
  capability_version bigint NOT NULL CHECK (capability_version > 0),
  implementation_type text NOT NULL CHECK (implementation_type IN ('skill','plan_template')),
  implementation_id text NOT NULL,
  implementation_version text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary','alternative','supporting','validation','recovery')),
  priority integer NOT NULL CHECK (priority >= 0),
  activation_condition jsonb,
  provider_policy_override jsonb,
  status text NOT NULL CHECK (status IN ('draft','active','suspended','retired')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (binding_id, revision),
  FOREIGN KEY (capability_id, capability_version)
    REFERENCES sdar_control.node_capability_definition_version(capability_id, version)
    ON DELETE RESTRICT
);

CREATE INDEX capability_implementation_selection_idx
  ON sdar_control.capability_implementation_binding(
    capability_id, capability_version, status, role, priority, binding_id, revision DESC
  );

CREATE OR REPLACE FUNCTION sdar_control.protect_published_capability_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('published','suspended','deprecated','retired') AND (
    NEW.capability_id IS DISTINCT FROM OLD.capability_id OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.domain IS DISTINCT FROM OLD.domain OR
    NEW.name IS DISTINCT FROM OLD.name OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.input_schema IS DISTINCT FROM OLD.input_schema OR
    NEW.output_schema IS DISTINCT FROM OLD.output_schema OR
    NEW.success_criteria IS DISTINCT FROM OLD.success_criteria OR
    NEW.required_evidence IS DISTINCT FROM OLD.required_evidence OR
    NEW.effects IS DISTINCT FROM OLD.effects OR
    NEW.artifacts IS DISTINCT FROM OLD.artifacts OR
    NEW.constraints IS DISTINCT FROM OLD.constraints OR
    NEW.supported_modes IS DISTINCT FROM OLD.supported_modes OR
    NEW.risk_level IS DISTINCT FROM OLD.risk_level OR
    NEW.definition_hash IS DISTINCT FROM OLD.definition_hash OR
    NEW.previous_version IS DISTINCT FROM OLD.previous_version OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'NODE_CAPABILITY_PUBLISHED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER node_capability_definition_immutable
BEFORE UPDATE ON sdar_control.node_capability_definition_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_published_capability_definition();

CREATE TRIGGER node_capability_definition_no_delete
BEFORE DELETE ON sdar_control.node_capability_definition_version
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();

CREATE TRIGGER capability_implementation_binding_immutable
BEFORE UPDATE OR DELETE ON sdar_control.capability_implementation_binding
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();
