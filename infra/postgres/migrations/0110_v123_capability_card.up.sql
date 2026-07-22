BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public_capability_card_snapshot) THEN
    RAISE EXCEPTION 'MIGRATION_0110_REQUIRES_EMPTY_UNRELEASED_CAPABILITY_CARDS';
  END IF;
END $$;

ALTER TABLE public_capability_card_snapshot
  ADD COLUMN card_content_hash text NOT NULL
    CHECK (card_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN source_skill_refs jsonb NOT NULL
    CHECK (jsonb_typeof(source_skill_refs) = 'array'),
  ADD COLUMN generation_mode text NOT NULL
    CHECK (generation_mode IN ('deterministic', 'model_narrative', 'deterministic_fallback'));

ALTER TABLE public_capability_card_snapshot
  ADD CONSTRAINT public_capability_card_catalog_policy_unique
  UNIQUE (catalog_hash, generation_policy_version);

INSERT INTO schema_migration(version) VALUES ('0110_v123_capability_card');

COMMIT;
