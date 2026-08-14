import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0159_v14_remote_task_admission_recovery.up.sql',
  import.meta.url,
);

describe('0159 remote Task admission recovery migration', () => {
  it('allows parallel admission intents to materialize against the same final snapshot', async () => {
    const sql = await readFile(up, 'utf8');
    const snapshotColumn =
      /materialized_snapshot_id text(?<definition>[\s\S]*?)materialized_at timestamptz/u.exec(sql)
        ?.groups?.['definition'];

    expect(snapshotColumn).toBeDefined();
    expect(snapshotColumn).toContain(
      'REFERENCES workflow_continuation_snapshot(snapshot_id) ON DELETE RESTRICT',
    );
    expect(snapshotColumn).not.toContain('UNIQUE');
    expect(sql).toContain('CREATE INDEX remote_task_admission_snapshot_idx');
  });

  it('fails closed when a recorded receipt lacks a complete continuation checkpoint', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain(
      "(jsonb_typeof(remote_receipt_json->'continuation'->'snapshot') = 'object') IS TRUE",
    );
    expect(sql).toContain("IN ('exact_single','requires_graph_merge','exact_final')) IS TRUE");
    expect(sql).toContain("remote_receipt_json->'continuation'->'snapshot'->'waitingNodeRuns'");
    expect(sql).toContain("= 'array') IS TRUE");
    expect(sql).toContain('AND receipt_recorded_at IS NOT NULL');
  });
});
