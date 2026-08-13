import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createManagementOperation,
  createNodeProfile,
  createNodeProfileRevision,
  transitionManagementOperation,
  type ControlAuditEvent,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';
import {
  NodeControlFoundationService,
  NodeControlTaskControlService,
} from '../../node-control-application/src/index.js';
import {
  applyControlMigrations,
  PostgresNodeControlEventRepository,
  PostgresNodeControlEvidenceSource,
  PostgresNodeControlFoundationRepository,
  PostgresNodeHealthObservationProducer,
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
    `TRUNCATE sdar_control.node_control_evidence_observation,
              sdar_control.node_health_observation,
              sdar_control.node_event_outbox,
              sdar_control.node_profile_command_receipt,
              sdar_control.node_profile_revision,
              sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_registry_snapshot_lineage,
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
      { version: '0009_canonical_evidence_authority' },
      { version: '0010_smpp_registry_lineage_revalidation' },
      { version: '0011_explicit_unauthenticated_credentials' },
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

  it('migrates both credential authorities to the one explicit unauthenticated sentinel', async () => {
    const constraints = await credentialConstraintDefinitions();
    expect(constraints).toEqual([
      expect.objectContaining({
        constraint_name: 'mcp_provider_binding_credential_ref_check',
        definition: expect.stringContaining("'unauthenticated://none'"),
      }),
      expect.objectContaining({
        constraint_name: 'smpp_registry_source_credential_ref_check',
        definition: expect.stringContaining("'unauthenticated://none'"),
      }),
    ]);

    await expect(
      insertCredentialConstraintSource(
        'credential-source-unauthenticated',
        'unauthenticated://none',
      ),
    ).resolves.toBeUndefined();
    await expect(
      insertCredentialConstraintBinding(
        'credential-binding-unauthenticated',
        'unauthenticated://none',
      ),
    ).resolves.toBeUndefined();
    await expect(
      insertCredentialConstraintSource(
        'credential-source-invalid-unauthenticated',
        'unauthenticated://fallback',
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'smpp_registry_source_credential_ref_check',
    });
    await expect(
      insertCredentialConstraintBinding(
        'credential-binding-invalid-unauthenticated',
        'unauthenticated://fallback',
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'mcp_provider_binding_credential_ref_check',
    });

    await expect(rollbackLatestControlMigration(pool)).rejects.toMatchObject({
      code: '55000',
      message: expect.stringContaining(
        'CONTROL_UNAUTHENTICATED_CREDENTIAL_ROWS_REQUIRE_RECONFIGURATION',
      ),
    });
    const preserved = await pool.query<{ source_count: string; binding_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM sdar_control.smpp_registry_source
           WHERE credential_ref='unauthenticated://none') AS source_count,
         (SELECT count(*)::text FROM sdar_control.mcp_provider_binding
           WHERE credential_ref='unauthenticated://none') AS binding_count`,
    );
    expect(preserved.rows).toEqual([{ source_count: '1', binding_count: '1' }]);

    await pool.query(
      `TRUNCATE sdar_control.mcp_provider_catalog_observation,
                sdar_control.mcp_provider_binding,
                sdar_control.smpp_registry_sync_attempt,
                sdar_control.smpp_registry_snapshot_lineage,
                sdar_control.smpp_provider_candidate,
                sdar_control.smpp_registry_snapshot,
                sdar_control.smpp_registry_source`,
    );
    await expect(rollbackLatestControlMigration(pool)).resolves.toBe(
      '0011_explicit_unauthenticated_credentials',
    );
    const rolledBack = await credentialConstraintDefinitions();
    expect(rolledBack).toHaveLength(2);
    expect(rolledBack.every(({ definition }) => !definition.includes('unauthenticated://'))).toBe(
      true,
    );
    await expect(
      insertCredentialConstraintSource('credential-source-rolled-back', 'unauthenticated://none'),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'smpp_registry_source_credential_ref_check',
    });

    await applyControlMigrations(pool);
    await expect(
      insertCredentialConstraintSource('credential-source-reapplied', 'unauthenticated://none'),
    ).resolves.toBeUndefined();
  });

  it('rolls back and reapplies 0010 without fabricating legacy lineage', async () => {
    await expect(rollbackLatestControlMigration(pool)).resolves.toBe(
      '0011_explicit_unauthenticated_credentials',
    );
    await expect(rollbackLatestControlMigration(pool)).resolves.toBe(
      '0010_smpp_registry_lineage_revalidation',
    );
    const removed = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.smpp_registry_snapshot_lineage')::text AS value`,
    );
    expect(removed.rows[0]?.value).toBeNull();
    const removedColumns = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_schema='sdar_control'
          AND (
            (table_name='smpp_registry_source' AND column_name='active_snapshot_valid_until')
            OR
            (table_name='smpp_registry_sync_attempt' AND column_name IN (
              'observed_native_revision','observed_native_checksum',
              'observed_projection_contract','observed_valid_until'))
          )`,
    );
    expect(removedColumns.rows).toEqual([{ count: '0' }]);
    const preserved = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.node_control_evidence_observation')::text AS value`,
    );
    expect(preserved.rows[0]?.value).toBe('sdar_control.node_control_evidence_observation');
    await expect(repository.probe()).resolves.toBe(true);
    await pool.query(
      `INSERT INTO sdar_control.smpp_registry_snapshot(
         smpp_source_id,snapshot_revision,checksum,etag,generated_at,external_expires_at,
         valid_until,provider_count,applied_at)
       VALUES('legacy-source',1,$1,$2,$3,$4,$5,0,$3)`,
      [
        'd'.repeat(64),
        `"${'d'.repeat(64)}"`,
        '2026-08-09T00:00:00.000Z',
        '2026-08-09T02:00:00.000Z',
        '2026-08-09T01:00:00.000Z',
      ],
    );
    await pool.query(
      `INSERT INTO sdar_control.smpp_registry_source(
         smpp_source_id,revision,registry_endpoint,credential_ref,environment,sync_mode,
         snapshot_ttl_seconds,lkg_policy,status,active_snapshot_revision,
         active_snapshot_checksum,active_snapshot_etag,created_at,updated_at)
       VALUES('legacy-source',1,'https://registry.example.test/latest','secret://env/SMPP_TOKEN',
         'integration','watch',3600,'allow_unexpired','active',1,$1,$2,$3,$3)`,
      ['d'.repeat(64), `"${'d'.repeat(64)}"`, '2026-08-09T00:00:00.000Z'],
    );
    await applyControlMigrations(pool);
    const legacy = await pool.query<{ active_snapshot_valid_until: Date }>(
      `SELECT active_snapshot_valid_until
         FROM sdar_control.smpp_registry_source
        WHERE smpp_source_id='legacy-source' AND revision=1`,
    );
    expect(legacy.rows[0]?.active_snapshot_valid_until.toISOString()).toBe(
      '2026-08-09T01:00:00.000Z',
    );
    const lineage = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM sdar_control.smpp_registry_snapshot_lineage
        WHERE smpp_source_id='legacy-source'`,
    );
    expect(lineage.rows).toEqual([{ count: '0' }]);
    const attemptColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='sdar_control' AND table_name='smpp_registry_sync_attempt'
          AND column_name IN (
            'observed_native_revision','observed_native_checksum',
            'observed_projection_contract','observed_valid_until')
        ORDER BY column_name`,
    );
    expect(attemptColumns.rows).toHaveLength(4);
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

  it('recovers one accepted Task command and replays its terminal result after process restart', async () => {
    const action = 'goal_patch' as const;
    const taskId = 'task-control-restart';
    const reason = 'Apply this Goal Patch once after restart.';
    const idempotencyKey = 'node-control-restart-goal-patch';
    const payload = Object.freeze({ instruction: 'Retain prior accepted evidence.' });
    const actorId = 'node-control:organization_service';
    const operationType = 'task.goal_patch';
    const target = Object.freeze({ type: 'task', id: taskId });
    const idempotencyKeyHash = sha256(idempotencyKey);
    const inputHash = sha256Json({ operationType, target, actorId, reason, payload });
    const accepted = createManagementOperation(
      {
        operationId: `control-task-${sha256(`${operationType}:${idempotencyKeyHash}`).slice(0, 40)}`,
        operationType,
        target,
        actorId,
        reason,
        idempotencyKeyHash,
        inputHash,
      },
      '2026-08-13T01:00:00.000Z',
    );
    await repository.recordGovernanceOperation(accepted, {
      auditId: 'audit-task-control-restart-accepted',
      actorId,
      action: operationType,
      aggregateType: 'task',
      aggregateId: taskId,
      reason,
      requestHash: inputHash,
      resultCode: 'ACCEPTED',
      createdAt: accepted.createdAt,
    });

    let runtimeCalls = 0;
    const serviceAfterRestart = () =>
      new NodeControlTaskControlService({
        runtime: {
          execute: () => {
            runtimeCalls += 1;
            const runtimeAccepted = createManagementOperation(
              {
                operationId: 'runtime-task-control-restart',
                operationType,
                target,
                actorId: 'runtime-task-authority',
                reason,
                idempotencyKeyHash: '8'.repeat(64),
                inputHash: '9'.repeat(64),
              },
              '2026-08-13T01:00:01.000Z',
            );
            return Promise.resolve(
              transitionManagementOperation(
                transitionManagementOperation(
                  runtimeAccepted,
                  'running',
                  '2026-08-13T01:00:01.000Z',
                ),
                'succeeded',
                '2026-08-13T01:00:02.000Z',
                { result: { applied: true } },
              ),
            );
          },
        },
        operations: repository,
        clock: { now: () => '2026-08-13T01:00:02.000Z' },
      });
    const command = Object.freeze({
      reason,
      idempotencyKey,
      correlationId: 'task-control-restart-correlation',
      payload,
    });
    const principal = Object.freeze({ actorId, role: 'organization_service' as const });

    await expect(
      serviceAfterRestart().execute(action, taskId, command, principal),
    ).resolves.toMatchObject({
      operationId: accepted.operationId,
      status: 'succeeded',
      result: { runtimeOperationId: 'runtime-task-control-restart' },
    });
    await expect(
      serviceAfterRestart().execute(action, taskId, command, principal),
    ).resolves.toMatchObject({
      operationId: accepted.operationId,
      status: 'succeeded',
    });
    expect(runtimeCalls).toBe(1);
    await expect(
      serviceAfterRestart().execute(
        action,
        taskId,
        { ...command, payload: { instruction: 'Conflicting patch.' } },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_IDEMPOTENCY_CONFLICT', status: 409 });
    expect(runtimeCalls).toBe(1);
  });

  it('atomically cancels an accepted Task command before dispatch and replays without Runtime', async () => {
    const fixture = taskControlFixture('cancel-before-dispatch', 'pause');
    await repository.recordGovernanceOperation(
      fixture.accepted,
      operationAudit(fixture.accepted, 'ACCEPTED', fixture.accepted.createdAt),
    );
    const foundation = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-13T03:00:01.000Z' },
      ids: { next: () => 'unused-cancel-operation-id' },
    });

    const canceled = await foundation.cancelManagementOperation(
      fixture.accepted.operationId,
      'cancel-before-dispatch-key',
      { reason: 'Cancel before Runtime dispatch.' },
      fixture.principal.actorId,
    );
    const replay = await foundation.cancelManagementOperation(
      fixture.accepted.operationId,
      'cancel-before-dispatch-key',
      { reason: 'Cancel before Runtime dispatch.' },
      fixture.principal.actorId,
    );
    let runtimeCalls = 0;
    const taskControl = new NodeControlTaskControlService({
      runtime: {
        execute: () => {
          runtimeCalls += 1;
          return Promise.resolve(runtimeOperationForIntegration(fixture));
        },
      },
      operations: repository,
      clock: { now: () => '2026-08-13T03:00:02.000Z' },
    });

    await expect(
      taskControl.execute(fixture.action, fixture.taskId, fixture.command, fixture.principal),
    ).resolves.toEqual(canceled);
    expect(replay).toEqual(canceled);
    expect(canceled).toMatchObject({
      status: 'canceled',
      result: { canceledBeforeDispatch: true },
    });
    expect(runtimeCalls).toBe(0);
    const cancellationAudits = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM sdar_control.control_audit_event
        WHERE aggregate_id=$1
          AND result_code='MANAGEMENT_OPERATION_CANCELED_BEFORE_DISPATCH'`,
      [fixture.accepted.operationId],
    );
    expect(cancellationAudits.rows).toEqual([{ count: '1' }]);
  });

  it('fails closed when dispatch wins before cancellation and on running process replay', async () => {
    const fixture = taskControlFixture('dispatch-before-cancel', 'resume');
    await repository.recordGovernanceOperation(
      fixture.accepted,
      operationAudit(fixture.accepted, 'ACCEPTED', fixture.accepted.createdAt),
    );
    await repository.startGovernanceOperation(
      fixture.accepted,
      operationAudit(fixture.accepted, 'DISPATCH_STARTED', '2026-08-13T03:10:01.000Z'),
    );
    const foundation = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-13T03:10:02.000Z' },
      ids: { next: () => 'unused-cancel-operation-id' },
    });

    await expect(
      foundation.cancelManagementOperation(
        fixture.accepted.operationId,
        'cancel-after-dispatch-key',
        { reason: 'Attempt after dispatch.' },
        fixture.principal.actorId,
      ),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE', status: 409 });
    let runtimeCalls = 0;
    await expect(
      new NodeControlTaskControlService({
        runtime: {
          execute: () => {
            runtimeCalls += 1;
            return Promise.resolve(runtimeOperationForIntegration(fixture));
          },
        },
        operations: repository,
        clock: { now: () => '2026-08-13T03:10:03.000Z' },
      }).execute(fixture.action, fixture.taskId, fixture.command, fixture.principal),
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_DISPATCH_UNCERTAIN', status: 409 });
    expect(runtimeCalls).toBe(0);
    await expect(
      repository.findManagementOperation(fixture.accepted.operationId),
    ).resolves.toMatchObject({ status: 'running' });
  });

  it('serializes concurrent cancellation and dispatch start with one pre-dispatch winner', async () => {
    const fixture = taskControlFixture('cancel-dispatch-concurrency', 'cancel');
    await repository.recordGovernanceOperation(
      fixture.accepted,
      operationAudit(fixture.accepted, 'ACCEPTED', fixture.accepted.createdAt),
    );
    const [start, cancel] = await Promise.allSettled([
      repository.startGovernanceOperation(
        fixture.accepted,
        operationAudit(fixture.accepted, 'DISPATCH_STARTED', '2026-08-13T03:20:01.000Z'),
      ),
      repository.cancelGovernanceOperation(
        fixture.accepted.operationId,
        operationAudit(
          fixture.accepted,
          'MANAGEMENT_OPERATION_CANCELED_BEFORE_DISPATCH',
          '2026-08-13T03:20:01.000Z',
        ),
        context('c', 'd', '2026-08-13T03:20:01.000Z'),
      ),
    ]);
    const final = await repository.findManagementOperation(fixture.accepted.operationId);

    expect(final?.status === 'running' || final?.status === 'canceled').toBe(true);
    if (final?.status === 'running') {
      expect(start).toMatchObject({ status: 'fulfilled', value: { status: 'running' } });
      expect(cancel).toMatchObject({
        status: 'rejected',
        reason: { code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE' },
      });
    } else {
      expect(cancel).toMatchObject({ status: 'fulfilled', value: { status: 'canceled' } });
      expect(start).toMatchObject({ status: 'fulfilled', value: { status: 'canceled' } });
    }
  });

  it('projects durable health and published telemetry without skipping or leaking credentials', async () => {
    const source = new PostgresNodeControlEvidenceSource(pool, undefined, evidenceReadPrincipal());
    const healthProducer = new PostgresNodeHealthObservationProducer(pool);
    await pool.query(
      `INSERT INTO sdar_control.node_profile_revision(
         node_id,node_type,display_name,description,environment,labels,authority_scopes,
         runtime_endpoint_ref,status,revision,created_by,created_at,updated_at)
       VALUES('node-phase9','sdar-runtime','Phase 9 Node','','integration','{}','[]',
         'http://127.0.0.1:9998','draft',1,'integration-test',$1,$1)`,
      ['2026-08-09T01:00:00.000Z'],
    );
    await pool.query(
      `UPDATE sdar_control.node_profile_revision
          SET display_name='Phase 9 Node Later',updated_at=$2
        WHERE node_id='node-phase9' AND revision=$1`,
      [1, '2026-08-09T01:00:00.500Z'],
    );
    await pool.query(
      `INSERT INTO sdar_control.configuration_revision(
         configuration_id,target_type,target_id,revision,status,apply_mode,content,checksum,
         created_by,created_at,published_at)
       VALUES('telemetry-phase9','telemetry_link','telemetry-phase9',1,'published','hot_reload',
         $1::jsonb,$2,'integration-test',$3,$3)`,
      [
        JSON.stringify({
          endpointRef: 'http://127.0.0.1:1/evidence',
          credentialRef: 'env:P11_EVIDENCE_TOKEN',
          nested: { tokenRef: 'env:SECOND_SECRET', safe: 'retained' },
        }),
        'a'.repeat(64),
        '2026-08-09T01:00:01.000Z',
      ],
    );
    await pool.query(
      `UPDATE sdar_control.configuration_revision SET status='applied'
        WHERE configuration_id='telemetry-phase9' AND revision=1`,
    );
    const publicationRows = await pool.query<{ count: string; status: string }>(
      `SELECT count(*)::text AS count,min(authority_payload->>'status') AS status
         FROM sdar_control.node_control_evidence_observation
        WHERE record_type='node_control.telemetry_configuration'
          AND source_record_id='telemetry-phase9:1'`,
    );
    expect(publicationRows.rows).toEqual([{ count: '1', status: 'published' }]);
    const observation = await healthProducer.recordNext(
      'health-phase9-1',
      {
        nodeId: 'node-phase9',
        status: 'healthy',
        components: [
          {
            component: 'postgresql',
            status: 'healthy',
            observedAt: '2026-08-09T01:00:02.000Z',
          },
        ],
        activeTasks: 0,
        observedAt: '2026-08-09T01:00:02.000Z',
      },
      { correlationId: 'health-phase9-correlation' },
    );
    expect(observation.observationRevision).toBe(1);
    await expect(
      healthProducer.recordNext('health-phase9-too-many-components', {
        nodeId: 'node-phase9',
        status: 'healthy',
        components: Array.from({ length: 65 }, (_, index) => ({
          component: `component-${String(index)}`,
          status: 'healthy' as const,
          observedAt: '2026-08-09T01:00:02.000Z',
        })),
        activeTasks: 0,
        observedAt: '2026-08-09T01:00:02.000Z',
      }),
    ).rejects.toThrow('NODE_HEALTH_COMPONENTS_INVALID');

    const page = await source.pendingPage(100, { lastEventId: 'health:health-phase9-1' });
    // Last-Event-ID constrains only event partitions; older non-event authorities remain visible.
    expect(page.partitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'node_control.profile_revision',
          sourceRecordId: 'node-phase9:1',
        }),
        expect.objectContaining({
          recordType: 'node_control.health_observation',
          sourceRecordId: 'health-phase9-1',
        }),
      ]),
    );
    const profilePartitions = page.partitions.filter(
      (partition) =>
        partition.recordType === 'node_control.profile_revision' &&
        partition.sourceRecordId === 'node-phase9:1',
    );
    expect(profilePartitions).toHaveLength(1);
    const profilePartition = profilePartitions[0];
    if (profilePartition === undefined) throw new Error('PROFILE_PARTITION_MISSING');
    await expect(source.load(profilePartition)).resolves.toMatchObject({
      payload: { displayName: 'Phase 9 Node' },
    });
    const telemetryPartition = page.partitions.find(
      (partition) => partition.recordType === 'node_control.telemetry_configuration',
    );
    expect(telemetryPartition).toBeDefined();
    if (telemetryPartition === undefined) throw new Error('TELEMETRY_PARTITION_MISSING');
    const telemetry = await source.load(telemetryPartition);
    expect(telemetry?.partition.sourceRevision).toBe(1);
    expect(telemetry?.payload['content']).toEqual({
      endpointRef: 'http://127.0.0.1:1/evidence',
      nested: { safe: 'retained' },
    });
    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('P11_EVIDENCE_TOKEN');
    expect(serialized).not.toContain('SECOND_SECRET');

    const healthPartition = page.partitions.find(
      (partition) => partition.recordType === 'node_control.health_observation',
    );
    if (healthPartition === undefined) throw new Error('HEALTH_PARTITION_MISSING');
    const health = await source.load(healthPartition);
    expect(health?.references).toEqual([
      expect.objectContaining({
        recordType: 'node_control.node_event',
        sourceRecordId: 'health:health-phase9-1',
        sourceRevision: 1,
      }),
    ]);
  });

  it('rejects Organization or tenant-scoped principals before any Control authority read', () => {
    expect(
      () =>
        new PostgresNodeControlEvidenceSource(pool, undefined, {
          ...evidenceReadPrincipal(),
          principalType: 'api',
          role: 'organization_service',
          authorityScope: 'tenant',
          actorId: 'node-control:organization_service',
        } as never),
    ).toThrow('NODE_CONTROL_EVIDENCE_READ_FORBIDDEN:projector_service_principal');
  });

  it('fails closed on aggregate revision regression', async () => {
    const source = new PostgresNodeControlEvidenceSource(pool, undefined, evidenceReadPrincipal());
    for (const revision of [2, 1]) {
      await pool.query(
        `INSERT INTO sdar_control.node_profile_revision(
           node_id,node_type,display_name,description,environment,labels,authority_scopes,
           runtime_endpoint_ref,status,revision,created_by,created_at,updated_at)
         VALUES('node-regression','sdar-runtime','Regression','','integration','{}','[]',
           'http://127.0.0.1:9998','draft',$1,'integration-test',$2,$2)`,
        [revision, `2026-08-09T02:00:0${String(3 - revision)}.000Z`],
      );
    }
    const partitions = await source.pendingPartitions(100);
    const regressed = partitions.find(
      (partition) =>
        partition.recordType === 'node_control.profile_revision' &&
        partition.sourceRecordId === 'node-regression:1',
    );
    if (regressed === undefined) throw new Error('REGRESSED_PARTITION_MISSING');
    await expect(source.load(regressed)).rejects.toMatchObject({
      code: 'NODE_CONTROL_EVIDENCE_REVISION_REGRESSION',
    });
  });

  it('rejects a reused Runtime Event identity without advancing the Control cursor', async () => {
    await pool.query(
      `UPDATE sdar_control.node_event_source_cursor
       SET last_sequence=0,updated_at=clock_timestamp()
       WHERE source_name='runtime-cognitive-outbox'`,
    );
    await pool.query(
      `CREATE TABLE public.cognitive_runtime_outbox(
         outbox_sequence bigint PRIMARY KEY,event_id text NOT NULL,event_type text NOT NULL,
         aggregate_type text NOT NULL,aggregate_id text NOT NULL,aggregate_version integer NOT NULL,
         correlation jsonb NOT NULL,payload jsonb NOT NULL,occurred_at timestamptz NOT NULL)`,
    );
    try {
      await pool.query(
        `INSERT INTO sdar_control.node_profile(
           node_id,node_type,display_name,description,environment,labels,authority_scopes,
           runtime_endpoint_ref,status,revision,created_at,updated_at)
         VALUES('node-runtime-conflict','sdar-runtime','Conflict Node','','integration','{}','[]',
           'http://127.0.0.1:9998','draft',1,$1,$1)`,
        ['2026-08-09T03:00:00.000Z'],
      );
      await pool.query(
        `INSERT INTO sdar_control.node_event_outbox(
           event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
           aggregate_revision,correlation_id,causation_id,data_classification,payload)
         VALUES('runtime:runtime-conflict','node.task.capability_bound',$1,'node-runtime-conflict',
           'task','task-conflict',1,'old-correlation','runtime-conflict','internal',$2::jsonb)`,
        [
          '2026-08-09T03:00:01.000Z',
          JSON.stringify({
            resourceRef: { type: 'task', id: 'task-conflict', revision: 1 },
            changeCode: 'TASK_CAPABILITY_BOUND',
          }),
        ],
      );
      await pool.query(
        `INSERT INTO public.cognitive_runtime_outbox(
           outbox_sequence,event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at)
         VALUES(1,'runtime-conflict','node.task.capability_bound','task','task-conflict',1,
           $1::jsonb,'{}'::jsonb,$2)`,
        [JSON.stringify({ correlationId: 'new-correlation' }), '2026-08-09T03:00:01.000Z'],
      );
      const synchronized = new PostgresNodeControlEventRepository(pool, pool);
      await expect(synchronized.listAfter(undefined, 10)).rejects.toMatchObject({
        code: 'NODE_EVENT_PAYLOAD_CONFLICT',
      });
      const cursor = await pool.query<{ last_sequence: string }>(
        `SELECT last_sequence::text FROM sdar_control.node_event_source_cursor
          WHERE source_name='runtime-cognitive-outbox'`,
      );
      expect(cursor.rows[0]?.last_sequence).toBe('0');
    } finally {
      await pool.query('DROP TABLE public.cognitive_runtime_outbox');
    }
  });
});

async function credentialConstraintDefinitions(): Promise<
  readonly Readonly<{ constraint_name: string; definition: string }>[]
> {
  const result = await pool.query<{ constraint_name: string; definition: string }>(
    `SELECT conname AS constraint_name,pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE connamespace='sdar_control'::regnamespace
        AND conname IN (
          'smpp_registry_source_credential_ref_check',
          'mcp_provider_binding_credential_ref_check'
        )
      ORDER BY conname`,
  );
  return result.rows;
}

async function insertCredentialConstraintSource(sourceId: string, credentialRef: string) {
  await pool.query(
    `INSERT INTO sdar_control.smpp_registry_source(
       smpp_source_id,revision,registry_endpoint,credential_ref,environment,sync_mode,
       snapshot_ttl_seconds,lkg_policy,status,created_at,updated_at)
     VALUES($1,1,'https://registry.example.test/latest',$2,'integration','manual',300,
            'allow_unexpired','draft',$3,$3)`,
    [sourceId, credentialRef, '2026-08-12T02:00:00.000Z'],
  );
}

async function insertCredentialConstraintBinding(bindingId: string, credentialRef: string) {
  await pool.query(
    `INSERT INTO sdar_control.mcp_provider_binding(
       binding_id,revision,local_server_id,origin_type,catalog_revision,catalog_checksum,
       endpoint_ref,credential_ref,status,availability_status,availability_valid_until,
       catalog_observed_at,operation_count,created_at)
     VALUES($1,1,$2,'direct','1',$3,'https://runtime.example.test/mcp',$4,'active',
            'available',$5,$6,0,$6)`,
    [
      bindingId,
      `${bindingId}-server`,
      'a'.repeat(64),
      credentialRef,
      '2026-08-12T03:00:00.000Z',
      '2026-08-12T02:00:00.000Z',
    ],
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function taskControlFixture(suffix: string, action: 'pause' | 'resume' | 'cancel' | 'goal_patch') {
  const taskId = `task-${suffix}`;
  const operationType = `task.${action}`;
  const reason = `Govern Task command ${suffix}.`;
  const idempotencyKey = `task-control-${suffix}-key`;
  const principal = Object.freeze({
    actorId: 'node-control:node_admin',
    role: 'node_admin' as const,
  });
  const target = Object.freeze({ type: 'task', id: taskId });
  const idempotencyKeyHash = sha256(idempotencyKey);
  const inputHash = sha256Json({ operationType, target, actorId: principal.actorId, reason });
  const accepted = createManagementOperation(
    {
      operationId: `control-task-${sha256(`${operationType}:${idempotencyKeyHash}`).slice(0, 40)}`,
      operationType,
      target,
      actorId: principal.actorId,
      reason,
      idempotencyKeyHash,
      inputHash,
    },
    '2026-08-13T03:00:00.000Z',
  );
  return Object.freeze({
    action,
    taskId,
    operationType,
    reason,
    accepted,
    principal,
    command: Object.freeze({
      reason,
      idempotencyKey,
      correlationId: `correlation-${suffix}`,
    }),
  });
}

function operationAudit(
  operation: ManagementOperation,
  resultCode: string,
  createdAt: string,
): ControlAuditEvent {
  return Object.freeze({
    auditId: `audit-${operation.operationId}-${resultCode.toLowerCase().replaceAll('_', '-')}`,
    actorId: operation.actorId,
    action: operation.operationType,
    aggregateType: operation.target.type,
    aggregateId: operation.target.id,
    reason: operation.reason,
    requestHash: operation.inputHash,
    resultCode,
    createdAt,
  });
}

function runtimeOperationForIntegration(
  fixture: ReturnType<typeof taskControlFixture>,
): ManagementOperation {
  const accepted = createManagementOperation(
    {
      operationId: `runtime-${fixture.accepted.operationId}`,
      operationType: fixture.operationType,
      target: { type: 'task', id: fixture.taskId },
      actorId: 'sdar-runtime',
      reason: fixture.reason,
      idempotencyKeyHash: '8'.repeat(64),
      inputHash: '9'.repeat(64),
    },
    '2026-08-13T03:30:00.000Z',
  );
  return transitionManagementOperation(
    transitionManagementOperation(accepted, 'running', '2026-08-13T03:30:00.001Z'),
    'succeeded',
    '2026-08-13T03:30:00.002Z',
    { result: { applied: true } },
  );
}

function context(idempotency: string, request: string, occurredAt: string) {
  return Object.freeze({
    actorId: 'integration-test',
    reason: 'P12 Node Profile governance',
    idempotencyKeyHash: idempotency.repeat(64),
    requestHash: request.repeat(64),
    occurredAt,
  });
}

function evidenceReadPrincipal() {
  return Object.freeze({
    principalType: 'service' as const,
    actorId: 'service:node-control-evidence-projector:node-phase9',
    role: 'node_control_evidence_projector' as const,
    permission: 'node_control.evidence.read' as const,
    authorityScope: 'global_authority' as const,
    organizationScope: 'node_local' as const,
    nodeId: 'node-phase9',
    allowedDataClassifications: Object.freeze(['public', 'internal', 'restricted'] as const),
  });
}
