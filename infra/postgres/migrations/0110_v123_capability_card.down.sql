BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public_capability_card_snapshot) THEN
    RAISE EXCEPTION 'MIGRATION_0110_ROLLBACK_REQUIRES_NO_CAPABILITY_CARDS';
  END IF;
END $$;

ALTER TABLE public_capability_card_snapshot
  DROP CONSTRAINT public_capability_card_catalog_policy_unique;
ALTER TABLE public_capability_card_snapshot
  DROP COLUMN generation_mode,
  DROP COLUMN source_skill_refs,
  DROP COLUMN card_content_hash;

DELETE FROM schema_migration WHERE version = '0110_v123_capability_card';

COMMIT;
