BEGIN;

CREATE TABLE promotion_provenance_report (
  report_id text PRIMARY KEY,
  knowledge_kind text NOT NULL CHECK (
    knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')
  ),
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL CHECK (knowledge_revision >= 1),
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^sha256:[0-9a-f]{64}$'),
  report_hash text NOT NULL CHECK (report_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('incubating', 'passed', 'failed')),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (knowledge_kind, knowledge_id, knowledge_revision),
  UNIQUE (report_hash)
);

CREATE INDEX promotion_provenance_report_status_idx
  ON promotion_provenance_report(status, created_at, report_id);

INSERT INTO schema_migration(version)
VALUES ('0124_v123_replay_shadow_evidence');

COMMIT;
