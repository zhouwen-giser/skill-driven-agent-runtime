BEGIN;

DROP TABLE IF EXISTS runtime_bootstrap_probe;
DELETE FROM schema_migration WHERE version = '0001_sdar_bootstrap';
DROP TABLE IF EXISTS schema_migration;

-- The vector extension is intentionally retained because later migrations may own vector columns.
-- Remove it manually only after proving that no remaining object depends on it.

COMMIT;
