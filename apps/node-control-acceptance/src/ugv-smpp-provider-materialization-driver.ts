import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { MCP_UNAUTHENTICATED_CREDENTIAL_REF } from '../../../packages/node-control-domain/src/index.js';
import {
  materializeSmppProviders,
  SmppProviderMaterializationError,
  type SmppExpectedTool,
  type SmppProviderMaterializationConfiguration,
  type SmppProviderMaterializationReport,
} from './smpp-provider-materializer.js';

const UGV_TOOL_NAMES = Object.freeze([
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_laser_range',
  'vehicle_navigate',
  'vehicle_track_target',
] as const);

export type UgvToolName = (typeof UGV_TOOL_NAMES)[number];

const READ_ONLY_SEMANTICS = Object.freeze({
  taskBehavior: 'synchronous_only',
  executionSemantics: Object.freeze({
    effect: 'read_only',
    execution: 'synchronous',
    cancellation: 'unsupported',
    idempotency: 'server_managed',
    replay: 'allowed',
  }),
}) satisfies SmppExpectedTool;

const TASK_CONTROL_SEMANTICS = Object.freeze({
  taskBehavior: 'task_required',
  executionSemantics: Object.freeze({
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'server_managed',
    replay: 'forbidden',
  }),
}) satisfies SmppExpectedTool;

const FIRE_SEMANTICS = Object.freeze({
  taskBehavior: 'task_required',
  executionSemantics: Object.freeze({
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'server_managed',
    replay: 'forbidden',
  }),
}) satisfies SmppExpectedTool;

/**
 * Reviewed catalog policy. It classifies every expected UGV Tool, including fire, but grants no
 * execution authority and is never used to create a fire Capability or Skill.
 */
export const UGV_REVIEWED_TOOL_POLICY: Readonly<Record<UgvToolName, SmppExpectedTool>> =
  Object.freeze({
    vehicle_area_recon: TASK_CONTROL_SEMANTICS,
    vehicle_control_gimbal: TASK_CONTROL_SEMANTICS,
    vehicle_emergency_stop: TASK_CONTROL_SEMANTICS,
    vehicle_fire_weapon: FIRE_SEMANTICS,
    vehicle_get_capabilities: READ_ONLY_SEMANTICS,
    vehicle_get_payload_status: READ_ONLY_SEMANTICS,
    vehicle_get_state: READ_ONLY_SEMANTICS,
    vehicle_get_targets: READ_ONLY_SEMANTICS,
    vehicle_laser_range: READ_ONLY_SEMANTICS,
    vehicle_navigate: TASK_CONTROL_SEMANTICS,
    vehicle_track_target: TASK_CONTROL_SEMANTICS,
  });

export interface UgvSmppProviderMaterializationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly smppSourceId: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly localServerId: string;
  readonly bindingId: string;
  readonly providerDisplayName: string;
  readonly runtimeCredentialRef: string;
  readonly runId: string;
}

export interface UgvSmppProviderMaterializationReport {
  readonly schemaVersion: 'sdar.ugv-smpp-provider-materialization/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly provider: SmppProviderMaterializationReport['providers'][number];
  readonly catalog: Readonly<{
    expectedToolCount: 11;
    materializedToolCount: 11;
    reviewedToolPolicy: true;
    allExecutionSemanticsExplicit: true;
    physicalToolInvocationCount: 0;
  }>;
  readonly firePolicy: Readonly<{
    toolName: 'vehicle_fire_weapon';
    discoveredAndClassified: true;
    executionAuthorized: false;
    capabilityCreationAuthority: 'none';
  }>;
  readonly authentication: Readonly<{
    runtimeMode: 'none';
    implicitFallback: false;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    credentialReferencesIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: true;
  }>;
}

export class UgvSmppProviderMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvSmppProviderMaterializationError';
    this.code = code;
  }
}

