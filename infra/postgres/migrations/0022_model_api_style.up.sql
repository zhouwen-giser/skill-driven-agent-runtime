BEGIN;
ALTER TABLE model_provider ADD COLUMN IF NOT EXISTS api_style text NOT NULL DEFAULT 'openai_chat_completions';
ALTER TABLE model_provider DROP CONSTRAINT IF EXISTS model_provider_api_style_check;
ALTER TABLE model_provider ADD CONSTRAINT model_provider_api_style_check CHECK(
  api_style IN ('openai_chat_completions','anthropic_messages')
);
INSERT INTO schema_migration(version) VALUES('0022_model_api_style') ON CONFLICT(version) DO NOTHING;
COMMIT;
