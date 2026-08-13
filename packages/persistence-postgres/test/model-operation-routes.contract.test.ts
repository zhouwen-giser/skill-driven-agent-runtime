import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0155_v14_model_operation_routes.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0155_v14_model_operation_routes.down.sql',
  import.meta.url,
);

describe('operation-aware Model stage-route migration contract', () => {
  it('backfills existing routes and makes operation part of their identity', async () => {
    const migration = compact(await readFile(migrationUrl, 'utf8'));

    const addOperation = migration.indexOf(
      "ADD COLUMN operation text NOT NULL DEFAULT 'structured_generation' CONSTRAINT stage_model_route_operation_check CHECK (operation IN ('structured_generation', 'embedding'))",
    );
    const dropDefault = migration.indexOf('ALTER COLUMN operation DROP DEFAULT');
    const addCompositeKey = migration.indexOf('ADD PRIMARY KEY(stage, operation)');

    expect(migration).toContain('DROP CONSTRAINT stage_model_route_pkey');
    expect(addOperation).toBeGreaterThan(-1);
    expect(dropDefault).toBeGreaterThan(addOperation);
    expect(addCompositeKey).toBeGreaterThan(dropDefault);
    expect(migration).toContain("VALUES ('0155_v14_model_operation_routes')");
  });

  it('preserves structured routes on rollback and refuses lossy embedding rollback', async () => {
    const rollback = compact(await readFile(rollbackUrl, 'utf8'));

    const lock = rollback.indexOf('LOCK TABLE stage_model_route IN ACCESS EXCLUSIVE MODE');
    const precondition = rollback.indexOf(
      "IF EXISTS ( SELECT 1 FROM stage_model_route WHERE operation <> 'structured_generation' )",
    );
    const dropOperation = rollback.indexOf('DROP COLUMN operation');

    expect(lock).toBeGreaterThan(-1);
    expect(precondition).toBeGreaterThan(lock);
    expect(dropOperation).toBeGreaterThan(precondition);
    expect(rollback).toContain(
      "RAISE EXCEPTION 'MODEL_OPERATION_ROUTE_ROLLBACK_REQUIRES_REVIEW' USING ERRCODE = '55000'",
    );
    expect(rollback).toContain('ADD PRIMARY KEY(stage)');
    expect(rollback).toContain(
      "DELETE FROM schema_migration WHERE version = '0155_v14_model_operation_routes'",
    );
    expect(rollback).not.toContain('DELETE FROM stage_model_route');
  });
});

function compact(source: string): string {
  return source.replace(/\s+/gu, ' ').replace(/ ?; ?/gu, '').trim();
}
