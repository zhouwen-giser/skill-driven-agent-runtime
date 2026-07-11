BEGIN;

CREATE TABLE IF NOT EXISTS skill_relation (
  relation_id text PRIMARY KEY,
  source_skill_id text NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE,
  target_skill_id text NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN (
    'parent_child', 'depends_on', 'input_output_match',
    'alternative', 'composition', 'capability_coverage'
  )),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CHECK (source_skill_id <> target_skill_id),
  UNIQUE (source_skill_id, target_skill_id, relation_type)
);

CREATE INDEX IF NOT EXISTS skill_relation_source_idx
  ON skill_relation(source_skill_id, relation_type);
CREATE INDEX IF NOT EXISTS skill_relation_target_idx
  ON skill_relation(target_skill_id, relation_type);

COMMIT;
