import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createManagementOperation,
  createNodeProfile,
  createNodeProfileRevision,
  transitionManagementOperation,
} from '../../node-control-domain/src/index.js';
import {
  applyControlMigrations,
  PostgresNodeControlEventRepository,
  PostgresNodeControlFoundationRepository,
  rollbackLatestControlMigration,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const repository = new PostgresNodeControlFoundationRepository(pool);
const events = new PostgresNodeControlEventRepository(pool);

beforeAll(async () => {
  await applyControlMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE sdar_control.node_event_outbox,
              sdar_control.node_profile_command_receipt,
              sdar_control.node_profile_revision,
              sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_provider_candidate,
              sdar_control.smpp_registry_snapshot,
              sdar_control.smpp_registry_source,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
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
      { version: '0003_llm_provider_model_route' },
      { version: '0004_smpp_registry_federation' },
      { version: '0005_mcp_provider_binding_governance' },
      { version: '0006_node_capability_authority' },
      { version: '0007_a2a_exposure_agent_card' },
      { version: '0008_organization_node_events' },
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
      '0008_organization_node_events',
    );
    const removed = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.node_event_outbox')::text AS value`,
    );
    expect(removed.rows[0]?.value).toBeNull();
    const preserved = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.a2a_exposure_version')::text AS value`,
    );
    expect(preserved.rows[0]?.value).toBe('sdar_control.a2a_exposure_version');
    await expect(repository.probe()).resolves.toBe(true);
    await applyControlMigrations(pool);
    await expect(repository.probe()).resolves.toBe(true);
  });

  it('persists ordered hint events and resumes strictly after Last-Event-ID', async () => {
    const profile = createNodeProfile(
      {
        nodeId: 'node-p12',
        nodeType: 'sdar-runtime',
        displayName: 'P12 Node',
        environment: 'integration',
        runtimeEndpointRef: 'http://127.0.0.1:9998',
      },
      '2026-08-02T08:00:00.000Z',
    );
    await repository.bootstrapNodeProfile(profile, {
      auditId: 'audit-p12-profile',
      actorId: 'integration-test',
      action: 'node.profile.bootstrap',
      aggregateType: 'node_profile',
      aggregateId: profile.nodeId,
      resultRevision: 1,
      reason: 'verify durable Node Event projection',
      requestHash: 'a'.repeat(64),
      resultCode: 'NODE_PROFILE_BOOTSTRAPPED',
      createdAt: '2026-08-02T08:00:00.000Z',
    });

    const accepted = createManagementOperation(
      {
        operationId: 'operation-p12',
        operationType: 'node.health.refresh',
        target: { type: 'node', id: profile.nodeId, revision: 1 },
        actorId: 'integration-test',
        reason: 'verify completed operation hint',
        idempotencyKeyHash: 'b'.repeat(64),
        inputHash: 'c'.repeat(64),
      },
      '2026-08-02T08:00:01.000Z',
    );
    const completed = transitionManagementOperation(
      transitionManagementOperation(accepted, 'running', '2026-08-02T08:00:01.000Z'),
      'succeeded',
      '2026-08-02T08:00:02.000Z',
      { result: { refreshed: true } },
    );
    await repository.recordGovernanceOperation(completed, {
      auditId: 'audit-p12-operation',
      actorId: 'integration-test',
      action: 'management_operation.recorded',
      aggregateType: 'management_operation',
      aggregateId: completed.operationId,
      resultRevision: 1,
      reason: 'record terminal operation',
      requestHash: 'd'.repeat(64),
      resultCode: 'MANAGEMENT_OPERATION_SUCCEEDED',
      createdAt: '2026-08-02T08:00:02.000Z',
    });

    const first = await events.listAfter(undefined, 1);
    expect(first.items).toEqual([
      expect.objectContaining({
        eventId: 'audit:audit-p12-profile',
        eventType: 'node.profile.changed',
        aggregateRevision: 1,
      }),
    ]);
    const second = await events.listAfter(first.lastEventId, 10);
    expect(second.items).toEqual([
      expect.objectContaining({
        eventId: 'operation:operation-p12:succeeded',
        eventType: 'node.management_operation.completed',
        correlationId: 'b'.repeat(64),
      }),
    ]);
    await expect(events.listAfter('unknown-event', 10)).rejects.toMatchObject({
      code: 'NODE_EVENT_CURSOR_NOT_FOUND',
      status: 409,
    });
    await expect(
      pool.query("UPDATE sdar_control.node_event_outbox SET payload='{}'::jsonb"),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('governs an immutable validated Node Profile revision before publication', async () => {
    const occurredAt = '2026-08-02T09:00:00.000Z';
    const profile = createNodeProfile(
      {
        nodeId: 'node-p12-profile',
        nodeType: 'sdar-runtime',
        displayName: 'P12 Draft Node',
        environment: 'integration',
        runtimeEndpointRef: 'http://127.0.0.1:9998',
      },
      occurredAt,
    );
    await repository.bootstrapNodeProfile(profile, {
      auditId: 'audit-p12-bootstrap',
      actorId: 'integration-test',
      action: 'node.profile.bootstrap',
      aggregateType: 'node_profile',
      aggregateId: profile.nodeId,
      resultRevision: 1,
      reason: 'bootstrap profile governance test',
      requestHash: '1'.repeat(64),
      resultCode: 'NODE_PROFILE_BOOTSTRAPPED',
      createdAt: occurredAt,
    });
    const draft = createNodeProfileRevision(
      {
        ...profile,
        displayName: 'P12 Published Node',
        status: 'draft',
      },
      2,
      '2026-08-02T09:00:01.000Z',
    );
    const draftContext = context('2', '3', '2026-08-02T09:00:01.000Z');
    await expect(repository.createNodeProfileDraft(draft, 1, draftContext)).resolves.toMatchObject({
      revision: 2,
      status: 'draft',
    });
    const validateContext = context('4', '5', '2026-08-02T09:00:02.000Z');
    await expect(repository.validateNodeProfileDraft(2, 2, validateContext)).resolves.toMatchObject(
      { revision: 2, status: 'draft' },
    );
    const accepted = createManagementOperation(
      {
        operationId: 'operation-p12-profile-publish',
        operationType: 'node.profile.publish',
        target: { type: 'node_profile', id: profile.nodeId, revision: 2 },
        actorId: 'integration-test',
        reason: 'publish validated Node Profile',
        idempotencyKeyHash: '6'.repeat(64),
        inputHash: '7'.repeat(64),
      },
      '2026-08-02T09:00:03.000Z',
    );
    const completed = transitionManagementOperation(
      transitionManagementOperation(accepted, 'running', '2026-08-02T09:00:03.000Z'),
      'succeeded',
      '2026-08-02T09:00:03.000Z',
      { result: { revision: 2 } },
    );
    const publishContext = context('6', '7', '2026-08-02T09:00:03.000Z');
    const audit = {
      auditId: 'audit-p12-profile-publish',
      actorId: 'integration-test',
      action: 'node.profile.publish',
      aggregateType: 'node_profile',
      aggregateId: profile.nodeId,
      expectedRevision: 2,
      resultRevision: 2,
      reason: 'publish validated Node Profile',
      requestHash: '7'.repeat(64),
      resultCode: 'NODE_PROFILE_PUBLISHED',
      createdAt: '2026-08-02T09:00:03.000Z',
    } as const;
    await expect(
      repository.publishNodeProfileDraft(2, 2, completed, audit, publishContext),
    ).resolves.toMatchObject({ status: 'succeeded' });
    await expect(
      repository.publishNodeProfileDraft(2, 2, completed, audit, publishContext),
    ).resolves.toMatchObject({ operationId: completed.operationId });
    await expect(repository.findNodeProfile()).resolves.toMatchObject({
      displayName: 'P12 Published Node',
      revision: 2,
      status: 'active',
    });
    await expect(
      pool.query(
        "UPDATE sdar_control.node_profile_revision SET display_name='mutated' WHERE revision=2",
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });
});

function context(idempotency: string, request: string, occurredAt: string) {
  return Object.freeze({
    actorId: 'integration-test',
    reason: 'P12 Node Profile governance',
    idempotencyKeyHash: idempotency.repeat(64),
    requestHash: request.repeat(64),
    occurredAt,
  });
}
