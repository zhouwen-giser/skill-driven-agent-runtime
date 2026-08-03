# Node Control PostgreSQL

This directory owns the independent `sdar_control` database migration sequence. It does not import,
rewrite or share the Runtime `public.schema_migration` ledger. `control_schema_migration` is created by
the P01 migration runner before applying numbered files.

P01 starts at `0001_node_control_foundation`. Rollback is destructive and is permitted only by
explicit migration verification against a disposable database; production startup only applies up
migrations.
