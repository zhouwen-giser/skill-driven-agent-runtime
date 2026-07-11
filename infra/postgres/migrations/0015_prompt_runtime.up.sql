BEGIN;
CREATE TABLE IF NOT EXISTS prompt (
  prompt_id text PRIMARY KEY,
  stage text NOT NULL UNIQUE,
  current_version integer,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_version (
  prompt_id text NOT NULL REFERENCES prompt(prompt_id) ON DELETE CASCADE,
  stage text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  previous_version integer,
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','enabled','disabled')),
  source text NOT NULL CHECK (source IN ('admin','auto_candidate','manual_correction','rollback')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(prompt_id, version),
  FOREIGN KEY(prompt_id, previous_version) REFERENCES prompt_version(prompt_id, version)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_current_version_fk') THEN
    ALTER TABLE prompt ADD CONSTRAINT prompt_current_version_fk FOREIGN KEY(prompt_id,current_version) REFERENCES prompt_version(prompt_id,version);
  END IF;
END $$;
ALTER TABLE model_invocation ADD COLUMN IF NOT EXISTS prompt_id text;
ALTER TABLE model_invocation ADD COLUMN IF NOT EXISTS prompt_version integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_invocation_prompt_fk') THEN
    ALTER TABLE model_invocation ADD CONSTRAINT model_invocation_prompt_fk FOREIGN KEY(prompt_id,prompt_version) REFERENCES prompt_version(prompt_id,version);
  END IF;
END $$;
INSERT INTO schema_migration(version) VALUES ('0015_prompt_runtime') ON CONFLICT(version) DO NOTHING;
COMMIT;
