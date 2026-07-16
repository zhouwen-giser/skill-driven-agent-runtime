BEGIN;

ALTER TABLE memory_item
  DROP CONSTRAINT IF EXISTS memory_item_embedding_dimensions_check;

ALTER TABLE memory_item
  ALTER COLUMN embedding TYPE vector USING embedding::vector;

ALTER TABLE memory_item
  ADD COLUMN durability text,
  ADD COLUMN authority text,
  ADD COLUMN durability_reason text;

UPDATE memory_item
SET durability = 'unknown',
    authority = 'model_inferred',
    durability_reason = 'Legacy pre-v1.0.12 Memory requires explicit durability review.';

ALTER TABLE memory_item
  ALTER COLUMN durability SET NOT NULL,
  ALTER COLUMN authority SET NOT NULL,
  ALTER COLUMN durability_reason SET NOT NULL,
  ADD CONSTRAINT memory_item_durability_check
    CHECK (durability IN ('durable','volatile','unknown')),
  ADD CONSTRAINT memory_item_authority_check
    CHECK (authority IN ('mcp','skill_experience','admin','model_inferred')),
  ADD CONSTRAINT memory_item_durability_reason_check
    CHECK (length(btrim(durability_reason)) > 0),
  ADD CONSTRAINT memory_item_embedding_dimensions_check
    CHECK (embedding_dimensions > 0 AND vector_dims(embedding) = embedding_dimensions);

CREATE INDEX memory_item_provider_dimensions_idx
  ON memory_item (embedding_provider_id, embedding_dimensions)
  WHERE status = 'active' AND durability = 'durable';

INSERT INTO schema_migration(version)
VALUES('0064_memory_production_hardening')
ON CONFLICT(version) DO NOTHING;

COMMIT;
