import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { MODEL_STAGES } from '../../../packages/domain/src/index.js';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SMPP_ROOT = resolve(REPOSITORY_ROOT, '../sdar-mcp-provider-platform');
const DEPLOY_ROOT = resolve(REPOSITORY_ROOT, 'deploy/ugv-agent-profile-simulation');
const INITIALIZE_STATE = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/initialize-state.mjs',
);
const VALIDATE_PROFILE = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/validate-profile.mjs',
);
const RECORD_ATTEMPT = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/record-attempt.mjs',
);
const QUALIFY_SMPP = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/qualify-smpp-readonly.mjs',
);
const EVIDENCE_FILES = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/evidence-files.mjs',
);
const PROJECT_PMS_SEED_REPORT = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/project-pms-seed-report.mjs',
);
const PROJECT_AUTHORITY_REPORT = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/project-authority-report.mjs',
);
const SUPERVISOR = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/host-process-supervisor.mjs',
);
const MODEL_INVOCATION_AUDIT = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/model-invocation-audit.mjs',
);
const VALIDATE_RUNNING_STACK = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/validate-running-stack.mjs',
);
const SMPP_SERVICES = [
  'ugv-agent-profile-adapter-postgres',
  'ugv-agent-profile-runtime-postgres',
  'ugv-agent-profile-pms-postgres',
  'ugv-agent-profile-pms-api',
  'ugv-agent-profile-adapter',
  'ugv-agent-profile-runtime',
  'ugv-agent-profile-pms-worker',
] as const;

interface StateModule {
  initializeState(stateRoot: string): Promise<{
    readonly root: string;
    readonly pmsRoot: string;
    readonly logsRoot: string;
    readonly runId: string;
    readonly bootstrapRunId: string;
    readonly simulationRunId: string;
  }>;
}

interface ValidationModule {
  assertNoDotEnvMaterial(
    value: unknown,
    secrets?: readonly string[],
    keys?: readonly string[],
  ): void;
  assertPrivateProcessLogSafe(value: unknown, dotenvValues: Readonly<Record<string, string>>): void;
  publicConfigurationMaterial(
    values: Readonly<Record<string, string>>,
    additionalSecrets?: readonly string[],
  ): readonly string[];
  validateDotEnv(path: string): Promise<{
    readonly values: Readonly<Record<string, string>>;
    readonly secretValues: readonly string[];
  }>;
  validatePmsRuntimeCredentialDescriptor(value: unknown): void;
  validateSdarCompose(value: unknown, secrets?: readonly string[], keys?: readonly string[]): void;
  validateSmppCompose(
    value: unknown,
    secrets?: readonly string[],
    keys?: readonly string[],
    expectedPmsRoot?: string,
  ): void;
}

interface AttemptModule {
  recordAttempt(input: {
    readonly kind: string;
    readonly stage: string;
    readonly status: string;
    readonly exitCode: number;
    readonly command: string;
    readonly stateRoot: string;
    readonly reportRoot: string;
  }): Promise<{ readonly target: string }>;
}

interface QualifierModule {
  addedRows(
    before: readonly Record<string, unknown>[],
    after: readonly Record<string, unknown>[],
    key: string,
  ): readonly Record<string, unknown>[];
  assertFreshTimestamp(value: unknown, maximumAge: number, now: number): void;
  assessFailureAudit(
    before: Record<string, readonly Record<string, unknown>[]>,
    after: Record<string, readonly Record<string, unknown>[]> | undefined,
  ): { readonly status: string; readonly externalMutationPerformed: boolean | 'unknown' };
  assessQualificationFailure(
    before: Record<string, readonly Record<string, unknown>[]> | undefined,
    after: Record<string, readonly Record<string, unknown>[]> | undefined,
    error: unknown,
  ): {
    readonly status: string;
    readonly externalMutationPerformed: boolean | 'unknown';
    readonly preexistingExternalMutationObserved: boolean | 'unknown';
    readonly mutationAttribution: string;
  };
}

