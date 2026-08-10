import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import {
  applyRuntimeMigrations,
  startServerRuntime,
  type ServerRuntimeHandle,
} from '../../server/src/runtime.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';
import { PostgresEvidenceStore } from '../../../packages/runtime-control-persistence-postgres/src/index.js';
import {
  createCatalogEvidenceEnvelope,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
} from '../../../packages/domain/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const redisPort = Number(process.env['SDAR_REDIS_PORT'] ?? '56379');
const apiToken = 'p11-control-api-token-00000000000000000000000';
const runtimeToken = 'p11-runtime-service-token-0000000000000000000';
const credential = 'p11-ingestion-credential';
const exportId = `export-p11-${randomUUID()}`;
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 2 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 2 });
const evidence = new PostgresEvidenceStore(runtimePool);
let runtime: ServerRuntimeHandle | undefined;
let control: NodeControlApiRuntime | undefined;
let ingestion: Server | undefined;
let controlNodeId = 'node-p11';
let ingestionUrl: string;
const receivedEvidenceRecords: CanonicalEvidenceEnvelope[] = [];
const previousCredential = process.env['P11_EVIDENCE_TOKEN'];

interface EvidenceRow {
  readonly record_id: string;
  readonly record_type: string;
  readonly source_system: 'runtime' | 'node_control';
  readonly source_record_id: string;
  readonly observation_generation: number;
  readonly evidence_refs: readonly string[];
  readonly payload: Readonly<Record<string, EvidenceJsonValue>>;
  readonly acknowledged_at: Date | string | null;
}

beforeAll(async () => {
  process.env['P11_EVIDENCE_TOKEN'] = credential;
  await Promise.all([applyRuntimeMigrations(runtimePool), applyControlMigrations(controlPool)]);
  await runtimePool.query(
    `TRUNCATE evidence_export_ack,evidence_export_batch,evidence_dead_letter,
      evidence_projection_issue,evidence_source_checkpoint,evidence_outbox,
      evidence_export_state,evidence_export_configuration RESTART IDENTITY CASCADE`,
  );
  await runtimePool.query('ALTER SEQUENCE evidence_export_observation_sequence RESTART WITH 1');
  await controlPool.query(
    `TRUNCATE sdar_control.node_control_evidence_observation,
              sdar_control.node_health_observation,
              sdar_control.node_event_outbox,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
              sdar_control.management_operation,
              sdar_control.control_audit_event RESTART IDENTITY CASCADE`,
  );
  receivedEvidenceRecords.length = 0;
  ingestion = createServer((request, response) => {
    if (
      request.headers.authorization !== `Bearer ${credential}` ||
      request.headers['x-sdar-evidence-contract'] !== 'sdar.evidence/v1' ||
      request.headers['x-sdar-telemetry-contract'] !== undefined
    ) {
      response.statusCode = 401;
      response.end();
      return;
    }
    if (request.method === 'HEAD') {
      response.statusCode = 204;
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        contractVersion?: string;
        batchHash?: string;
        records?: readonly CanonicalEvidenceEnvelope[];
      };
      if (
        body.contractVersion !== 'sdar.evidence/v1' ||
        !/^sha256:[0-9a-f]{64}$/u.test(body.batchHash ?? '')
      ) {
        response.statusCode = 400;
        response.end();
        return;
      }
      const records = body.records ?? [];
      receivedEvidenceRecords.push(...records);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({ lastAcknowledgedSequence: records.at(-1)?.evidenceSequence ?? '0' }),
      );
    });
  });
  await listen(ingestion);
  ingestionUrl = address(ingestion);
  const node = await controlPool.query<{ node_id: string }>(
    'SELECT node_id FROM sdar_control.node_profile LIMIT 1',
  );
  controlNodeId = node.rows[0]?.node_id ?? 'node-p11';
  runtime = await startServerRuntime({
    postgresUrl: runtimeConnectionString,
    redis: { host: '127.0.0.1', port: redisPort },
    masterKeyBase64: randomBytes(32).toString('base64'),
    applyMigrations: true,
    a2aHost: '127.0.0.1',
    a2aPort: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    runtimeControlServiceToken: runtimeToken,
    queueName: `v141-evidence-${randomUUID()}`,
  });
  control = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_RUNTIME_DATABASE_URL: runtimeConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: controlNodeId,
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P11 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: runtime.management.baseUrl,
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: runtime.a2a.baseUrl,
  });
});

