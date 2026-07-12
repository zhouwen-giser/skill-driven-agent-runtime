BEGIN;

CREATE TABLE IF NOT EXISTS evolution_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  success_threshold integer NOT NULL CHECK(success_threshold >= 2),
  updated_at timestamptz NOT NULL
);

INSERT INTO evolution_policy(singleton,success_threshold,updated_at)
VALUES(true,2,now()) ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS evolution_trigger (
  trigger_id text PRIMARY KEY,
  capability_fingerprint text NOT NULL,
  experience_id text NOT NULL REFERENCES temporary_skill_experience(experience_id),
  successful_experience_count integer NOT NULL CHECK(successful_experience_count >= 1),
  configured_threshold integer NOT NULL CHECK(configured_threshold >= 2),
  decision text NOT NULL CHECK(decision IN ('below_threshold','candidate_created','candidate_existing')),
  candidate_id text REFERENCES skill_formalization_candidate(candidate_id),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS evolution_trigger_fingerprint_idx
  ON evolution_trigger(capability_fingerprint,created_at);

INSERT INTO schema_migration(version) VALUES('0039_evolution_policy')
ON CONFLICT(version) DO NOTHING;

COMMIT;
