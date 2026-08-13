import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  SMPP_UNAUTHENTICATED_CREDENTIAL_REF,
  createSmppRegistrySource,
  smppCandidateIdentity,
  type SmppRegistrySource,
} from '../../../packages/node-control-domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const SECRET_REFERENCE = /^secret:\/\/[A-Za-z0-9._~:/-]+$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,62}$/u;
const PROJECTION_CONTRACT = 'sdar-registry-v1' as const;

export interface UgvSmppSourceBootstrapConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlAdminToken: string;
  readonly smppSourceId: string;
  readonly sourceName?: string;
  readonly smppEnvironment: string;
  readonly registryEndpoint: string;
  readonly registryCredentialRef: string;
  readonly syncMode: 'manual' | 'poll';
  readonly snapshotTtlSeconds: number;
  readonly lkgPolicy: 'allow_unexpired' | 'deny_when_unavailable';
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly runId: string;
}

export interface UgvSmppSourceBootstrapReport {
  readonly schemaVersion: 'sdar.ugv-smpp-source-bootstrap/v1';
  readonly status: 'passed';
  readonly evidenceClass: 'real_public_api';
  readonly observedAt: string;
  readonly sourceAction: 'created' | 'reused';
  readonly sourceIdentitySha256: string;
  readonly intendedTupleSha256: string;
  readonly authenticationMode: 'none' | 'bearer_secret_ref';
  readonly sourceSyncMode: 'manual' | 'poll';
  readonly sourceRevision: number;
  readonly snapshotRevision: number;
  readonly snapshotChecksum: string;
  readonly snapshotValidUntil: string;
  readonly nativeRegistryRevision: number;
  readonly nativeRegistryChecksum: string;
  readonly registryProjectionContract: typeof PROJECTION_CONTRACT;
  readonly candidateCount: 1;
  readonly initialSyncOutcome: 'applied' | 'not_modified';
  readonly conditionalSyncOutcome: 'not_modified';
  readonly conditionalValidity: 'extended' | 'unchanged';
  readonly checks: readonly string[];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    credentialReferencesIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

export class UgvSmppSourceBootstrapError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvSmppSourceBootstrapError';
    this.code = code;
  }
}

const SourceSchema = z
  .object({
    smppSourceId: z.string().min(1),
    name: z.string().min(1).optional(),
    registryEndpoint: z.string().min(1),
    credentialRef: z.string().min(1),
    tenantId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    environment: z.string().min(1),
    syncMode: z.enum(['manual', 'poll', 'watch']),
    snapshotTtlSeconds: z.number().int().positive(),
    lkgPolicy: z.enum(['allow_unexpired', 'deny_when_unavailable']),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    activeSnapshotRevision: z.number().int().positive().optional(),
    activeSnapshotChecksum: z.string().regex(CHECKSUM).optional(),
    activeSnapshotValidUntil: z.iso.datetime().optional(),
    lastSyncAt: z.iso.datetime().optional(),
    lastErrorCode: z.string().min(1).optional(),
    revision: z.number().int().positive(),
  })
  .strict();

const SourceListSchema = z
  .object({
    items: z.array(SourceSchema),
    totalEstimate: z.number().int().nonnegative(),
    asOf: z.iso.datetime(),
  })
  .strict();

const CandidateSchema = z
  .object({
    smppSourceId: z.string().min(1),
    externalProviderId: z.string().min(1),
    externalServerId: z.string().min(1),
    compositeIdentity: z.string().min(1),
    serverEndpoint: z.string().min(1),
    displayName: z.string().min(1).optional(),
    catalogRevision: z.string().regex(/^[1-9][0-9]*$/u),
    labels: z
      .object({
        environment: z.string().regex(ENVIRONMENT),
        protocolMode: z.literal('frozen_v1'),
      })
      .strict(),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    registryEtag: z.string().min(1),
    registryValidUntil: z.iso.datetime(),
    nativeRegistryRevision: z.number().int().positive(),
    nativeRegistryChecksum: z.string().regex(CHECKSUM),
    registryProjectionContract: z.literal(PROJECTION_CONTRACT),
  })
  .strict();

