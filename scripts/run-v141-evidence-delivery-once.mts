import process from 'node:process';

import { Pool } from 'pg';

import { hashCanonicalEvidenceJson } from '../packages/domain/src/index.js';

import {
  EvidenceOperationsService,
  RuntimeEvidenceExportService,
} from '../packages/runtime-control-application/src/index.js';
import {
  PostgresEvidenceOperationsRepository,
  PostgresRuntimeEvidenceExportStore,
} from '../packages/runtime-control-persistence-postgres/src/index.js';
import {
  EnvironmentEvidenceCredentialResolver,
  HttpEvidenceExportTransport,
} from '../packages/evidence-export-adapter/src/index.js';

/**
 * Offline Evidence maintenance only. The full Runtime exporter must remain stopped for the whole
 * invocation; this process deliberately never composes Task, workflow, MCP, model or A2A workers.
 */
const RETRY_OPEN_DEAD_LETTERS = '--retry-open-dead-letters';
const MAX_DEAD_LETTERS = 10_000;
const DEFAULT_TIMEOUT_MS = 180_000;

interface DeliverySummary {
  readonly operationId: string;
  readonly exportId: string;
  readonly revision: number;
  readonly openDeadLettersBefore: number;
  readonly requeuedRecords: number;
  readonly deliveredRecords: number;
  readonly drainCycles: number;
  readonly pendingRecords: number;
  readonly deadLetterRecords: number;
  readonly acknowledgedFrontier?: string;
  readonly highWatermarkActive: boolean;
}

const postgresUrl = requiredEnvironment('SDAR_POSTGRES_URL');
const operationId = requiredEnvironment('SDAR_EVIDENCE_DELIVERY_OPERATION_ID');
if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(operationId)) fail('EVIDENCE_DELIVERY_OPERATION_ID_INVALID');
const expectedExportId = requiredEnvironment('SDAR_EVIDENCE_DELIVERY_EXPECTED_EXPORT_ID');
const allowedOrigin = normalizedOrigin(
  requiredEnvironment('SDAR_EVIDENCE_DELIVERY_ALLOWED_ORIGIN'),
);
const retryOpenDeadLetters = process.argv.includes(RETRY_OPEN_DEAD_LETTERS);
const unsupportedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== RETRY_OPEN_DEAD_LETTERS);
if (unsupportedArguments.length > 0) fail('EVIDENCE_DELIVERY_ARGUMENT_INVALID');

const timeoutMs = optionalPositiveInteger(
  process.env['SDAR_EVIDENCE_DELIVERY_TIMEOUT_MS'],
  DEFAULT_TIMEOUT_MS,
);
const deadline = Date.now() + timeoutMs;
const pool = new Pool({
  connectionString: postgresUrl,
  max: 1,
  idleTimeoutMillis: 0,
  connectionTimeoutMillis: Math.min(5_000, timeoutMs),
  statement_timeout: Math.min(10_000, timeoutMs),
  query_timeout: Math.min(15_000, timeoutMs),
});
let lockAcquired = false;
let lockBackendPid: number | undefined;
let openDeadLettersBefore = 0;
let requeuedRecords = 0;
let deliveredRecords = 0;
let drainCycles = 0;
let lastStatus: Awaited<ReturnType<EvidenceOperationsService['status']>> | undefined;

