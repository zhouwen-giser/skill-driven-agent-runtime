BEGIN;
CREATE TABLE IF NOT EXISTS memory_item (
  memory_id text PRIMARY KEY,
  type text NOT NULL CHECK(type IN (
    'fact','success_experience','failure_experience','workflow_pattern','skill_learning','prompt_learning'
  )),
  content_json jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','superseded','invalid')),
  source_refs_json jsonb NOT NULL,
  supersedes_json jsonb NOT NULL,
  confidence double precision NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  embedding_provider_id text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK(embedding_dimensions = 3),
  embedding vector(3) NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_item_status_created_idx ON memory_item(status,created_at DESC);
INSERT INTO schema_migration(version) VALUES('0031_global_memory') ON CONFLICT(version) DO NOTHING;
COMMIT;
