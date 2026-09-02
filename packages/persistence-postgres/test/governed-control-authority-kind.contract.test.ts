import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../../../infra/postgres/migrations/', import.meta.url);

describe('governed-control authority-kind migration compatibility', () => {
  it('keeps physical_control as the additive default for legacy writers', async () => {
    const [initial, repair] = await Promise.all([
      readFile(new URL('0176_v14_control_authority_kind.up.sql', migrationRoot), 'utf8'),
      readFile(new URL('0177_v14_control_authority_kind_default.up.sql', migrationRoot), 'utf8'),
    ]);

    expect(initial).toContain("ADD COLUMN authority_kind text NOT NULL DEFAULT 'physical_control'");
    expect(initial).not.toContain('ALTER COLUMN authority_kind DROP DEFAULT');
    expect(repair).toContain("ALTER COLUMN authority_kind SET DEFAULT 'physical_control'");
    expect(repair).toContain("VALUES ('0177_v14_control_authority_kind_default')");
  });

  it('rolls back only the compatibility default and its own ledger row', async () => {
    const rollback = await readFile(
      new URL('0177_v14_control_authority_kind_default.down.sql', migrationRoot),
      'utf8',
    );

    expect(rollback).toContain('ALTER COLUMN authority_kind DROP DEFAULT');
    expect(rollback).toContain("WHERE version='0177_v14_control_authority_kind_default'");
    expect(rollback).not.toContain('DROP COLUMN authority_kind');
  });
});
