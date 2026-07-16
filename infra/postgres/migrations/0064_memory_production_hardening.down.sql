BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM memory_item
    WHERE embedding_dimensions <> 3 OR vector_dims(embedding) <> 3
  ) THEN
    RAISE EXCEPTION 'MIGRATION_0064_ROLLBACK_REQUIRES_THREE_DIMENSIONAL_MEMORY';
  END IF;
END $$;

DROP INDEX IF EXISTS memory_item_provider_dimensions_idx;

ALTER TABLE memory_item
  DROP CONSTRAINT IF EXISTS memory_item_embedding_dimensions_check,
  DROP CONSTRAINT IF EXISTS memory_item_durability_check,
  DROP CONSTRAINT IF EXISTS memory_item_authority_check,
  DROP CONSTRAINT IF EXISTS memory_item_durability_reason_check;

ALTER TABLE memory_item
  ALTER COLUMN embedding TYPE vector(3) USING embedding::vector(3),
  ADD CONSTRAINT memory_item_embedding_dimensions_check CHECK (embedding_dimensions = 3),
  DROP COLUMN durability,
  DROP COLUMN authority,
  DROP COLUMN durability_reason;

DELETE FROM schema_migration WHERE version='0064_memory_production_hardening';

COMMIT;
