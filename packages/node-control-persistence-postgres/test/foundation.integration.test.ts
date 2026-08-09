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
      '0009_canonical_evidence_authority',
    );
    const removed = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.node_control_evidence_observation')::text AS value`,
    );
    expect(removed.rows[0]?.value).toBeNull();
    const preserved = await pool.query<{ value: string | null }>(
      `SELECT to_regclass('sdar_control.node_event_outbox')::text AS value`,
    );
    expect(preserved.rows[0]?.value).toBe('sdar_control.node_event_outbox');
    await expect(repository.probe()).resolves.toBe(true);
    await pool.query(
      `INSERT INTO sdar_control.configuration_revision(
         configuration_id,target_type,target_id,revision,status,apply_mode,content,checksum,
         created_by,created_at,published_at)
       VALUES('telemetry-backfill','telemetry_link','telemetry-backfill',1,'applied','hot_reload',
         '{}'::jsonb,$1,'integration-test',$2,$3)`,
      ['b'.repeat(64), '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:01.000Z'],
    );
    await applyControlMigrations(pool);
    const publication = await pool.query<{ status: string }>(
      `SELECT authority_payload->>'status' AS status
         FROM sdar_control.node_control_evidence_observation
        WHERE record_type='node_control.telemetry_configuration'
          AND source_record_id='telemetry-backfill:1'`,
    );
    expect(publication.rows).toEqual([{ status: 'published' }]);
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