export async function materializeUgvSmppProvider(
  input: UgvSmppProviderMaterializationConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<UgvSmppProviderMaterializationReport> {
  const configuration = validateConfiguration(input);
  const generic: SmppProviderMaterializationConfiguration = Object.freeze({
    nodeControlBaseUrl: configuration.nodeControlBaseUrl,
    nodeControlBearerToken: configuration.nodeControlBearerToken,
    runtimeManagementBaseUrl: configuration.runtimeManagementBaseUrl,
    smppSourceId: configuration.smppSourceId,
    runId: configuration.runId,
    providers: Object.freeze([
      Object.freeze({
        providerKey: 'ugv',
        name: configuration.providerDisplayName,
        externalProviderId: configuration.externalProviderId,
        externalServerId: configuration.externalServerId,
        bindingId: configuration.bindingId,
        localServerId: configuration.localServerId,
        credentialRef: configuration.runtimeCredentialRef,
        credential: Object.freeze({ mode: 'none' as const }),
        tools: UGV_REVIEWED_TOOL_POLICY,
      }),
    ]),
  });
  let materialized: SmppProviderMaterializationReport;
  try {
    materialized = await materializeSmppProviders(generic, dependencies);
  } catch (error) {
    if (error instanceof SmppProviderMaterializationError)
      throw new UgvSmppProviderMaterializationError(error.code, error.message);
    throw error;
  }
  const provider = materialized.providers[0];
  if (provider === undefined || materialized.providers.length !== 1)
    return fail('UGV_PROVIDER_RESULT_NOT_EXACT', 'Expected exactly one materialized UGV Provider.');
  const materializedToolNames = provider.tools.map(({ toolName }) => toolName);
  if (
    provider.tools.length !== UGV_TOOL_NAMES.length ||
    UGV_TOOL_NAMES.some((toolName) => !materializedToolNames.includes(toolName))
  )
    fail('UGV_CATALOG_TOOL_SET_MISMATCH', 'Materialized UGV Catalog is not the reviewed 11 tools.');
  const fire = provider.tools.find(({ toolName }) => toolName === 'vehicle_fire_weapon');
  if (fire?.effect !== 'side_effecting')
    fail('UGV_FIRE_CLASSIFICATION_MISMATCH', 'Fire must be classified as side-effecting.');

  const report: UgvSmppProviderMaterializationReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-provider-materialization/v1',
    status: 'passed',
    observedAt: materialized.observedAt,
    provider,
    catalog: Object.freeze({
      expectedToolCount: 11,
      materializedToolCount: 11,
      reviewedToolPolicy: true,
      allExecutionSemanticsExplicit: true,
      physicalToolInvocationCount: 0,
    }),
    firePolicy: Object.freeze({
      toolName: 'vehicle_fire_weapon',
      discoveredAndClassified: true,
      executionAuthorized: false,
      capabilityCreationAuthority: 'none',
    }),
    authentication: Object.freeze({ runtimeMode: 'none', implicitFallback: false }),
    redaction: Object.freeze({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: true,
    }),
  });
  assertRedacted(report, configuration);
  return report;
}

export function ugvSmppProviderMaterializationConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<{
  configuration: UgvSmppProviderMaterializationConfiguration;
  reportFile: string;
}> {
  const runtimeCredentialRef = requiredEnvironment(
    environment,
    'SMPP_UGV_RUNTIME_CREDENTIAL_REF',
    512,
  );
  if (runtimeCredentialRef !== MCP_UNAUTHENTICATED_CREDENTIAL_REF)
    fail(
      'UGV_RUNTIME_CREDENTIAL_MODE_UNSUPPORTED',
      `This deployment wrapper requires ${MCP_UNAUTHENTICATED_CREDENTIAL_REF}.`,
    );
  rejectPopulatedEnvironment(environment, [
    'SMPP_UGV_RUNTIME_TOKEN',
    'SMPP_UGV_RUNTIME_TOKEN_FILE',
  ]);
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL', 2_048),
      nodeControlBearerToken: requiredEnvironment(environment, 'SDAR_CONTROL_API_TOKEN', 4_096),
      runtimeManagementBaseUrl: requiredEnvironment(
        environment,
        'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
        2_048,
      ),
      smppSourceId: requiredEnvironment(environment, 'SMPP_SDAR_SOURCE_ID', 256),
      externalProviderId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_PROVIDER_ID', 256),
      externalServerId: requiredEnvironment(environment, 'SMPP_UGV_EXTERNAL_SERVER_ID', 256),
      localServerId: requiredEnvironment(environment, 'SDAR_UGV_LOCAL_SERVER_ID', 256),
      bindingId: requiredEnvironment(environment, 'SDAR_UGV_BINDING_ID', 256),
      providerDisplayName: requiredEnvironment(environment, 'SDAR_UGV_PROVIDER_DISPLAY_NAME', 256),
      runtimeCredentialRef,
      runId: requiredEnvironment(environment, 'SDAR_UGV_BOOTSTRAP_RUN_ID', 128),
    }),
    reportFile:
      optionalEnvironment(environment, 'SDAR_UGV_PROVIDER_REPORT_FILE', 4_096) ??
      'reports/sdar-ugv-smpp-integration/provider-materialization.redacted.json',
  });
}

