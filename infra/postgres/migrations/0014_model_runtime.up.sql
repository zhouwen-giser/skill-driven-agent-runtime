BEGIN;

CREATE TABLE IF NOT EXISTS model_provider (
  provider_id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('openai_compatible','local','other_vendor')),
  base_url text NOT NULL,
  model text NOT NULL,
  enabled boolean NOT NULL,
  timeout_ms integer NOT NULL CHECK (timeout_ms > 0),
  encrypted_credential text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_model_route (
  stage text PRIMARY KEY CHECK (stage IN ('intent','goal','skill_authoring','skill_selection','workflow_planning','execution_decision','goal_evaluation','evaluation','result_processing')),
  provider_id text NOT NULL REFERENCES model_provider(provider_id),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS model_invocation (
  invocation_id text PRIMARY KEY,
  stage text NOT NULL,
  provider_id text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('structured_generation','embedding')),
  request_json jsonb NOT NULL,
  context_json jsonb NOT NULL,
  raw_response_json jsonb,
  structured_result_json jsonb,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  status text NOT NULL CHECK (status IN ('succeeded','failed')),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS model_invocation_stage_created ON model_invocation(stage, created_at DESC);

INSERT INTO schema_migration (version) VALUES ('0014_model_runtime') ON CONFLICT (version) DO NOTHING;
COMMIT;
