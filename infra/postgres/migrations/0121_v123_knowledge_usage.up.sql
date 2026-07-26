BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_usage_record) THEN
    RAISE EXCEPTION 'MIGRATION_0121_REQUIRES_EMPTY_PRE_G13_USAGE_RECORD';
  END IF;
END $$;

ALTER TABLE experience_usage_record
  ADD COLUMN authoritative_ref text NOT NULL,
  ADD COLUMN query_fingerprint text NOT NULL
    CHECK (query_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN retrieval_rank integer NOT NULL CHECK (retrieval_rank >= 1);

CREATE UNIQUE INDEX experience_usage_record_session_knowledge_idx
  ON experience_usage_record(
    planning_session_id, knowledge_kind, knowledge_id, knowledge_revision
  );
CREATE INDEX experience_usage_record_query_replay_idx
  ON experience_usage_record(query_fingerprint, retrieval_rank, usage_id);

CREATE TABLE knowledge_relation (
  relation_id text PRIMARY KEY,
  source_kind text NOT NULL
    CHECK (source_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')),
  source_knowledge_id text NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision >= 1),
  target_kind text NOT NULL
    CHECK (target_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')),
  target_knowledge_id text NOT NULL,
  target_revision integer NOT NULL CHECK (target_revision >= 1),
  relation_type text NOT NULL
    CHECK (relation_type IN ('requires', 'contradicts', 'supersedes', 'supported_by', 'related')),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (
    source_kind, source_knowledge_id, source_revision,
    target_kind, target_knowledge_id, target_revision, relation_type
  ),
  CHECK (
    source_kind <> target_kind
    OR source_knowledge_id <> target_knowledge_id
    OR source_revision <> target_revision
  )
);

CREATE INDEX knowledge_relation_source_idx
  ON knowledge_relation(
    source_kind, source_knowledge_id, source_revision, relation_type, relation_id
  );
CREATE INDEX knowledge_relation_target_idx
  ON knowledge_relation(target_kind, target_knowledge_id, target_revision);

CREATE INDEX planning_heuristic_active_fts_idx
  ON planning_heuristic USING gin (to_tsvector('simple', definition::text))
  WHERE status = 'active';
CREATE INDEX task_type_definition_active_fts_idx
  ON task_type_definition USING gin (to_tsvector('simple', definition::text))
  WHERE status = 'active';
CREATE INDEX capability_pattern_definition_active_fts_idx
  ON capability_pattern_definition USING gin (to_tsvector('simple', definition::text))
  WHERE status = 'active';

INSERT INTO schema_migration(version)
VALUES ('0121_v123_knowledge_usage');

COMMIT;
