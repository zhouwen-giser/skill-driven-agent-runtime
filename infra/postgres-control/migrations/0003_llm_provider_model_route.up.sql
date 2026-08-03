CREATE TABLE sdar_control.llm_provider_definition (
  provider_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  provider_type text NOT NULL CHECK (provider_type IN ('openai_compatible','anthropic','local')),
  base_url text NOT NULL,
  credential_ref text NOT NULL CHECK (credential_ref ~ '^(secret|runtime-model-provider)://'),
  model_catalog jsonb NOT NULL CHECK (jsonb_typeof(model_catalog) = 'array' AND jsonb_array_length(model_catalog) > 0),
  health_policy jsonb NOT NULL CHECK (jsonb_typeof(health_policy) = 'object'),
  rate_limit_policy jsonb NOT NULL CHECK (jsonb_typeof(rate_limit_policy) = 'object'),
  status text NOT NULL CHECK (status IN ('draft','active','degraded','suspended','retired')),
  secret_status text NOT NULL CHECK (secret_status IN ('unknown','available','unavailable','invalid')),
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (provider_id, revision)
);

CREATE INDEX llm_provider_latest_idx
  ON sdar_control.llm_provider_definition(provider_id, revision DESC);

CREATE TABLE sdar_control.model_route_definition (
  route_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  stage text NOT NULL CHECK (stage IN ('understanding','planning','execution','evaluation','summary','embedding')),
  primary_candidate jsonb NOT NULL CHECK (jsonb_typeof(primary_candidate) = 'object'),
  fallback_candidates jsonb NOT NULL CHECK (jsonb_typeof(fallback_candidates) = 'array'),
  budget_policy jsonb NOT NULL CHECK (jsonb_typeof(budget_policy) = 'object'),
  scope_type text GENERATED ALWAYS AS (budget_policy #>> '{selector,scope}') STORED,
  scope_key text GENERATED ALWAYS AS (COALESCE(budget_policy #>> '{selector,key}', '')) STORED,
  status text NOT NULL CHECK (status IN ('draft','active','suspended','retired')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (route_id, revision),
  CHECK (scope_type IN ('stage','task','case')),
  CHECK ((scope_type = 'stage' AND scope_key = '') OR (scope_type IN ('task','case') AND scope_key <> ''))
);

CREATE INDEX model_route_latest_idx
  ON sdar_control.model_route_definition(route_id, revision DESC);

CREATE UNIQUE INDEX model_route_one_active_scope_idx
  ON sdar_control.model_route_definition(stage, scope_type, scope_key)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION sdar_control.protect_applied_llm_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND
     (to_jsonb(NEW) - 'status' - 'secret_status' - 'last_validated_at' - 'updated_at' - 'scope_type' - 'scope_key')
       IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'secret_status' - 'last_validated_at' - 'updated_at' - 'scope_type' - 'scope_key') THEN
    RAISE EXCEPTION 'CONTROL_LLM_DEFINITION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER llm_provider_applied_immutable
BEFORE UPDATE ON sdar_control.llm_provider_definition
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_applied_llm_definition();

CREATE TRIGGER model_route_applied_immutable
BEFORE UPDATE ON sdar_control.model_route_definition
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_applied_llm_definition();