try {
  const store = new PostgresRuntimeEvidenceExportStore(pool);
  assertBeforeDeadline(deadline);
  const initialConfiguration = await store.findActive();
  assertBeforeDeadline(deadline);
  if (initialConfiguration === undefined) fail('EVIDENCE_DELIVERY_ACTIVE_CONFIGURATION_REQUIRED');
  if (initialConfiguration.exportId !== expectedExportId)
    fail('EVIDENCE_DELIVERY_EXPORT_ID_MISMATCH');
  if (normalizedOrigin(initialConfiguration.endpointRef) !== allowedOrigin)
    fail('EVIDENCE_DELIVERY_ORIGIN_MISMATCH');

  const credentialVariable = /^env:([A-Z][A-Z0-9_]{0,127})$/u.exec(
    initialConfiguration.credentialRef,
  )?.[1];
  if (credentialVariable === undefined || process.env[credentialVariable] === undefined)
    fail('EVIDENCE_DELIVERY_CREDENTIAL_UNAVAILABLE');

  const transport = new HttpEvidenceExportTransport(
    new EnvironmentEvidenceCredentialResolver(),
    5_000,
    false,
  );

  assertBeforeDeadline(deadline);
  await acquireDeliveryLocks();
  assertBeforeDeadline(deadline);
  const configuration = await store.findActive();
  assertBeforeDeadline(deadline);
  if (
    configuration === undefined ||
    hashCanonicalEvidenceJson(configuration) !== hashCanonicalEvidenceJson(initialConfiguration)
  )
    fail('EVIDENCE_DELIVERY_CONFIGURATION_CHANGED');

  // Probe under the same configuration lock used by apply/recovery, before any durable write.
  await transport.probe(configuration);
  assertBeforeDeadline(deadline);

  const operations = new EvidenceOperationsService(new PostgresEvidenceOperationsRepository(pool));
  lastStatus = await operations.status();
  assertBeforeDeadline(deadline);
  await assertNoConcurrentDeliveryLease();
  assertBeforeDeadline(deadline);
  if (!retryOpenDeadLetters && lastStatus.deadLetterRecords > 0)
    fail('EVIDENCE_DELIVERY_DEAD_LETTER_RETRY_REQUIRED');
  if (retryOpenDeadLetters) await assertOpenDeadLettersInActiveScope(lastStatus.deadLetterRecords);
  assertBeforeDeadline(deadline);
  const deadLetters = retryOpenDeadLetters ? await listOpenDeadLetters(operations, deadline) : [];
  if (deadLetters.length !== lastStatus.deadLetterRecords)
    fail('EVIDENCE_DELIVERY_DEAD_LETTER_SET_CHANGED');
  openDeadLettersBefore = deadLetters.length;
  for (const deadLetter of deadLetters) {
    assertBeforeDeadline(deadline);
    const idempotencyKeyHash = hashCanonicalEvidenceJson({
      operation: 'retry_dead_letter',
      deadLetterId: deadLetter.deadLetterId,
      requeueCount: deadLetter.requeueCount,
      deliveryOperationId: operationId,
      exportId: configuration.exportId,
      configurationRevision: configuration.revision,
    });
    const identity = idempotencyKeyHash.slice('sha256:'.length);
    const recovered = await operations.recover({
      operation: 'retry_dead_letter',
      deadLetterId: deadLetter.deadLetterId,
      operationId: `evidence-delivery-once:${operationId}:${identity}`,
      idempotencyKeyHash,
      actorId: 'sdar-evidence-delivery-once',
      reason: 'Retry an open Evidence dead letter after the configured receiver passed probe.',
      requestedAt: new Date().toISOString(),
    });
    if (recovered.status !== 'succeeded')
      fail(recovered.errorCode ?? 'EVIDENCE_DELIVERY_RECOVERY_FAILED');
    requeuedRecords += recovered.affectedRecords;
    lastStatus = await operations.status();
  }

  const exporter = new RuntimeEvidenceExportService({
    store,
    transport,
    clock: { now: () => new Date().toISOString() },
    actorId: 'sdar-evidence-delivery-once',
    workerId: `sdar-evidence-delivery-once:${process.pid}`,
  });
  let status = await operations.status();
  lastStatus = status;
  if (status.deadLetterRecords > 0) fail('EVIDENCE_DELIVERY_DEAD_LETTER_REMAINING');
  while (status.pendingRecords > 0) {
    assertBeforeDeadline(deadline);
    const result = await exporter.drain(1_000);
    drainCycles += 1;
    deliveredRecords += result.delivered;
    status = await operations.status();
    lastStatus = status;
    if (status.deadLetterRecords > 0) fail('EVIDENCE_DELIVERY_NEW_DEAD_LETTER');
    if (result.delivered === 0 && status.pendingRecords > 0) await delay(250);
  }

  const summary: DeliverySummary = {
    operationId,
    exportId: configuration.exportId,
    revision: configuration.revision,
    openDeadLettersBefore,
    requeuedRecords,
    deliveredRecords,
    drainCycles,
    pendingRecords: status.pendingRecords,
    deadLetterRecords: status.deadLetterRecords,
    ...(status.globalAcknowledgedFrontier === undefined
      ? {}
      : { acknowledgedFrontier: status.globalAcknowledgedFrontier }),
    highWatermarkActive: status.highWatermarkActive,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      event: 'evidence_delivery_once.failed',
      errorCode: safeErrorCode(error),
      operationId,
      openDeadLettersBefore,
      requeuedRecords,
      deliveredRecords,
      drainCycles,
      pendingRecords: lastStatus?.pendingRecords ?? null,
      deadLetterRecords: lastStatus?.deadLetterRecords ?? null,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (lockAcquired) await releaseDeliveryLocks().catch(() => undefined);
  await pool.end();
}

async function listOpenDeadLetters(
  operations: EvidenceOperationsService,
  deadlineAt: number,
): Promise<readonly { readonly deadLetterId: string; readonly requeueCount: number }[]> {
  const result: { deadLetterId: string; requeueCount: number }[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    assertBeforeDeadline(deadlineAt);
    const page = await operations.deadLetters({
      limit: 200,
      openOnly: true,
      ...(cursor === undefined ? {} : { cursor }),
    });
    result.push(
      ...page.items.map(({ deadLetterId, requeueCount }) => ({ deadLetterId, requeueCount })),
    );
    if (result.length > MAX_DEAD_LETTERS) fail('EVIDENCE_DELIVERY_DEAD_LETTER_LIMIT_EXCEEDED');
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) fail('EVIDENCE_DELIVERY_DEAD_LETTER_CURSOR_LOOP');
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);
  return Object.freeze(result);
}