afterAll(async () => {
  await control?.close();
  await runtime?.close();
  if (ingestion?.listening === true) await close(ingestion);
  await Promise.all([runtimePool.end(), controlPool.end()]);
  if (previousCredential === undefined) delete process.env['P11_EVIDENCE_TOKEN'];
  else process.env['P11_EVIDENCE_TOKEN'] = previousCredential;
}, 60_000);

describe(
  'v1.4.1 Node Control -> Runtime -> Canonical Evidence endpoint',
  { concurrent: false },
  () => {
    it('publishes, applies, projects both authorities, delivers, ACKs and isolates endpoint outage', async () => {
      if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
      const revisionResult = await controlPool.query<{ next_revision: string }>(
        `SELECT (COALESCE(max(revision),0)+1)::text AS next_revision
       FROM sdar_control.configuration_revision
       WHERE target_type='telemetry_link' AND target_id=$1`,
        [controlNodeId],
      );
      const revisionRow = revisionResult.rows[0];
      if (revisionRow === undefined) throw new Error('P11_REVISION_UNAVAILABLE');
      const revision = Number(revisionRow.next_revision);
      const definition = {
        exportId,
        endpointRef: `${ingestionUrl}/ingest`,
        sourceId: 'runtime-p11',
        credentialRef: 'env:P11_EVIDENCE_TOKEN',
        includedFamilies: [
          'runtime',
          'skill',
          'mcp_task',
          'capability',
          'experience',
          'replay',
          'artifact',
          'node_control',
          'evidence',
        ],
        excludedDiagnosticTypes: ['node_control.health_observation'],
        batchPolicy: { maxRecords: 10, maxBytes: 262_144, flushIntervalMs: 1_000 },
        retryPolicy: { baseDelayMs: 100, maxDelayMs: 300_000 },
        outboxPolicy: { maxPendingRecords: 100, retentionDays: 30 },
        redactionProfile: 'strict_internal_v1',
        artifactMode: 'reference',
        status: 'draft',
        revision,
        applyMode: 'hot_reload',
      };
      const created = await command('/api/v1/evidence-export/revisions', definition, {
        idempotencyKey: `p11-create-${randomUUID()}`,
      });
      expect(created.response.status, JSON.stringify(created.body)).toBe(201);
      const validated = await command(
        `/api/v1/evidence-export/revisions/${String(revision)}/validate`,
        { reason: 'Validate exact P11 output configuration.', expectedRevision: revision },
        {
          idempotencyKey: `p11-validate-${randomUUID()}`,
          etag: requiredResponseHeader(created.response, 'etag'),
        },
      );
      expect(validated.response.status, JSON.stringify(validated.body)).toBe(200);
      const published = await command(
        `/api/v1/evidence-export/revisions/${String(revision)}/publish`,
        { reason: 'Publish exact P11 output configuration.', expectedRevision: revision },
        {
          idempotencyKey: `p11-publish-${randomUUID()}`,
          etag: requiredResponseHeader(validated.response, 'etag'),
        },
      );
      expect(published.response.status, JSON.stringify(published.body)).toBe(202);
      expect(published.body).toMatchObject({ status: 'succeeded' });
      const testKey = `p11-test-${randomUUID()}`;
      const tested = await command(
        '/api/v1/evidence-export/test',
        { reason: 'Probe the active P11 ingestion endpoint.' },
        { idempotencyKey: testKey },
      );
      expect(tested.response.status, JSON.stringify(tested.body)).toBe(202);
      expect(tested.body).toMatchObject({
        operationType: 'evidence-export.test',
        status: 'succeeded',
      });
      const testReplay = await command(
        '/api/v1/evidence-export/test',
        { reason: 'Probe the active P11 ingestion endpoint.' },
        { idempotencyKey: testKey },
      );
      expect(testReplay.body).toEqual(tested.body);

      await waitFor(async () => {
        const authority = await controlPool.query<{
          revision_status: string | null;
          application_status: string | null;
          convergence_status: string | null;
          node_events: number;
        }>(
          `SELECT
             (SELECT status FROM sdar_control.configuration_revision
               WHERE configuration_id=$1 AND revision=$2) AS revision_status,
             (SELECT status FROM sdar_control.configuration_application
               WHERE configuration_id=$1 AND revision=$2 LIMIT 1) AS application_status,
             (SELECT convergence_status FROM sdar_control.configuration_target_state
               WHERE target_type='telemetry_link' AND target_id=$3) AS convergence_status,
             (SELECT count(*)::integer FROM sdar_control.node_event_outbox
               WHERE aggregate_id IN ($1,$3)) AS node_events`,
          [exportId, revision, controlNodeId],
        );
        const row = authority.rows[0];
        return (
          row?.revision_status === 'applied' &&
          row.application_status === 'applied' &&
          row.convergence_status === 'converged' &&
          row.node_events >= 2
        );
      });
      await expect(
        runtimePool.query<{
          active: number;
          lkg: number;
        }>(
          `SELECT
             count(*) FILTER (WHERE is_active)::integer AS active,
             count(*) FILTER (WHERE is_lkg)::integer AS lkg
           FROM evidence_export_configuration
           WHERE export_id=$1 AND revision=$2`,
          [exportId, revision],
        ),
      ).resolves.toMatchObject({ rows: [{ active: 1, lkg: 1 }] });

      const verticalRecordTypes = [
        'node_control.configuration_revision',
        'node_control.configuration_apply_ack',
        'node_control.configuration_lkg_transition',
        'node_control.management_operation',
        'node_control.audit_event',
        'node_control.node_event',
        'node_control.telemetry_configuration',
        'node_control.telemetry_delivery',
        'node_control.telemetry_ack',
      ] as const;
      try {
        await waitFor(async () => {
          const projected = await runtimePool.query<{ record_type: string }>(
            `SELECT DISTINCT record_type FROM evidence_outbox
              WHERE record_type=ANY($1::text[])`,
            [verticalRecordTypes],
          );
          const present = new Set(projected.rows.map((row) => row.record_type));
          if (!verticalRecordTypes.every((recordType) => present.has(recordType))) return false;
          const deliveredSelfObservations = await runtimePool.query<{ delivered: number }>(
            `SELECT count(*)::integer AS delivered FROM evidence_outbox
              WHERE record_type IN (
                'node_control.telemetry_delivery','node_control.telemetry_ack'
              ) AND observation_generation=1 AND acknowledged_at IS NOT NULL`,
          );
          return (deliveredSelfObservations.rows[0]?.delivered ?? 0) >= 2;
        }, 60_000);
      } catch (error) {
        const diagnostics = await runtimePool.query<{
          present_types: readonly string[];
          issues: readonly Readonly<{ recordType: string | null; issueCode: string }>[];
        }>(
          `SELECT
             ARRAY(SELECT DISTINCT record_type FROM evidence_outbox
               WHERE record_type=ANY($1::text[]) ORDER BY record_type) AS present_types,
             ARRAY(SELECT jsonb_build_object(
               'recordType',record_type,'issueCode',issue_code
             ) FROM evidence_projection_issue WHERE resolved_at IS NULL
               ORDER BY last_observed_at DESC LIMIT 20) AS issues`,
          [verticalRecordTypes],
        );
        throw new Error(
          `P11_VERTICAL_EVIDENCE_TIMEOUT:${JSON.stringify(diagnostics.rows[0] ?? {})}`,
          { cause: error },
        );
      }

      const verticalEvidence = await evidenceRows(verticalRecordTypes);
      expect(new Set(verticalEvidence.map((row) => row.record_type))).toEqual(
        new Set(verticalRecordTypes),
      );
      expect(
        verticalEvidence
          .filter((row) =>
            [
              'node_control.configuration_revision',
              'node_control.configuration_apply_ack',
              'node_control.configuration_lkg_transition',
              'node_control.management_operation',
              'node_control.audit_event',
              'node_control.node_event',
              'node_control.telemetry_configuration',
            ].includes(row.record_type),
          )
          .every((row) => row.source_system === 'node_control'),
      ).toBe(true);
      const telemetryEvidence = verticalEvidence.filter((row) =>
        ['node_control.telemetry_delivery', 'node_control.telemetry_ack'].includes(row.record_type),
      );
      expect(
        telemetryEvidence.every(
          (row) => row.source_system === 'runtime' && row.observation_generation === 1,
        ),
      ).toBe(true);
      expect(
        telemetryEvidence.some(
          (row) =>
            row.record_type === 'node_control.telemetry_delivery' && row.acknowledged_at !== null,
        ),
      ).toBe(true);
      expect(
        telemetryEvidence.some(
          (row) => row.record_type === 'node_control.telemetry_ack' && row.acknowledged_at !== null,
        ),
      ).toBe(true);

      const applyAck = requiredEvidence(verticalEvidence, 'node_control.configuration_apply_ack');
      const appliedConfiguration = requiredReferencedEvidence(verticalEvidence, applyAck);
      expect(appliedConfiguration).toMatchObject({
        record_type: 'node_control.configuration_revision',
        payload: { configurationId: exportId, revision, status: 'published' },
      });
      const lkgTransition = requiredEvidence(
        verticalEvidence,
        'node_control.configuration_lkg_transition',
      );
      expect(lkgTransition.evidence_refs).toContain(applyAck.record_id);
      const telemetryConfiguration = requiredEvidence(
        verticalEvidence,
        'node_control.telemetry_configuration',
      );
      const telemetryAcknowledgement = requiredEvidence(
        verticalEvidence,
        'node_control.telemetry_ack',
      );
      const telemetryDelivery = requiredReferencedEvidence(
        verticalEvidence,
        telemetryAcknowledgement,
      );
      expect(telemetryDelivery).toMatchObject({
        record_type: 'node_control.telemetry_delivery',
        observation_generation: 1,
      });
      expect(telemetryDelivery.evidence_refs).toEqual([telemetryConfiguration.record_id]);
      expect(telemetryAcknowledgement.evidence_refs).toEqual([telemetryDelivery.record_id]);

      const generationBoundary = await runtimePool.query<{
        generation_one: number;
        recursive_batches: number;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM evidence_outbox
             WHERE record_type IN (
               'node_control.telemetry_delivery','node_control.telemetry_ack'
             ) AND observation_generation=1) AS generation_one,
           (SELECT count(*)::integer FROM evidence_export_batch
             WHERE source_partition LIKE 'node-control:node_control.telemetry_delivery:%'
                OR source_partition LIKE 'node-control:node_control.telemetry_ack:%')
             AS recursive_batches`,
      );
      expect(generationBoundary.rows[0]?.generation_one).toBeGreaterThanOrEqual(2);
      expect(generationBoundary.rows[0]?.recursive_batches).toBe(0);
      expect(
        receivedEvidenceRecords.some((row) => row.recordId === telemetryDelivery.record_id),
      ).toBe(true);
      expect(
        receivedEvidenceRecords.some((row) => row.recordId === telemetryAcknowledgement.record_id),
      ).toBe(true);
      const exportedEvidenceText = JSON.stringify({
        persisted: verticalEvidence,
        delivered: receivedEvidenceRecords,
      }).toLowerCase();
      expect(exportedEvidenceText).not.toContain('credentialref');
      expect(exportedEvidenceText).not.toContain('p11_evidence_token');
      expect(exportedEvidenceText).not.toContain(credential.toLowerCase());

      const draftRevisionResult = await controlPool.query<{ next_revision: string }>(
        `SELECT (COALESCE(max(revision),0)+1)::text AS next_revision
       FROM sdar_control.configuration_revision
       WHERE target_type='telemetry_link'
         AND target_id=(
           SELECT target_id FROM sdar_control.configuration_revision
           WHERE configuration_id=$1 AND revision=$2
         )`,
        [exportId, revision],
      );
      const draftRevisionRow = draftRevisionResult.rows[0];
      if (draftRevisionRow === undefined) throw new Error('P11_DRAFT_REVISION_UNAVAILABLE');
      const draftRevision = Number(draftRevisionRow.next_revision);
      const newerDraft = await command(
        '/api/v1/evidence-export/revisions',
        {
          ...definition,
          endpointRef: 'http://127.0.0.1:1/unpublished',
          revision: draftRevision,
        },
        { idempotencyKey: `p11-create-newer-draft-${randomUUID()}` },
      );
      expect(newerDraft.response.status, JSON.stringify(newerDraft.body)).toBe(201);
      const activeTest = await command(
        '/api/v1/evidence-export/test',
        { reason: 'Probe the applied P11 revision, not the newer draft.' },
        { idempotencyKey: `p11-test-active-${randomUUID()}` },
      );
      expect(activeTest.body).toMatchObject({ status: 'succeeded' });

      const firstTask = await insertRuntimeFact('first');
      await waitFor(async () => {
        const deliveredTask = await runtimePool.query<{ delivered: boolean }>(
          `SELECT acknowledged_at IS NOT NULL AS delivered FROM evidence_outbox
            WHERE source_record_id=$1 AND record_type='runtime.episode'`,
          [firstTask],
        );
        return deliveredTask.rows[0]?.delivered === true;
      }, 30_000);
      let delivered: unknown;
      await waitFor(async () => {
        delivered = await publicGet('/api/v1/evidence-export/status');
        const status = delivered as { status?: string; pendingRecords?: number };
        return status.status === 'healthy' && status.pendingRecords === 0;
      });
      expect(delivered).toMatchObject({
        exportId,
        status: 'healthy',
        pendingRecords: 0,
      });

      const outboxPage = (await publicGet(
        `/api/v1/evidence-export/outbox?episodeId=${encodeURIComponent(firstTask)}&limit=10`,
      )) as {
        items?: readonly Readonly<{ recordId?: string; payload?: unknown }>[];
      };
      const replayRecord = outboxPage.items?.find((item) => item.recordId !== undefined);
      if (replayRecord?.recordId === undefined) throw new Error('P11_REPLAY_RECORD_MISSING');
      expect(replayRecord).not.toHaveProperty('payload');
      const replayKey = `p11-evidence-replay-${randomUUID()}`;
      const replayed = await command(
        '/api/v1/evidence-export/replays',
        {
          scope: 'record',
          recordId: replayRecord.recordId,
          reason: 'Re-deliver one acknowledged canonical Evidence record.',
        },
        { idempotencyKey: replayKey },
      );
      expect(replayed.response.status, JSON.stringify(replayed.body)).toBe(200);
      expect(replayed.body).toMatchObject({
        operationType: 'evidence.replay',
        status: 'succeeded',
      });
      await waitFor(async () => {
        const redelivered = await runtimePool.query<{ delivered: boolean }>(
          `SELECT acknowledged_at IS NOT NULL AS delivered FROM evidence_outbox
            WHERE record_id=$1`,
          [replayRecord.recordId],
        );
        return redelivered.rows[0]?.delivered === true;
      });
      const replayGovernance = await controlPool.query<{
        operations: number;
        audits: number;
        operation_id: string | null;
      }>(
        `SELECT
             (SELECT count(*)::integer FROM sdar_control.management_operation
               WHERE operation_type='evidence.replay') AS operations,
             (SELECT max(operation_id) FROM sdar_control.management_operation
               WHERE operation_type='evidence.replay') AS operation_id,
             (SELECT count(*)::integer FROM sdar_control.control_audit_event
               WHERE action='evidence.replay'
                 AND aggregate_id=$1) AS audits`,
        [replayRecord.recordId],
      );
      expect(replayGovernance.rows).toMatchObject([{ operations: 1, audits: 2 }]);
      const replayOperationId = replayGovernance.rows[0]?.operation_id;
      if (replayOperationId === null || replayOperationId === undefined)
        throw new Error('P11_REPLAY_OPERATION_ID_MISSING');
      await waitFor(async () => {
        const projectedOperation = await runtimePool.query<{ delivered: boolean }>(
          `SELECT acknowledged_at IS NOT NULL AS delivered FROM evidence_outbox
            WHERE record_type='node_control.management_operation' AND source_record_id=$1`,
          [replayOperationId],
        );
        return projectedOperation.rows[0]?.delivered === true;
      });

      if (ingestion === undefined) throw new Error('P11_INGESTION_NOT_STARTED');
      await close(ingestion);
      const outageTask = await insertRuntimeFact('outage');
      await waitFor(async () => {
        const status = (await publicGet('/api/v1/evidence-export/status')) as {
          status?: string;
          pendingRecords?: number;
        };
        return status.status === 'degraded' && (status.pendingRecords ?? 0) >= 1;
      });
      await waitFor(async () => {
        const failure = await runtimePool.query<{ last_error_code: string | null }>(
          `SELECT last_error_code FROM evidence_export_state
           WHERE export_id=$1 AND last_error_code='EVIDENCE_ENDPOINT_UNAVAILABLE'
           ORDER BY last_error_at DESC NULLS LAST LIMIT 1`,
          [exportId],
        );
        return failure.rows[0]?.last_error_code === 'EVIDENCE_ENDPOINT_UNAVAILABLE';
      });
      await expect(
        runtimePool.query<{ phase: string }>(
          `SELECT phase FROM agent_task WHERE task_id=ANY($1::text[]) ORDER BY task_id`,
          [[firstTask, outageTask]],
        ),
      ).resolves.toMatchObject({ rows: [{ phase: 'completed' }, { phase: 'completed' }] });
      const authority = await runtimePool.query<{
        active: number;
        lkg: number;
        pending: number;
        last_error_code: string | null;
      }>(
        `SELECT
         (SELECT count(*)::integer FROM evidence_export_configuration WHERE is_active) AS active,
         (SELECT count(*)::integer FROM evidence_export_configuration WHERE is_lkg) AS lkg,
         (SELECT count(*)::integer FROM evidence_outbox
           WHERE source_record_id=$2 AND record_type='runtime.episode'
             AND acknowledged_at IS NULL) AS pending,
         (SELECT last_error_code FROM evidence_export_state
           WHERE export_id=$1 AND last_error_code='EVIDENCE_ENDPOINT_UNAVAILABLE'
           ORDER BY last_error_at DESC NULLS LAST LIMIT 1) AS last_error_code`,
        [exportId, outageTask],
      );
      expect(authority.rows).toEqual([
        {
          active: 1,
          lkg: 1,
          pending: 1,
          last_error_code: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
        },
      ]);
      const controlAudit = await controlPool.query<{ operations: number; audits: number }>(
        `SELECT
         (SELECT count(*)::integer FROM sdar_control.management_operation
           WHERE target_id=$1 AND operation_type='evidence-export.test') AS operations,
         (SELECT count(*)::integer FROM sdar_control.control_audit_event
           WHERE aggregate_id=$1 || ':' || $2::text AND action='evidence-export.test') AS audits`,
        [exportId, revision],
      );
      expect(controlAudit.rows).toEqual([{ operations: 2, audits: 2 }]);
    }, 120_000);
  },
);

async function evidenceRows(recordTypes: readonly string[]): Promise<readonly EvidenceRow[]> {
  const result = await runtimePool.query<EvidenceRow>(
    `SELECT record_id,record_type,source_system,source_record_id,
            observation_generation,evidence_refs,payload,acknowledged_at
       FROM evidence_outbox
      WHERE record_type=ANY($1::text[])
      ORDER BY sequence`,
    [recordTypes],
  );
  return result.rows;
}

function requiredEvidence(rows: readonly EvidenceRow[], recordType: string): EvidenceRow {
  const row = rows.find((candidate) => candidate.record_type === recordType);
  if (row === undefined) throw new Error(`P09_EVIDENCE_MISSING:${recordType}`);
  return row;
}

function requiredReferencedEvidence(
  rows: readonly EvidenceRow[],
  referencing: EvidenceRow,
): EvidenceRow {
  const reference = referencing.evidence_refs[0];
  const row = rows.find((candidate) => candidate.record_id === reference);
  if (row === undefined) {
    throw new Error(`P09_EVIDENCE_REFERENCE_MISSING:${referencing.record_type}`);
  }
  return row;
}

async function command(
  path: string,
  body: unknown,
  headers: Readonly<{ idempotencyKey: string; etag?: string }>,
): Promise<Readonly<{ response: Response; body: Record<string, unknown> }>> {
  if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
  const response = await fetch(`${control.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': headers.idempotencyKey,
      ...(headers.etag === undefined ? {} : { 'if-match': headers.etag }),
    },
    body: JSON.stringify(body),
  });
  return Object.freeze({ response, body: (await response.json()) as Record<string, unknown> });
}

async function publicGet(path: string): Promise<unknown> {
  if (control === undefined) throw new Error('P11_CONTROL_NOT_STARTED');
  const response = await fetch(`${control.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function insertRuntimeFact(suffix: string): Promise<string> {
  const id = randomUUID();
  const contextId = `context-p11-${id}`;
  const taskId = `task-p11-${suffix}-${id}`;
  const occurredAt = new Date().toISOString();
  await runtimePool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES ($1,'user-p11',$2,$2)`,
    [contextId, occurredAt],
  );
  await runtimePool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,created_at,updated_at)
     VALUES ($1,$2,'user-p11','completed','completed','P11 request','{}'::jsonb,$3,$3)`,
    [taskId, contextId, occurredAt],
  );
  await evidence.append(
    createCatalogEvidenceEnvelope({
      recordType: 'runtime.episode',
      sourceRecordId: taskId,
      sourceRevision: occurredAt,
      environment: 'integration',
      correlationId: contextId,
      occurredAt,
      recordedAt: occurredAt,
      taskId,
      contextId,
      episodeId: taskId,
      payload: { episodeId: taskId, taskId, status: 'completed' },
    }),
    occurredAt,
    'runtime:episodes',
  );
  return taskId;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('P11_WAIT_TIMEOUT');
}

function requiredResponseHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value === '') throw new Error(`P11_${name.toUpperCase()}_MISSING`);
  return value;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function address(server: Server): string {
  const value = server.address();
  if (value === null || typeof value === 'string') throw new Error('P11_ADDRESS_INVALID');
  return `http://127.0.0.1:${String(value.port)}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
