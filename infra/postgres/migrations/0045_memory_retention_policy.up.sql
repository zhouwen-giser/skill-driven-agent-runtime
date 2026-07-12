BEGIN;
CREATE TABLE IF NOT EXISTS memory_retention_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  review_after_days integer NOT NULL CHECK(review_after_days > 0),
  archive_after_days integer CHECK(archive_after_days > 0),
  delete_after_days integer CHECK(delete_after_days > 0),
  automatic_archive_enabled boolean NOT NULL CHECK(NOT automatic_archive_enabled),
  automatic_delete_enabled boolean NOT NULL CHECK(NOT automatic_delete_enabled),
  updated_at timestamptz NOT NULL,
  CHECK(archive_after_days IS NULL OR delete_after_days IS NULL OR delete_after_days > archive_after_days)
);
INSERT INTO memory_retention_policy(
  singleton,review_after_days,archive_after_days,delete_after_days,
  automatic_archive_enabled,automatic_delete_enabled,updated_at)
VALUES(true,90,365,730,false,false,CURRENT_TIMESTAMP)
ON CONFLICT(singleton) DO NOTHING;
INSERT INTO schema_migration(version) VALUES('0045_memory_retention_policy') ON CONFLICT(version) DO NOTHING;
COMMIT;