const CandidateListSchema = z
  .object({
    items: z.array(CandidateSchema),
    totalEstimate: z.number().int().nonnegative(),
    asOf: z.iso.datetime(),
  })
  .strict();

const OperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationType: z.literal('smpp_source.sync'),
    target: z
      .object({
        type: z.literal('smpp_source'),
        id: z.string().min(1),
        revision: z.number().int().positive().optional(),
      })
      .loose(),
    status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
    result: z.record(z.string(), z.unknown()).optional(),
    errorCode: z.string().min(1).optional(),
  })
  .loose();

const AuditSchema = z
  .object({
    auditId: z.string().min(1),
    action: z.string().min(1),
    aggregateType: z.string().min(1),
    aggregateId: z.string().min(1),
    reason: z.string().min(1),
    resultCode: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .loose();

const AuditListSchema = z
  .object({
    items: z.array(AuditSchema),
    totalEstimate: z.number().int().nonnegative(),
    asOf: z.iso.datetime(),
  })
  .strict();

type Source = z.infer<typeof SourceSchema>;
type Candidate = z.infer<typeof CandidateSchema>;
type Operation = z.infer<typeof OperationSchema>;

export async function bootstrapUgvSmppSource(
  input: UgvSmppSourceBootstrapConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<UgvSmppSourceBootstrapReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const observedAt = validTimestamp(
    dependencies.now?.() ?? new Date().toISOString(),
    'DRIVER_CLOCK_INVALID',
  );
  const expected = expectedSource(configuration);

  const listed = await controlGet(
    configuration,
    '/api/v1/smpp-sources?pageSize=200',
    SourceListSchema,
    request,
  );
  const listedMatches = listed.items.filter(
    (source) => source.smppSourceId === configuration.smppSourceId,
  );
  if (listedMatches.length > 1)
    fail('SOURCE_IDENTITY_NOT_UNIQUE', 'The Source list contains a duplicate source identity.');

  const direct = await controlGetOptionalSource(configuration, request);
  if (listedMatches.length === 1 && direct === undefined)
    fail('SOURCE_AUTHORITY_INCONSISTENT', 'List and direct Source authorities disagree.');
  const listedSource = listedMatches[0];
  if (
    listedSource !== undefined &&
    direct !== undefined &&
    !sourceAuthoritiesEqual(listedSource, direct)
  )
    fail('SOURCE_AUTHORITY_INCONSISTENT', 'List and direct Source authorities disagree.');

  let sourceAction: UgvSmppSourceBootstrapReport['sourceAction'];
  let source = direct;
  if (source === undefined) {
    sourceAction = 'created';
    source = await controlPost(
      configuration,
      '/api/v1/smpp-sources',
      `${configuration.runId}-source-create`,
      expected,
      SourceSchema,
      201,
      request,
    );
  } else {
    sourceAction = 'reused';
  }
  assertImmutableSourceConfiguration(source, expected);
  if (source.status !== 'draft' && source.status !== 'active')
    fail('SOURCE_STATUS_NOT_RECONCILABLE', 'The existing Source is not draft or active.');
  const initialSnapshotRequired = source.status === 'draft';

  const initialReason = `UGV SMPP Source initial synchronization (${configuration.runId}).`;
  const initialOperation = await synchronize(
    configuration,
    `${configuration.runId}-source-sync-initial`,
    initialReason,
    request,
  );
  const initialAuditOutcome = await requireSyncAuditOutcome(
    configuration,
    initialReason,
    initialSnapshotRequired ? ['applied'] : ['applied', 'not_modified'],
    request,
  );
  assertSyncOperation(initialOperation, configuration.smppSourceId);

  const afterInitial = await requireActiveSource(configuration, expected, observedAt, request);
  const initialCandidates = await requireExactCandidateAuthority(
    configuration,
    afterInitial,
    observedAt,
    request,
  );
  const initialCandidate = initialCandidates[0];
  assertSyncOperationAuthority(initialOperation, afterInitial, initialCandidate);

  const conditionalReason = `UGV SMPP Source conditional revalidation (${configuration.runId}).`;
  const conditionalOperation = await synchronize(
    configuration,
    `${configuration.runId}-source-sync-conditional`,
    conditionalReason,
    request,
  );
  assertSyncOperation(conditionalOperation, configuration.smppSourceId);
  await requireSyncAuditOutcome(configuration, conditionalReason, ['not_modified'], request);

  const afterConditional = await requireActiveSource(configuration, expected, observedAt, request);
  const conditionalCandidates = await requireExactCandidateAuthority(
    configuration,
    afterConditional,
    observedAt,
    request,
  );
  const conditionalCandidate = conditionalCandidates[0];
  assertSyncOperationAuthority(conditionalOperation, afterConditional, conditionalCandidate);
  assertConditionalAuthorityUnchanged(
    afterInitial,
    initialCandidate,
    afterConditional,
    conditionalCandidate,
  );

  const initialValidUntil = requiredActiveValidUntil(afterInitial);
  const conditionalValidUntil = requiredActiveValidUntil(afterConditional);
  const conditionalValidity =
    Date.parse(conditionalValidUntil) > Date.parse(initialValidUntil) ? 'extended' : 'unchanged';

  return Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-source-bootstrap/v1',
    status: 'passed',
    evidenceClass: 'real_public_api',
    observedAt,
    sourceAction,
    sourceIdentitySha256: sha256(configuration.smppSourceId),
    intendedTupleSha256: sha256(
      [
        configuration.smppSourceId,
        configuration.externalProviderId,
        configuration.externalServerId,
      ].join('\u0000'),
    ),
    authenticationMode:
      configuration.registryCredentialRef === SMPP_UNAUTHENTICATED_CREDENTIAL_REF
        ? 'none'
        : 'bearer_secret_ref',
    sourceSyncMode: configuration.syncMode,
    sourceRevision: afterConditional.revision,
    snapshotRevision: requiredActiveRevision(afterConditional),
    snapshotChecksum: requiredActiveChecksum(afterConditional),
    snapshotValidUntil: conditionalValidUntil,
    nativeRegistryRevision: conditionalCandidate.nativeRegistryRevision,
    nativeRegistryChecksum: conditionalCandidate.nativeRegistryChecksum,
    registryProjectionContract: conditionalCandidate.registryProjectionContract,
    candidateCount: 1,
    initialSyncOutcome: initialAuditOutcome,
    conditionalSyncOutcome: 'not_modified',
    conditionalValidity,
    checks: Object.freeze([
      'public_source_list_and_direct_read',
      'immutable_source_configuration',
      'source_active_current_pointer',
      'sync_operation_succeeded',
      'exact_ugv_only_candidate_tuple',
      'projection_and_native_lineage_complete',
      'persisted_snapshot_fresh',
      'conditional_304_audit_outcome',
      'conditional_revision_checksum_lineage_unchanged',
      'conditional_validity_not_shortened',
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
}

export function ugvSmppSourceBootstrapConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): UgvSmppSourceBootstrapConfiguration {
  const sourceName = optionalEnvironment(environment, 'SMPP_SDAR_SOURCE_NAME', 256);
  const tenantId = optionalEnvironment(environment, 'SMPP_SDAR_TENANT_ID', 256);
  const projectId = optionalEnvironment(environment, 'SMPP_SDAR_PROJECT_ID', 256);
  return validateConfiguration({
    nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL', 2_048),
    nodeControlAdminToken: requiredEnvironment(environment, 'SDAR_CONTROL_API_TOKEN', 4_096),
    smppSourceId: requiredEnvironment(environment, 'SMPP_SDAR_SOURCE_ID', 256),
    ...(sourceName === undefined ? {} : { sourceName }),
    smppEnvironment: requiredEnvironment(environment, 'SMPP_ENVIRONMENT', 63),
    registryEndpoint: requiredEnvironment(environment, 'SMPP_SDAR_REGISTRY_ENDPOINT', 2_048),
    registryCredentialRef: requiredEnvironment(environment, 'SMPP_REGISTRY_CREDENTIAL_REF', 512),
    syncMode: optionalSyncMode(environment),
    snapshotTtlSeconds: optionalPositiveInteger(
      environment,
      'SMPP_SDAR_SNAPSHOT_TTL_SECONDS',
      300,
      1,
      2_592_000,
    ),
    lkgPolicy: optionalLkgPolicy(environment),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(projectId === undefined ? {} : { projectId }),
    externalProviderId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_PROVIDER_ID', 256),
    externalServerId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_SERVER_ID', 256),
    runId: requiredEnvironment(environment, 'SDAR_UGV_BOOTSTRAP_RUN_ID', 128),
  });
}

function validateConfiguration(
  input: UgvSmppSourceBootstrapConfiguration,
): UgvSmppSourceBootstrapConfiguration {
  const nodeControlBaseUrl = managementBaseUrl(input.nodeControlBaseUrl);
  const nodeControlAdminToken = bounded(input.nodeControlAdminToken, 'admin token', 32, 4_096);
  const smppSourceId = bounded(input.smppSourceId, 'Source ID', 1, 256);
  const sourceName = optionalBounded(input.sourceName, 'Source name', 256);
  const smppEnvironment = bounded(input.smppEnvironment, 'SMPP environment', 1, 63);
  if (!ENVIRONMENT.test(smppEnvironment))
    fail('DRIVER_CONFIGURATION_INVALID', 'SMPP environment is invalid.');
  const registryEndpoint = normalizedEndpoint(input.registryEndpoint);
  const registryCredentialRef = bounded(input.registryCredentialRef, 'credential ref', 1, 512);
  if (
    registryCredentialRef !== SMPP_UNAUTHENTICATED_CREDENTIAL_REF &&
    !SECRET_REFERENCE.test(registryCredentialRef)
  )
    fail(
      'DRIVER_CONFIGURATION_INVALID',
      `Registry credential authority must be an opaque SecretRef or ${SMPP_UNAUTHENTICATED_CREDENTIAL_REF}.`,
    );
  if (!['manual', 'poll'].includes(input.syncMode))
    fail('DRIVER_CONFIGURATION_INVALID', 'Source sync mode must be manual or poll.');
  if (
    !Number.isInteger(input.snapshotTtlSeconds) ||
    input.snapshotTtlSeconds < 1 ||
    input.snapshotTtlSeconds > 2_592_000
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Snapshot TTL is invalid.');
  if (!['allow_unexpired', 'deny_when_unavailable'].includes(input.lkgPolicy))
    fail('DRIVER_CONFIGURATION_INVALID', 'LKG policy is invalid.');
  const tenantId = optionalBounded(input.tenantId, 'tenant ID', 256);
  const projectId = optionalBounded(input.projectId, 'project ID', 256);
  const externalProviderId = bounded(input.externalProviderId, 'external Provider ID', 1, 256);
  const externalServerId = bounded(input.externalServerId, 'external Server ID', 1, 256);
  const runId = bounded(input.runId, 'run ID', 8, 128);
  if (!RUN_ID.test(runId)) fail('DRIVER_CONFIGURATION_INVALID', 'Run ID is invalid.');
  return Object.freeze({
    nodeControlBaseUrl,
    nodeControlAdminToken,
    smppSourceId,
    ...(sourceName === undefined ? {} : { sourceName }),
    smppEnvironment,
    registryEndpoint,
    registryCredentialRef,
    syncMode: input.syncMode,
    snapshotTtlSeconds: input.snapshotTtlSeconds,
    lkgPolicy: input.lkgPolicy,
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(projectId === undefined ? {} : { projectId }),
    externalProviderId,
    externalServerId,
    runId,
  });
}

function expectedSource(configuration: UgvSmppSourceBootstrapConfiguration): SmppRegistrySource {
  try {
    return createSmppRegistrySource({
      smppSourceId: configuration.smppSourceId,
      ...(configuration.sourceName === undefined ? {} : { name: configuration.sourceName }),
      registryEndpoint: configuration.registryEndpoint,
      credentialRef: configuration.registryCredentialRef,
      ...(configuration.tenantId === undefined ? {} : { tenantId: configuration.tenantId }),
      ...(configuration.projectId === undefined ? {} : { projectId: configuration.projectId }),
      environment: configuration.smppEnvironment,
      syncMode: configuration.syncMode,
      snapshotTtlSeconds: configuration.snapshotTtlSeconds,
      lkgPolicy: configuration.lkgPolicy,
      status: 'draft',
      revision: 1,
    });
  } catch {
    return fail('DRIVER_CONFIGURATION_INVALID', 'Source configuration is invalid.');
  }
}

function optionalSyncMode(environment: NodeJS.ProcessEnv): 'manual' | 'poll' {
  const value = optionalEnvironment(environment, 'SMPP_SDAR_SYNC_MODE', 16) ?? 'manual';
  if (value !== 'manual' && value !== 'poll')
    return fail('DRIVER_CONFIGURATION_INVALID', 'SMPP_SDAR_SYNC_MODE must be manual or poll.');
  return value;
}

async function controlGetOptionalSource(
  configuration: UgvSmppSourceBootstrapConfiguration,
  request: typeof fetch,
): Promise<Source | undefined> {
  const response = await controlRequest(
    configuration,
    `/api/v1/smpp-sources/${encodeURIComponent(configuration.smppSourceId)}`,
    { method: 'GET' },
    request,
  );
  if (response.status === 404) return undefined;
  if (response.status !== 200)
    return fail('NODE_CONTROL_REQUEST_FAILED', 'Direct Source read failed.');
  return parseResponse(response, SourceSchema);
}

async function synchronize(
  configuration: UgvSmppSourceBootstrapConfiguration,
  idempotencyKey: string,
  reason: string,
  request: typeof fetch,
): Promise<Operation> {
  return controlPost(
    configuration,
    `/api/v1/smpp-sources/${encodeURIComponent(configuration.smppSourceId)}/sync`,
    idempotencyKey,
    { reason },
    OperationSchema,
    202,
    request,
  );
}

async function requireActiveSource(
  configuration: UgvSmppSourceBootstrapConfiguration,
  expected: SmppRegistrySource,
  observedAt: string,
  request: typeof fetch,
): Promise<Source> {
  const source = await controlGetOptionalSource(configuration, request);
  if (source === undefined)
    return fail('SOURCE_MISSING_AFTER_SYNC', 'Source disappeared after synchronization.');
  assertImmutableSourceConfiguration(source, expected);
  if (
    source.status !== 'active' ||
    source.activeSnapshotRevision === undefined ||
    source.activeSnapshotChecksum === undefined ||
    source.activeSnapshotValidUntil === undefined ||
    source.lastSyncAt === undefined ||
    source.lastErrorCode !== undefined
  )
    fail('SOURCE_NOT_ACTIVE', 'Source does not expose one healthy active Snapshot pointer.');
  requireFresh(source.activeSnapshotValidUntil, observedAt, 'SOURCE_SNAPSHOT_EXPIRED');
  return source;
}

async function requireExactCandidateAuthority(
  configuration: UgvSmppSourceBootstrapConfiguration,
  source: Source,
  observedAt: string,
  request: typeof fetch,
): Promise<readonly [Candidate]> {
  const directory = await controlGet(
    configuration,
    `/api/v1/mcp-provider-candidates?smppSourceId=${encodeURIComponent(configuration.smppSourceId)}&pageSize=200`,
    CandidateListSchema,
    request,
  );
  if (directory.items.length !== 1)
    fail(
      'SOURCE_CANDIDATE_SET_NOT_EXACT',
      'The UGV-only Source must expose exactly one current Candidate.',
    );
  const candidate = directory.items[0];
  if (candidate === undefined)
    return fail('SOURCE_CANDIDATE_SET_NOT_EXACT', 'The current Candidate is missing.');
  if (
    candidate.smppSourceId !== configuration.smppSourceId ||
    candidate.externalProviderId !== configuration.externalProviderId ||
    candidate.externalServerId !== configuration.externalServerId ||
    candidate.compositeIdentity !==
      smppCandidateIdentity(
        configuration.smppSourceId,
        configuration.externalProviderId,
        configuration.externalServerId,
      ) ||
    candidate.labels.environment !== configuration.smppEnvironment
  )
    fail('SOURCE_CANDIDATE_TUPLE_MISMATCH', 'The exact intended UGV tuple was not selected.');
  if (
    candidate.registryRevision !== source.activeSnapshotRevision ||
    candidate.registryChecksum !== source.activeSnapshotChecksum ||
    candidate.registryEtag !== `"${candidate.registryChecksum}"` ||
    candidate.registryValidUntil !== source.activeSnapshotValidUntil
  )
    fail('SOURCE_CANDIDATE_LINEAGE_MISMATCH', 'Candidate and active Source lineage differ.');
  normalizedEndpoint(candidate.serverEndpoint);
  requireFresh(candidate.registryValidUntil, observedAt, 'SOURCE_SNAPSHOT_EXPIRED');
  return Object.freeze([candidate]);
}

async function requireSyncAuditOutcome(
  configuration: UgvSmppSourceBootstrapConfiguration,
  reason: string,
  allowed: readonly ('applied' | 'not_modified')[],
  request: typeof fetch,
): Promise<'applied' | 'not_modified'> {
  const audit = await controlGet(
    configuration,
    '/api/v1/audit-events?pageSize=200',
    AuditListSchema,
    request,
  );
  const matches = audit.items.filter(
    (event) =>
      event.action === 'smpp_source.sync' &&
      event.aggregateType === 'smpp_source' &&
      event.aggregateId === configuration.smppSourceId &&
      event.reason === reason,
  );
  if (matches.length !== 1)
    return fail('SOURCE_SYNC_AUDIT_NOT_EXACT', 'Exact Source synchronization audit is missing.');
  const outcome = matches[0]?.resultCode;
  if (outcome !== 'applied' && outcome !== 'not_modified')
    return fail('SOURCE_SYNC_AUDIT_FAILED', 'Source synchronization audit did not succeed.');
  if (!allowed.includes(outcome))
    return fail('SOURCE_CONDITIONAL_304_NOT_OBSERVED', 'Conditional 304 was not observed.');
  return outcome;
}

function assertSyncOperation(operation: Operation, sourceId: string): void {
  if (
    operation.status !== 'succeeded' ||
    operation.target.id !== sourceId ||
    operation.errorCode !== undefined ||
    operation.result === undefined
  )
    fail('SOURCE_SYNC_OPERATION_FAILED', 'Source synchronization operation did not succeed.');
  const result = operation.result;
  if (
    !Number.isInteger(result['snapshotRevision']) ||
    Number(result['snapshotRevision']) <= 0 ||
    typeof result['checksum'] !== 'string' ||
    !CHECKSUM.test(result['checksum']) ||
    typeof result['etag'] !== 'string' ||
    result['etag'] !== `"${result['checksum']}"` ||
    typeof result['validUntil'] !== 'string' ||
    !Number.isFinite(Date.parse(result['validUntil'])) ||
    result['authority'] !== 'candidate_directory_only' ||
    !isNativeLineage(result['nativeLineage'])
  )
    fail('SOURCE_SYNC_OPERATION_RESULT_INVALID', 'Source synchronization result is incomplete.');
}

function assertImmutableSourceConfiguration(source: Source, expected: SmppRegistrySource): void {
  if (
    source.smppSourceId !== expected.smppSourceId ||
    source.name !== expected.name ||
    normalizedEndpoint(source.registryEndpoint) !== expected.registryEndpoint ||
    source.credentialRef !== expected.credentialRef ||
    source.tenantId !== expected.tenantId ||
    source.projectId !== expected.projectId ||
    source.environment !== expected.environment ||
    source.syncMode !== expected.syncMode ||
    source.snapshotTtlSeconds !== expected.snapshotTtlSeconds ||
    source.lkgPolicy !== expected.lkgPolicy ||
    source.revision !== expected.revision
  )
    fail(
      'SOURCE_IMMUTABLE_CONFIGURATION_DRIFT',
      'Existing Source immutable configuration differs and no public update is available.',
    );
}

function assertSyncOperationAuthority(
  operation: Operation,
  source: Source,
  candidate: Candidate,
): void {
  const result = operation.result;
  if (result === undefined || !isNativeLineage(result['nativeLineage']))
    return fail('SOURCE_SYNC_OPERATION_RESULT_INVALID', 'Source sync authority is incomplete.');
  const nativeLineage = result['nativeLineage'];
  if (
    result['snapshotRevision'] !== requiredActiveRevision(source) ||
    result['checksum'] !== requiredActiveChecksum(source) ||
    result['etag'] !== candidate.registryEtag ||
    typeof result['validUntil'] !== 'string' ||
    Date.parse(result['validUntil']) > Date.parse(requiredActiveValidUntil(source)) ||
    nativeLineage.nativeRevision !== candidate.nativeRegistryRevision ||
    nativeLineage.nativeChecksum !== candidate.nativeRegistryChecksum
  )
    fail(
      'SOURCE_SYNC_OPERATION_AUTHORITY_MISMATCH',
      'Operation, active Source, Candidate, and native Registry lineage differ.',
    );
}

function assertConditionalAuthorityUnchanged(
  initialSource: Source,
  initialCandidate: Candidate,
  conditionalSource: Source,
  conditionalCandidate: Candidate,
): void {
  if (
    requiredActiveRevision(conditionalSource) !== requiredActiveRevision(initialSource) ||
    requiredActiveChecksum(conditionalSource) !== requiredActiveChecksum(initialSource) ||
    conditionalCandidate.registryRevision !== initialCandidate.registryRevision ||
    conditionalCandidate.registryChecksum !== initialCandidate.registryChecksum ||
    conditionalCandidate.registryEtag !== initialCandidate.registryEtag ||
    conditionalCandidate.nativeRegistryRevision !== initialCandidate.nativeRegistryRevision ||
    conditionalCandidate.nativeRegistryChecksum !== initialCandidate.nativeRegistryChecksum
  )
    fail(
      'SOURCE_CONDITIONAL_LINEAGE_CHANGED',
      'Conditional synchronization changed Snapshot or native Registry lineage.',
    );
  if (
    Date.parse(requiredActiveValidUntil(conditionalSource)) <
      Date.parse(requiredActiveValidUntil(initialSource)) ||
    Date.parse(conditionalCandidate.registryValidUntil) <
      Date.parse(initialCandidate.registryValidUntil)
  )
    fail('SOURCE_CONDITIONAL_VALIDITY_SHORTENED', 'Conditional validity was shortened.');
  if (
    initialSource.lastSyncAt === undefined ||
    conditionalSource.lastSyncAt === undefined ||
    Date.parse(conditionalSource.lastSyncAt) < Date.parse(initialSource.lastSyncAt)
  )
    fail('SOURCE_CONDITIONAL_SYNC_TIME_INVALID', 'Conditional synchronization time regressed.');
}

function sourceAuthoritiesEqual(left: Source, right: Source): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requiredActiveRevision(source: Source): number {
  if (source.activeSnapshotRevision === undefined)
    return fail('SOURCE_NOT_ACTIVE', 'Active Snapshot revision is missing.');
  return source.activeSnapshotRevision;
}

function requiredActiveChecksum(source: Source): string {
  if (source.activeSnapshotChecksum === undefined)
    return fail('SOURCE_NOT_ACTIVE', 'Active Snapshot checksum is missing.');
  return source.activeSnapshotChecksum;
}

function requiredActiveValidUntil(source: Source): string {
  if (source.activeSnapshotValidUntil === undefined)
    return fail('SOURCE_NOT_ACTIVE', 'Active Snapshot validity is missing.');
  return source.activeSnapshotValidUntil;
}

function isNativeLineage(value: unknown): value is Readonly<{
  nativeRevision: number;
  nativeChecksum: string;
  projectionContract: typeof PROJECTION_CONTRACT;
}> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const lineage = value as Readonly<Record<string, unknown>>;
  return (
    Number.isInteger(lineage['nativeRevision']) &&
    Number(lineage['nativeRevision']) > 0 &&
    typeof lineage['nativeChecksum'] === 'string' &&
    CHECKSUM.test(lineage['nativeChecksum']) &&
    lineage['projectionContract'] === PROJECTION_CONTRACT
  );
}

async function controlGet<T>(
  configuration: UgvSmppSourceBootstrapConfiguration,
  path: string,
  schema: z.ZodType<T>,
  request: typeof fetch,
): Promise<T> {
  const response = await controlRequest(configuration, path, { method: 'GET' }, request);
  if (response.status !== 200)
    return fail('NODE_CONTROL_REQUEST_FAILED', 'Node Control read failed.');
  return parseResponse(response, schema);
}

async function controlPost<T>(
  configuration: UgvSmppSourceBootstrapConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  schema: z.ZodType<T>,
  expectedStatus: number,
  request: typeof fetch,
): Promise<T> {
  const response = await controlRequest(
    configuration,
    path,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    request,
  );
  if (response.status !== expectedStatus)
    return fail('NODE_CONTROL_REQUEST_FAILED', 'Node Control command failed.');
  return parseResponse(response, schema);
}

async function controlRequest(
  configuration: UgvSmppSourceBootstrapConfiguration,
  path: string,
  init: RequestInit,
  request: typeof fetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${configuration.nodeControlAdminToken}`);
  try {
    return await request(`${configuration.nodeControlBaseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });
  } catch {
    return fail('NODE_CONTROL_UNAVAILABLE', 'Node Control is unavailable.');
  }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    return fail('NODE_CONTROL_RESPONSE_INVALID', 'Node Control returned an invalid contract.');
  }
}