async function acquireDeliveryLocks(): Promise<void> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{
      backend_pid: number;
      invocation_acquired: boolean;
      configuration_acquired: boolean;
    }>(
      `SELECT pg_backend_pid() AS backend_pid,
              pg_try_advisory_lock(
                hashtextextended('sdar:v141:evidence-only-recovery-export',0)
              ) AS invocation_acquired,
              pg_try_advisory_lock(hashtext('runtime.evidence-export'))
                AS configuration_acquired`,
    );
    const row = lock.rows[0];
    if (row?.invocation_acquired !== true || row.configuration_acquired !== true) {
      if (row?.invocation_acquired === true)
        await client.query(
          `SELECT pg_advisory_unlock(
             hashtextextended('sdar:v141:evidence-only-recovery-export',0)
           )`,
        );
      if (row?.configuration_acquired === true)
        await client.query(`SELECT pg_advisory_unlock(hashtext('runtime.evidence-export'))`);
      fail('EVIDENCE_DELIVERY_ALREADY_RUNNING');
    }
    lockAcquired = true;
    lockBackendPid = row.backend_pid;
  } finally {
    client.release();
  }
}

async function releaseDeliveryLocks(): Promise<void> {
  const client = await pool.connect();
  try {
    const backend = await client.query<{ backend_pid: number }>(
      'SELECT pg_backend_pid() AS backend_pid',
    );
    if (backend.rows[0]?.backend_pid !== lockBackendPid)
      fail('EVIDENCE_DELIVERY_LOCK_SESSION_LOST');
    await client.query(
      `SELECT pg_advisory_unlock(hashtext('runtime.evidence-export')),
              pg_advisory_unlock(
                hashtextextended('sdar:v141:evidence-only-recovery-export',0)
              )`,
    );
  } finally {
    client.release();
  }
}

async function assertNoConcurrentDeliveryLease(): Promise<void> {
  const result = await pool.query<{ active_leases: number }>(
    `SELECT count(*)::integer AS active_leases
     FROM evidence_export_state
     WHERE lease_owner IS NOT NULL AND lease_expires_at > clock_timestamp()`,
  );
  if (result.rows[0]?.active_leases !== 0) fail('EVIDENCE_DELIVERY_ACTIVE_LEASE_PRESENT');
}

async function assertOpenDeadLettersInActiveScope(expectedOpen: number): Promise<void> {
  const result = await pool.query<{ open_count: number; outside_scope: number }>(
    `SELECT count(*)::integer AS open_count,
            count(*) FILTER (WHERE NOT (
              configuration.definition->'includedFamilies' ? evidence.record_family
              AND NOT (
                evidence.evaluation_role='diagnostic'
                AND COALESCE(
                  configuration.definition->'excludedDiagnosticTypes','[]'::jsonb
                ) ? evidence.record_type
              )
            ))::integer AS outside_scope
     FROM evidence_dead_letter dead_letter
     JOIN evidence_outbox evidence ON evidence.sequence=dead_letter.sequence
     JOIN evidence_export_configuration configuration ON configuration.is_active
     WHERE dead_letter.requeued_at IS NULL`,
  );
  const row = result.rows[0];
  if (row?.open_count !== expectedOpen) fail('EVIDENCE_DELIVERY_DEAD_LETTER_SET_CHANGED');
  if (row.outside_scope !== 0) fail('EVIDENCE_DELIVERY_DEAD_LETTER_OUTSIDE_ACTIVE_SCOPE');
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') fail(`EVIDENCE_DELIVERY_${name}_REQUIRED`);
  return value;
}

function normalizedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('EVIDENCE_DELIVERY_ORIGIN_INVALID');
  }
  if (url.username !== '' || url.password !== '') fail('EVIDENCE_DELIVERY_ORIGIN_INVALID');
  return url.origin;
}

function optionalPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000 || parsed > 900_000)
    fail('EVIDENCE_DELIVERY_TIMEOUT_INVALID');
  return parsed;
}

function assertBeforeDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) fail('EVIDENCE_DELIVERY_TIMEOUT');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code)) return code;
  }
  return error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
    ? error.message
    : 'EVIDENCE_DELIVERY_FAILED';
}

function fail(code: string): never {
  const error = new Error(code);
  Object.assign(error, { code });
  throw error;
}