export async function writeRedactedUgvSmppProviderReport(
  reportFile: string,
  report: UgvSmppProviderMaterializationReport,
): Promise<void> {
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

function validateConfiguration(
  input: UgvSmppProviderMaterializationConfiguration,
): UgvSmppProviderMaterializationConfiguration {
  for (const [field, value, maximum] of [
    ['Node Control bearer token', input.nodeControlBearerToken, 4_096],
    ['SMPP Source ID', input.smppSourceId, 256],
    ['external Provider ID', input.externalProviderId, 256],
    ['external Server ID', input.externalServerId, 256],
    ['local Server ID', input.localServerId, 256],
    ['Binding ID', input.bindingId, 256],
    ['Provider display name', input.providerDisplayName, 256],
    ['run ID', input.runId, 128],
  ] as const)
    bounded(value, field, field === 'Node Control bearer token' ? 32 : 1, maximum);
  if (input.runId.length < 8)
    fail('DRIVER_CONFIGURATION_INVALID', 'Run ID must contain at least eight characters.');
  if (input.runtimeCredentialRef !== MCP_UNAUTHENTICATED_CREDENTIAL_REF)
    fail(
      'UGV_RUNTIME_CREDENTIAL_MODE_UNSUPPORTED',
      `This deployment wrapper requires ${MCP_UNAUTHENTICATED_CREDENTIAL_REF}.`,
    );
  return Object.freeze({
    ...input,
    nodeControlBaseUrl: managementBaseUrl(input.nodeControlBaseUrl),
    runtimeManagementBaseUrl: managementBaseUrl(input.runtimeManagementBaseUrl),
  });
}

function assertRedacted(
  report: UgvSmppProviderMaterializationReport,
  configuration: UgvSmppProviderMaterializationConfiguration,
): void {
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    configuration.nodeControlBearerToken,
    configuration.runtimeCredentialRef,
    configuration.nodeControlBaseUrl,
    configuration.runtimeManagementBaseUrl,
  ])
    if (serialized.includes(forbidden))
      fail('REPORT_REDACTION_FAILED', 'Provider report contains forbidden sensitive material.');
  if (/https?:\/\//iu.test(serialized) || /unauthenticated:\/\/none/iu.test(serialized))
    fail('REPORT_REDACTION_FAILED', 'Provider report contains an endpoint or CredentialRef.');
}

function managementBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('DRIVER_CONFIGURATION_INVALID', 'Management URL must be absolute HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Management URL contains unsupported components.');
  return url.origin;
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

function rejectPopulatedEnvironment(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): void {
  if (names.some((name) => (environment[name]?.trim() ?? '') !== ''))
    fail(
      'UGV_RUNTIME_CREDENTIAL_CONFIGURATION_CONFLICT',
      'Unauthenticated Runtime mode cannot include token configuration.',
    );
}

function bounded(value: string, field: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    fail('DRIVER_CONFIGURATION_INVALID', `${field} is invalid.`);
  return normalized;
}

function fail(code: string, message: string): never {
  throw new UgvSmppProviderMaterializationError(code, message);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } =
      ugvSmppProviderMaterializationConfigurationFromEnvironment();
    const report = await materializeUgvSmppProvider(configuration);
    await writeRedactedUgvSmppProviderReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof UgvSmppProviderMaterializationError
        ? error.code
        : 'UGV_SMPP_PROVIDER_MATERIALIZATION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