function managementBaseUrl(value: string): string {
  const url = safeUrl(value, 'DRIVER_CONFIGURATION_INVALID');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control base URL cannot include a path or query.');
  return url.origin;
}

function normalizedEndpoint(value: string): string {
  const url = safeUrl(value, 'DRIVER_CONFIGURATION_INVALID');
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function safeUrl(value: string, code: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(code, 'Expected an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '')
    fail(code, 'Expected a credential-free HTTP(S) URL.');
  return url;
}

function requireFresh(validUntil: string, observedAt: string, code: string): void {
  if (Date.parse(validUntil) <= Date.parse(observedAt))
    fail(code, 'Persisted Source authority has expired.');
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) return fail(code, 'Expected an RFC 3339 timestamp.');
  return value;
}

function bounded(value: string, field: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    Array.from(normalized).some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    })
  )
    fail('DRIVER_CONFIGURATION_INVALID', `${field} is invalid.`);
  return normalized;
}

function optionalBounded(value: string | undefined, field: string, maximum: number) {
  return value === undefined ? undefined : bounded(value, field, 1, maximum);
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  maximum: number,
): string {
  const value = environment[name];
  if (value === undefined)
    return fail('DRIVER_CONFIGURATION_INVALID', 'Required deployment configuration is missing.');
  return bounded(value, name, 1, maximum);
}

function optionalEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  maximum: number,
): string | undefined {
  const value = environment[name]?.trim();
  return value === undefined || value === '' ? undefined : bounded(value, name, 1, maximum);
}

function optionalPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw))
    return fail('DRIVER_CONFIGURATION_INVALID', 'Integer deployment configuration is invalid.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    return fail('DRIVER_CONFIGURATION_INVALID', 'Integer deployment configuration is invalid.');
  return value;
}

function optionalLkgPolicy(
  environment: NodeJS.ProcessEnv,
): UgvSmppSourceBootstrapConfiguration['lkgPolicy'] {
  const value = environment['SMPP_SDAR_LKG_POLICY']?.trim() ?? 'allow_unexpired';
  if (value !== 'allow_unexpired' && value !== 'deny_when_unavailable')
    return fail('DRIVER_CONFIGURATION_INVALID', 'LKG policy is invalid.');
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code: string, message: string): never {
  throw new UgvSmppSourceBootstrapError(code, message);
}

async function main(): Promise<void> {
  try {
    const report = await bootstrapUgvSmppSource(
      ugvSmppSourceBootstrapConfigurationFromEnvironment(process.env),
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code =
      error instanceof UgvSmppSourceBootstrapError
        ? error.code
        : 'UGV_SMPP_SOURCE_BOOTSTRAP_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) void main();
