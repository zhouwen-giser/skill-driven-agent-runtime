import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createNodeProfile } from '../../node-control-domain/src/index.js';
import {
  applyControlMigrations,
  PostgresNodeControlFoundationRepository,
  rollbackLatestControlMigration,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const repository = new PostgresNodeControlFoundationRepository(pool);

beforeAll(async () => {
  await applyControlMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P01 Control PostgreSQL foundation', { concurrent: false }, () => {
  it('applies the independent migration ledger idempotently', async () => {
    await applyControlMigrations(pool);
    const ledger = await pool.query<{ version: string }>(
      'SELECT version FROM sdar_control.control_schema_migration ORDER BY version',
    );
    expect(ledger.rows).toEqual([
      { version: '0001_node_control_foundation' },
      { version: '0002_configuration_revision_apply_lkg' },
    ]);
    const runtimeLedger = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migration') IS NOT NULL AS exists`,
    );
    expect(runtimeLedger.rows[0]?.exists).toBe(false);
  });

  it('bootstraps Profile and immutable Audit in one transaction', async () => {
    const profile = createNodeProfile(
      {
        nodeId: 'node-p01',
        nodeType: 'sdar-runtime',
        displayName: 'P01 Node',
        environment: 'integration',
        runtimeEndpointRef: 'http://127.0.0.1:9998',
      },
      '2026-08-01T17:00:00.000Z',
    );
    await expect(
      repository.bootstrapNodeProfile(profile, {
        auditId: randomUUID(),
        actorId: 'integration-test',
        action: 'node.profile.bootstrap',
        aggregateType: 'node_profile',
        aggregateId: profile.nodeId,
        resultRevision: 1,
        reason: 'verify atomic bootstrap',
        requestHash: 'a'.repeat(64),
        resultCode: 'NODE_PROFILE_BOOTSTRAPPED',
        createdAt: '2026-08-01T17:00:00.000Z',
      }),
    ).resolves.toBe(true);
    await expect(repository.findNodeProfile()).resolves.toMatchObject({ nodeId: 'node-p01' });
    await expect(repository.listAuditEvents(10)).resolves.toHaveLength(1);
    await expect(
      pool.query("UPDATE sdar_control.control_audit_event SET result_code='MUTATED'"),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('rolls back and reapplies only the latest disposable Control migration', async () => {
    await expect(rollbackLatestControlMigration(pool)).resolves.toBe(
      '0002_configuration_revision_apply_lkg',
    );
    const removed = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.configuration_revision')::text AS value`,
    );
    expect(removed.rows[0]?.value).toBeNull();
    await expect(repository.probe()).resolves.toBe(true);
    await applyControlMigrations(pool);
    await expect(repository.probe()).resolves.toBe(true);
  });
});
