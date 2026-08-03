BEGIN;

CREATE TABLE runtime_model_provider_catalog (
  configuration_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  provider_id text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('openai_compatible','anthropic','local')),
  base_url text NOT NULL,
  credential_ref text NOT NULL,
  encrypted_credential text NOT NULL,
  model_catalog jsonb NOT NULL CHECK (jsonb_typeof(model_catalog) = 'array'),
  health_policy jsonb NOT NULL CHECK (jsonb_typeof(health_policy) = 'object'),
  rate_limit_policy jsonb NOT NULL CHECK (jsonb_typeof(rate_limit_policy) = 'object'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  is_active boolean NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (configuration_id, revision),
  UNIQUE (provider_id, revision)
);

CREATE UNIQUE INDEX runtime_model_provider_one_active_idx
  ON runtime_model_provider_catalog(provider_id) WHERE is_active;

CREATE TABLE runtime_model_route_snapshot (
  configuration_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  route_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('understanding','planning','execution','evaluation','summary','embedding')),
  scope_type text NOT NULL CHECK (scope_type IN ('stage','task','case')),
  scope_key text NOT NULL,
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) > 0),
  budget_policy jsonb NOT NULL CHECK (jsonb_typeof(budget_policy) = 'object'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  is_active boolean NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (configuration_id, revision),
  UNIQUE (route_id, revision),
  CHECK ((scope_type = 'stage' AND scope_key = '') OR (scope_type IN ('task','case') AND scope_key <> ''))
);

CREATE UNIQUE INDEX runtime_model_route_one_active_scope_idx
  ON runtime_model_route_snapshot(stage,scope_type,scope_key) WHERE is_active;

CREATE TABLE runtime_task_model_route_binding (
  task_id text NOT NULL,
  model_stage text NOT NULL,
  route_configuration_id text NOT NULL,
  route_revision bigint NOT NULL,
  route_checksum char(64) NOT NULL CHECK (route_checksum ~ '^[a-f0-9]{64}$'),
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) > 0),
  budget_policy jsonb NOT NULL CHECK (jsonb_typeof(budget_policy) = 'object'),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (task_id,model_stage),
  FOREIGN KEY (route_configuration_id,route_revision)
    REFERENCES runtime_model_route_snapshot(configuration_id,revision)
);

CREATE OR REPLACE FUNCTION protect_runtime_task_model_route_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RUNTIME_TASK_MODEL_ROUTE_BINDING_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER runtime_task_model_route_binding_immutable
BEFORE UPDATE OR DELETE ON runtime_task_model_route_binding
FOR EACH ROW EXECUTE FUNCTION protect_runtime_task_model_route_binding();

INSERT INTO schema_migration(version) VALUES ('0136_v14_model_control_governance')
ON CONFLICT (version) DO NOTHING;

COMMIT;
