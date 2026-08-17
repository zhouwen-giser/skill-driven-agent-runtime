import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  materializeSmppProviders,
  SmppProviderMaterializationError,
  type SmppExpectedTool,
  type SmppProviderMaterializationReport,
} from './smpp-provider-materializer.js';

const READ_ONLY_SEMANTICS = Object.freeze({
  effect: 'read_only',
  execution: 'synchronous',
  cancellation: 'unsupported',
  idempotency: 'server_managed',
  replay: 'allowed',
} as const);
const SIDE_EFFECTING_SEMANTICS = Object.freeze({
  effect: 'side_effecting',
  execution: 'task_required',
  cancellation: 'unsupported',
  idempotency: 'server_managed',
  replay: 'forbidden',
} as const);
const readTool = Object.freeze({
  taskBehavior: 'synchronous_only',
  executionSemantics: READ_ONLY_SEMANTICS,
} satisfies SmppExpectedTool);
const writeTool = Object.freeze({
  taskBehavior: 'task_required',
  executionSemantics: SIDE_EFFECTING_SEMANTICS,
} satisfies SmppExpectedTool);

const EXPECTED_PROVIDERS = Object.freeze({
  climate: Object.freeze({
    bindingId: 'mcp-binding-ha-climate-lab',
    tools: Object.freeze({
      climate_get_state: readTool,
      climate_set_hvac_mode: writeTool,
      climate_set_power: writeTool,
      climate_set_temperature: writeTool,
    }),
  }),
  light: Object.freeze({
    bindingId: 'mcp-binding-ha-light-lab',
    tools: Object.freeze({
      light_get_state: readTool,
      light_set_brightness: writeTool,
      light_set_power: writeTool,
    }),
  }),
});

type ProviderKind = keyof typeof EXPECTED_PROVIDERS;
type GenericProviderReport = SmppProviderMaterializationReport['providers'][number];

export interface HomeLabProviderConfiguration {
  readonly kind: ProviderKind;
  /** Defaults to the original home-lab Binding ID for backwards-compatible replays. */
  readonly bindingId?: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly localServerId: string;
  readonly credentialRef: string;
  readonly credential: Readonly<{ mode: 'bearer'; token: string }> | Readonly<{ mode: 'none' }>;
}

export interface HomeLabCatalogMaterializationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly smppSourceId: string;
  readonly runId: string;
  readonly providers: readonly HomeLabProviderConfiguration[];
}

export type HomeLabCatalogMaterializationReport = Omit<
  SmppProviderMaterializationReport,
  'schemaVersion' | 'providers'
> &
  Readonly<{
    schemaVersion: 'sdar.home-lab-catalog-materialization/v1';
    providers: readonly Readonly<
      Omit<GenericProviderReport, 'providerKey'> & { kind: ProviderKind }
    >[];
  }>;

export { SmppProviderMaterializationError as HomeLabCatalogMaterializationError };

export async function materializeHomeLabCatalog(
  input: HomeLabCatalogMaterializationConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<HomeLabCatalogMaterializationReport> {
  validateHomeLabProviders(input.providers);
  const generic = await materializeSmppProviders(
    {
      ...input,
      providers: input.providers.map((provider) => {
        const expected = EXPECTED_PROVIDERS[provider.kind];
        const bindingId = (provider.bindingId ?? expected.bindingId).trim();
        if (bindingId === '')
          fail('DRIVER_CONFIGURATION_INVALID', 'Provider Binding ID is required.');
        return Object.freeze({
          providerKey: provider.kind,
          name: `Home Lab ${provider.kind}`,
          externalProviderId: provider.externalProviderId,
          externalServerId: provider.externalServerId,
          bindingId,
          localServerId: provider.localServerId,
          credentialRef: provider.credentialRef,
          credential: provider.credential,
          bindingReconciliationPolicy: 'refresh_once_per_run',
          tools: expected.tools,
        });
      }),
    },
    dependencies,
  );
  return Object.freeze({
    ...generic,
    schemaVersion: 'sdar.home-lab-catalog-materialization/v1',
    providers: Object.freeze(
      generic.providers.map(({ providerKey, ...provider }) =>
        Object.freeze({ ...provider, kind: providerKey as ProviderKind }),
      ),
    ),
  });
}

export async function configurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: HomeLabCatalogMaterializationConfiguration;
    reportFile: string;
  }>
