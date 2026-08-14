import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0160_v14_remote_task_authority_snapshot.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0160_v14_remote_task_authority_snapshot.down.sql',
  import.meta.url,
);

describe('0160 remote Task authority snapshot migration', () => {
  it('persists bounded versioned authority while retaining nullable legacy bindings', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('ADD COLUMN authority_snapshot_json jsonb');
    expect(sql).toContain('authority_snapshot_json IS NULL OR');
    expect(sql).toContain("authority_snapshot_json->>'schemaVersion'='1.0'");
    expect(sql).toContain("jsonb_typeof(authority_snapshot_json->'runtime')='object'");
    expect(sql).toContain('octet_length(authority_snapshot_json::text) <= 65536');
    expect(sql).toContain(') IS TRUE)');
  });

  it('requires new durable receipts to carry authority without rejecting legacy rows', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('remote_task_admission_receipt_authority_check');
    expect(sql).toContain("remote_receipt_json->'authoritySnapshot'");
    expect(sql).toContain(') IS TRUE)');
    expect(sql).toContain(') NOT VALID;');
  });

  it('reverses both authority contracts', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS remote_task_admission_receipt_authority_check',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS authority_snapshot_json');
  });
});
