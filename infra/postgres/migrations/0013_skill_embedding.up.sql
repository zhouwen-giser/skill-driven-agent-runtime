BEGIN;

CREATE TABLE IF NOT EXISTS skill_embedding (
  skill_id text PRIMARY KEY REFERENCES skill(skill_id) ON DELETE CASCADE,
  skill_version integer NOT NULL,
  provider_id text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  searchable_text text NOT NULL,
  embedding vector NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skill_version(skill_id, version)
);

CREATE INDEX IF NOT EXISTS skill_embedding_provider_dimensions
  ON skill_embedding (provider_id, dimensions);

INSERT INTO schema_migration (version) VALUES ('0013_skill_embedding') ON CONFLICT (version) DO NOTHING;
COMMIT;