> {
  const sourceId = requiredEnvironment(environment, 'SDAR_HOME_LAB_SMPP_SOURCE_ID');
  const nodeControlBearerToken = await secretFromEnvironment(
    environment,
    'SDAR_HOME_LAB_NODE_CONTROL_TOKEN',
  );
  const providerKinds = providerKindsFromEnvironment(environment['SDAR_HOME_LAB_PROVIDER_KINDS']);
  const providers = await Promise.all(
    providerKinds.map(async (kind) => {
      const prefix = `SDAR_HOME_LAB_${kind.toUpperCase()}`;
      const credentialMode = environment[`${prefix}_CREDENTIAL_MODE`] ?? 'bearer';
      if (!['bearer', 'none'].includes(credentialMode))
        fail('DRIVER_CONFIGURATION_INVALID', `${prefix}_CREDENTIAL_MODE is invalid.`);
      const credential =
        credentialMode === 'none'
          ? ({ mode: 'none' } as const)
          : ({
              mode: 'bearer',
              token: await secretFromEnvironment(environment, `${prefix}_MCP_TOKEN`),
            } as const);
      return Object.freeze({
        kind,
        bindingId:
          environment[`${prefix}_BINDING_ID`] === undefined
            ? EXPECTED_PROVIDERS[kind].bindingId
            : requiredEnvironment(environment, `${prefix}_BINDING_ID`),
        externalProviderId: requiredEnvironment(environment, `${prefix}_EXTERNAL_PROVIDER_ID`),
        externalServerId: requiredEnvironment(environment, `${prefix}_EXTERNAL_SERVER_ID`),
        localServerId: requiredEnvironment(environment, `${prefix}_LOCAL_SERVER_ID`),
        credentialRef: requiredEnvironment(environment, `${prefix}_CREDENTIAL_REF`),
        credential,
      });
    }),
  );
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_NODE_CONTROL_URL'),
      nodeControlBearerToken,
      runtimeManagementBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUNTIME_URL'),
      smppSourceId: sourceId,
      runId: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUN_ID'),
      providers: Object.freeze(providers),
    }),
    reportFile:
      environment['SDAR_HOME_LAB_REPORT_FILE'] ??
      'reports/sdar-smpp-integration/home-lab-catalog-materialization.redacted.json',
  });
}

export async function writeRedactedReport(
  reportFile: string,
  report: HomeLabCatalogMaterializationReport,
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

function validateHomeLabProviders(providers: readonly HomeLabProviderConfiguration[]): void {
  if (
    providers.length < 1 ||
    providers.length > 2 ||
    new Set(providers.map(({ kind }) => kind)).size !== providers.length ||
    providers.some(({ kind }) => !Object.hasOwn(EXPECTED_PROVIDERS, kind))
  )
    fail(
      'DRIVER_CONFIGURATION_INVALID',
      'One or two unique supported home-lab providers are required.',
    );
}

function providerKindsFromEnvironment(value: string | undefined): readonly ProviderKind[] {
  if (value === undefined) return Object.freeze(['climate', 'light'] as const);
  const kinds = value.split(',').map((kind) => kind.trim());
  if (
    kinds.length < 1 ||
    kinds.length > 2 ||
    new Set(kinds).size !== kinds.length ||
    kinds.some((kind) => kind !== 'climate' && kind !== 'light')
  )
    fail(
      'DRIVER_CONFIGURATION_INVALID',
      'SDAR_HOME_LAB_PROVIDER_KINDS must contain unique climate and/or light values.',
    );
  return Object.freeze(kinds as ProviderKind[]);
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  let raw: string;
  if (inline !== undefined) raw = inline;
  else {
    if (file === undefined)
      return fail('DRIVER_CONFIGURATION_INVALID', `${name}_FILE is required.`);
    raw = await readFile(file, 'utf8');
  }
  const value = raw.trim();
  if (value === '') fail('DRIVER_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

function fail(code: string, message: string): never {
  throw new SmppProviderMaterializationError(code, message);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } = await configurationFromEnvironment();
    const report = await materializeHomeLabCatalog(configuration);
    await writeRedactedReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof SmppProviderMaterializationError
        ? error.code
        : 'HOME_LAB_CATALOG_MATERIALIZATION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
