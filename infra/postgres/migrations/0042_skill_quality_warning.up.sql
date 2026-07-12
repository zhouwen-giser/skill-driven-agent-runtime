BEGIN;

CREATE TABLE IF NOT EXISTS skill_quality_observation (
  observation_id text PRIMARY KEY,
  skill_id text NOT NULL,
  skill_version integer NOT NULL,
  evaluation_ref text NOT NULL,
  score double precision NOT NULL CHECK (score BETWEEN 0 AND 1),
  successful boolean NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skill_version(skill_id, version)
);

CREATE INDEX IF NOT EXISTS skill_quality_observation_recent_idx
  ON skill_quality_observation(skill_id, skill_version, created_at DESC, observation_id DESC);

CREATE TABLE IF NOT EXISTS skill_quality_warning (
  warning_id text PRIMARY KEY,
  skill_id text NOT NULL,
  skill_version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('consecutive_low_score', 'failure_rate_increase')),
  observation_ids_json jsonb NOT NULL,
  observed_value double precision NOT NULL,
  threshold double precision NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status = 'active'),
  skill_status_at_creation text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skill_version(skill_id, version),
  UNIQUE (skill_id, skill_version, kind, status)
);

CREATE INDEX IF NOT EXISTS skill_quality_warning_skill_idx
  ON skill_quality_warning(skill_id, created_at DESC, warning_id DESC);

COMMIT;