interface SupervisorModule {
  readonly UAP_HOST_PROCESS_SPECS: readonly Readonly<{
    readonly name: string;
    readonly entrypoint: string;
    readonly cwd: string;
  }>[];
  cleanupPublishedManifest(
    expected: Record<string, unknown>,
    dependencies: {
      readonly read: () => Promise<Record<string, unknown>>;
      readonly remove: () => Promise<void>;
    },
  ): Promise<void>;
  exactProviderAuthorities(values: Readonly<Record<string, string>>): readonly string[];
  prepareAtomicLockCandidate(
    path: string,
    owner: Record<string, unknown>,
  ): Promise<Readonly<{ owner: Record<string, unknown>; candidatePath: string }>>;
  publishAtomicLockCandidate(
    path: string,
    prepared: Readonly<{ owner: Record<string, unknown>; candidatePath: string }>,
    dependencies?: {
      readonly isOwnerLive: (owner: Record<string, unknown>) => Promise<boolean>;
    },
  ): Promise<Record<string, unknown>>;
  releaseAtomicLock(anchor: Record<string, unknown>): Promise<void>;
  listPrivateLogFiles(path: string): Promise<readonly string[]>;
  processEnvironment(
    name: string,
    sideEffects: string,
    stateRoot: string,
    dotEnvPath: string,
  ): Promise<Readonly<Record<string, string>>>;
  rollbackSpawnedCandidate(
    candidate: Record<string, unknown>,
    dependencies: {
      readonly inspect: (pid: number) => Promise<Record<string, unknown> | undefined>;
      readonly group: (
        candidate: Record<string, unknown>,
      ) => Promise<readonly Record<string, unknown>[]>;
      readonly signal: (candidate: Record<string, unknown>, signal: string) => Promise<void>;
      readonly wait: (candidate: Record<string, unknown>, timeout: number) => Promise<boolean>;
    },
  ): Promise<void>;
  sanitizedBaseEnvironment(
    environment: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>>;
  transactionalRestartServer(
    manifest: Readonly<{
      sideEffects: string;
      revision: number;
      processes: readonly Record<string, unknown>[];
      [key: string]: unknown;
    }>,
    sideEffects: string,
    dependencies: {
      readonly stop: (entries: readonly Record<string, unknown>[]) => Promise<void>;
      readonly spawn: (mode: string) => Promise<Record<string, unknown>>;
      readonly readManifest: () => Promise<Record<string, unknown>>;
      readonly replaceManifest: (
        prior: Record<string, unknown>,
        next: Record<string, unknown>,
      ) => Promise<void>;
      readonly validate: (value: Record<string, unknown>) => Promise<unknown>;
      readonly now: () => string;
    },
  ): Promise<Record<string, unknown>>;
}

interface ModelInvocationAuditModule {
  readonly EXPECTED_MODEL_STAGES: readonly string[];
  auditModelInvocations(
    mode: string,
    options: {
      readonly repositoryRoot: string;
      readonly stateRoot: string;
      readonly reportRoot: string;
      readonly dotEnvPath: string;
      readonly queryAuthority: () => Promise<Record<string, unknown>>;
    },
  ): Promise<Record<string, unknown>>;
  validateModelAuthority(
    authority: Record<string, unknown>,
    dotEnvValues: Readonly<Record<string, string>>,
  ): Record<string, unknown>;
}

interface EvidenceModule {
  readValidatedFirstPassIndex(
    path: string,
    repositoryRoot: string,
    expected?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  writeCanonicalJsonFirstWriter(path: string, document: Record<string, unknown>): Promise<string>;
  writeCanonicalFirstPassIndex(
    path: string,
    document: Record<string, unknown>,
    repositoryRoot: string,
  ): Promise<string>;
  writeImmutableAttemptJson(
    directory: string,
    prefix: string,
    document: Record<string, unknown>,
  ): Promise<string>;
  sha256CanonicalJson(document: Record<string, unknown>): string;
}

interface RunningStackModule {
  validateProjectInventory(
    document: unknown,
    options: {
      readonly mode: string;
      readonly project: string;
      readonly expectedServices: readonly string[];
    },
  ): Readonly<{ serviceCount: number }>;
  validateSmppRuntimeExposure(document: unknown): Readonly<{
    serviceCount: number;
    publishedPortOwnerCount: number;
    northboundOwnerCount: number;
    southboundOwnerCount: number;
  }>;
  validateSdarRuntimeExposure(document: unknown): Readonly<{
    serviceCount: number;
    publishedPortOwnerCount: number;
    northboundOwnerCount: number;
  }>;
  validateSupervisorStatus(document: unknown): Readonly<Record<string, unknown>>;
}

interface PmsSeedProjectorModule {
  projectPmsSeedReport(
    inputPath: string,
    outputPath: string,
    options?: { readonly repositoryRoot?: string; readonly stateRoot?: string },
  ): Promise<Record<string, unknown>>;
}

interface AuthorityProjectorModule {
  projectAuthorityReport(
    mode: string,
    inputPath: string,
    outputPath: string,
    options?: { readonly repositoryRoot?: string; readonly stateRoot?: string },
  ): Promise<Record<string, unknown>>;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('UGV Agent Profile simulation deployment contract', () => {
  it('accepts only a private regular local model configuration without requiring generated service tokens', async () => {
    const validator = await validationModule();
    const directory = await temporaryDirectory();
    const envPath = join(directory, '.env');
    await writeFile(envPath, validDotEnv(), { mode: 0o600 });

    const accepted = await validator.validateDotEnv(envPath);
    expect(accepted.values['SDAR_UGV_REAL_MODEL_ENABLED']).toBe('YES');
    expect(accepted.values['SDAR_CONTROL_API_TOKEN']).toBeUndefined();

    const anthropicPath = join(directory, 'anthropic.env');
    await writeFile(
      anthropicPath,
      validDotEnv().replace('openai_chat_completions', 'anthropic_messages'),
      { mode: 0o600 },
    );
    await expect(validator.validateDotEnv(anthropicPath)).rejects.toMatchObject({
      code: 'UAP_MODEL_API_STYLE_INVALID',
    });

    await chmod(envPath, 0o644);
    await expect(validator.validateDotEnv(envPath)).rejects.toMatchObject({
      code: 'UAP_DOTENV_MODE_INVALID',
    });

    await chmod(envPath, 0o600);
    const linkPath = join(directory, 'linked.env');
    await symlink(envPath, linkPath);
    await expect(validator.validateDotEnv(linkPath)).rejects.toMatchObject({
      code: 'UAP_DOTENV_NOT_REGULAR',
    });

    const remoteHttpPath = join(directory, 'remote-http.env');
    await writeFile(
      remoteHttpPath,
      validDotEnv().replace('https://models.example.test/v1', 'http://models.example.test/v1'),
      { mode: 0o600 },
    );
    await expect(validator.validateDotEnv(remoteHttpPath)).rejects.toMatchObject({
      code: 'UAP_MODEL_BASE_URL_INVALID',
    });

    const credentialFile = join(directory, 'model.key');
    const credentialValue = 'model-file-secret-contract-never-print';
    await writeFile(credentialFile, `${credentialValue}\n`, { mode: 0o600 });
    const fileEnvPath = join(directory, 'file.env');
    await writeFile(
      fileEnvPath,
      validDotEnv().replace(
        'SDAR_UGV_MODEL_API_KEY=model-secret-contract-never-print',
        `SDAR_UGV_MODEL_API_KEY_FILE=${credentialFile}`,
      ),
      { mode: 0o600 },
    );
    const fileAccepted = await validator.validateDotEnv(fileEnvPath);
    expect(fileAccepted.secretValues).toEqual([credentialValue]);
    await chmod(credentialFile, 0o644);
    await expect(validator.validateDotEnv(fileEnvPath)).rejects.toMatchObject({
      code: 'UAP_MODEL_CREDENTIAL_FILE_MODE_INVALID',
    });

    const shortInlinePath = join(directory, 'short-inline.env');
    await writeFile(
      shortInlinePath,
      validDotEnv().replace('model-secret-contract-never-print', '1234567'),
      { mode: 0o600 },
    );
    await expect(validator.validateDotEnv(shortInlinePath)).rejects.toMatchObject({
      code: 'UAP_MODEL_CREDENTIAL_INVALID',
    });
    const minimumInlinePath = join(directory, 'minimum-inline.env');
    await writeFile(
      minimumInlinePath,
      validDotEnv().replace('model-secret-contract-never-print', '12345678'),
      { mode: 0o600 },
    );
    const minimumAccepted = await validator.validateDotEnv(minimumInlinePath);
    expect(() => {
      validator.assertPrivateProcessLogSafe('credential=12345678', minimumAccepted.values);
    }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_VALUE_EXPOSED' }));
    await writeFile(credentialFile, '1234567\n', { mode: 0o600 });
    await chmod(credentialFile, 0o600);
    await expect(validator.validateDotEnv(fileEnvPath)).rejects.toMatchObject({
      code: 'UAP_MODEL_CREDENTIAL_INVALID',
    });

    const shadowPath = join(directory, 'shadow.env');
    await writeFile(shadowPath, 'UAP_TASK_OWNED_OVERRIDE=from-file\n', { mode: 0o600 });
    const loadResult = await execFileAsync(
      process.execPath,
      [
        '-e',
        "process.loadEnvFile(process.argv[1]);if(process.env.UAP_TASK_OWNED_OVERRIDE!=='from-supervisor')process.exit(23)",
        shadowPath,
      ],
      { env: { PATH: process.env['PATH'], UAP_TASK_OWNED_OVERRIDE: 'from-supervisor' } },
    );
    expect(loadResult).toEqual({ stdout: '', stderr: '' });

    expect(() => {
      validator.assertNoDotEnvMaterial(
        `database material only: postgresql://uap:private@127.0.0.1:5432/uap`,
        Object.values({
          SDAR_DATABASE_URL: 'postgresql://uap:private@127.0.0.1:5432/uap',
        }),
        [],
      );
    }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_VALUE_EXPOSED' }));
    expect(() => {
      validator.assertNoDotEnvMaterial(
        { PMS_DATABASE_URL_FILE: '/run/uap-pms/pms-database-url' },
        [],
        ['PMS_DATABASE_URL'],
      );
    }).not.toThrow();
    expect(() => {
      validator.assertNoDotEnvMaterial({ PMS_DATABASE_URL: 'redacted' }, [], ['PMS_DATABASE_URL']);
    }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_KEY_EXPOSED' }));
    expect(() => {
      validator.assertPrivateProcessLogSafe(
        'provider structured-provider model structured-model base https://models.example.test/v1',
        accepted.values,
      );
    }).not.toThrow();
    expect(() => {
      validator.assertPrivateProcessLogSafe(
        'database postgresql://uap:private@127.0.0.1:5432/uap',
        { SDAR_DATABASE_URL: 'postgresql://uap:private@127.0.0.1:5432/uap' },
      );
    }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_VALUE_EXPOSED' }));
  });

  it('keeps every concurrent command attempt immutable instead of overwriting failure history', async () => {
    const attempts = await attemptModule();
    const root = await temporaryDirectory();
    const stateRoot = join(root, 'state');
    const reportRoot = join(root, 'attempts');
    const results = await Promise.all([
      ...Array.from({ length: 12 }, () =>
        attempts.recordAttempt({
          kind: 'preflight',
          stage: 'remote-baseline',
          status: 'failed',
          exitCode: 2,
          command: 'preflight',
          stateRoot,
          reportRoot,
        }),
      ),
      attempts.recordAttempt({
        kind: 'preflight',
        stage: 'complete',
        status: 'passed',
        exitCode: 0,
        command: 'preflight',
        stateRoot,
        reportRoot,
      }),
    ]);
    expect(new Set(results.map((result) => result.target))).toHaveLength(13);
    expect(await readdir(reportRoot)).toHaveLength(13);
    const documents = await Promise.all(
      results.map(
        async ({ target }) => JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>,
      ),
    );
    expect(documents.filter((document) => document['status'] === 'failed')).toHaveLength(12);
    expect(documents.filter((document) => document['status'] === 'passed')).toHaveLength(1);
    expect(documents.every((document) => document['simulationSideEffectsEnabled'] === false)).toBe(
      true,
    );
    const seedAttempt = await attempts.recordAttempt({
      kind: 'smpp-seed',
      stage: 'complete',
      status: 'passed',
      exitCode: 0,
      command: 'seed-smpp',
      stateRoot,
      reportRoot,
    });
    const seedDocument = JSON.parse(await readFile(seedAttempt.target, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(seedDocument).toMatchObject({
      externalPhysicalMutationAuthorized: false,
      activityAssessment: 'not_assessed',
      controlPlaneMutationAttempted: true,
      localMutationAttempted: true,
    });
    expect(seedDocument['externalPhysicalMutationAttempted']).toBeUndefined();
    expect(seedDocument['navigationCallCount']).toBeUndefined();
    expect(seedDocument['weaponCallCount']).toBeUndefined();
  });

  it('rejects changed, deleted, or duplicate Adapter ledger rows and locks freshness boundaries', async () => {
    const qualifier = await qualifierModule();
    const before = [{ rowId: 'row-1', state: 'accepted' }];
    expect(
      qualifier.addedRows(before, [...before, { rowId: 'row-2', state: 'accepted' }], 'rowId'),
    ).toEqual([{ rowId: 'row-2', state: 'accepted' }]);
    for (const after of [[], [{ rowId: 'row-1', state: 'changed' }], [...before, ...before]])
      expect(() => {
        qualifier.addedRows(before, after, 'rowId');
      }).toThrow();

    const now = Date.parse('2026-08-21T10:00:00.000Z');
    expect(() => {
      qualifier.assertFreshTimestamp('2026-08-21T10:00:01.000Z', 3_000, now);
    }).not.toThrow();
    expect(() => {
      qualifier.assertFreshTimestamp('2026-08-21T10:00:01.001Z', 3_000, now);
    }).toThrow('UAP_SMPP_VEHICLE_STATE_STALE');
    expect(() => {
      qualifier.assertFreshTimestamp('2026-08-21T09:59:57.000Z', 3_000, now);
    }).not.toThrow();
    expect(() => {
      qualifier.assertFreshTimestamp('2026-08-21T09:59:56.999Z', 3_000, now);
    }).toThrow('UAP_SMPP_VEHICLE_STATE_STALE');

    const cleanAudit = {
      deviceToolCalls: [{ callId: 'call-1', toolName: 'get_status' }],
      executions: [],
      mutationJournal: [],
      commandAcks: [],
    };
    expect(qualifier.assessFailureAudit(cleanAudit, structuredClone(cleanAudit))).toMatchObject({
      status: 'no_mutation_observed',
      externalMutationPerformed: false,
    });
    expect(
      qualifier.assessFailureAudit(cleanAudit, {
        ...structuredClone(cleanAudit),
        mutationJournal: [{ rowId: 'mutation-1', toolName: 'vehicle_navigate' }],
      }),
    ).toMatchObject({ status: 'mutation_observed', externalMutationPerformed: true });
    expect(
      qualifier.assessFailureAudit(cleanAudit, {
        ...structuredClone(cleanAudit),
        deviceToolCalls: [{ callId: 'call-1', toolName: 'changed' }],
      }),
    ).toMatchObject({ status: 'unknown', externalMutationPerformed: 'unknown' });
    expect(qualifier.assessFailureAudit(cleanAudit, undefined)).toMatchObject({
      status: 'unknown',
      externalMutationPerformed: 'unknown',
    });
    expect(
      qualifier.assessQualificationFailure(
        undefined,
        undefined,
        new Error('UAP_SMPP_ADAPTER_AUDIT_FAILED'),
      ),
    ).toMatchObject({
      status: 'unknown',
      externalMutationPerformed: 'unknown',
      preexistingExternalMutationObserved: 'unknown',
      mutationAttribution: 'unknown',
    });
    expect(
      qualifier.assessQualificationFailure(
        {
          ...cleanAudit,
          mutationJournal: [{ rowId: 'preexisting', toolName: 'vehicle_navigate' }],
        },
        undefined,
        new Error('UAP_SMPP_ADAPTER_NOT_CLEAN_READ_ONLY'),
      ),
    ).toMatchObject({
      status: 'preexisting_mutation_observed',
      externalMutationPerformed: false,
      preexistingExternalMutationObserved: true,
      mutationAttribution: 'preexisting_before_qualification',
    });
  });

  it('sanitizes host child environments and rolls back an identity-anchored failed spawn', async () => {
    const supervisor = await supervisorModule();
    const directory = await temporaryDirectory();
    const stateRoot = join(directory, 'state');
    const envPath = join(directory, '.env');
    await writeFile(envPath, validDotEnv(), { mode: 0o600 });
    const server = await supervisor.processEnvironment('server', 'NO', stateRoot, envPath);
    const controlApi = await supervisor.processEnvironment(
      'node-control-api',
      'NO',
      stateRoot,
      envPath,
    );
    const controlWorker = await supervisor.processEnvironment(
      'node-control-worker',
      'NO',
      stateRoot,
      envPath,
    );
    expect(server['SDAR_MASTER_KEY_BASE64']).toBeUndefined();
    expect(Object.keys(server).some((key) => key.startsWith('SDAR_UGV_MODEL_'))).toBe(false);
    expect(server['ALLOW_UGV_SIMULATION_SIDE_EFFECTS']).toBe('NO');
    expect(server['UGV_SIMULATION_RUN_ID']).toMatch(/^uap-p3-b02-/u);
    expect(server['SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST']).toBe(
      'embeddings.example.test,models.example.test',
    );
    for (const environment of [controlApi, controlWorker]) {
      expect(environment['SDAR_MASTER_KEY_BASE64']).toBeUndefined();
      expect(Object.keys(environment).some((key) => key.startsWith('SDAR_UGV_MODEL_'))).toBe(false);
    }
    const processSpecs = Object.fromEntries(
      supervisor.UAP_HOST_PROCESS_SPECS.map((specification) => [specification.name, specification]),
    );
    expect(processSpecs['server']?.cwd).toBe(REPOSITORY_ROOT);
    const fixedHostWork = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}/host-work`;
    expect(processSpecs['node-control-api']?.cwd).toBe(fixedHostWork);
    expect(processSpecs['node-control-worker']?.cwd).toBe(fixedHostWork);
    expect(() =>
      supervisor.exactProviderAuthorities({
        SDAR_UGV_MODEL_BASE_URL: 'http://remote.example.test/v1',
        SDAR_UGV_MODEL_EMBEDDING_BASE_URL: 'https://embeddings.example.test/v1',
      }),
    ).toThrow(expect.objectContaining({ code: 'UAP_MODEL_PROVIDER_AUTHORITY_INVALID' }));
    expect(
      supervisor.sanitizedBaseEnvironment({
        PATH: '/bin',
        SDAR_MASTER_KEY_BASE64: 'shell-canary',
        SDAR_UGV_MODEL_API_KEY: 'shell-canary',
      }),
    ).toEqual({ PATH: '/bin' });

    const candidate = {
      pid: 43210,
      startTicks: '1234',
      uid: process.getuid?.() ?? 0,
      processGroupId: 43210,
      sessionId: 43210,
    };
    const observed = { ...candidate };
    const signals: string[] = [];
    await supervisor.rollbackSpawnedCandidate(candidate, {
      inspect: () => Promise.resolve(observed),
      group: () => Promise.resolve([observed]),
      signal: (_entry, signal) => {
        signals.push(signal);
        return Promise.resolve();
      },
      wait: () => Promise.resolve(true),
    });
    expect(signals).toEqual(['SIGTERM']);
    await expect(
      supervisor.rollbackSpawnedCandidate(candidate, {
        inspect: () => Promise.resolve({ ...observed, uid: observed.uid + 1 }),
        group: () => Promise.resolve([{ ...observed, uid: observed.uid + 1 }]),
        signal: () => Promise.resolve(),
        wait: () => Promise.resolve(true),
      }),
    ).rejects.toMatchObject({ code: 'UAP_PROCESS_ORPHAN_RISK' });
    for (const unanchored of [undefined, { ...observed, startTicks: '9999' }]) {
      const unsafeSignals: string[] = [];
      await expect(
        supervisor.rollbackSpawnedCandidate(candidate, {
          inspect: () => Promise.resolve(unanchored),
          group: () => Promise.resolve([observed]),
          signal: (_entry, signal) => {
            unsafeSignals.push(signal);
            return Promise.resolve();
          },
          wait: () => Promise.resolve(true),
        }),
      ).rejects.toMatchObject({ code: 'UAP_PROCESS_ORPHAN_RISK' });
      expect(unsafeSignals).toEqual([]);
    }

    const published = { schemaVersion: 'test', revision: 1 };
    let removed = false;
    await supervisor.cleanupPublishedManifest(published, {
      read: () => Promise.resolve(published),
      remove: () => {
        removed = true;
        return Promise.resolve();
      },
    });
    expect(removed).toBe(true);
    await expect(
      supervisor.cleanupPublishedManifest(published, {
        read: () => Promise.resolve({ ...published, revision: 2 }),
        remove: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'UAP_PROCESS_MANIFEST_DRIFT' });

    const priorManifest = {
      sideEffects: 'NO',
      revision: 1,
      processes: [
        { name: 'server', pid: 1 },
        { name: 'node-control-api', pid: 2 },
        { name: 'node-control-worker', pid: 3 },
      ],
    };
    const spawnModes: string[] = [];
    let restoredManifest: Record<string, unknown> | undefined;
    await expect(
      supervisor.transactionalRestartServer(priorManifest, 'YES', {
        stop: () => Promise.resolve(),
        spawn: (mode) => {
          spawnModes.push(mode);
          return mode === 'YES'
            ? Promise.reject(new Error('replacement failed'))
            : Promise.resolve({ name: 'server', pid: 4 });
        },
        readManifest: () => Promise.resolve(priorManifest),
        replaceManifest: (_prior, next) => {
          restoredManifest = next;
          return Promise.resolve();
        },
        validate: () => Promise.resolve(),
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toThrow('replacement failed');
    expect(spawnModes).toEqual(['YES', 'NO']);
    expect(restoredManifest?.['sideEffects']).toBe('NO');
    expect((restoredManifest?.['processes'] as Record<string, unknown>[])[0]?.['pid']).toBe(4);

    const concurrentOwnerBase = {
      schemaVersion: 'sdar.ugv-agent-profile.supervisor-lock/v1',
      pid: 43_210,
      uid: process.getuid?.() ?? 0,
      startTicks: '1234',
    };
    const lockRoot = await temporaryDirectory();
    const lockPath = join(lockRoot, 'supervisor.lock');
    const pausedCandidate = await supervisor.prepareAtomicLockCandidate(
      lockPath,
      concurrentOwnerBase,
    );
    const winnerCandidate = await supervisor.prepareAtomicLockCandidate(lockPath, {
      ...concurrentOwnerBase,
      pid: 43_211,
      startTicks: '1235',
    });
    const winnerAnchor = await supervisor.publishAtomicLockCandidate(lockPath, winnerCandidate, {
      isOwnerLive: () => Promise.resolve(true),
    });
    await expect(
      supervisor.publishAtomicLockCandidate(lockPath, pausedCandidate, {
        isOwnerLive: () => Promise.resolve(true),
      }),
    ).rejects.toMatchObject({ code: 'UAP_SUPERVISOR_LOCKED' });
    const [lockStatus, winnerStatus] = await Promise.all([
      lstat(lockPath),
      lstat(winnerCandidate.candidatePath),
    ]);
    expect({ dev: lockStatus.dev, ino: lockStatus.ino }).toEqual({
      dev: winnerStatus.dev,
      ino: winnerStatus.ino,
    });
    await expect(
      supervisor.publishAtomicLockCandidate(lockPath, pausedCandidate, {
        isOwnerLive: () => Promise.resolve(false),
      }),
    ).rejects.toMatchObject({
      code: 'UAP_SUPERVISOR_STALE_LOCK_MANUAL_RECOVERY_REQUIRED',
    });
    await supervisor.releaseAtomicLock(winnerAnchor);

    const logsRoot = join(lockRoot, 'logs');
    await mkdir(logsRoot, { mode: 0o700 });
    await writeFile(join(logsRoot, 'server-old.jsonl'), '{}\n', { mode: 0o600 });
    await writeFile(join(logsRoot, 'server-current.jsonl'), '{}\n', { mode: 0o600 });
    await expect(supervisor.listPrivateLogFiles(logsRoot)).resolves.toHaveLength(2);
    await symlink(join(logsRoot, 'server-old.jsonl'), join(logsRoot, 'unknown-link'));
    await expect(supervisor.listPrivateLogFiles(logsRoot)).rejects.toMatchObject({
      code: 'UAP_HOST_LOG_CLOSURE_INVALID',
    });
    const supervisorSource = await readFile(SUPERVISOR, 'utf8');
    const processValidation = supervisorSource.slice(
      supervisorSource.indexOf('async function validateProcessEntry'),
      supervisorSource.indexOf('async function inspectProcess'),
    );
    expect(processValidation).toContain(
      "if (allowMissing) throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK')",
    );
  });

  it('anchors the zero-model baseline and rejects any observed external model invocation', async () => {
    const audit = await modelInvocationAuditModule();
    expect(audit.EXPECTED_MODEL_STAGES).toEqual(MODEL_STAGES);
    const root = await temporaryDirectory();
    const stateRoot = join(root, 'state');
    const reportRoot = join(root, 'reports/ugv-agent-profile-simulation');
    const dotEnvPath = join(root, '.env');
    await writeFile(dotEnvPath, validDotEnv(), { mode: 0o600 });
    const authority = modelAuthorityFixture(audit.EXPECTED_MODEL_STAGES);
    await expect(
      audit.auditModelInvocations('baseline', {
        repositoryRoot: root,
        stateRoot,
        reportRoot,
        dotEnvPath,
        queryAuthority: () => Promise.resolve(authority),
      }),
    ).resolves.toMatchObject({ noExternalModelInvocation: true, observedInvocationCount: 0 });
    await expect(
      audit.auditModelInvocations('final', {
        repositoryRoot: root,
        stateRoot,
        reportRoot,
        dotEnvPath,
        queryAuthority: () => Promise.resolve(authority),
      }),
    ).resolves.toMatchObject({ auditPhase: 'final', observedInvocationCount: 0 });
    await expect(
      audit.auditModelInvocations('final', {
        repositoryRoot: root,
        stateRoot,
        reportRoot,
        dotEnvPath,
        queryAuthority: () => Promise.resolve({ ...authority, invocationCount: 1 }),
      }),
    ).rejects.toThrow('UAP_MODEL_INVOCATION_OBSERVED');
    const values = (await (await validationModule()).validateDotEnv(dotEnvPath)).values;
    const firstProvider = (authority['providers'] as Record<string, unknown>[])[0];
    const secondProvider = (authority['providers'] as Record<string, unknown>[])[1];
    for (const drift of [
      {
        ...authority,
        providers: [{ ...firstProvider, model: 'wrong' }, secondProvider],
      },
      {
        ...authority,
        providers: [{ ...firstProvider, baseUrl: 'https://wrong.example.test/v1' }, secondProvider],
      },
      {
        ...authority,
        providers: [{ ...firstProvider, apiStyle: 'anthropic_messages' }, secondProvider],
      },
      {
        ...authority,
        providers: [{ ...firstProvider, providerId: 'wrong-provider' }, secondProvider],
      },
      {
        ...authority,
        routes: (authority['routes'] as Record<string, unknown>[]).slice(1),
      },
    ])
      expect(() => audit.validateModelAuthority(drift, values)).toThrow();
  });

  it('keeps the first canonical PASS index while repeated PASS attempts carry new dynamic lineage', async () => {
    const evidence = await evidenceModule();
    const root = await temporaryDirectory();
    const attemptsRoot = join(root, 'reports/ugv-agent-profile-simulation/attempts');
    const target = join(root, 'reports/ugv-agent-profile-simulation/canonical.json');
    const identity = {
      schemaVersion: 'sdar.ugv-agent-profile.test-index/v1',
      status: 'passed',
      task: 'UAP-P3-B01',
      bootstrapRunId: 'uap-p3-b01-contract-repeat',
    };
    const attemptIdentity = {
      schemaVersion: 'sdar.ugv-agent-profile.test/v1',
      status: 'passed',
      task: identity.task,
      bootstrapRunId: identity.bootstrapRunId,
      evidenceClass: 'external_simulation',
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    };
    const firstDocument = { ...attemptIdentity, dynamicRevision: 1 };
    const secondDocument = { ...attemptIdentity, dynamicRevision: 2 };
    const first = await evidence.writeImmutableAttemptJson(
      attemptsRoot,
      'qualification',
      firstDocument,
    );
    const second = await evidence.writeImmutableAttemptJson(
      attemptsRoot,
      'qualification',
      secondDocument,
    );
    const index = (attempt: string, document: Record<string, unknown>) => ({
      ...identity,
      evidenceClass: 'external_simulation',
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attempt.slice(root.length + 1),
      firstPassAttemptSha256: evidence.sha256CanonicalJson(document),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    });
    await evidence.writeCanonicalFirstPassIndex(target, index(first, firstDocument), root);
    await expect(
      evidence.writeCanonicalFirstPassIndex(target, index(second, secondDocument), root),
    ).resolves.toBe(target);
    const winner = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    expect(winner['firstPassAttemptFile']).toBe(first.slice(root.length + 1));
    expect(winner['firstPassAttemptSha256']).toBe(evidence.sha256CanonicalJson(firstDocument));
    await expect(
      evidence.readValidatedFirstPassIndex(target, root, identity),
    ).resolves.toMatchObject({ attemptPath: first });

    await writeFile(
      first,
      `${JSON.stringify({ ...firstDocument, dynamicRevision: 99 }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    await expect(evidence.readValidatedFirstPassIndex(target, root, identity)).rejects.toThrow(
      'UAP_CANONICAL_ATTEMPT_INVALID',
    );
    await writeFile(first, `${JSON.stringify(firstDocument, null, 2)}\n`, { mode: 0o600 });
    const tamperedIndex = { ...winner, firstPassAttemptSha256: '0'.repeat(64) };
    await writeFile(target, `${JSON.stringify(tamperedIndex, null, 2)}\n`, { mode: 0o600 });
    await expect(evidence.readValidatedFirstPassIndex(target, root, identity)).rejects.toThrow(
      'UAP_CANONICAL_ATTEMPT_INVALID',
    );
    await writeFile(target, `${JSON.stringify(winner, null, 2)}\n`, { mode: 0o600 });

    const exactTarget = join(root, 'exact.json');
    await evidence.writeCanonicalJsonFirstWriter(exactTarget, { stable: true });
    await expect(
      evidence.writeCanonicalJsonFirstWriter(exactTarget, { stable: false }),
    ).rejects.toThrow('UAP_CANONICAL_EVIDENCE_DRIFT');
  });

  it('projects repeated formal PMS seed runs as immutable attempts behind one first-PASS index', async () => {
    const projector = await pmsSeedProjectorModule();
    const root = await temporaryDirectory();
    const input = join(root, 'private-seed.jsonl');
    const output = join(root, 'reports/ugv-agent-profile-simulation/pms-seed.redacted.json');
    const stateRoot = join(root, 'state');
    const validPayload = {
      status: 'seeded',
      packageId: 'builtin.isr.vehicle.ugv',
      providerTypeId: 'isr.vehicle.ugv',
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: {
        providerTypeId: 'isr.vehicle.ugv',
        displayName: 'UGV',
        status: 'active',
      },
      provider: {
        providerId: 'isr.vehicle.ugv.ugv1',
        providerTypeId: 'isr.vehicle.ugv',
        packageId: 'builtin.isr.vehicle.ugv',
        packageVersion: '1.0.0',
        hostingMode: 'vendor_managed',
        adapterEndpoint: 'ugv-agent-profile-adapter:7010',
        status: 'active',
      },
      resourceId: 'vehicle:ugv1',
      environment: 'simulation',
      hostingMode: 'vendor_managed',
      runtimeAuthority: 'direct_container',
      registryAuthority: 'pms_worker',
      productionQualification: 'NOT_CLAIMED',
      deployment: {
        deploymentId: 'uap-p3-b01-runtime',
        providerId: 'isr.vehicle.ugv.ugv1',
        environment: 'simulation',
        runtimeVersion: '2.0.0-rc.1',
        adapterEndpoint: 'ugv-agent-profile-adapter:7010',
        desiredReplicas: 1,
        status: 'ACTIVE',
        runtimeAuthority: 'direct_container',
        directContainer: {
          instanceId: 'uap-p3-b01-runtime-1',
          controlEndpoint: 'http://ugv-agent-profile-runtime:8080/',
          advertisedEndpoint: 'http://127.0.0.1:19131/',
        },
      },
      process: {
        instanceId: 'uap-p3-b01-runtime-1',
        deploymentId: 'uap-p3-b01-runtime',
        observedHealth: 'READY',
        readyForActive: true,
        registrationState: 'registered',
        registrationFreshness: 'registered',
        lastHeartbeatAt: new Date().toISOString(),
        configState: 'externally_managed',
      },
      registry: {
        revision: 7,
        checksum: 'a'.repeat(64),
        effectiveEndpoint: 'http://127.0.0.1:19131/mcp',
        catalogToolCount: 10,
        catalogToolNames: [
          'vehicle_area_recon',
          'vehicle_control_gimbal',
          'vehicle_emergency_stop',
          'vehicle_fire_weapon',
          'vehicle_get_capabilities',
          'vehicle_get_payload_status',
          'vehicle_get_state',
          'vehicle_get_targets',
          'vehicle_navigate',
          'vehicle_track_target',
        ],
      },
      resource: {
        environment: 'simulation',
        resourceId: 'vehicle:ugv1',
        resourceType: 'isr.vehicle.ugv',
        status: 'available',
        metadata: {
          displayName: 'UGV 1',
          hostingMode: 'vendor_managed',
          runtimeAuthority: 'direct_container',
          registryAuthority: 'pms_worker',
          productionQualification: 'NOT_CLAIMED',
        },
      },
      resourceBinding: {
        providerId: 'isr.vehicle.ugv.ugv1',
        environment: 'simulation',
        resourceId: 'vehicle:ugv1',
        boundAt: new Date().toISOString(),
      },
      packageSync: { inserted: 1, updated: 0, unchanged: 0 },
      packageProjection: packageProjectionFixture(),
      comparisonBeforeMutation: true,
    };
    await writeFile(input, `${JSON.stringify(validPayload)}\n`, { mode: 0o600 });

    await expect(
      projector.projectPmsSeedReport(input, output, { repositoryRoot: root, stateRoot }),
    ).resolves.toMatchObject({
      packageSynchronization: {
        controlledPackageCount: 1,
        inserted: 1,
        unchanged: 0,
        packageProjectionSha256: 'ef3a3a2b61e1cc3a6d8136d8df3ddc1ccc4c336f1b1350ad62a2cd2988619c52',
      },
    });
    const firstIndex = await readFile(output, 'utf8');
    await writeFile(
      input,
      `${JSON.stringify({
        ...validPayload,
        packageSync: { inserted: 0, updated: 0, unchanged: 1 },
      })}\n`,
      { mode: 0o600 },
    );
    await projector.projectPmsSeedReport(input, output, { repositoryRoot: root, stateRoot });

    expect(await readFile(output, 'utf8')).toBe(firstIndex);
    expect(await readdir(join(root, 'reports/ugv-agent-profile-simulation/attempts'))).toHaveLength(
      2,
    );
    const index = JSON.parse(firstIndex) as Record<string, unknown>;
    expect(index['canonicalSemantics']).toBe('immutable_first_pass');
    expect(index['firstPassAttemptSha256']).toMatch(/^[a-f0-9]{64}$/u);

    for (const invalid of [
      { ...validPayload, packageSync: undefined },
      { ...validPayload, packageSync: { inserted: 0, updated: 0, unchanged: 0 } },
      { ...validPayload, packageSync: { inserted: 2, updated: 0, unchanged: 0 } },
      {
        ...validPayload,
        packageProjection: {
          ...packageProjectionFixture(),
          contentChecksum: 'b'.repeat(64),
        },
      },
      {
        ...validPayload,
        packageProjection: {
          ...packageProjectionFixture(),
          content: { ...packageProjectionFixture().content, protocolMode: 'drift' },
        },
      },
      { ...validPayload, providerType: { ...validPayload.providerType, displayName: 'drift' } },
      { ...validPayload, provider: { ...validPayload.provider, status: 'degraded' } },
      {
        ...validPayload,
        registry: {
          ...validPayload.registry,
          catalogToolCount: 11,
          catalogToolNames: [
            ...validPayload.registry.catalogToolNames,
            'vehicle_laser_range',
          ].sort(),
        },
      },
      {
        ...validPayload,
        registry: {
          ...validPayload.registry,
          catalogToolCount: 9,
          catalogToolNames: [...validPayload.registry.catalogToolNames].filter(
            (name) => name !== 'vehicle_get_state',
          ),
        },
      },
      {
        ...validPayload,
        resourceBinding: { ...validPayload.resourceBinding, providerId: 'drift' },
      },
      {
        ...validPayload,
        resource: { ...validPayload.resource, status: 'unavailable' },
      },
      {
        ...validPayload,
        process: { ...validPayload.process, readyForActive: false },
      },
      { ...validPayload, deployment: { ...validPayload.deployment, status: 'DEGRADED' } },
    ]) {
      const invalidInput = join(root, `invalid-${randomBytes(4).toString('hex')}.jsonl`);
      await writeFile(invalidInput, `${JSON.stringify(invalid)}\n`, { mode: 0o600 });
      await expect(
        projector.projectPmsSeedReport(invalidInput, output, { repositoryRoot: root, stateRoot }),
      ).rejects.toThrow('UAP_PMS_SEED_AUTHORITY_INVALID');
    }
  });

  it('validates readiness lifecycle as a distinct authority schema with bare public hashes', async () => {
    const projector = await authorityProjectorModule();
    const root = await temporaryDirectory();
    const stateRoot = join(root, 'state');
    const input = join(root, 'readiness-private.json');
    const output = join(root, 'reports/ugv-agent-profile-simulation/readiness.redacted.json');
    const beforeHash = 'a'.repeat(64);
    const a2aHash = 'b'.repeat(64);
    const payload = readinessAuthorityFixture(beforeHash, a2aHash);
    await writeFile(input, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    await expect(
      projector.projectAuthorityReport('readiness', input, output, {
        repositoryRoot: root,
        stateRoot,
      }),
    ).resolves.toMatchObject({
      command: 'deploy/ugv-agent-profile-simulation/readiness.sh',
      authorityMode: 'readiness',
      skillLifecycle: { finalGovernedStatus: 'published' },
      profilePublicCardLifecycle: { semanticRestored: true },
      managedCardSeparation: { unchangedAcrossSkillLifecycle: true },
    });

    const negativeRevision = structuredClone(payload);
    asRecord(negativeRevision['skillLifecycle'])['beforeRevision'] = -1;
    await writeFile(input, `${JSON.stringify(negativeRevision)}\n`, { mode: 0o600 });
    await expect(
      projector.projectAuthorityReport('readiness', input, output, {
        repositoryRoot: root,
        stateRoot,
      }),
    ).rejects.toThrow('UAP_AUTHORITY_REPORT_INVALID');
    await writeFile(input, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    const firstReadinessIndex = await readFile(output, 'utf8');
    await projector.projectAuthorityReport('readiness', input, output, {
      repositoryRoot: root,
      stateRoot,
    });
    expect(await readFile(output, 'utf8')).toBe(firstReadinessIndex);

    const prefixed = structuredClone(payload);
    asRecord(asRecord(prefixed['profilePublicCardLifecycle'])['before'])['managementContentHash'] =
      `sha256:${beforeHash}`;
    await writeFile(input, `${JSON.stringify(prefixed)}\n`, { mode: 0o600 });
    await expect(
      projector.projectAuthorityReport('readiness', input, output, {
        repositoryRoot: root,
        stateRoot,
      }),
    ).rejects.toThrow('UAP_AUTHORITY_REPORT_INVALID');

    const verifyInput = join(root, 'verify-private.json');
    const verifyOutput = join(root, 'reports/ugv-agent-profile-simulation/verify.redacted.json');
    await writeFile(verifyInput, `${JSON.stringify(bootstrapAuthorityFixture('verify'))}\n`, {
      mode: 0o600,
    });
    await expect(
      projector.projectAuthorityReport('verify', verifyInput, verifyOutput, {
        repositoryRoot: root,
        stateRoot,
      }),
    ).resolves.toMatchObject({
      command: 'deploy/ugv-agent-profile-simulation/verify.sh',
      authorityMode: 'verify',
    });
  });

  it('reserves distinct immutable bootstrap and future simulation identities with credentials under concurrency', async () => {
    const state = await stateModule();
    const validator = await validationModule();
    const stateRoot = join(await temporaryDirectory(), 'state');
    const attempts = await Promise.allSettled(
      Array.from({ length: 24 }, async () => state.initializeState(stateRoot)),
    );
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toEqual([]);
    const initialized = attempts.flatMap((attempt) =>
      attempt.status === 'fulfilled' ? [attempt.value] : [],
    );

    expect(new Set(initialized.map((value) => value.runId))).toHaveLength(1);
    expect(new Set(initialized.map((value) => value.bootstrapRunId))).toHaveLength(1);
    expect(new Set(initialized.map((value) => value.simulationRunId))).toHaveLength(1);
    expect(initialized[0]?.runId).toBe(initialized[0]?.bootstrapRunId);
    expect(initialized[0]?.bootstrapRunId).toMatch(/^uap-p3-b01-/u);
    expect(initialized[0]?.simulationRunId).toMatch(/^uap-p3-b02-/u);
    expect(initialized[0]?.bootstrapRunId).not.toBe(initialized[0]?.simulationRunId);
    const secretPaths = [
      'control-api.token',
      'runtime-control-service.token',
      'governed-control.token',
      'artifact-management.token',
      'pms/runtime-registration.token',
      'pms/postgres-provisioning.json',
      'run-id',
      'simulation-run-id',
    ];
    const initialContents = new Map<string, string>();
    for (const relativePath of secretPaths) {
      const path = join(stateRoot, relativePath);
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      initialContents.set(relativePath, await readFile(path, 'utf8'));
    }

    const repeated = await state.initializeState(stateRoot);
    expect(repeated.bootstrapRunId).toBe(initialized[0]?.bootstrapRunId);
    expect(repeated.simulationRunId).toBe(initialized[0]?.simulationRunId);
    for (const [relativePath, content] of initialContents)
      expect(await readFile(join(stateRoot, relativePath), 'utf8')).toBe(content);

    const descriptor = JSON.parse(
      await readFile(join(stateRoot, 'pms/runtime-credentials.json'), 'utf8'),
    ) as unknown;
    validator.validatePmsRuntimeCredentialDescriptor(descriptor);
    expect(JSON.stringify(descriptor)).not.toContain(
      initialContents.get('pms/runtime-registration.token')?.trim(),
    );
  });

  it('renders exact independent Compose projects with separated northbound/southbound ownership and no dotenv material', async () => {
    const validator = await validationModule();
    const directory = await temporaryDirectory();
    const stateRoot = join(directory, 'pms');
    const smpp = await renderSmppCompose(stateRoot);
    const sdar = await renderSdarCompose();
    const envPath = join(directory, '.env');
    await writeFile(envPath, validDotEnv(), { mode: 0o600 });
    const accepted = await validator.validateDotEnv(envPath);
    const classificationValues = {
      ...accepted.values,
      UAP_GENERIC_HOST: '127.0.0.1',
      UAP_GENERIC_ENVIRONMENT: 'simulation',
    };
    const publicMaterial = validator.publicConfigurationMaterial(
      classificationValues,
      accepted.secretValues,
    );
    expect(publicMaterial).not.toContain('127.0.0.1');
    expect(publicMaterial).not.toContain('simulation');
    expect(JSON.stringify(smpp)).toContain('127.0.0.1');
    expect(JSON.stringify(smpp)).toContain('simulation');
    validator.validateSmppCompose(
      smpp,
      publicMaterial,
      Object.keys(classificationValues),
      stateRoot,
    );
    validator.validateSdarCompose(sdar, publicMaterial, Object.keys(classificationValues));

    const expectedPostgresDockerfile = resolve(
      REPOSITORY_ROOT,
      'infra/postgres/Dockerfile.pgvector-hardened',
    );
    for (const serviceName of ['uap-sdar-postgres', 'uap-control-postgres']) {
      const build = asRecord(asRecord(asRecord(sdar['services'])[serviceName])['build']);
      expect(build['context']).toBe(REPOSITORY_ROOT);
      expect(resolve(String(build['context']), String(build['dockerfile']))).toBe(
        expectedPostgresDockerfile,
      );
    }
    expect(Object.keys(asRecord(sdar['networks'])).sort()).toEqual([
      'uap-sdar',
      'uap-sdar-northbound',
    ]);
    for (const service of Object.values(asRecord(sdar['services'])))
      expect(Object.keys(asRecord(asRecord(service)['networks'])).sort()).toEqual([
        'uap-sdar',
        'uap-sdar-northbound',
      ]);
    const escapedBuildContext = structuredClone(sdar);
    asRecord(asRecord(asRecord(escapedBuildContext['services'])['uap-sdar-postgres'])['build'])[
      'context'
    ] = resolve(REPOSITORY_ROOT, '../..');
    expect(() => {
      validator.validateSdarCompose(escapedBuildContext, [], []);
    }).toThrow(expect.objectContaining({ code: 'UAP_SDAR_BUILD_CONTEXT_INVALID' }));
    const missingSdarNorthbound = structuredClone(sdar);
    delete asRecord(asRecord(asRecord(missingSdarNorthbound['services'])['uap-redis'])['networks'])[
      'uap-sdar-northbound'
    ];
    expect(() => {
      validator.validateSdarCompose(missingSdarNorthbound, [], []);
    }).toThrow(expect.objectContaining({ code: 'UAP_SDAR_SERVICE_NETWORK_INVALID' }));

    validator.validateSmppCompose(
      smpp,
      ['dotenv-secret-canary'],
      ['SDAR_UGV_MODEL_API_KEY'],
      stateRoot,
    );
    validator.validateSdarCompose(sdar, ['dotenv-secret-canary'], ['SDAR_UGV_MODEL_API_KEY']);
    expect(Object.keys(asRecord(smpp['services'])).sort()).toEqual([...SMPP_SERVICES].sort());
    expect(asRecord(asRecord(smpp['networks'])['ugv-agent-profile-simulation'])['internal']).toBe(
      true,
    );
    expect(Object.keys(asRecord(smpp['networks'])).sort()).toEqual([
      'ugv-agent-profile-northbound',
      'ugv-agent-profile-simulation',
      'ugv-agent-profile-southbound',
    ]);
    const southboundOwners = Object.entries(asRecord(smpp['services']))
      .filter(([, service]) =>
        Object.hasOwn(asRecord(asRecord(service)['networks']), 'ugv-agent-profile-southbound'),
      )
      .map(([name]) => name);
    expect(southboundOwners).toEqual(['ugv-agent-profile-adapter']);
    const northboundOwners = Object.entries(asRecord(smpp['services']))
      .filter(([, service]) =>
        Object.hasOwn(asRecord(asRecord(service)['networks']), 'ugv-agent-profile-northbound'),
      )
      .map(([name]) => name)
      .sort();
    expect(northboundOwners).toEqual(['ugv-agent-profile-pms-api', 'ugv-agent-profile-runtime']);

    const missingNorthboundOwner = structuredClone(smpp);
    delete asRecord(
      asRecord(asRecord(missingNorthboundOwner['services'])['ugv-agent-profile-runtime'])[
        'networks'
      ],
    )['ugv-agent-profile-northbound'];
    expect(() => {
      validator.validateSmppCompose(missingNorthboundOwner, [], [], stateRoot);
    }).toThrow(expect.objectContaining({ code: 'UAP_SMPP_SERVICE_NETWORK_CLOSURE_INVALID' }));

    const foreignNorthboundOwner = structuredClone(smpp);
    asRecord(
      asRecord(asRecord(foreignNorthboundOwner['services'])['ugv-agent-profile-pms-worker'])[
        'networks'
      ],
    )['ugv-agent-profile-northbound'] = null;
    expect(() => {
      validator.validateSmppCompose(foreignNorthboundOwner, [], [], stateRoot);
    }).toThrow(expect.objectContaining({ code: 'UAP_SMPP_SERVICE_NETWORK_CLOSURE_INVALID' }));

    const leaked = structuredClone(smpp);
    asRecord(asRecord(asRecord(leaked['services'])['ugv-agent-profile-runtime'])['environment'])[
      'SDAR_UGV_MODEL_API_KEY'
    ] = 'dotenv-secret-canary';
    expect(() => {
      validator.validateSmppCompose(
        leaked,
        ['dotenv-secret-canary'],
        ['SDAR_UGV_MODEL_API_KEY'],
        stateRoot,
      );
    }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_VALUE_EXPOSED' }));

    const widenedMount = structuredClone(smpp);
    const api = asRecord(asRecord(widenedMount['services'])['ugv-agent-profile-pms-api']);
    api['volumes'] = [
      {
        type: 'bind',
        source: stateRoot,
        target: '/run/uap-pms',
        read_only: true,
      },
    ];
    expect(() => {
      validator.validateSmppCompose(widenedMount, [], [], stateRoot);
    }).toThrow(expect.objectContaining({ code: 'UAP_PMS_BIND_MOUNT_CLOSURE_INVALID' }));

    for (const leakedValue of [
      accepted.values['SDAR_UGV_MODEL_BASE_URL'],
      accepted.values['SDAR_UGV_MODEL_NAME'],
      accepted.values['SDAR_UGV_MODEL_API_KEY'],
    ]) {
      const modelLeak = structuredClone(smpp);
      asRecord(
        asRecord(asRecord(modelLeak['services'])['ugv-agent-profile-runtime'])['environment'],
      )['UAP_PUBLIC_LEAK_CANARY'] = leakedValue;
      expect(() => {
        validator.validateSmppCompose(
          modelLeak,
          publicMaterial,
          Object.keys(classificationValues),
          stateRoot,
        );
      }).toThrow(expect.objectContaining({ code: 'UAP_DOTENV_VALUE_EXPOSED' }));
    }
  });

  it('fails closed on rogue project containers, unsafe supervisor mode, or uncertain volume cleanup', async () => {
    const running = await runningStackModule();
    const smppInventory = dockerProjectInventory('sdar-uap-p3-b01-smpp', SMPP_SERVICES);
    expect(
      running.validateProjectInventory(smppInventory, {
        mode: 'running',
        project: 'sdar-uap-p3-b01-smpp',
        expectedServices: SMPP_SERVICES,
      }),
    ).toEqual({ serviceCount: 7 });
    const liveExposure = dockerSmppRuntimeInventory();
    expect(running.validateSmppRuntimeExposure(liveExposure)).toEqual({
      serviceCount: 7,
      publishedPortOwnerCount: 3,
      northboundOwnerCount: 2,
      southboundOwnerCount: 1,
    });
    const nullPmsMapping = structuredClone(liveExposure);
    asRecord(inventoryService(nullPmsMapping, 'ugv-agent-profile-pms-api')['NetworkSettings'])[
      'Ports'
    ] = { '8090/tcp': null };
    expect(() => running.validateSmppRuntimeExposure(nullPmsMapping)).toThrow(
      'UAP_SMPP_LIVE_PORT_EXPOSURE_INVALID',
    );
    const widenedWorkerNetwork = structuredClone(liveExposure);
    asRecord(
      asRecord(
        inventoryService(widenedWorkerNetwork, 'ugv-agent-profile-pms-worker')['NetworkSettings'],
      )['Networks'],
    )['sdar-uap-p3-b01-smpp-northbound'] = {
      NetworkID: 'network-northbound',
      IPAddress: '172.31.0.7',
    };
    expect(() => running.validateSmppRuntimeExposure(widenedWorkerNetwork)).toThrow(
      'UAP_SMPP_LIVE_NETWORK_INVALID',
    );
    const sdarLiveExposure = dockerSdarRuntimeInventory();
    expect(running.validateSdarRuntimeExposure(sdarLiveExposure)).toEqual({
      serviceCount: 3,
      publishedPortOwnerCount: 3,
      northboundOwnerCount: 3,
    });
    const nullRuntimeDatabaseMapping = structuredClone(sdarLiveExposure);
    asRecord(inventoryService(nullRuntimeDatabaseMapping, 'uap-sdar-postgres')['NetworkSettings'])[
      'Ports'
    ] = { '5432/tcp': null };
    expect(() => running.validateSdarRuntimeExposure(nullRuntimeDatabaseMapping)).toThrow(
      'UAP_SDAR_LIVE_PORT_EXPOSURE_INVALID',
    );
    const widenedRedisNetwork = structuredClone(sdarLiveExposure);
    asRecord(
      asRecord(inventoryService(widenedRedisNetwork, 'uap-redis')['NetworkSettings'])['Networks'],
    )['foreign-network'] = { NetworkID: 'foreign-network', IPAddress: '172.31.1.9' };
    expect(() => running.validateSdarRuntimeExposure(widenedRedisNetwork)).toThrow(
      'UAP_SDAR_LIVE_NETWORK_INVALID',
    );
    expect(() =>
      running.validateProjectInventory(
        [...smppInventory, ...dockerProjectInventory('sdar-uap-p3-b01-smpp', ['rogue-service'])],
        {
          mode: 'running',
          project: 'sdar-uap-p3-b01-smpp',
          expectedServices: SMPP_SERVICES,
        },
      ),
    ).toThrow('UAP_PROJECT_INVENTORY_INVALID');
    expect(() =>
      running.validateProjectInventory(smppInventory.slice(1), {
        mode: 'closure',
        project: 'sdar-uap-p3-b01-smpp',
        expectedServices: SMPP_SERVICES,
      }),
    ).toThrow('UAP_PROJECT_INVENTORY_INVALID');
    expect(
      running.validateProjectInventory([], {
        mode: 'closure',
        project: 'sdar-uap-p3-b01-smpp',
        expectedServices: SMPP_SERVICES,
      }),
    ).toEqual({ serviceCount: 0 });
    expect(
      running.validateSupervisorStatus({ status: 'running', processCount: 3, sideEffects: 'NO' }),
    ).toEqual({ processCount: 3, sideEffects: 'NO' });
    for (const unsafe of [
      { status: 'running', processCount: 3, sideEffects: 'YES' },
      { status: 'running', processCount: 3, sideEffects: 'NO', extra: true },
      { status: 'running', processCount: 2, sideEffects: 'NO' },
    ])
      expect(() => running.validateSupervisorStatus(unsafe)).toThrow(
        'UAP_SUPERVISOR_STATUS_INVALID',
      );

    const commonPath = join(DEPLOY_ROOT, 'common.sh');
    const shellCase = (source: string, ...arguments_: string[]) =>
      execFileAsync('bash', ['-c', source, 'uap-volume-contract', commonPath, ...arguments_], {
        cwd: REPOSITORY_ROOT,
      });
    await expect(
      shellCase(
        'source "$1"; uap_docker(){ return 7; }; set +e; uap_remove_owned_volume project volume; code=$?; set -e; [[ "$code" -eq 2 ]]',
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: 'UAP_VOLUME_INVENTORY_FAILED\n' });
    await expect(
      shellCase(
        'source "$1"; uap_docker(){ if [[ "$1 $2" == "volume ls" ]]; then printf "other\\n"; return 0; fi; return 9; }; uap_remove_owned_volume project volume',
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(
      shellCase(
        'source "$1"; uap_docker(){ if [[ "$1 $2" == "volume ls" ]]; then printf "volume\\n"; return 0; fi; return 7; }; set +e; uap_remove_owned_volume project volume; code=$?; set -e; [[ "$code" -eq 2 ]]',
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: 'UAP_VOLUME_INSPECTION_FAILED\n' });
    await expect(
      shellCase(
        'source "$1"; uap_docker(){ if [[ "$1 $2" == "volume ls" ]]; then printf "volume\\n"; elif [[ "$1 $2" == "volume inspect" ]]; then printf "foreign\\n"; else return 9; fi; }; set +e; uap_remove_owned_volume project volume; code=$?; set -e; [[ "$code" -eq 2 ]]',
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: 'UAP_VOLUME_OWNERSHIP_MISMATCH\n' });
    const removedMarker = join(await temporaryDirectory(), 'removed');
    await expect(
      shellCase(
        'source "$1"; marker="$2"; uap_docker(){ if [[ "$1 $2" == "volume ls" ]]; then [[ -f "$marker" ]] || printf "volume\\n"; elif [[ "$1 $2" == "volume inspect" ]]; then printf "project\\n"; elif [[ "$1 $2" == "volume rm" ]]; then : >"$marker"; else return 9; fi; }; uap_remove_owned_volume project volume; [[ -f "$marker" ]]',
        removedMarker,
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(
      shellCase(
        'source "$1"; uap_docker(){ if [[ "$1 $2" == "volume ls" ]]; then printf "volume\\n"; elif [[ "$1 $2" == "volume inspect" ]]; then printf "project\\n"; elif [[ "$1 $2" == "volume rm" ]]; then return 0; else return 9; fi; }; set +e; uap_remove_owned_volume project volume; code=$?; set -e; [[ "$code" -eq 2 ]]',
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: 'UAP_VOLUME_REMOVAL_POSTCHECK_FAILED\n' });
  });

  it('keeps shell orchestration from sourcing, mounting, or interpolating the repository dotenv', async () => {
    const common = await readFile(join(DEPLOY_ROOT, 'common.sh'), 'utf8');
    const smppOverlay = await readFile(join(DEPLOY_ROOT, 'compose.smpp-pms.yaml'), 'utf8');
    const sdarCompose = await readFile(join(DEPLOY_ROOT, 'compose.sdar.yaml'), 'utf8');
    const sources = `${common}\n${smppOverlay}\n${sdarCompose}`;

    expect(common).toContain('--env-file /dev/null');
    expect(common).toContain('--project-name "$UAP_SMPP_PROJECT"');
    for (const command of ['config', 'up', 'ps', 'logs'])
      expect(common).toContain(`uap_smpp_compose ${command} "$@" "\${UAP_SMPP_SERVICES[@]}"`);
    expect(common.match(/\n\s+-f /gu)).toHaveLength(4);
    expect(sources).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+[^\n]*\.env/gu);
    expect(sources).not.toMatch(/(?:^|\n)\s*env_file\s*:/gu);
    expect(sources).not.toMatch(/(?:source|target)\s*:\s*[^\n]*\.env/gu);
    expect(sdarCompose).not.toContain('baseline.sql');
    expect(sdarCompose).not.toContain('minimal.sql');
    expect(smppOverlay).toContain('UGV_MQTT_CLIENT_ID: sdar-uap-p3-b01-ugv1');
    expect(smppOverlay).toContain('PMS_DEPLOYMENT_ID: uap-p3-b01-runtime');
    expect(smppOverlay).toContain('aliases: [pms-api]');
    expect(smppOverlay).toContain('name: sdar-uap-p3-b01-smpp-northbound');
    const cleanStart = await readFile(
      resolve(REPOSITORY_ROOT, 'scripts/ugv-agent-profile-simulation/check-clean-start.mjs'),
      'utf8',
    );
    expect(cleanStart).toContain("'sdar-uap-p3-b01-smpp-northbound'");
    expect(cleanStart).toContain("'sdar-uap-p3-b01-sdar-northbound'");
    expect(cleanStart).toContain("value.startsWith('sdar-uap-p3-b01-sdar-')");

    const upSmpp = await readFile(join(DEPLOY_ROOT, 'up-smpp.sh'), 'utf8');
    const liveExposureGate = upSmpp.indexOf('uap_assert_smpp_live_exposure');
    const seedInvocation = upSmpp.indexOf('"$script_directory/seed-smpp.sh"');
    expect(upSmpp).toContain('set -Eeuo pipefail');
    expect(liveExposureGate).toBeGreaterThan(upSmpp.indexOf('uap_smpp_up'));
    expect(liveExposureGate).toBeLessThan(seedInvocation);
    expect(upSmpp.slice(liveExposureGate, seedInvocation)).not.toContain('||');
    expect(common).toContain('--smpp-runtime-inspect "$render_root/smpp-live-inspect.json"');

    const upSdar = await readFile(join(DEPLOY_ROOT, 'up-sdar.sh'), 'utf8');
    const sdarLiveExposureGate = upSdar.indexOf('uap_assert_sdar_live_exposure');
    const supervisorInvocation = upSdar.indexOf('uap_supervisor start');
    expect(upSdar).toContain('set -Eeuo pipefail');
    expect(sdarLiveExposureGate).toBeGreaterThan(upSdar.indexOf('uap_sdar_up'));
    expect(sdarLiveExposureGate).toBeLessThan(supervisorInvocation);
    expect(upSdar.slice(sdarLiveExposureGate, supervisorInvocation)).not.toContain('||');
    expect(common).toContain('--sdar-runtime-inspect "$render_root/sdar-live-inspect.json"');

    const seed = await readFile(join(DEPLOY_ROOT, 'seed-smpp.sh'), 'utf8');
    const pmsSeed = await readFile(
      resolve(REPOSITORY_ROOT, 'scripts/ugv-agent-profile-simulation/pms-profile-seed.mjs'),
      'utf8',
    );
    const qualifier = await readFile(
      resolve(REPOSITORY_ROOT, 'scripts/ugv-agent-profile-simulation/qualify-smpp-readonly.mjs'),
      'utf8',
    );
    const pmsProjector = await readFile(
      resolve(REPOSITORY_ROOT, 'scripts/ugv-agent-profile-simulation/project-pms-seed-report.mjs'),
      'utf8',
    );
    expect(seed).toContain('pms-profile-seed.mjs');
    expect(seed).not.toContain('production-bundles/ugv/bin/pms-seed.mjs');
    expect(seed).toContain('validate-profile.mjs" private-log');
    expect(pmsSeed.indexOf('await ensureProviderType();')).toBeLessThan(
      pmsSeed.indexOf('await synchronizeWorkspaceProviderPackages'),
    );
    expect(pmsSeed.indexOf('await synchronizeWorkspaceProviderPackages')).toBeLessThan(
      pmsSeed.indexOf('await assertProviderType();'),
    );
    const providerTypeFunction = pmsSeed.slice(
      pmsSeed.indexOf('async function ensureProviderType()'),
      pmsSeed.indexOf('async function assertProviderType()'),
    );
    expect(providerTypeFunction.indexOf("await api('PATCH'")).toBeLessThan(
      providerTypeFunction.lastIndexOf("await api('GET', path)"),
    );
    const providerFunction = pmsSeed.slice(
      pmsSeed.indexOf('async function ensureProvider()'),
      pmsSeed.indexOf('async function ensureResource()'),
    );
    expect(providerFunction.indexOf("await api('PATCH'")).toBeLessThan(
      providerFunction.lastIndexOf("await api('GET', path)"),
    );
    const resourceFunction = pmsSeed.slice(
      pmsSeed.indexOf('async function ensureResource()'),
      pmsSeed.indexOf('async function ensureResourceBinding()'),
    );
    expect(resourceFunction.indexOf('resourceMetadataMatches')).toBeLessThan(
      resourceFunction.indexOf("current.status !== 'available'"),
    );
    const bindingFunction = pmsSeed.slice(
      pmsSeed.indexOf('async function ensureResourceBinding()'),
      pmsSeed.indexOf('async function ensureDeployment()'),
    );
    expect(
      bindingFunction.indexOf('listed.items.length === 1 && matches.length === 0'),
    ).toBeLessThan(bindingFunction.indexOf("await api('POST', path"));
    expect(qualifier).toContain("const READ_OPERATION = 'vehicle_get_state'");
    expect(qualifier).not.toMatch(/tools\/call[\s\S]*vehicle_get_payload_status/gu);
    expect(qualifier).toContain("'io.sdar/taskExecution/checkAvailability'");
    expect(qualifier).toContain('FROM ugv_mutation_journal');
    expect(qualifier).toContain('FROM ugv_execution_command_ack');
    for (const source of [pmsSeed, pmsProjector, qualifier]) {
      const catalogClosure = source.slice(
        source.indexOf('const EXPECTED_TOOLS'),
        source.indexOf(']);', source.indexOf('const EXPECTED_TOOLS')),
      );
      expect(catalogClosure).not.toContain("'vehicle_laser_range'");
      expect(catalogClosure).toContain("'vehicle_get_state'");
      expect(catalogClosure).toContain("'vehicle_navigate'");
      expect(catalogClosure).toContain("'vehicle_fire_weapon'");
    }

    const bootstrap = await readFile(join(DEPLOY_ROOT, 'bootstrap-authority.sh'), 'utf8');
    expect(bootstrap).toContain('uap_assert_owned_stack_running');
    expect(bootstrap.indexOf('uap_assert_owned_stack_running')).toBeLessThan(
      bootstrap.indexOf('authority-bootstrap-driver.ts'),
    );
    expect(bootstrap).not.toContain('preflight.sh');
    expect(bootstrap).not.toContain('up-smpp.sh');
    expect(bootstrap).not.toContain('up-sdar.sh');
    expect(bootstrap).toContain('SDAR_CONTROL_API_TOKEN_FILE=');
    expect(bootstrap).toContain('SDAR_UAP_PROFILE_A2A_BASE_URL=http://127.0.0.1:10999');
    expect(bootstrap).toContain('uap_smpp_source_id="smpp-source-ugv1-uap-p3-b01"');
    expect(bootstrap).toContain('SMPP_SDAR_SOURCE_ID="$uap_smpp_source_id"');
    expect(bootstrap).toContain(
      'SMPP_SDAR_REGISTRY_ENDPOINT="http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/$uap_smpp_source_id/latest"',
    );

    const aggregateUp = await readFile(join(DEPLOY_ROOT, 'up.sh'), 'utf8');
    expect(aggregateUp.indexOf('"$script_directory/up-smpp.sh"')).toBeLessThan(
      aggregateUp.indexOf('"$script_directory/up-sdar.sh"'),
    );
    const aggregateBootstrap = await readFile(join(DEPLOY_ROOT, 'bootstrap.sh'), 'utf8');
    expect(aggregateBootstrap).toContain('"$script_directory/bootstrap-authority.sh"');
    expect(aggregateBootstrap).not.toContain('preflight.sh');
    expect(aggregateBootstrap).not.toContain('up.sh');
    expect(aggregateBootstrap).not.toContain('up-smpp.sh');
    expect(aggregateBootstrap).not.toContain('up-sdar.sh');

    const readiness = await readFile(join(DEPLOY_ROOT, 'readiness.sh'), 'utf8');
    expect(readiness).toMatch(/authority-bootstrap-driver\.ts" \\\n+\s+readiness/gu);
    expect(readiness.indexOf('uap_assert_owned_stack_running')).toBeLessThan(
      readiness.indexOf('authority-bootstrap-driver.ts'),
    );
    expect(readiness).toContain('SDAR_UAP_PROFILE_A2A_BASE_URL=http://127.0.0.1:10999');
    expect(readiness).toContain('uap_smpp_source_id="smpp-source-ugv1-uap-p3-b01"');
    expect(readiness).toContain('SMPP_SDAR_SOURCE_ID="$uap_smpp_source_id"');
    expect(readiness).toContain(
      'SMPP_SDAR_REGISTRY_ENDPOINT="http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/$uap_smpp_source_id/latest"',
    );
    expect(qualifier).toContain("const SDAR_SOURCE_ID = 'smpp-source-ugv1-uap-p3-b01'");
    expect(qualifier).toContain(
      '`/api/v1/registry/simulation/consumers/sdar/v1/sources/${SDAR_SOURCE_ID}/latest`',
    );
    expect(common).toContain('if ! active_output="$(uap_supervisor log-files)"');
    expect(common).toContain('if ! stored_output="$(uap_supervisor stored-log-files)"');
    expect(common).toContain('(${#active_log_files[@]} != UAP_HOST_PROCESS_COUNT)');
    expect(common).toContain('uap_docker ps -a');
    expect(common).toContain('label=com.docker.compose.project=$project');
    expect(common).toContain('supervisor-status.json');
    expect(common).toContain('if ! uap_supervisor status >"$render_root/supervisor-status.json"');
    const down = await readFile(join(DEPLOY_ROOT, 'down.sh'), 'utf8');
    expect(down.indexOf('uap_assert_owned_project_closure')).toBeLessThan(
      down.indexOf('uap_supervisor stop'),
    );
    expect(down.indexOf('uap_supervisor stop')).toBeLessThan(
      down.lastIndexOf('uap_scan_host_process_logs stored-log-files'),
    );
    expect(common).not.toContain('mapfile -t smpp_ids < <(uap_smpp_ps');
    expect(common).not.toContain('mapfile -t sdar_ids < <(uap_sdar_ps');
    await expect(
      execFileAsync(
        'bash',
        [
          '-c',
          'source "$1"; failing_ps(){ return 7; }; ids=(); set +e; uap_read_command_lines ids failing_ps; status=$?; set -e; [[ "$status" -eq 2 && "${#ids[@]}" -eq 0 ]]',
          'uap-contract',
          join(DEPLOY_ROOT, 'common.sh'),
        ],
        { cwd: REPOSITORY_ROOT },
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(
      execFileAsync(
        'bash',
        [
          '-c',
          'source "$1"; abort_for_test(){ printf "handled:%s\\n" "$1"; exit "$1"; }; uap_install_abort_traps abort_for_test; kill -TERM "$$"; exit 99',
          'uap-contract',
          join(DEPLOY_ROOT, 'common.sh'),
        ],
        { cwd: REPOSITORY_ROOT },
      ),
    ).rejects.toMatchObject({ code: 143, stdout: 'handled:143\n', stderr: '' });
    for (const name of ['up.sh', 'up-smpp.sh', 'up-sdar.sh']) {
      const startup = await readFile(join(DEPLOY_ROOT, name), 'utf8');
      expect(startup).toContain('uap_install_abort_traps uap_abort');
      expect(startup).toContain('uap_failure_handled="false"');
      expect(startup).not.toContain('--remove-orphans');
    }
    for (const name of (await readdir(DEPLOY_ROOT)).filter((value) => value.endsWith('.sh')))
      expect(await readFile(join(DEPLOY_ROOT, name), 'utf8')).not.toContain('--remove-orphans');
  });
});

async function stateModule(): Promise<StateModule> {
  return (await import(pathToFileURL(INITIALIZE_STATE).href)) as StateModule;
}

async function validationModule(): Promise<ValidationModule> {
  return (await import(pathToFileURL(VALIDATE_PROFILE).href)) as ValidationModule;
}

async function attemptModule(): Promise<AttemptModule> {
  return (await import(pathToFileURL(RECORD_ATTEMPT).href)) as AttemptModule;
}

async function qualifierModule(): Promise<QualifierModule> {
  return (await import(pathToFileURL(QUALIFY_SMPP).href)) as QualifierModule;
}

async function evidenceModule(): Promise<EvidenceModule> {
  return (await import(pathToFileURL(EVIDENCE_FILES).href)) as EvidenceModule;
}

async function pmsSeedProjectorModule(): Promise<PmsSeedProjectorModule> {
  return (await import(pathToFileURL(PROJECT_PMS_SEED_REPORT).href)) as PmsSeedProjectorModule;
}

async function authorityProjectorModule(): Promise<AuthorityProjectorModule> {
  return (await import(pathToFileURL(PROJECT_AUTHORITY_REPORT).href)) as AuthorityProjectorModule;
}

async function supervisorModule(): Promise<SupervisorModule> {
  return (await import(pathToFileURL(SUPERVISOR).href)) as SupervisorModule;
}

async function modelInvocationAuditModule(): Promise<ModelInvocationAuditModule> {
  return (await import(pathToFileURL(MODEL_INVOCATION_AUDIT).href)) as ModelInvocationAuditModule;
}

async function runningStackModule(): Promise<RunningStackModule> {
  return (await import(pathToFileURL(VALIDATE_RUNNING_STACK).href)) as RunningStackModule;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sdar-uap-p3-b01-contract-'));
  temporaryDirectories.push(directory);
  return directory;
}

function validDotEnv(): string {
  return [
    `SDAR_MASTER_KEY_BASE64=${randomBytes(32).toString('base64')}`,
    'SDAR_UGV_REAL_MODEL_ENABLED=YES',
    'SDAR_UGV_MODEL_PROVIDER_ID=structured-provider',
    'SDAR_UGV_MODEL_BASE_URL=https://models.example.test/v1',
    'SDAR_UGV_MODEL_NAME=structured-model',
    'SDAR_UGV_MODEL_API_STYLE=openai_chat_completions',
    'SDAR_UGV_MODEL_API_KEY=model-secret-contract-never-print',
    'SDAR_UGV_MODEL_EMBEDDING_NAME=embedding-model',
    'SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID=embedding-provider',
    'SDAR_UGV_MODEL_EMBEDDING_BASE_URL=https://embeddings.example.test/v1',
    'SDAR_UGV_MODEL_TIMEOUT_MS=30000',
    '',
  ].join('\n');
}

function packageProjectionFixture(): {
  readonly content: Record<string, unknown>;
  readonly contentChecksum: string;
} {
  return {
    content: {
      packageId: 'builtin.isr.vehicle.ugv',
      packageVersion: '1.0.0',
      providerType: 'isr.vehicle.ugv',
      hostingModes: ['vendor_managed', 'platform_managed'],
      configSchemaId: 'provider.ugv',
      compatibleRuntimeVersion: '2.0.0-rc.1',
      protocolMode: 'frozen_v1',
      qualification: { componentStatus: 'passed', realResourceStatus: 'pending' },
    },
    contentChecksum: 'ef3a3a2b61e1cc3a6d8136d8df3ddc1ccc4c336f1b1350ad62a2cd2988619c52',
  };
}

function dockerProjectInventory(
  project: string,
  services: readonly string[],
): readonly Record<string, unknown>[] {
  return services.map((service) => ({
    Config: {
      Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
      },
    },
    State: { Status: 'running', Health: { Status: 'healthy' } },
  }));
}

function inventoryService(
  entries: readonly Record<string, unknown>[],
  service: string,
): Record<string, unknown> {
  const entry = entries.find(
    (candidate) =>
      asRecord(asRecord(candidate['Config'])['Labels'])['com.docker.compose.service'] === service,
  );
  if (entry === undefined) throw new Error(`missing inventory service: ${service}`);
  return entry;
}

function dockerSmppRuntimeInventory(): readonly Record<string, unknown>[] {
  const networksByService: Readonly<Record<string, readonly string[]>> = {
    'ugv-agent-profile-adapter': [
      'sdar-uap-p3-b01-smpp-control',
      'sdar-uap-p3-b01-smpp-southbound',
    ],
    'ugv-agent-profile-adapter-postgres': ['sdar-uap-p3-b01-smpp-control'],
    'ugv-agent-profile-pms-api': [
      'sdar-uap-p3-b01-smpp-control',
      'sdar-uap-p3-b01-smpp-northbound',
    ],
    'ugv-agent-profile-pms-postgres': ['sdar-uap-p3-b01-smpp-control'],
    'ugv-agent-profile-pms-worker': ['sdar-uap-p3-b01-smpp-control'],
    'ugv-agent-profile-runtime': [
      'sdar-uap-p3-b01-smpp-control',
      'sdar-uap-p3-b01-smpp-northbound',
    ],
    'ugv-agent-profile-runtime-postgres': ['sdar-uap-p3-b01-smpp-control'],
  };
  const portsByService: Readonly<
    Record<string, Readonly<{ containerPort: number; hostPort: number }>>
  > = {
    'ugv-agent-profile-adapter': { containerPort: 7010, hostPort: 17031 },
    'ugv-agent-profile-pms-api': { containerPort: 8090, hostPort: 18092 },
    'ugv-agent-profile-runtime': { containerPort: 8080, hostPort: 19131 },
  };
  return SMPP_SERVICES.map((service, index) => {
    const port = portsByService[service];
    const bindings =
      port === undefined
        ? null
        : {
            [`${String(port.containerPort)}/tcp`]: [
              { HostIp: '127.0.0.1', HostPort: String(port.hostPort) },
            ],
          };
    return {
      Config: {
        Labels: {
          'com.docker.compose.project': 'sdar-uap-p3-b01-smpp',
          'com.docker.compose.service': service,
        },
      },
      HostConfig: { PortBindings: bindings },
      NetworkSettings: {
        Networks: Object.fromEntries(
          (networksByService[service] ?? []).map((network) => [
            network,
            { NetworkID: `network-${network}`, IPAddress: `172.31.0.${String(index + 2)}` },
          ]),
        ),
        Ports:
          bindings ?? (service.endsWith('-postgres') ? { '5432/tcp': null } : Object.create(null)),
      },
      State: { Status: 'running', Health: { Status: 'healthy' } },
    };
  });
}

function dockerSdarRuntimeInventory(): readonly Record<string, unknown>[] {
  const ports: Readonly<Record<string, Readonly<{ containerPort: number; hostPort: number }>>> = {
    'uap-control-postgres': { containerPort: 5432, hostPort: 55463 },
    'uap-redis': { containerPort: 6379, hostPort: 56391 },
    'uap-sdar-postgres': { containerPort: 5432, hostPort: 55462 },
  };
  return Object.keys(ports).map((service, index) => {
    const port = ports[service];
    if (port === undefined) throw new Error(`missing live port: ${service}`);
    const bindings = {
      [`${String(port.containerPort)}/tcp`]: [
        { HostIp: '127.0.0.1', HostPort: String(port.hostPort) },
      ],
    };
    return {
      Config: {
        Labels: {
          'com.docker.compose.project': 'sdar-uap-p3-b01-sdar',
          'com.docker.compose.service': service,
        },
      },
      HostConfig: { PortBindings: bindings },
      NetworkSettings: {
        Networks: {
          'sdar-uap-p3-b01-sdar-control': {
            NetworkID: 'sdar-control-network',
            IPAddress: `172.31.1.${String(index + 2)}`,
          },
          'sdar-uap-p3-b01-sdar-northbound': {
            NetworkID: 'sdar-northbound-network',
            IPAddress: `172.31.2.${String(index + 2)}`,
          },
        },
        Ports: bindings,
      },
      State: { Status: 'running', Health: { Status: 'healthy' } },
    };
  });
}

function modelAuthorityFixture(stages: readonly string[]): Record<string, unknown> {
  const provider = (input: {
    readonly providerId: string;
    readonly baseUrl: string;
    readonly model: string;
  }) => ({
    providerId: input.providerId,
    name: input.providerId,
    kind: 'openai_compatible',
    apiStyle: 'openai_chat_completions',
    baseUrl: input.baseUrl,
    model: input.model,
    enabled: true,
    timeoutMs: 30_000,
    credentialPresent: true,
  });
  return {
    invocationCount: 0,
    providers: [
      provider({
        providerId: 'structured-provider',
        baseUrl: 'https://models.example.test/v1',
        model: 'structured-model',
      }),
      provider({
        providerId: 'embedding-provider',
        baseUrl: 'https://embeddings.example.test/v1',
        model: 'embedding-model',
      }),
    ],
    routes: stages.flatMap((stage) => [
      { stage, operation: 'structured_generation', providerId: 'structured-provider' },
      { stage, operation: 'embedding', providerId: 'embedding-provider' },
    ]),
  };
}

function readinessAuthorityFixture(
  managementContentHash: string,
  a2aContentHash: string,
): Record<string, unknown> {
  const cardPhase = (
    exactSkillCount: number,
    totalSkillCount: number,
    capabilityCount: number,
    managementHash = managementContentHash,
    publicHash = a2aContentHash,
  ) => ({
    exactSkillCount,
    totalSkillCount,
    capabilityCount,
    managementContentHash: managementHash,
    a2aContentHash: publicHash,
  });
  return {
    schemaVersion: 'sdar.ugv-agent-profile-authority-readiness/v1',
    status: 'passed',
    mode: 'readiness',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observedAt: new Date().toISOString(),
    skillLifecycle: {
      skillId: 'embodied.move_to',
      version: 1,
      beforeRevision: 0,
      suspendedRevision: 1,
      restoredRevision: 2,
      finalGovernedStatus: 'published',
      exactVersionCount: 1,
    },
    profilePublicCardLifecycle: {
      authority: 'CapabilityCardPublisher',
      managedCardUsed: false,
      sourceSkillRef: 'embodied.move_to:1',
      before: cardPhase(1, 1, 2),
      suspended: cardPhase(0, 0, 0),
      restored: cardPhase(1, 1, 2, 'd'.repeat(64), 'e'.repeat(64)),
      semanticRestored: true,
    },
    managedCardSeparation: {
      authority: 'node_control_exposure',
      exposureRef: 'a2a.embodied.move:1',
      revision: 3,
      contentHash: 'c'.repeat(64),
      unchangedAcrossSkillLifecycle: true,
    },
    driverActivity: {
      navigationDispatchCount: 0,
      forbiddenOperationCallCount: 0,
      fireInvocationCount: 0,
      modelInvocationCount: 0,
      providerToolCallCount: 0,
    },
    redaction: {
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
    },
  };
}

function bootstrapAuthorityFixture(mode: 'bootstrap' | 'verify'): Record<string, unknown> {
  return {
    schemaVersion: 'sdar.ugv-agent-profile-authority-bootstrap/v1',
    status: 'passed',
    mode,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observedAt: new Date().toISOString(),
    source: {
      action: 'verified',
      registryRevision: 3,
      registryChecksum: 'a'.repeat(64),
      sourceIdentitySha256: 'b'.repeat(64),
    },
    provider: {
      action: 'verified',
      bindingRevision: 3,
      bindingIdentitySha256: 'c'.repeat(64),
      catalogRevision: '3',
      catalogChecksum: 'b'.repeat(64),
      toolCount: 10,
      navigateReplay: 'simulation_only',
    },
    skill: {
      skillId: 'embodied.move_to',
      version: 1,
      runtimeStatus: 'enabled',
      governedStatus: 'published',
      packageChecksum: 'c'.repeat(64),
      exactVersionCount: 1,
    },
    capability: {
      capabilityId: 'embodied.move',
      version: 1,
      status: 'published',
      definitionHash: 'd'.repeat(64),
      implementationBindingId: 'capability-binding-embodied.move-v1',
      implementationCount: 1,
      constraintCount: 7,
    },
    readiness: {
      status: 'available',
      snapshotVersion: 3,
      snapshotHash: 'e'.repeat(64),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    },
    exposure: {
      exposureId: 'a2a.embodied.move',
      version: 1,
      agentSkillId: 'embodied.move_to',
      status: 'published',
      exposureHash: 'f'.repeat(64),
      exactExposureCount: 1,
    },
    managedCard: {
      authority: 'node_control_exposure',
      distinctFromProfilePublicCard: true,
      status: 'active',
      revision: 3,
      exposureRefs: ['a2a.embodied.move:1'],
      contentHash: '1'.repeat(64),
      capabilityCatalogHash: '2'.repeat(64),
    },
    profilePublicCard: {
      authority: 'enabled_skill_version',
      managedCardUsed: false,
      sourceSkillRef: 'embodied.move_to:1',
    },
    driverActivity: {
      navigationDispatchCount: 0,
      forbiddenOperationCallCount: 0,
      fireInvocationCount: 0,
      modelInvocationCount: 0,
      providerToolCallCount: 0,
    },
    redaction: {
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
    },
  };
}

async function renderSmppCompose(stateRoot: string): Promise<Record<string, unknown>> {
  const result = await execFileAsync(
    'docker',
    [
      'compose',
      '--env-file',
      '/dev/null',
      '--project-directory',
      SMPP_ROOT,
      '--project-name',
      'sdar-uap-p3-b01-smpp',
      '-f',
      resolve(SMPP_ROOT, 'compose.yaml'),
      '-f',
      resolve(SMPP_ROOT, 'compose.ugv-agent-profile-simulation.yaml'),
      '-f',
      resolve(DEPLOY_ROOT, 'compose.smpp-pms.yaml'),
      '--profile',
      'ugv-agent-profile-simulation',
      'config',
      '--format',
      'json',
      ...SMPP_SERVICES,
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        UAP_PMS_STATE_ROOT: stateRoot,
        UGV_AGENT_PROFILE_ADAPTER_PORT: '17031',
        UGV_AGENT_PROFILE_RUNTIME_PORT: '19131',
        UGV_AGENT_PROFILE_IMAGE_TAG: 'uap-p3-b01',
      },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function renderSdarCompose(): Promise<Record<string, unknown>> {
  const result = await execFileAsync(
    'docker',
    [
      'compose',
      '--env-file',
      '/dev/null',
      '--project-directory',
      REPOSITORY_ROOT,
      '--project-name',
      'sdar-uap-p3-b01-sdar',
      '-f',
      resolve(DEPLOY_ROOT, 'compose.sdar.yaml'),
      'config',
      '--format',
      'json',
    ],
    { cwd: REPOSITORY_ROOT, env: process.env, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('expected record');
  return value as Record<string, unknown>;
}
