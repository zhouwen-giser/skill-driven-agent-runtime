import { execFile, spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const WRAPPER = resolve(REPOSITORY_ROOT, 'deploy/ugv-agent-profile-simulation/qualify-a2a-move.sh');
const LEDGER = resolve(REPOSITORY_ROOT, 'scripts/ugv-agent-profile-simulation/provider-ledger.mjs');
const PROJECTOR = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/project-a2a-move-report.mjs',
);
const VALIDATOR = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/validate-profile.mjs',
);
const EVIDENCE = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/evidence-files.mjs',
);
const ATTEMPT_IDENTITY = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/b02-attempt-identity.mjs',
);
const FAILURE_RECORDER = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/record-b02-failure.mjs',
);
const ADMISSION_BUDGETS_MS = Object.freeze({
  source: 240_000,
  binding: 1_200_000,
  runtimeDiscovery: 1_200_000,
  readiness: 30_000,
});
const SUPERVISOR_PROCESS_HASHES = Object.freeze({
  preServer: prefixedSha256('uap-b02-supervisor-pre-server'),
  executionServer: prefixedSha256('uap-b02-supervisor-execution-server'),
  finalServer: prefixedSha256('uap-b02-supervisor-final-server'),
  nodeControlApi: prefixedSha256('uap-b02-supervisor-node-control-api'),
  nodeControlWorker: prefixedSha256('uap-b02-supervisor-node-control-worker'),
});

interface LedgerModule {
  captureUgvB02ProviderLedger(options: {
    execute: (...arguments_: unknown[]) => string;
    now: () => string;
  }): Record<string, unknown>;
  writePrivateLedger(path: string, ledger: unknown): Promise<void>;
  assessUgvB02ZeroDispatchWindow(
    before: unknown,
    after: unknown,
    options?: Readonly<{ simulationId: string }>,
  ): Readonly<{ classification: 'zero_dispatch'; deltas: Readonly<Record<string, number>> }>;
  assessUgvB02TerminalProviderSafeWindow(
    before: unknown,
    after: unknown,
    options: Readonly<{ simulationId: string }>,
  ): Readonly<{
    classification: 'terminal_provider_safe';
    deltas: Readonly<Record<string, number>>;
  }>;
  UGV_B02_ZERO_DISPATCH_DELTA_KEYS: readonly string[];
}

interface AttemptIdentityModule {
  deriveB02AdmissionIdempotencyKey(simulationId: string): string;
  issueB02AttemptIdentity(
    input: Readonly<{
      predecessorSimulationId: string;
      failureReportPath: string;
      beforeLedgerPath: string;
      afterLedgerPath: string;
    }>,
    options: Readonly<{
      stateRoot: string;
      reportRoot: string;
      now: () => string;
      publicationFault?: (step: string) => void | Promise<void>;
    }>,
  ): Promise<
    Readonly<{
      simulationId: string;
      a2aIdempotencyKey: string;
      predecessorSimulationId: string;
      recordPath: string;
      reconciliationAttemptPath: string;
      record: Readonly<Record<string, unknown>>;
      publicReport: Readonly<Record<string, unknown>>;
    }>
  >;
  authorizeB02SimulationId(
    simulationId: string,
    options: Readonly<{ stateRoot: string; reportRoot: string }>,
  ): Promise<Readonly<{ simulationId: string; kind: string }>>;
  validateIssuedB02AttemptIdentity(
    simulationId: string,
    options: Readonly<{ stateRoot: string; reportRoot: string }>,
  ): Promise<
    Readonly<{
      schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-authorization/v1';
      status: 'authorized';
      kind: 'recovery_issued';
      simulationId: string;
      identityRecordPath: string;
      identityRecordSha256: string;
    }>
  >;
}

interface ProjectorModule {
  projectA2aMoveReport(
    inputPath: string,
    preStatusPath: string,
    executionStatusPath: string,
    finalStatusPath: string,
    sourceRecoveryReportPath: string,
    authorityGateReportPath: string,
    outputPath: string,
    options: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

interface ValidatorModule {
  validatePublicArtifacts(
    paths: readonly string[],
    options: Record<string, unknown>,
  ): Promise<{ artifactCount: number }>;
}

interface EvidenceModule {
  sha256CanonicalJson(value: unknown): string;
  writeFirstPassPairTransactional(
    options: Record<string, unknown>,
    dependencies?: Record<string, unknown>,
  ): Promise<{ attemptPath: string; indexPath: string }>;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('UAP-P3-B02 deployment boundary', () => {
  it('freezes staged admission -> durable recovery evidence -> source/gate -> NO/YES -> finally NO -> publish ordering', async () => {
    const source = await readFile(WRAPPER, 'utf8');
    const sourceRecovery = source.indexOf('pnpm exec tsx "$uap_source_recovery_runner"');
    const authorityGate = source.indexOf('"$uap_driver" authority-gate');
    const runDirectory = source.indexOf('mkdir -m 0700 "$uap_b02_private_root"');
    const trap = source.indexOf('trap \'uap_finalize_b02 "$?"\' EXIT');
    const sealLedger = source.indexOf('mv -- "$uap_pre_ledger_candidate"');
    const sealGate = source.indexOf('mv -- "$uap_authority_gate_candidate"');
    const pre = source.indexOf('capture NO "$uap_pre_status_file"');
    const readonlyQualification = source.indexOf('qualify-smpp-readonly.mjs');
    const cleanLedger = source.indexOf('capture "$uap_pre_ledger_candidate"');
    const cleanPreflight = source.indexOf('"$uap_driver" preflight');
    const yes = source.indexOf('--side-effects YES');
    const simulationRunId = source.indexOf('--simulation-run-id "$uap_simulation_id"');
    const acknowledgement = source.indexOf(
      '--acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS',
    );
    const execution = source.indexOf('capture YES "$uap_execution_status_file"');
    const prepare = source.indexOf('"$uap_driver" prepare');
    const observe = source.indexOf('"$uap_driver" observe');
    const restore = source.indexOf('restart-server --side-effects NO');
    const finalStatus = source.indexOf('capture NO "$uap_final_status_file"');
    const publish = source.indexOf('project-a2a-move-report.mjs');
    expect([
      readonlyQualification,
      cleanLedger,
      cleanPreflight,
      runDirectory,
      trap,
      sealLedger,
      sourceRecovery,
      authorityGate,
      sealGate,
      pre,
      yes,
      simulationRunId,
      acknowledgement,
      execution,
      prepare,
      observe,
    ]).toEqual(
      [
        ...[
          readonlyQualification,
          cleanLedger,
          cleanPreflight,
          runDirectory,
          trap,
          sealLedger,
          sourceRecovery,
          authorityGate,
          sealGate,
          pre,
          yes,
          simulationRunId,
          acknowledgement,
          execution,
          prepare,
          observe,
        ],
      ].sort((left, right) => left - right),
    );
    expect(sourceRecovery).toBeGreaterThan(0);
    expect(pre).toBeGreaterThan(0);
    expect(trap).toBeLessThan(yes);
    expect(restore).toBeGreaterThan(0);
    expect(finalStatus).toBeGreaterThan(restore);
    expect(publish).toBeGreaterThan(finalStatus);
    expect(source).toContain('trap \'uap_finalize_b02 "$?"\' EXIT');
    expect(source).toContain('final_exit=70');
    const finalizer = source.indexOf('uap_finalize_b02()');
    const ignoreSignals = source.indexOf("trap '' INT TERM", finalizer);
    const clearExitTrap = source.indexOf('trap - EXIT ERR', finalizer);
    expect(ignoreSignals).toBeGreaterThan(finalizer);
    expect(ignoreSignals).toBeLessThan(clearExitTrap);
    expect(source).not.toContain('record-attempt.mjs');
    expect(source.match(/"\$uap_driver" prepare/gu)).toHaveLength(1);
    expect(source.match(/"\$uap_driver" observe/gu)).toHaveLength(1);
  });

  it.each([
    [{}, 'UAP_B02_EXPLICIT_SIDE_EFFECT_AUTHORIZATION_REQUIRED'],
    [
      {
        ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'NO',
        UGV_SIMULATION_RUN_ID: 'uap-p3-b02-owned-run-0001',
      },
      'UAP_B02_EXPLICIT_SIDE_EFFECT_AUTHORIZATION_REQUIRED',
    ],
    [
      { ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES', UGV_SIMULATION_RUN_ID: '' },
      'UAP_B02_SIMULATION_ID_REQUIRED',
    ],
  ])('rejects missing mandatory authority before any B02 action', async (environment, code) => {
    await expect(
      execFileAsync(WRAPPER, [], {
        cwd: REPOSITORY_ROOT,
        env: { PATH: process.env['PATH'], ...environment },
      }),
    ).rejects.toMatchObject({ code: 64, stderr: expect.stringContaining(code) });
  });

  it('authorizes only the reserved or formally issued simulation identity before run-dir creation', async () => {
    const source = await readFile(WRAPPER, 'utf8');
    const existing = source.indexOf('uap_authorize_b02_simulation_run_id');
    const mismatch = source.indexOf('UAP_B02_SIMULATION_ID_MISMATCH');
    const localValidation = source.indexOf('validate-profile.mjs" environment');
    const ownership = source.indexOf('uap_assert_owned_stack_running');
    const smppExposure = source.indexOf('uap_assert_smpp_live_exposure');
    const sdarExposure = source.indexOf('uap_assert_sdar_live_exposure');
    const exclusiveLock = source.indexOf('flock -n "$uap_lock_fd"');
    const priorRunGate = source.indexOf('[[ -e "$uap_b02_private_root"');
    const readonlyQualification = source.indexOf('qualify-smpp-readonly.mjs');
    const sourceRecovery = source.indexOf('pnpm exec tsx "$uap_source_recovery_runner"');
    const authorityGate = source.indexOf('"$uap_driver" authority-gate');
    const runDirectory = source.indexOf('mkdir -m 0700 "$uap_b02_private_root"');
    const initializer = source.indexOf('uap_initialize_state');
    expect(existing).toBeGreaterThan(0);
    expect(mismatch).toBeGreaterThan(existing);
    expect([
      mismatch,
      localValidation,
      ownership,
      smppExposure,
      sdarExposure,
      exclusiveLock,
      priorRunGate,
      readonlyQualification,
      runDirectory,
      sourceRecovery,
      authorityGate,
    ]).toEqual(
      [
        ...[
          mismatch,
          localValidation,
          ownership,
          smppExposure,
          sdarExposure,
          exclusiveLock,
          priorRunGate,
          readonlyQualification,
          runDirectory,
          sourceRecovery,
          authorityGate,
        ],
      ].sort((left, right) => left - right),
    );
    expect(source).toContain('env -u ALLOW_UGV_SIMULATION_SIDE_EFFECTS');
    expect(source).toContain('UAP_B02_SIMULATION_ALREADY_RUNNING');
    expect(source).toContain('SMPP_SNAPSHOT_TTL_SECONDS="300"');
    expect(source).toContain(
      'SDAR_RUNTIME_CONTROL_SERVICE_TOKEN_FILE="$UAP_STATE_ROOT/runtime-control-service.token"',
    );
    expect(source).toContain('SDAR_CONTROL_API_TOKEN_FILE="$UAP_STATE_ROOT/control-api.token"');
    expect(source).not.toContain('SDAR_CONTROL_API_TOKEN=');
    expect(initializer).toBe(-1);
  });

  it('uses exact docker compose argv and the real SDAR mcp_invocation columns', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const calls: unknown[][] = [];
    const execute = vi.fn((...arguments_: unknown[]) => {
      calls.push(arguments_);
      const argv = arguments_[1] as string[];
      if (argv.includes('ugv-agent-profile-runtime-postgres'))
        return JSON.stringify({ idempotencyRecords: [], providerTasks: [], admissionIntents: [] });
      if (argv.includes('ugv-agent-profile-adapter-postgres'))
        return JSON.stringify({
          executions: [],
          deviceToolCalls: [],
          mutationJournal: [],
          commandAcks: [],
        });
      return JSON.stringify(emptySdar());
    });
    expect(
      module.captureUgvB02ProviderLedger({
        execute,
        now: () => '2026-08-21T12:00:00.000Z',
      }),
    ).toMatchObject({ schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1' });
    expect(calls).toHaveLength(3);
    const sdarArgv = calls[2]?.[1] as string[];
    expect(sdarArgv.slice(0, 9)).toEqual([
      'compose',
      '--env-file',
      '/dev/null',
      '--project-directory',
      REPOSITORY_ROOT,
      '--project-name',
      'sdar-uap-p3-b01-sdar',
      '-f',
      resolve(REPOSITORY_ROOT, 'deploy/ugv-agent-profile-simulation/compose.sdar.yaml'),
    ]);
    expect(sdarArgv.filter((value) => value === '-U')).toHaveLength(1);
    const query = sdarArgv.at(-1) ?? '';
    expect(query).toContain("'arguments', arguments_json");
    expect(query).toContain("'controlArgumentsHash', control_arguments_hash");
    expect(query).not.toContain('invocation.arguments_hash');
    expect(query).toContain('to_jsonb(invocation)');
  });

  it('writes each private ledger once and rejects an overwrite', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const directory = await temporaryDirectory();
    const target = join(directory, 'ledger.json');
    await module.writePrivateLedger(target, { value: 1 });
    await expect(module.writePrivateLedger(target, { value: 2 })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ value: 1 });
  });

  it('prevalidates the first-pass pair before publishing either public file', async () => {
    const { module, options, attempts, index } = await transactionFixture();
    await expect(
      module.writeFirstPassPairTransactional(options, {
        validatePair: () => {
          throw new Error('injected candidate validation failure');
        },
      }),
    ).rejects.toThrow('injected candidate validation failure');
    await expect(readFile(index)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(attempts)).toEqual([]);
  });

  it('rolls back the attempt when the canonical index link fails', async () => {
    const { module, options, attempts, index } = await transactionFixture();
    let linkCount = 0;
    await expect(
      module.writeFirstPassPairTransactional(options, {
        link: async (source: string, target: string) => {
          linkCount += 1;
          if (linkCount === 2) throw new Error('injected index link failure');
          await link(source, target);
        },
      }),
    ).rejects.toThrow('injected index link failure');
    await expect(readFile(index)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(attempts)).filter((name) => name.endsWith('.redacted.json'))).toEqual([]);
  });

  it('removes both publications when the post-index directory sync fails', async () => {
    const { module, options, attempts, index } = await transactionFixture();
    let syncCount = 0;
    await expect(
      module.writeFirstPassPairTransactional(options, {
        syncDirectory: () => {
          syncCount += 1;
          if (syncCount === 2) return Promise.reject(new Error('injected commit sync failure'));
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('injected commit sync failure');
    await expect(readFile(index)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(attempts)).filter((name) => name.endsWith('.redacted.json'))).toEqual([]);
  });

  it.each(['index', 'attempt'] as const)(
    'makes a failed %s unlink dominate the original publication error',
    async (failedTarget) => {
      const { module, options, attempts, index } = await transactionFixture();
      let syncCount = 0;
      await expect(
        module.writeFirstPassPairTransactional(options, {
          syncDirectory: () => {
            syncCount += 1;
            if (syncCount === 2) return Promise.reject(new Error('injected commit sync failure'));
            return Promise.resolve();
          },
          unlink: async (path: string) => {
            const isIndex = path === index;
            const isAttempt = path.endsWith('.redacted.json');
            if ((failedTarget === 'index' && isIndex) || (failedTarget === 'attempt' && isAttempt))
              throw new Error(`injected ${failedTarget} unlink failure`);
            await unlink(path);
          },
        }),
      ).rejects.toThrow('UAP_FIRST_PASS_PAIR_ROLLBACK_FAILED');
      if (failedTarget === 'index')
        expect(await readFile(index, 'utf8')).toContain('"status": "passed"');
      else
        expect((await readdir(attempts)).some((name) => name.endsWith('.redacted.json'))).toBe(
          true,
        );
    },
  );

  it('makes a failed rollback directory sync dominate the original index-link failure', async () => {
    const { module, options } = await transactionFixture();
    let linkCount = 0;
    let syncCount = 0;
    await expect(
      module.writeFirstPassPairTransactional(options, {
        link: async (source: string, target: string) => {
          linkCount += 1;
          if (linkCount === 2) throw new Error('injected index link failure');
          await link(source, target);
        },
        syncDirectory: () => {
          syncCount += 1;
          if (syncCount === 2) return Promise.reject(new Error('injected rollback sync failure'));
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('UAP_FIRST_PASS_PAIR_ROLLBACK_FAILED');
  });

  it('projects an exact public allowlist, hashes model values, and passes canonical validation', async () => {
    const fixture = await projectorAuthorityFixture();
    const projector = (await import(pathToFileURL(PROJECTOR).href)) as ProjectorModule;
    const validator = (await import(pathToFileURL(VALIDATOR).href)) as ValidatorModule;
    const report = await projector.projectA2aMoveReport(
      fixture.inputPath,
      fixture.preStatusPath,
      fixture.executionStatusPath,
      fixture.finalStatusPath,
      fixture.sourceRecoveryReportPath,
      fixture.authorityGateReportPath,
      fixture.outputPath,
      fixture.projectorOptions,
    );
    expect(report).toMatchObject({
      task: 'UAP-P3-B02',
      supervisor: {
        restoredSideEffects: 'NO',
        processCount: 3,
        identityVerified: true,
        revisions: { pre: 1, execution: 2, final: 3 },
      },
      sideEffectWindow: {
        pre: 'NO',
        execution: 'YES',
        restored: 'NO',
        restoreVerified: true,
      },
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentityHashesIncluded: true,
      modelValuesIncluded: false,
      admissionAuthority: {
        schemaVersion: 'sdar.ugv-agent-profile.b02-admission-authority/v1',
        issuedAttempt: {
          simulationIdSha256: prefixedSha256(fixture.simulationId),
          admissionIdempotencyKeySha256: prefixedSha256(fixture.a2aIdempotencyKey),
          identityRecordSha256: fixture.identityRecordSha256,
        },
        sourceRecovery: {
          reportSha256: fixture.sourceRecoveryEnvelope.reportSha256,
          evidenceClass: 'real_public_api',
          action: 'not_required',
          sourceRemainingTtlMs: 300_000,
          bindingRemainingTtlMs: 1_260_000,
          runtimeDiscoveryRemainingTtlMs: 1_260_000,
        },
        authorityGate: {
          budgetsMs: ADMISSION_BUDGETS_MS,
          minimumRemainingTtlMs: {
            source: 270_000,
            binding: 1_230_000,
            runtimeDiscovery: 1_230_000,
            readiness: 30_000,
          },
        },
        redaction: {
          secretsIncluded: false,
          credentialReferencesIncluded: false,
          endpointsIncluded: false,
          entityIdsIncluded: false,
        },
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-provider-value');
    expect(serialized).not.toContain('private-model-value');
    for (const privateIdentityHash of Object.values(SUPERVISOR_PROCESS_HASHES))
      expect(serialized).not.toContain(privateIdentityHash);
    expect(serialized).toContain('device-call-1');
    await expect(
      validator.validatePublicArtifacts([fixture.outputPath], {
        repositoryRoot: fixture.repositoryRoot,
        reportRoot: fixture.reportRoot,
        stateRoot: fixture.stateRoot,
        dotEnvPath: fixture.dotEnvPath,
      }),
    ).resolves.toEqual({ artifactCount: 2 });

    const canonicalIndex = JSON.parse(await readFile(fixture.outputPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await privateJson(fixture.outputPath, { ...canonicalIndex, task: 'UAP-P3-B01' });
    await expect(
      validator.validatePublicArtifacts([fixture.outputPath], {
        repositoryRoot: fixture.repositoryRoot,
        reportRoot: fixture.reportRoot,
        stateRoot: fixture.stateRoot,
        dotEnvPath: fixture.dotEnvPath,
      }),
    ).rejects.toThrow('UAP_CANONICAL_ATTEMPT_INVALID');
    await privateJson(fixture.outputPath, {
      ...canonicalIndex,
      firstPassAttemptSha256: '0'.repeat(64),
    });
    await expect(
      validator.validatePublicArtifacts([fixture.outputPath], {
        repositoryRoot: fixture.repositoryRoot,
        reportRoot: fixture.reportRoot,
        stateRoot: fixture.stateRoot,
        dotEnvPath: fixture.dotEnvPath,
      }),
    ).rejects.toThrow('UAP_CANONICAL_ATTEMPT_INVALID');
  });

  it.each([
    ['missing Source recovery report', 'source-missing'],
    ['missing authority gate report', 'gate-missing'],
    ['tampered Source recovery report', 'source-tampered'],
    ['tampered authority gate report', 'gate-tampered'],
    ['Source recovery report for another identity', 'source-other-identity'],
    ['authority gate report for another identity', 'gate-other-identity'],
  ] as const)('rejects %s before any passed B02 publication', async (_name, fault) => {
    const fixture = await projectorAuthorityFixture();
    await injectProjectorAuthorityFault(fixture, fault);
    const projector = (await import(pathToFileURL(PROJECTOR).href)) as ProjectorModule;

    await expect(
      projector.projectA2aMoveReport(
        fixture.inputPath,
        fixture.preStatusPath,
        fixture.executionStatusPath,
        fixture.finalStatusPath,
        fixture.sourceRecoveryReportPath,
        fixture.authorityGateReportPath,
        fixture.outputPath,
        fixture.projectorOptions,
      ),
    ).rejects.toThrow();
    await expect(readFile(fixture.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await readdir(join(fixture.reportRoot, 'attempts'))).filter((entry) =>
        entry.startsWith(`uap-p3-b02-${fixture.simulationId}-`),
      ),
    ).toEqual([]);
  });

  it.each([
    ['legacy three-key capture', 'legacy-final'],
    ['execution active-ID drift', 'execution-active-id'],
    ['non-sequential manifest revision', 'revision-gap'],
    ['reused server process identity', 'server-reused'],
    ['control process identity drift', 'control-drift'],
    ['bootstrap generation drift', 'bootstrap-drift'],
  ] as const)('rejects %s before any passed B02 publication', async (_name, fault) => {
    const fixture = await projectorAuthorityFixture();
    await injectProjectorSupervisorFault(fixture, fault);
    const projector = (await import(pathToFileURL(PROJECTOR).href)) as ProjectorModule;

    await expect(
      projector.projectA2aMoveReport(
        fixture.inputPath,
        fixture.preStatusPath,
        fixture.executionStatusPath,
        fixture.finalStatusPath,
        fixture.sourceRecoveryReportPath,
        fixture.authorityGateReportPath,
        fixture.outputPath,
        fixture.projectorOptions,
      ),
    ).rejects.toThrow();
    await expect(readFile(fixture.outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await readdir(join(fixture.reportRoot, 'attempts'))).filter((entry) =>
        entry.startsWith(`uap-p3-b02-${fixture.simulationId}-`),
      ),
    ).toEqual([]);
  });

  it('issues exactly one append-only recovery identity without rewriting the old failed attempt', async () => {
    const fixture = await recoveryIdentityFixture();
    const module = await attemptIdentityModule();
    const before = await recoveryFixtureSnapshot(fixture);
    const attempts = await Promise.allSettled(
      Array.from({ length: 16 }, async () =>
        module.issueB02AttemptIdentity(fixture.input, fixture.options),
      ),
    );
    const fulfilled = attempts.flatMap((attempt) =>
      attempt.status === 'fulfilled' ? [attempt.value] : [],
    );

    expect(fulfilled).toHaveLength(16);
    expect(new Set(fulfilled.map((attempt) => attempt.simulationId)).size).toBe(1);
    expect(new Set(fulfilled.map((attempt) => attempt.a2aIdempotencyKey)).size).toBe(1);
    expect(new Set(fulfilled.map((attempt) => attempt.recordPath)).size).toBe(1);
    const issued = fulfilled[0];
    expect(issued).toBeDefined();
    if (issued === undefined) throw new Error('expected issued recovery identity');
    expect(issued.simulationId).toMatch(/^uap-p3-b02-/u);
    expect(issued.simulationId).not.toBe(fixture.predecessorSimulationId);
    expect(issued.a2aIdempotencyKey).not.toBe(
      module.deriveB02AdmissionIdempotencyKey(fixture.predecessorSimulationId),
    );
    expect(issued.a2aIdempotencyKey).toBe(
      module.deriveB02AdmissionIdempotencyKey(issued.simulationId),
    );
    expect(await recoveryFixtureSnapshot(fixture)).toEqual(before);
    await expect(lstat(join(fixture.stateRoot, 'b02', issued.simulationId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(issued.recordPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(dirname(issued.recordPath))).mode & 0o777).toBe(0o700);
    expect((await lstat(issued.reconciliationAttemptPath)).mode & 0o777).toBe(0o600);
    await expectSingleRecoveryPair(fixture, issued.simulationId);
    const publicSource = await readFile(issued.reconciliationAttemptPath, 'utf8');
    const publicReport = JSON.parse(publicSource) as Record<string, unknown>;
    expect(publicReport).toMatchObject({
      schemaVersion: 'sdar.ugv-agent-profile.b02-recovery-reconciliation/v1',
      status: 'verified_zero_dispatch',
      issuanceCode: 'UAP_B02_RECOVERY_IDENTITY_ISSUED',
      simulationIdentifiersIncluded: true,
      downstreamDeviceIdentifiersIncluded: false,
      providerIdentifiersIncluded: false,
      supervisor: { restoredSideEffects: 'NO', restoreVerified: true },
      ledgerObservationWindow: {
        beforeCapturedAt: '2026-08-21T12:00:00.000Z',
        failureGeneratedAt: '2026-08-21T12:00:10.000Z',
        afterCapturedAt: '2026-08-21T12:00:20.000Z',
        assessedAt: '2026-08-21T12:20:20.000Z',
      },
    });
    expect(publicSource).not.toContain(issued.simulationId);
    expect(publicSource).not.toContain('device-call-');
    expect(publicSource).not.toContain('validUntil');
    expect(publicSource).not.toContain('sourceWindow');
    await expect(
      module.authorizeB02SimulationId(fixture.predecessorSimulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'initial_reserved' });
    await expect(
      module.authorizeB02SimulationId(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued', simulationId: issued.simulationId });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({
      schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-authorization/v1',
      status: 'authorized',
      kind: 'recovery_issued',
      simulationId: issued.simulationId,
      identityRecordPath: issued.recordPath,
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(fixture.predecessorSimulationId, fixture.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_ISSUED_IDENTITY_REQUIRED' });
    await expect(
      module.authorizeB02SimulationId('uap-p3-b02-forged-not-issued-0001', fixture.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_SIMULATION_ID_NOT_AUTHORIZED' });
    await expect(
      module.issueB02AttemptIdentity(fixture.input, fixture.options),
    ).resolves.toMatchObject({
      simulationId: issued.simulationId,
      a2aIdempotencyKey: issued.a2aIdempotencyKey,
      recordPath: issued.recordPath,
    });
  });

  it.each([
    'write-public-candidate',
    'link-private',
    'unlink-public-candidate',
    'unlink-private-candidate',
    'fsync-public-after-link',
    'fsync-private-after-link',
  ])('recovers a %s publication fault without publishing before authority', async (failedStep) => {
    const fixture = await recoveryIdentityFixture();
    const module = await attemptIdentityModule();
    let injected = false;
    await expect(
      module.issueB02AttemptIdentity(fixture.input, {
        ...fixture.options,
        publicationFault: (step) => {
          if (!injected && step === failedStep) {
            injected = true;
            throw new Error(`injected:${failedStep}`);
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_PUBLICATION_FAILED' });
    expect(injected).toBe(true);
    const interrupted = await expectNoPublicBeforeIdentity(fixture, true);
    expect(await recoveryFixtureSnapshot(fixture)).toEqual(fixture.initialSnapshot);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    if (interrupted.recordSimulationId !== undefined)
      expect(issued.simulationId).toBe(interrupted.recordSimulationId);
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({
      kind: 'recovery_issued',
      simulationId: issued.simulationId,
      identityRecordPath: issued.recordPath,
    });
    await expectSingleRecoveryPair(fixture, issued.simulationId);
  });

  it('makes staging cleanup failure dominate without polluting the identity inventory', async () => {
    const fixture = await recoveryIdentityFixture();
    const module = await attemptIdentityModule();
    await expect(
      module.issueB02AttemptIdentity(fixture.input, {
        ...fixture.options,
        publicationFault: (step) => {
          if (step === 'link-private' || step === 'recovery-unlink-private-candidate')
            throw new Error(`injected:${step}`);
        },
      }),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_ROLLBACK_FAILED' });
    await expectNoPublicBeforeIdentity(fixture, false);
    expect(await recoveryFixtureSnapshot(fixture)).toEqual(fixture.initialSnapshot);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('repairs the same winner after termination between the private and public final links', async () => {
    const fixture = await recoveryIdentityFixture();
    const module = await attemptIdentityModule();
    await expect(
      module.issueB02AttemptIdentity(fixture.input, {
        ...fixture.options,
        publicationFault: (step) => {
          if (step === 'link-public') throw new Error('simulated-process-termination-window');
        },
      }),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_PUBLICATION_FAILED' });
    const interrupted = await expectNoPublicBeforeIdentity(fixture, true);
    expect(interrupted.recordSimulationId).toMatch(/^uap-p3-b02-/u);
    if (interrupted.recordSimulationId === undefined)
      throw new Error('expected a private first-writer identity');
    await expect(
      module.validateIssuedB02AttemptIdentity(interrupted.recordSimulationId, fixture.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_ATTEMPT_IDENTITY_EVIDENCE_INVALID' });

    const repaired = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(repaired.simulationId).toBe(interrupted.recordSimulationId);
    await expectSingleRecoveryPair(fixture, repaired.simulationId);
    await expect(
      module.validateIssuedB02AttemptIdentity(repaired.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('keeps an issued identity verifiable from preserved state and reports across DB generations', async () => {
    const fixture = await recoveryIdentityFixture();
    const module = await attemptIdentityModule();
    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    const preserved = await recoveryFixtureSnapshot(fixture);
    const databaseRoot = join(fixture.root, 'database-volumes');
    const oldGeneration = join(databaseRoot, 'old-generation');
    const freshGeneration = join(databaseRoot, 'fresh-generation');
    await mkdir(oldGeneration, { recursive: true, mode: 0o700 });
    await privateText(join(oldGeneration, 'database.sentinel'), 'old-database-generation');

    await rm(oldGeneration, { recursive: true, force: true });
    await mkdir(freshGeneration, { recursive: true, mode: 0o700 });
    await privateText(join(freshGeneration, 'database.sentinel'), 'fresh-database-generation');

    expect(await recoveryFixtureSnapshot(fixture)).toEqual(preserved);
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({
      kind: 'recovery_issued',
      simulationId: issued.simulationId,
      identityRecordPath: issued.recordPath,
    });
    const privateRecordSource = await readFile(issued.recordPath, 'utf8');
    expect(privateRecordSource).not.toContain('authorityGeneration');
    expect(privateRecordSource).not.toContain('databaseGeneration');
  });

  it('keeps an already-issued identity authoritative when a later finalizer adds a supplemental failure report', async () => {
    const fixture = await recoveryIdentityFixture('confirm-and-observe');
    const module = await attemptIdentityModule();
    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    const supplementalPath = join(
      fixture.reportRoot,
      'attempts',
      `uap-p3-b02-failure-${fixture.predecessorSimulationId}-20260821120100000-supplemental.redacted.json`,
    );
    const supplemental = JSON.parse(await readFile(fixture.failureReportPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await privateJson(supplementalPath, {
      ...supplemental,
      generatedAt: '2026-08-21T12:01:00.000Z',
      stage: 'restore-no',
      exitCode: 70,
    });

    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({
      kind: 'recovery_issued',
      simulationId: issued.simulationId,
      identityRecordPath: issued.recordPath,
    });
  });

  it('still rejects selecting a failure report when no identity exists and multiple reports are present', async () => {
    const fixture = await recoveryIdentityFixture('confirm-and-observe');
    const module = await attemptIdentityModule();
    await privateJson(
      join(
        fixture.reportRoot,
        'attempts',
        `uap-p3-b02-failure-${fixture.predecessorSimulationId}-20260821120100000-ambiguous.redacted.json`,
      ),
      JSON.parse(await readFile(fixture.failureReportPath, 'utf8')),
    );

    await expect(
      module.issueB02AttemptIdentity(fixture.input, fixture.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_FAILURE_REPORT_AMBIGUOUS' });
  });

  it('permits a restored observe-stage failure only when the full ledger window is zero-dispatch', async () => {
    const fixture = await recoveryIdentityFixture('confirm-and-observe');
    const module = await attemptIdentityModule();
    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({
      kind: 'recovery_issued',
      simulationId: issued.simulationId,
    });
  });

  it('issues a successor after one exact taskless qualification read and no execution dispatch', async () => {
    const fixture = await recoveryIdentityFixture('prepare-unique-admission');
    const module = await attemptIdentityModule();
    const after = emptyProviderLedger('2026-08-21T12:00:20.000Z');
    const taskId = 'qualification-read-task-1';
    after.adapter['deviceToolCalls']?.push({
      callId: 'qualification-call-1',
      call_id: 'qualification-call-1',
      taskId,
      task_id: taskId,
      toolName: 'get_status',
      tool_name: 'get_status',
      argumentHash: 'a'.repeat(64),
      argument_hash: 'a'.repeat(64),
      outcome: 'accepted',
      occurredAt: '2026-08-21T12:00:10.100Z',
    });
    after.sdar['mcpInvocations']?.push({
      status: 'succeeded',
      taskId: null,
      task_id: null,
      capabilityAttemptId: null,
      controlConfirmationId: null,
      controlProviderBindingId: null,
      controlArgumentsHash: null,
      controlDispatchHash: null,
      toolName: 'vehicle_get_state',
      tool_name: 'vehicle_get_state',
      executionMode: 'simulation',
      simulationId: fixture.predecessorSimulationId,
      simulation_id: fixture.predecessorSimulationId,
      arguments: { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
      error_code: null,
      error_message: null,
      startedAt: '2026-08-21T12:00:10.000Z',
      completedAt: '2026-08-21T12:00:10.200Z',
      execution_semantics_json: {
        effect: 'read_only',
        execution: 'synchronous',
        replay: 'allowed',
      },
      result_json: {
        isError: false,
        evidence: [{ subjectRef: `execution:vehicle:ugv1:sync:${taskId}` }],
        structuredContent: {
          identity: { resourceId: 'vehicle:ugv1', executionMode: 'simulation' },
        },
      },
    });
    await privateJson(fixture.afterLedgerPath, after);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(issued.record['zeroDispatchAssessment']).toMatchObject({
      classification: 'zero_dispatch',
      deltas: { adapterDeviceToolCalls: 1, sdarMcpInvocations: 1 },
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('issues a successor after an exact pre-confirmation structural failure with zero dispatch', async () => {
    const fixture = await recoveryIdentityFixture('prepare-unique-admission');
    const module = await attemptIdentityModule();
    const after = emptyProviderLedger('2026-08-21T12:00:20.000Z');
    appendQualificationRead(after, fixture.predecessorSimulationId);
    appendPreconfirmationFailure(after, fixture.predecessorSimulationId);
    await privateJson(fixture.afterLedgerPath, after);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(issued.record['zeroDispatchAssessment']).toMatchObject({
      classification: 'zero_dispatch',
      deltas: {
        adapterDeviceToolCalls: 1,
        sdarMcpInvocations: 1,
        sdarInitialTaskAdmissions: 1,
        sdarCapabilityAttempts: 1,
        sdarTasks: 1,
        sdarGoals: 1,
        sdarGoalContracts: 1,
        sdarUserGoalPlans: 1,
      },
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('issues a successor after an exact awaiting-confirmation plan boundary with zero dispatch', async () => {
    const fixture = await recoveryIdentityFixture('prepare-unique-admission');
    const module = await attemptIdentityModule();
    const after = emptyProviderLedger('2026-08-21T12:00:20.000Z');
    appendQualificationRead(after, fixture.predecessorSimulationId);
    appendAwaitingConfirmationPlanningFailure(after, fixture.predecessorSimulationId);
    await privateJson(fixture.afterLedgerPath, after);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(issued.record['zeroDispatchAssessment']).toMatchObject({
      classification: 'zero_dispatch',
      deltas: {
        adapterDeviceToolCalls: 1,
        sdarMcpInvocations: 1,
        sdarInitialTaskAdmissions: 1,
        sdarCapabilityAttempts: 1,
        sdarTasks: 1,
        sdarWorkflowPlans: 1,
        sdarSkillExecutions: 1,
        sdarSkillExecutionEvents: 11,
      },
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('rejects an awaiting-confirmation recovery when its production DSL node type drifts', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const before = emptyProviderLedger('2026-08-21T12:00:00.000Z');
    const after = emptyProviderLedger('2026-08-21T12:00:20.000Z');
    appendQualificationRead(after, 'uap-p3-b02-test-run-0001');
    appendAwaitingConfirmationPlanningFailure(after, 'uap-p3-b02-test-run-0001');
    const workflowPlan = after.sdar['workflowPlans']?.[0];
    if (workflowPlan === undefined) throw new Error('workflow plan fixture missing');
    const definition = workflowPlan['definition_json'] as Record<string, unknown>;
    const nodes = definition['nodes'] as Record<string, unknown>[];
    nodes[1] = { ...nodes[1], type: 'context_gate' };

    expect(() =>
      module.assessUgvB02ZeroDispatchWindow(before, after, {
        simulationId: 'uap-p3-b02-test-run-0001',
      }),
    ).toThrow('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  });

  it('issues a successor after an exact confirmed pre-transport readiness failure', async () => {
    const fixture = await recoveryIdentityFixture('confirm-and-observe');
    const module = await attemptIdentityModule();
    const after = emptyProviderLedger('2026-08-21T12:01:00.000Z');
    appendQualificationRead(after, fixture.predecessorSimulationId);
    appendConfirmedPretransportReadinessFailure(after, fixture.predecessorSimulationId);
    await privateJson(fixture.afterLedgerPath, after);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(issued.record['zeroDispatchAssessment']).toMatchObject({
      classification: 'zero_dispatch',
      deltas: {
        adapterDeviceToolCalls: 2,
        sdarModelInvocations: 1,
        sdarMcpInvocations: 2,
        sdarGovernedConfirmations: 1,
        sdarRemoteAdmissionIntents: 1,
        sdarWorkflowInstances: 1,
        sdarSkillExecutionEvents: 13,
      },
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('rejects a confirmed pre-transport failure if its navigate intent crossed dispatch', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const before = emptyProviderLedger('2026-08-21T12:00:00.000Z');
    const after = emptyProviderLedger('2026-08-21T12:01:00.000Z');
    appendQualificationRead(after, 'uap-p3-b02-test-run-0001');
    appendConfirmedPretransportReadinessFailure(after, 'uap-p3-b02-test-run-0001');
    const intent = after.sdar['remoteAdmissionIntents']?.[0];
    if (intent === undefined) throw new Error('remote intent fixture missing');
    intent['dispatched_at'] = '2026-08-21T12:00:13.000Z';

    expect(() =>
      module.assessUgvB02ZeroDispatchWindow(before, after, {
        simulationId: 'uap-p3-b02-test-run-0001',
      }),
    ).toThrow('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  });

  it('issues a successor only after an exact Provider-terminal receipt-decoding failure', async () => {
    const fixture = await recoveryIdentityFixture('confirm-and-observe');
    const module = await attemptIdentityModule();
    const after = emptyProviderLedger('2026-08-21T12:02:00.000Z');
    appendQualificationRead(after, fixture.predecessorSimulationId);
    appendTerminalProviderSafeFailure(after, fixture.predecessorSimulationId);
    await privateJson(fixture.afterLedgerPath, after);

    const issued = await module.issueB02AttemptIdentity(fixture.input, fixture.options);
    expect(issued.record['zeroDispatchAssessment']).toMatchObject({
      classification: 'terminal_provider_safe',
      resultCode: 'UAP_B02_RECOVERY_TERMINAL_PROVIDER_SAFE_VERIFIED',
      deltas: {
        runtimeProviderTasks: 1,
        adapterExecutions: 1,
        adapterMutationJournal: 2,
        sdarMcpInvocations: 3,
        sdarContinuationSnapshots: 0,
        sdarTerminalOutcomes: 0,
      },
    });
    expect(issued.publicReport).toMatchObject({
      status: 'verified_terminal_provider_safe',
      physicalVehicleQualified: false,
      terminalSafeAssessment: {
        classification: 'terminal_provider_safe',
      },
    });
    await expect(
      module.validateIssuedB02AttemptIdentity(issued.simulationId, fixture.options),
    ).resolves.toMatchObject({ kind: 'recovery_issued' });
  });

  it('rejects terminal-safe recovery while the Provider execution is nonterminal', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const before = emptyProviderLedger('2026-08-21T12:00:00.000Z');
    const after = emptyProviderLedger('2026-08-21T12:02:00.000Z');
    appendQualificationRead(after, 'uap-p3-b02-test-run-0001');
    appendTerminalProviderSafeFailure(after, 'uap-p3-b02-test-run-0001');
    const execution = after.adapter['executions']?.[0];
    if (execution === undefined) throw new Error('terminal execution fixture missing');
    execution['state'] = 'RUNNING';

    expect(() =>
      module.assessUgvB02TerminalProviderSafeWindow(before, after, {
        simulationId: 'uap-p3-b02-test-run-0001',
      }),
    ).toThrow('UAP_B02_RECOVERY_TERMINAL_SAFETY_INVALID');
  });

  it('rejects a qualification-shaped recovery read when it is task-bound or cross-run', async () => {
    const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
    const before = emptyProviderLedger('2026-08-21T12:00:00.000Z');
    const after = structuredClone(before);
    after.capturedAt = '2026-08-21T12:00:20.000Z';
    after.adapter['deviceToolCalls']?.push({
      callId: 'qualification-call-1',
      call_id: 'qualification-call-1',
      taskId: 'qualification-read-task-1',
      task_id: 'qualification-read-task-1',
      toolName: 'get_status',
      tool_name: 'get_status',
      argumentHash: 'a'.repeat(64),
      argument_hash: 'a'.repeat(64),
      outcome: 'accepted',
      occurredAt: '2026-08-21T12:00:10.100Z',
    });
    after.sdar['mcpInvocations']?.push({
      status: 'succeeded',
      taskId: 'forbidden-task',
      task_id: 'forbidden-task',
      toolName: 'vehicle_get_state',
      tool_name: 'vehicle_get_state',
      executionMode: 'simulation',
      simulationId: 'uap-p3-b02-other-run-0001',
      simulation_id: 'uap-p3-b02-other-run-0001',
    });
    expect(() =>
      module.assessUgvB02ZeroDispatchWindow(before, after, {
        simulationId: 'uap-p3-b02-test-run-0001',
      }),
    ).toThrow('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  });

  it.each(zeroDispatchCollectionPaths())(
    'rejects recovery when the %s authority collection changes',
    async (name, group, collection) => {
      const module = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
      expect(module.UGV_B02_ZERO_DISPATCH_DELTA_KEYS).toEqual(
        zeroDispatchCollectionPaths().map(([expectedName]) => expectedName),
      );
      const before = emptyProviderLedger('2026-08-21T12:00:00.000Z');
      const after = structuredClone(emptyProviderLedger('2026-08-21T12:00:20.000Z'));
      const groupValue = after[group] as Record<string, unknown>;
      const rows = groupValue[collection] as unknown[];
      rows.push({ rowId: `drift-${name}` });
      expect(() => module.assessUgvB02ZeroDispatchWindow(before, after)).toThrow(
        'UAP_B02_RECOVERY_NONZERO_DISPATCH',
      );
    },
  );

  it('rejects path escape, forged identity state, nonzero activity, and issuance after PASS', async () => {
    const module = await attemptIdentityModule();

    const escaped = await recoveryIdentityFixture();
    const outsideFailure = join(escaped.root, 'outside-failure.redacted.json');
    await writeFile(outsideFailure, await readFile(escaped.failureReportPath), { mode: 0o600 });
    await expect(
      module.issueB02AttemptIdentity(
        { ...escaped.input, failureReportPath: outsideFailure },
        escaped.options,
      ),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_FAILURE_REPORT_PATH_INVALID' });
    await expect(
      readdir(join(escaped.stateRoot, 'b02', 'attempt-identities')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const active = await recoveryIdentityFixture();
    const activeAfter = emptyProviderLedger('2026-08-21T12:00:20.000Z');
    activeAfter.runtime['providerTasks']?.push({ taskId: 'unexpected-task' });
    await privateJson(active.afterLedgerPath, activeAfter);
    await expect(
      module.issueB02AttemptIdentity(active.input, active.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_NONZERO_DISPATCH' });

    const forged = await recoveryIdentityFixture();
    const identityRoot = join(forged.stateRoot, 'b02', 'attempt-identities');
    await mkdir(identityRoot, { mode: 0o700 });
    await privateJson(join(identityRoot, `${forged.predecessorSimulationId}.json`), {
      schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-identity/v1',
      status: 'issued',
    });
    await expect(
      module.authorizeB02SimulationId('uap-p3-b02-forged-record-0001', forged.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_ATTEMPT_IDENTITY_STATE_INVALID' });

    const passed = await recoveryIdentityFixture();
    await privateJson(join(passed.reportRoot, 'uap-p3-b02-verification.json'), {
      schemaVersion: 'sdar.ugv-agent-profile.a2a-move-index/v1',
      status: 'passed',
      task: 'UAP-P3-B02',
    });
    await expect(
      module.issueB02AttemptIdentity(passed.input, passed.options),
    ).rejects.toMatchObject({ code: 'UAP_B02_RECOVERY_AFTER_PASS_FORBIDDEN' });
    expect(await recoveryFixtureSnapshot(passed)).toEqual(passed.initialSnapshot);
  });

  it('rejects an unissued wrapper identity before creating its run directory or invoking actions', async () => {
    const harness = await createWrapperHarness();
    const forgedSimulationId = 'uap-p3-b02-forged-wrapper-0001';
    const result = await runWrapperHarness(harness, {
      UGV_SIMULATION_RUN_ID: forgedSimulationId,
    });
    expect(result).toMatchObject({ code: 64, signal: null });
    expect(result.stderr).toContain('UAP_B02_SIMULATION_ID_NOT_AUTHORIZED');
    expect(result.events).toEqual([`identity:authorize:${forgedSimulationId}`]);
    await expect(
      lstat(join(harness.root, 'state', 'b02', forgedSimulationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when the execution capture active identity differs from the issued ambient identity', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness, {
      UAP_TEST_CAPTURE_ACTIVE_SIMULATION_ID: 'uap-p3-b02-different-wrapper-identity',
    });

    expect(result).toMatchObject({ code: 63, signal: null });
    expect(result.events).toContain('restart:YES');
    expect(result.events).toContain('capture:YES:execution');
    expect(result.events).toContain('restart:NO');
    expect(result.events).toContain('capture:NO:final');
    expect(result.events).not.toContain('driver:prepare');
    expect(result.events).not.toContain('driver:observe');
    await expectNoPassedPublication(harness);
  });

  it('serializes one issued identity with a kernel-held lock before any direct qualifier', async () => {
    const harness = await createWrapperHarness();
    const winner = startWrapperHarness(harness, { UAP_TEST_QUALIFIER_BLOCK: 'YES' });
    await waitForPath(join(harness.root, 'qualifier-entered'));

    const loser = await runWrapperHarness(harness);
    expect(loser).toMatchObject({ code: 75, signal: null });
    expect(loser.stderr).toContain('UAP_B02_SIMULATION_ALREADY_RUNNING');
    const duringContention = await readEvents(harness.eventLogPath);
    expect(duringContention.filter((event) => event === 'qualify:smpp-readonly')).toHaveLength(1);
    expect(duringContention).not.toContain('ledger:capture');
    expect(duringContention).not.toContain('source-recovery:NO');
    expect(duringContention).not.toContain('driver:authority-gate');
    expect(duringContention).not.toContain('restart:YES');
    await expect(
      lstat(join(harness.root, 'state', 'b02', harness.simulationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(join(harness.root, 'qualifier-release'), 'release\n', { mode: 0o600 });
    const won = await winner.result;
    expect(won).toMatchObject({ code: 0, signal: null });
    const finalEvents = await readEvents(harness.eventLogPath);
    expect(finalEvents.filter((event) => event === 'qualify:smpp-readonly')).toHaveLength(1);
    expect(finalEvents.filter((event) => event === 'ledger:capture')).toHaveLength(1);
    expect(finalEvents.filter((event) => event === 'source-recovery:NO')).toHaveLength(1);
    expect(finalEvents.filter((event) => event === 'driver:authority-gate')).toHaveLength(1);
    expect(finalEvents.filter((event) => event === 'restart:YES')).toHaveLength(1);
    await expectPassedPublication(harness);
  });

  it('rejects a sequential same-ID rerun before qualifier, ledger, Source, gate, or YES', async () => {
    const harness = await createWrapperHarness();
    const first = await runWrapperHarness(harness);
    expect(first).toMatchObject({ code: 0, signal: null });
    const before = await readEvents(harness.eventLogPath);

    const repeated = await runWrapperHarness(harness);
    expect(repeated).toMatchObject({ code: 73, signal: null });
    expect(repeated.stderr).toContain('UAP_B02_RUN_ALREADY_ATTEMPTED');
    const after = await readEvents(harness.eventLogPath);
    for (const event of [
      'qualify:smpp-readonly',
      'ledger:capture',
      'source-recovery:NO',
      'driver:authority-gate',
      'restart:YES',
    ])
      expect(after.filter((candidate) => candidate === event)).toHaveLength(
        before.filter((candidate) => candidate === event).length,
      );
    await expectPassedPublication(harness);
  });

  it.each(['file', 'symlink'] as const)(
    'rejects a pre-existing official-run %s without following it or invoking admission actions',
    async (shape) => {
      const harness = await createWrapperHarness();
      const runPath = join(harness.root, 'state', 'b02', harness.simulationId);
      await mkdir(dirname(runPath), { recursive: true, mode: 0o700 });
      if (shape === 'file') await writeFile(runPath, 'occupied\n', { mode: 0o600 });
      else {
        const target = join(harness.root, 'unrelated-symlink-target');
        await mkdir(target, { mode: 0o700 });
        await symlink(target, runPath);
      }

      const result = await runWrapperHarness(harness);
      expect(result).toMatchObject({ code: 73, signal: null });
      expect(result.stderr).toContain('UAP_B02_RUN_ALREADY_ATTEMPTED');
      for (const event of [
        'qualify:smpp-readonly',
        'ledger:capture',
        'source-recovery:NO',
        'driver:authority-gate',
        'restart:YES',
      ])
        expect(result.events).not.toContain(event);
      await expectNoPassedPublication(harness);
    },
  );

  it('rejects an unsafe staged preledger before Source, gate, official run, or YES', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: 'preledger-mode' });

    expect(result).toMatchObject({ code: 48, signal: null });
    expect(result.events).toContain('qualify:smpp-readonly');
    expect(result.events).toContain('ledger:capture');
    expect(result.events).toContain('driver:preflight');
    expect(result.events).not.toContain('source-recovery:NO');
    expect(result.events).not.toContain('driver:authority-gate');
    expect(result.events).not.toContain('restart:YES');
    await expect(
      lstat(join(harness.root, 'state', 'b02', harness.simulationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(join(harness.root, 'state', 'b02', 'preflight-staging'))).resolves.toEqual(
      [],
    );
    await expectNoPassedPublication(harness);
  });

  it.each([
    ['source recovery', 'source-recovery', 43, 'recover-source-under-no'],
    ['authority gate', 'authority-gate', 44, 'authority-runway-gate'],
  ] as const)(
    'finalizes %s failure from a durable zero-dispatch baseline before A2A, navigation, mutation, or YES',
    async (_name, failedStage, expectedExit, recordedStage) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: failedStage });

      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expectOrderedEvents(result.events, [
        `identity:authorize:${harness.simulationId}`,
        'tools:checked',
        'validate:environment',
        'stack:owned',
        'stack:smpp-live',
        'stack:sdar-live',
        'qualify:smpp-readonly',
        'ledger:capture',
        'driver:preflight',
        'source-recovery:NO',
      ]);
      if (failedStage === 'authority-gate')
        expect(result.events).toContain('driver:authority-gate');
      else expect(result.events).not.toContain('driver:authority-gate');
      expect(result.events.filter((event) => event === 'qualify:smpp-readonly')).toHaveLength(1);
      expect(result.events.filter((event) => event === 'ledger:capture')).toHaveLength(1);
      expect(result.events).not.toContain('restart:YES');
      expect(result.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
      expect(result.events).toContain('capture:NO:final');
      expect(result.events).toContain(`record-failure:${recordedStage}:${String(expectedExit)}`);
      expect(result.events).not.toContain('driver:prepare');
      expect(result.events).not.toContain('driver:observe');
      const runRoot = join(harness.root, 'state', 'b02', harness.simulationId);
      expect((await lstat(runRoot)).mode & 0o777).toBe(0o700);
      expect((await lstat(join(runRoot, 'provider-ledger-pre.json'))).mode & 0o777).toBe(0o600);
      await expect(
        readdir(join(harness.root, 'state', 'b02', 'preflight-staging')),
      ).resolves.toEqual([]);
      if (failedStage === 'authority-gate')
        await expect(
          readdir(join(harness.root, 'state', 'b02', 'authority-gate-staging')),
        ).resolves.toEqual([]);
      await expectNoPassedPublication(harness);
    },
  );

  it('rejects the same identity locally after a gate failure instead of replaying expiring Source evidence', async () => {
    const harness = await createWrapperHarness();
    const failed = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: 'authority-gate' });
    expect(failed).toMatchObject({ code: 44, signal: null });
    expect(failed.events).toContain('source-recovery:fresh');
    expect(failed.events).not.toContain('restart:YES');
    expect(failed.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
    const before = await readEvents(harness.eventLogPath);

    const repeated = await runWrapperHarness(harness);
    expect(repeated).toMatchObject({ code: 73, signal: null });
    expect(repeated.stderr).toContain('UAP_B02_RUN_ALREADY_ATTEMPTED');
    const after = await readEvents(harness.eventLogPath);
    for (const event of [
      'qualify:smpp-readonly',
      'ledger:capture',
      'source-recovery:NO',
      'driver:authority-gate',
      'restart:YES',
    ])
      expect(after.filter((candidate) => candidate === event)).toHaveLength(
        before.filter((candidate) => candidate === event).length,
      );
    await expectNoPassedPublication(harness);
  });

  it('rolls back an empty official run after atomic preledger seal failure and permits same-ID replay', async () => {
    const harness = await createWrapperHarness();
    const failed = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: 'preledger-seal' });

    expect(failed).toMatchObject({ code: 45, signal: null });
    expect(failed.events).toContain('mv:preledger');
    expect(failed.events).not.toContain('restart:YES');
    expect(failed.events).not.toContain('restart:NO');
    await expect(
      lstat(join(harness.root, 'state', 'b02', harness.simulationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(join(harness.root, 'state', 'b02', 'preflight-staging'))).resolves.toEqual(
      [],
    );
    await expect(
      directoryEntriesOrEmpty(join(harness.root, 'state', 'b02', 'authority-gate-staging')),
    ).resolves.toEqual([]);
    await expectNoPassedPublication(harness);

    const resumed = await runWrapperHarness(harness);
    expect(resumed).toMatchObject({ code: 0, signal: null });
    expect(resumed.events.filter((event) => event === 'source-recovery:fresh')).toHaveLength(1);
    expect(resumed.events.filter((event) => event === 'source-recovery:replay')).toHaveLength(0);
    expect(resumed.events.filter((event) => event === 'restart:YES')).toHaveLength(1);
    await expectPassedPublication(harness);
  });

  it('seals the real preledger before finalizing when empty-run rollback also fails', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness, {
      UAP_TEST_FAIL_STAGE: 'preledger-seal-rmdir',
    });

    expect(result).toMatchObject({ code: 76, signal: null });
    expect(result.events.filter((event) => event === 'mv:preledger')).toHaveLength(2);
    expect(result.events).toContain('rmdir:official:injected-failure');
    expect(result.events).toContain('restart:NO');
    expect(result.events).toContain('capture:NO:final');
    expect(result.events).toContain('record-failure:create-official-run:76');
    expect(result.events).not.toContain('restart:YES');
    const preledger = join(
      harness.root,
      'state',
      'b02',
      harness.simulationId,
      'provider-ledger-pre.json',
    );
    expect((await lstat(preledger)).mode & 0o777).toBe(0o600);
    await expectNoPassedPublication(harness);
  });

  it('finalizes a gate-seal fault with the exact clean preledger already durable', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: 'gate-seal' });

    expect(result).toMatchObject({ code: 46, signal: null });
    expect(result.events).toContain('mv:preledger');
    expect(result.events).toContain('mv:authority-gate');
    expect(result.events).toContain('restart:NO');
    expect(result.events).toContain('capture:NO:final');
    expect(result.events).toContain('record-failure:seal-authority-runway-gate:46');
    expect(result.events).not.toContain('restart:YES');
    const runRoot = join(harness.root, 'state', 'b02', harness.simulationId);
    expect((await lstat(join(runRoot, 'provider-ledger-pre.json'))).mode & 0o777).toBe(0o600);
    await expect(lstat(join(runRoot, 'authority-gate.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expectNoPassedPublication(harness);
  });

  it('treats empty staging-directory cleanup failure as non-critical after evidence seal', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: 'staging-rmdir' });

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(result.stderr).toContain('UAP_B02_PREFLIGHT_STAGING_CLEANUP_DEFERRED');
    expect(result.events).toContain('rmdir:preflight:deferred');
    expect(result.events.filter((event) => event === 'restart:YES')).toHaveLength(1);
    await expectPassedPublication(harness);
  });

  it.each([
    ['preledger', 'INT', 130, 'create-official-run'],
    ['preledger', 'TERM', 143, 'create-official-run'],
    ['gate', 'INT', 130, 'seal-authority-runway-gate'],
    ['gate', 'TERM', 143, 'seal-authority-runway-gate'],
  ] as const)(
    'finalizes %s-seal %s as soon as the required recovery evidence is durable',
    async (seal, signal, expectedExit, recordedStage) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, {
        UAP_TEST_MV_SIGNAL: `${seal}:${signal}`,
      });

      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expect(result.events).toContain('mv:preledger');
      expect(result.events).toContain('restart:NO');
      expect(result.events).not.toContain('restart:YES');
      expect(result.events).toContain(`record-failure:${recordedStage}:${String(expectedExit)}`);
      const runRoot = join(harness.root, 'state', 'b02', harness.simulationId);
      expect((await lstat(join(runRoot, 'provider-ledger-pre.json'))).mode & 0o777).toBe(0o600);
      if (seal === 'gate') {
        expect(result.events).toContain('mv:authority-gate');
        expect((await lstat(join(runRoot, 'authority-gate.json'))).mode & 0o777).toBe(0o600);
      } else {
        expect(result.events).not.toContain('source-recovery:NO');
        expect(result.events).not.toContain('driver:authority-gate');
        expect(result.events).not.toContain('mv:authority-gate');
        await expect(lstat(join(runRoot, 'authority-gate.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      await expectNoPassedPublication(harness);
    },
  );

  it.each([
    ['INT', 130],
    ['TERM', 143],
  ] as const)(
    'defers %s during official run mkdir until the NO finalizer can seal the attempt',
    async (signal, expectedExit) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, { UAP_TEST_MKDIR_SIGNAL: signal });

      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expect(result.events).toContain(`mkdir-signal:${signal}`);
      expect(result.events).not.toContain('restart:YES');
      expect(result.events).toContain('qualify:smpp-readonly');
      expect(result.events).toContain('ledger:capture');
      expect(result.events).not.toContain('source-recovery:NO');
      expect(result.events).not.toContain('driver:authority-gate');
      expect(result.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
      expect(result.events).toContain('capture:NO:final');
      expect(result.events).toContain(`record-failure:create-official-run:${String(expectedExit)}`);
      const runRoot = join(harness.root, 'state', 'b02', harness.simulationId);
      expect((await lstat(runRoot)).mode & 0o777).toBe(0o700);
      expect((await lstat(join(runRoot, 'provider-ledger-pre.json'))).mode & 0o777).toBe(0o600);
      await expectNoPassedPublication(harness);
    },
  );

  it.each([
    ['mkdir', 'INT', 130, 'create-official-run', { UAP_TEST_MKDIR_SIGNAL: 'INT' }],
    ['mkdir', 'TERM', 143, 'create-official-run', { UAP_TEST_MKDIR_SIGNAL: 'TERM' }],
    ['preledger seal', 'INT', 130, 'create-official-run', { UAP_TEST_MV_SIGNAL: 'preledger:INT' }],
    [
      'preledger seal',
      'TERM',
      143,
      'create-official-run',
      { UAP_TEST_MV_SIGNAL: 'preledger:TERM' },
    ],
    [
      'authority-gate seal',
      'INT',
      130,
      'seal-authority-runway-gate',
      { UAP_TEST_MV_SIGNAL: 'gate:INT' },
    ],
    [
      'authority-gate seal',
      'TERM',
      143,
      'seal-authority-runway-gate',
      { UAP_TEST_MV_SIGNAL: 'gate:TERM' },
    ],
    [
      'preledger rollback-rmdir fallback',
      'failure',
      76,
      'create-official-run',
      { UAP_TEST_FAIL_STAGE: 'preledger-seal-rmdir' },
    ],
    [
      'authority-gate atomic move',
      'failure',
      46,
      'seal-authority-runway-gate',
      { UAP_TEST_FAIL_STAGE: 'gate-seal' },
    ],
    [
      'Source recovery',
      'failure',
      43,
      'recover-source-under-no',
      { UAP_TEST_FAIL_STAGE: 'source-recovery' },
    ],
    [
      'authority runway gate',
      'failure',
      44,
      'authority-runway-gate',
      { UAP_TEST_FAIL_STAGE: 'authority-gate' },
    ],
  ] as const)(
    'issues an append-only successor after actual %s %s finalizer evidence',
    async (_boundary, _fault, expectedExit, expectedStage, injectedEnvironment) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, {
        ...injectedEnvironment,
        UAP_TEST_REAL_FAILURE_RECORDER: 'YES',
      });

      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expect(result.events).toContain(`record-failure:${expectedStage}:${String(expectedExit)}`);
      expect(result.events).not.toContain('restart:YES');
      const beforeRepeat = await readEvents(harness.eventLogPath);
      const repeated = await runWrapperHarness(harness);
      expect(repeated).toMatchObject({ code: 73, signal: null });
      expect(repeated.stderr).toContain('UAP_B02_RUN_ALREADY_ATTEMPTED');
      const afterRepeat = await readEvents(harness.eventLogPath);
      for (const event of [
        'qualify:smpp-readonly',
        'ledger:capture',
        'source-recovery:NO',
        'driver:authority-gate',
        'restart:YES',
      ])
        expect(afterRepeat.filter((candidate) => candidate === event)).toHaveLength(
          beforeRepeat.filter((candidate) => candidate === event).length,
        );
      await issueSuccessorAfterWrapperFailure(harness, expectedStage, expectedExit);
    },
  );

  it.each([
    ['prepare', 41, 'prepare-unique-admission'],
    ['observe', 42, 'confirm-and-observe'],
    ['host-scan', 71, 'post-restore-log-scan'],
    ['smpp-scan', 71, 'post-restore-smpp-scan'],
    ['sdar-scan', 71, 'post-restore-sdar-scan'],
    ['private-log', 71, 'validate-private-report'],
    ['source-private-log', 71, 'validate-source-recovery-report'],
    ['authority-private-log', 71, 'validate-authority-gate-report'],
    ['project', 71, 'publish-canonical-report'],
  ] as const)(
    'runs the real finalizer after %s failure without publishing a passed attempt',
    async (failedStage, expectedExit, recordedStage) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, { UAP_TEST_FAIL_STAGE: failedStage });

      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expect(result.events).toContain('restart:NO');
      expect(result.events).toContain(`record-failure:${recordedStage}:${String(expectedExit)}`);
      expect(result.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
      await expectNoPassedPublication(harness);
    },
  );

  it.each([
    ['command', 'prepare', 41],
    ['capture', 'observe', 42],
  ] as const)(
    'makes restore-NO %s failure exit 70 dominate the original %s failure',
    async (restoreFailure, primaryFailure, primaryExit) => {
      const harness = await createWrapperHarness();
      const result = await runWrapperHarness(harness, {
        UAP_TEST_FAIL_STAGE: primaryFailure,
        UAP_TEST_FAIL_RESTORE: restoreFailure,
      });

      expect(primaryExit).not.toBe(70);
      expect(result).toMatchObject({ code: 70, signal: null });
      expect(result.events).toContain(`driver:${primaryFailure}`);
      expect(result.events).toContain('restart:NO');
      expect(result.events).toContain('capture:NO:final');
      expect(result.events).toContain('record-failure:restore-no:70');
      expect(result.events).not.toContain('scan:host');
      await expectNoPassedPublication(harness);
    },
  );

  it.each([
    ['INT', 130],
    ['TERM', 143],
  ] as const)(
    'restores NO after %s and ignores an INT+TERM pair inside the restore window',
    async (abortSignal, expectedExit) => {
      const harness = await createWrapperHarness();
      const running = startWrapperHarness(harness, {
        UAP_TEST_RESTORE_BLOCK: 'YES',
        UAP_TEST_SELF_SIGNAL: abortSignal,
      });
      await waitForPath(harness.restoreEnteredPath);

      expect(running.child.kill('SIGINT')).toBe(true);
      expect(running.child.kill('SIGTERM')).toBe(true);
      await writeFile(harness.restoreReleasePath, 'release\n', { mode: 0o600 });

      const result = await running.result;
      expect(result).toMatchObject({ code: expectedExit, signal: null });
      expect(result.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
      expect(result.events).toContain(`record-failure:confirm-and-observe:${String(expectedExit)}`);
      await expectNoPassedPublication(harness);
    },
  );

  it('publishes only after the sole restore-NO command and every private scan succeeds', async () => {
    const harness = await createWrapperHarness();
    const result = await runWrapperHarness(harness);

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(result.events.filter((event) => event === 'restart:YES')).toHaveLength(1);
    expect(result.events.filter((event) => event === 'restart:NO')).toHaveLength(1);
    expect(result.events.at(-1)).toBe('project:published');
    expectOrderedEvents(result.events, [
      'driver:prepare',
      'driver:observe',
      'restart:NO',
      'capture:NO:final',
      'scan:host',
      'scan:smpp',
      'scan:sdar',
      'validate:private-log:main',
      'validate:private-log:source',
      'validate:private-log:authority',
      'project:start',
      'project:published',
    ]);
    expect(result.events.some((event) => event.startsWith('record-failure:'))).toBe(false);
    await expectPassedPublication(harness);
  });
});

interface WrapperHarness {
  root: string;
  repositoryRoot: string;
  wrapperPath: string;
  eventLogPath: string;
  restoreEnteredPath: string;
  restoreReleasePath: string;
  reportRoot: string;
  stateRoot: string;
  simulationId: string;
  environment: NodeJS.ProcessEnv;
}

interface WrapperResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  events: string[];
}

async function createWrapperHarness(): Promise<WrapperHarness> {
  const root = await temporaryDirectory();
  const repositoryRoot = join(root, 'repository');
  const deploymentRoot = join(repositoryRoot, 'deploy/ugv-agent-profile-simulation');
  const scriptRoot = join(repositoryRoot, 'scripts/ugv-agent-profile-simulation');
  const driverRoot = join(repositoryRoot, 'apps/node-control-acceptance/src');
  const tsxRoot = join(repositoryRoot, 'node_modules/tsx/dist');
  const binaryRoot = join(root, 'bin');
  const reportRoot = join(repositoryRoot, 'reports/ugv-agent-profile-simulation');
  const stateRoot = join(root, 'state');
  const eventLogPath = join(root, 'events.log');
  const restoreEnteredPath = join(root, 'restore-entered');
  const restoreReleasePath = join(root, 'restore-release');
  const simulationId = 'uap-p3-b02-wrapper-test-0001';

  await Promise.all(
    [deploymentRoot, scriptRoot, driverRoot, tsxRoot, binaryRoot, reportRoot, stateRoot].map(
      (path) => mkdir(path, { recursive: true }),
    ),
  );
  await createExistingState(stateRoot);
  await privateText(join(stateRoot, 'simulation-run-id'), simulationId);
  await writeFile(join(deploymentRoot, 'qualify-a2a-move.sh'), await readFile(WRAPPER), {
    mode: 0o700,
  });
  await writeFile(join(deploymentRoot, 'common.sh'), wrapperCommonShim(), { mode: 0o600 });
  await writeFile(join(deploymentRoot, 'compose.sdar.yaml'), 'services: {}\n', { mode: 0o600 });
  await writeFile(
    join(driverRoot, 'ugv-agent-profile-a2a-move-driver.ts'),
    '// isolated wrapper test shim\n',
    { mode: 0o600 },
  );
  await writeFile(join(tsxRoot, 'cli.mjs'), '// isolated tsx shim\n', { mode: 0o600 });
  await writeFile(join(binaryRoot, 'node'), wrapperNodeShim(), { mode: 0o700 });
  await writeFile(join(binaryRoot, 'docker'), wrapperDockerShim(), { mode: 0o700 });
  await writeFile(join(binaryRoot, 'pnpm'), wrapperPnpmShim(), { mode: 0o700 });
  await writeFile(join(binaryRoot, 'mkdir'), wrapperMkdirShim(), { mode: 0o700 });
  await writeFile(join(binaryRoot, 'mv'), wrapperMvShim(), { mode: 0o700 });
  await writeFile(join(binaryRoot, 'rmdir'), wrapperRmdirShim(), { mode: 0o700 });
  const realFailureRunner = join(scriptRoot, 'record-b02-failure-runner.mjs');
  await writeFile(realFailureRunner, wrapperRealFailureRecorderRunner(), { mode: 0o600 });
  await writeFile(eventLogPath, '', { mode: 0o600 });

  return {
    root,
    repositoryRoot,
    wrapperPath: join(deploymentRoot, 'qualify-a2a-move.sh'),
    eventLogPath,
    restoreEnteredPath,
    restoreReleasePath,
    reportRoot,
    stateRoot,
    simulationId,
    environment: {
      PATH: `${binaryRoot}:/usr/bin:/bin`,
      ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES',
      UGV_SIMULATION_RUN_ID: simulationId,
      UAP_TEST_ROOT: root,
      UAP_TEST_EVENT_LOG: eventLogPath,
      UAP_TEST_SIMULATION_ID: simulationId,
      UAP_TEST_RESTORE_ENTERED: restoreEnteredPath,
      UAP_TEST_RESTORE_RELEASE: restoreReleasePath,
      UAP_TEST_QUALIFIER_ENTERED: join(root, 'qualifier-entered'),
      UAP_TEST_QUALIFIER_RELEASE: join(root, 'qualifier-release'),
      UAP_TEST_REAL_NODE: process.execPath,
      UAP_TEST_REAL_FAILURE_RUNNER: realFailureRunner,
      UAP_TEST_STATE_ROOT: stateRoot,
      UAP_TEST_REPORT_ROOT: reportRoot,
    },
  };
}

function startWrapperHarness(harness: WrapperHarness, environment: NodeJS.ProcessEnv = {}) {
  const child = spawn('/bin/bash', [harness.wrapperPath], {
    cwd: harness.repositoryRoot,
    env: { ...harness.environment, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const result = new Promise<WrapperResult>((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectResult(new Error('UAP_B02_WRAPPER_TEST_TIMEOUT'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      void readEvents(harness.eventLogPath).then((events) => {
        resolveResult({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          events,
        });
      }, rejectResult);
    });
  });
  return { child, result };
}

async function runWrapperHarness(harness: WrapperHarness, environment: NodeJS.ProcessEnv = {}) {
  return startWrapperHarness(harness, environment).result;
}

async function readEvents(path: string) {
  const source = await readFile(path, 'utf8');
  return source.split('\n').filter((event) => event.length > 0);
}

async function waitForPath(path: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`UAP_B02_WRAPPER_MARKER_TIMEOUT: ${path}`);
}

async function expectNoPassedPublication(harness: WrapperHarness) {
  const canonicalPath = join(harness.reportRoot, 'uap-p3-b02-verification.json');
  await expect(readFile(canonicalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  const attemptRoot = join(harness.reportRoot, 'attempts');
  const attempts = await readdir(attemptRoot).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  });
  expect(attempts).toEqual([]);
}

async function issueSuccessorAfterWrapperFailure(
  harness: WrapperHarness,
  expectedStage: string,
  expectedExit: number,
) {
  const attemptRoot = join(harness.reportRoot, 'attempts');
  const failureNames = (await readdir(attemptRoot)).filter(
    (entry) =>
      entry.startsWith(`uap-p3-b02-failure-${harness.simulationId}-`) &&
      entry.endsWith('.redacted.json'),
  );
  expect(failureNames).toHaveLength(1);
  const failureName = failureNames[0];
  if (failureName === undefined) throw new Error('expected actual wrapper failure evidence');
  const failureReportPath = join(attemptRoot, failureName);
  const failureSource = await readFile(failureReportPath, 'utf8');
  const failure = JSON.parse(failureSource) as Record<string, unknown>;
  expect(failure).toMatchObject({
    schemaVersion: 'sdar.ugv-agent-profile.a2a-move-failure/v1',
    status: 'failed',
    task: 'UAP-P3-B02',
    simulationId: harness.simulationId,
    stage: expectedStage,
    exitCode: expectedExit,
    sideEffectWindow: {
      yesEntered: false,
      restoreAttempted: true,
      restoredSideEffects: 'NO',
      restoreVerified: true,
    },
    activityAssessment: 'unknown_unless_private_ledgers_are_reconciled',
  });
  const failureGeneratedAt = failure['generatedAt'];
  if (typeof failureGeneratedAt !== 'string')
    throw new Error('expected actual wrapper failure timestamp');

  const predecessorRunRoot = join(harness.stateRoot, 'b02', harness.simulationId);
  const beforeLedgerPath = join(predecessorRunRoot, 'provider-ledger-pre.json');
  const afterLedgerPath = join(predecessorRunRoot, 'provider-ledger-recovery.json');
  const beforeSource = await readFile(beforeLedgerPath, 'utf8');
  const beforeLedger = JSON.parse(beforeSource) as MutableProviderLedger;
  expect((await lstat(predecessorRunRoot)).mode & 0o777).toBe(0o700);
  expect((await lstat(beforeLedgerPath)).mode & 0o777).toBe(0o600);
  expect((await lstat(failureReportPath)).mode & 0o777).toBe(0o600);

  const beforeCapturedAt = Date.parse(beforeLedger.capturedAt);
  const failureAt = Date.parse(failureGeneratedAt);
  expect(Number.isFinite(beforeCapturedAt)).toBe(true);
  expect(Number.isFinite(failureAt)).toBe(true);
  const afterAt = Math.max(Date.now(), beforeCapturedAt, failureAt) + 1;
  const afterLedger = structuredClone(beforeLedger);
  afterLedger.capturedAt = new Date(afterAt).toISOString();
  const ledger = (await import(pathToFileURL(LEDGER).href)) as LedgerModule;
  await ledger.writePrivateLedger(afterLedgerPath, afterLedger);
  expect((await lstat(afterLedgerPath)).mode & 0o777).toBe(0o600);
  const assessment = ledger.assessUgvB02ZeroDispatchWindow(beforeLedger, afterLedger);
  expect(assessment.classification).toBe('zero_dispatch');
  expect(Object.keys(assessment.deltas)).toEqual([...ledger.UGV_B02_ZERO_DISPATCH_DELTA_KEYS]);
  expect(Object.values(assessment.deltas)).toEqual(
    Array.from({ length: ledger.UGV_B02_ZERO_DISPATCH_DELTA_KEYS.length }, () => 0),
  );

  const afterSource = await readFile(afterLedgerPath, 'utf8');
  const immutableFailureSnapshot = Object.freeze({ failureSource, beforeSource, afterSource });
  const identity = await attemptIdentityModule();
  const issued = await identity.issueB02AttemptIdentity(
    {
      predecessorSimulationId: harness.simulationId,
      failureReportPath,
      beforeLedgerPath,
      afterLedgerPath,
    },
    {
      stateRoot: harness.stateRoot,
      reportRoot: harness.reportRoot,
      now: () => new Date(afterAt + 1).toISOString(),
    },
  );

  expect(issued.simulationId).not.toBe(harness.simulationId);
  expect(issued.a2aIdempotencyKey).not.toBe(
    identity.deriveB02AdmissionIdempotencyKey(harness.simulationId),
  );
  expect(issued.a2aIdempotencyKey).toBe(
    identity.deriveB02AdmissionIdempotencyKey(issued.simulationId),
  );
  expect(issued.record).toMatchObject({
    predecessorSimulationId: harness.simulationId,
    simulationId: issued.simulationId,
    failureReport: {
      relativePath: `attempts/${failureName}`,
      sha256: `sha256:${sha256(failureSource)}`,
      generatedAt: failureGeneratedAt,
    },
    zeroDispatchAssessment: {
      classification: 'zero_dispatch',
      deltas: assessment.deltas,
    },
  });
  expect((await lstat(issued.recordPath)).mode & 0o777).toBe(0o600);
  expect((await lstat(dirname(issued.recordPath))).mode & 0o777).toBe(0o700);
  await expect(
    identity.validateIssuedB02AttemptIdentity(issued.simulationId, {
      stateRoot: harness.stateRoot,
      reportRoot: harness.reportRoot,
    }),
  ).resolves.toMatchObject({
    status: 'authorized',
    kind: 'recovery_issued',
    simulationId: issued.simulationId,
    identityRecordPath: issued.recordPath,
    identityRecordSha256: issued.record['recordSha256'],
  });
  await expect(
    identity.authorizeB02SimulationId(harness.simulationId, {
      stateRoot: harness.stateRoot,
      reportRoot: harness.reportRoot,
    }),
  ).resolves.toMatchObject({ kind: 'initial_reserved', simulationId: harness.simulationId });
  await expect(lstat(join(harness.stateRoot, 'b02', issued.simulationId))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect({
    failureSource: await readFile(failureReportPath, 'utf8'),
    beforeSource: await readFile(beforeLedgerPath, 'utf8'),
    afterSource: await readFile(afterLedgerPath, 'utf8'),
  }).toEqual(immutableFailureSnapshot);
  expect(
    (await directoryEntriesOrEmpty(join(harness.stateRoot, 'b02', 'attempt-identities'))).filter(
      (entry) => entry.endsWith('.json'),
    ),
  ).toEqual([`${harness.simulationId}.json`]);
  expect(
    (await readdir(attemptRoot)).filter((entry) =>
      entry.startsWith('uap-p3-b02-recovery-reconciliation-'),
    ),
  ).toEqual([`uap-p3-b02-recovery-reconciliation-${issued.simulationId}.redacted.json`]);
  await expect(
    readFile(join(harness.reportRoot, 'uap-p3-b02-verification.json'), 'utf8'),
  ).rejects.toMatchObject({ code: 'ENOENT' });
}

async function expectPassedPublication(harness: WrapperHarness) {
  const canonicalPath = join(harness.reportRoot, 'uap-p3-b02-verification.json');
  const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as Record<string, unknown>;
  expect(canonical).toMatchObject({ task: 'UAP-P3-B02', status: 'passed' });
  const attemptRoot = join(harness.reportRoot, 'attempts');
  const attempts = await readdir(attemptRoot);
  expect(attempts).toEqual([`${harness.simulationId}.json`]);
  const attempt = JSON.parse(
    await readFile(join(attemptRoot, attempts[0] ?? ''), 'utf8'),
  ) as Record<string, unknown>;
  expect(attempt).toMatchObject({ task: 'UAP-P3-B02', status: 'passed' });
}

function expectOrderedEvents(events: readonly string[], expected: readonly string[]) {
  let prior = -1;
  for (const event of expected) {
    const index = events.indexOf(event);
    expect(index, `missing or unordered event: ${event}`).toBeGreaterThan(prior);
    prior = index;
  }
}

function wrapperCommonShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
uap_deploy_dir="$(CDPATH= cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
uap_repo_root="$(CDPATH= cd -- "$uap_deploy_dir/../.." && pwd)"
readonly uap_deploy_dir uap_repo_root
readonly UAP_STATE_ROOT="\${UAP_TEST_ROOT:?}/state"
readonly UAP_REPORT_ROOT="$uap_repo_root/reports/ugv-agent-profile-simulation"
readonly UAP_SDAR_SERVICES=(uap-sdar-postgres uap-control-postgres uap-redis)

uap_test_event() { printf '%s\\n' "$1" >>"\${UAP_TEST_EVENT_LOG:?}"; }
uap_authorize_b02_simulation_run_id() {
  uap_test_event "identity:authorize:$1"
  [[ "$1" == "\${UAP_TEST_SIMULATION_ID:?}" ]] || return 64
  printf '%s\\n' "$1"
}
uap_require_local_tools() { uap_test_event 'tools:checked'; }
uap_assert_owned_stack_running() { uap_test_event 'stack:owned'; }
uap_assert_smpp_live_exposure() { uap_test_event 'stack:smpp-live'; }
uap_assert_sdar_live_exposure() { uap_test_event 'stack:sdar-live'; }
uap_smpp_config() { uap_test_event 'compose:smpp-config'; printf '{}\\n'; }
uap_sdar_compose() { uap_test_event 'compose:sdar-config'; printf '{}\\n'; }
uap_smpp_ps() { uap_test_event 'compose:smpp-ps'; printf '[]\\n'; }

uap_supervisor() {
  local command="\${1:-}"
  shift || true
  if [[ "$command" == 'restart-server' && "\${1:-}" == '--side-effects' && "\${2:-}" == 'YES' ]]; then
    [[ "$#" -eq 6 ]]
    [[ "\${3:-}" == '--simulation-run-id' ]]
    [[ "\${4:-}" == "\${UAP_TEST_SIMULATION_ID:?}" ]]
    [[ "\${5:-}" == '--acknowledge' ]]
    [[ "\${6:-}" == 'I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS' ]]
    uap_test_event 'restart:YES'
    return 0
  fi
  if [[ "$command" == 'restart-server' && " $* " == *' --side-effects NO '* ]]; then
    uap_test_event 'restart:NO'
    if [[ "\${UAP_TEST_RESTORE_BLOCK:-}" == 'YES' ]]; then
      : >"\${UAP_TEST_RESTORE_ENTERED:?}"
      while [[ ! -f "\${UAP_TEST_RESTORE_RELEASE:?}" ]]; do /bin/sleep 0.01; done
    fi
    if [[ "\${UAP_TEST_FAIL_RESTORE:-}" == 'command' ]]; then return 61; fi
    return 0
  fi
  uap_test_event "supervisor:$command:$*"
}

uap_scan_host_process_logs() {
  uap_test_event 'scan:host'
  [[ "\${UAP_TEST_FAIL_STAGE:-}" != 'host-scan' ]]
}
uap_capture_and_scan_smpp_runtime() {
  uap_test_event 'scan:smpp'
  [[ "\${UAP_TEST_FAIL_STAGE:-}" != 'smpp-scan' ]]
}
uap_capture_and_scan_sdar_runtime() {
  uap_test_event 'scan:sdar'
  [[ "\${UAP_TEST_FAIL_STAGE:-}" != 'sdar-scan' ]]
}
`;
}

function wrapperNodeShim() {
  const zeroLedgerTemplate = JSON.stringify(emptyProviderLedger('__UAP_CAPTURED_AT__'));
  return `#!/usr/bin/env bash
set -euo pipefail
script="\${1:-}"
shift || true
base="\${script##*/}"
event() { printf '%s\\n' "$1" >>"\${UAP_TEST_EVENT_LOG:?}"; }
write_private() { mkdir -p "$(dirname -- "$1")"; printf '%s\\n' "$2" >"$1"; chmod 0600 "$1"; }

case "$base" in
  b02-supervisor-state.mjs)
    action="\${1:-}"; side_effects="\${2:-}"; output="\${3:-}"
    suffix='pre'
    [[ "$output" == */supervisor-execution.json ]] && suffix='execution'
    [[ "$output" == */supervisor-final.json ]] && suffix='final'
    event "capture:$side_effects:$suffix"
    if [[ "$suffix" == 'final' && "\${UAP_TEST_FAIL_RESTORE:-}" == 'capture' ]]; then exit 62; fi
    manifest_revision=1
    active_simulation_json='null'
    server_identity=${JSON.stringify(SUPERVISOR_PROCESS_HASHES.preServer)}
    if [[ "$suffix" == 'execution' ]]; then
      manifest_revision=2
      active_simulation_id="\${UAP_TEST_CAPTURE_ACTIVE_SIMULATION_ID:-\${UGV_SIMULATION_RUN_ID:?}}"
      [[ "$active_simulation_id" == "\${UGV_SIMULATION_RUN_ID:?}" ]] || exit 63
      active_simulation_json="\\"$active_simulation_id\\""
      server_identity=${JSON.stringify(SUPERVISOR_PROCESS_HASHES.executionServer)}
    elif [[ "$suffix" == 'final' ]]; then
      manifest_revision=3
      server_identity=${JSON.stringify(SUPERVISOR_PROCESS_HASHES.finalServer)}
    fi
    printf -v supervisor_status '{"schemaVersion":"sdar.ugv-agent-profile.host-process-status/v2","status":"running","processCount":3,"sideEffects":"%s","bootstrapRunId":"uap-p3-b01-test-run","manifestRevision":%s,"activeSimulationRunId":%s,"processIdentitySha256":{"server":"%s","nodeControlApi":"%s","nodeControlWorker":"%s"}}' \\
      "$side_effects" "$manifest_revision" "$active_simulation_json" "$server_identity" \\
      ${JSON.stringify(SUPERVISOR_PROCESS_HASHES.nodeControlApi)} \\
      ${JSON.stringify(SUPERVISOR_PROCESS_HASHES.nodeControlWorker)}
    write_private "$output" "$supervisor_status"
    ;;
  validate-profile.mjs)
    mode="\${1:-}"
    if [[ "$mode" == 'private-log' ]]; then
      file="\${3:-}"
      scan='main'
      [[ "$file" == */source-recovery-reports/* ]] && scan='source'
      [[ "$file" == */authority-gate.json ]] && scan='authority'
      event "validate:private-log:$scan"
      if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'private-log' && "$scan" == 'main' ]]; then exit 51; fi
      if [[ "\${UAP_TEST_FAIL_STAGE:-}" == "$scan-private-log" ]]; then exit 51; fi
    else
      event "validate:$mode"
    fi
    ;;
  qualify-smpp-readonly.mjs)
    event 'qualify:smpp-readonly'
    if [[ "\${UAP_TEST_QUALIFIER_BLOCK:-}" == 'YES' ]]; then
      : >"\${UAP_TEST_QUALIFIER_ENTERED:?}"
      while [[ ! -f "\${UAP_TEST_QUALIFIER_RELEASE:?}" ]]; do /bin/sleep 0.01; done
    fi
    ;;
  provider-ledger.mjs)
    event 'ledger:capture'
    captured_at="$(/usr/bin/date -u +%FT%T.%3NZ)"
    zero_ledger=${JSON.stringify(zeroLedgerTemplate)}
    zero_ledger="\${zero_ledger/__UAP_CAPTURED_AT__/$captured_at}"
    write_private "\${2:?}" "$zero_ledger"
    if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'preledger-mode' ]]; then chmod 0644 "\${2:?}"; fi
    ;;
  cli.mjs)
    driver="\${1:-}"; command="\${2:-}"
    event "driver:$command"
    if [[ "$command" == 'preflight' && "$(/usr/bin/stat -c '%a' "\${UGV_B02_PRE_LEDGER_FILE:?}")" != '600' ]]; then exit 48; fi
    if [[ "$command" == 'authority-gate' && "\${UAP_TEST_FAIL_STAGE:-}" == 'authority-gate' ]]; then exit 44; fi
    if [[ "$command" == 'authority-gate' ]]; then
      simulation_hash="$(printf '%s' "\${UGV_SIMULATION_RUN_ID:?}" | sha256sum | awk '{print $1}')"
      admission_hash="$(printf '%s' "\${UGV_B02_A2A_IDEMPOTENCY_KEY:?}" | sha256sum | awk '{print $1}')"
      printf '{"schemaVersion":"sdar.ugv-agent-profile.b02-authority-gate/v1","status":"passed","task":"UAP-P3-B02","simulationIdSha256":"sha256:%s","admissionIdempotencyKeySha256":"sha256:%s","observedAt":"2026-08-21T12:00:00.000Z","budgetsMs":{"source":240000,"binding":1200000,"runtimeDiscovery":1200000,"readiness":30000},"minimumRemainingTtlMs":{"source":240000,"binding":1200000,"runtimeDiscovery":1200000,"readiness":30000},"etagChecks":["source_strong_etag_body_contract_valid","capability_strong_etag_body_contract_valid","readiness_strong_etag_canonical_body_hash_valid"],"authorityChecks":["source_binding_candidate_lineage_exact","runtime_discovery_catalog_exact","capability_provider_policy_exact","readiness_implementation_partition_exact","same_round_observed_at"],"redaction":{"secretsIncluded":false,"endpointsIncluded":false,"entityIdsIncluded":false}}\\n' "$simulation_hash" "$admission_hash"
    fi
    if [[ "$command" == 'prepare' && "\${UAP_TEST_FAIL_STAGE:-}" == 'prepare' ]]; then exit 41; fi
    if [[ "$command" == 'observe' ]]; then
      if [[ "\${UAP_TEST_SELF_SIGNAL:-}" == 'INT' ]]; then kill -s INT "$PPID"; /bin/sleep 0.05; fi
      if [[ "\${UAP_TEST_SELF_SIGNAL:-}" == 'TERM' ]]; then kill -s TERM "$PPID"; /bin/sleep 0.05; fi
      if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'observe' ]]; then exit 42; fi
      write_private "\${UGV_B02_PRIVATE_REPORT_FILE:?}" '{"status":"passed"}'
    fi
    ;;
  project-a2a-move-report.mjs)
    event 'project:start'
    if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'project' ]]; then exit 52; fi
    source_recovery="\${5:?}"
    authority_gate="\${6:?}"
    output="\${7:?}"
    [[ -f "$source_recovery" ]] || exit 53
    [[ -f "$authority_gate" ]] || exit 54
    attempt_root="$(dirname -- "$output")/attempts"
    mkdir -p "$attempt_root"
    write_private "$attempt_root/\${UAP_TEST_SIMULATION_ID:?}.json" '{"task":"UAP-P3-B02","status":"passed"}'
    write_private "$output" '{"task":"UAP-P3-B02","status":"passed"}'
    event 'project:published'
    ;;
  record-b02-failure.mjs)
    event "record-failure:\${2:-unknown}:\${3:-unknown}"
    if [[ "\${UAP_TEST_REAL_FAILURE_RECORDER:-}" == 'YES' ]]; then
      exec "\${UAP_TEST_REAL_NODE:?}" "\${UAP_TEST_REAL_FAILURE_RUNNER:?}" "$@"
    fi
    ;;
  *)
    event "node:unexpected:$base"
    exit 97
    ;;
esac
`;
}

function wrapperRealFailureRecorderRunner() {
  return `import { recordB02Failure } from ${JSON.stringify(pathToFileURL(FAILURE_RECORDER).href)};

const [command, stage, exitCodeSource, yesEnteredSource, finalStatusPath, simulationId] =
  process.argv.slice(2);
if (command !== 'record' || process.argv.length !== 8) {
  throw new Error('UAP_B02_TEST_FAILURE_RUNNER_INPUT_INVALID');
}
const yesEntered =
  yesEnteredSource === 'true' ? true : yesEnteredSource === 'false' ? false : undefined;
if (yesEntered === undefined) throw new Error('UAP_B02_TEST_FAILURE_RUNNER_INPUT_INVALID');
await recordB02Failure(
  {
    stage,
    exitCode: Number.parseInt(exitCodeSource, 10),
    yesEntered,
    finalSupervisorStatusPath: finalStatusPath,
    simulationId,
  },
  {
    stateRoot: process.env.UAP_TEST_STATE_ROOT,
    reportRoot: process.env.UAP_TEST_REPORT_ROOT,
  },
);
`;
}

function wrapperPnpmShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
event() { printf '%s\\n' "$1" >>"\${UAP_TEST_EVENT_LOG:?}"; }
if [[ "\${1:-}" != 'exec' || "\${2:-}" != 'tsx' || "\${3##*/}" != 'recover-b02-source-authority.mjs' ]]; then
  event "pnpm:unexpected:$*"
  exit 96
fi
if [[ "\${ALLOW_UGV_SIMULATION_SIDE_EFFECTS+x}" == 'x' ]]; then
  event 'source-recovery:side-effects-leaked'
  exit 95
fi
[[ "\${UGV_B02_SOURCE_RECOVERY_ATTEMPT_ID:-}" == "\${UAP_TEST_SIMULATION_ID:?}" ]] || exit 94
[[ "\${SMPP_SNAPSHOT_TTL_SECONDS:-}" == '300' ]] || exit 93
[[ "\${SDAR_CONTROL_API_TOKEN_FILE:-}" == "\${UAP_TEST_ROOT:?}/state/control-api.token" ]] || exit 92
event 'source-recovery:NO'
if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'source-recovery' ]]; then exit 43; fi
report="\${UAP_TEST_ROOT:?}/state/b02/source-recovery-reports/\${UGV_B02_SOURCE_RECOVERY_ATTEMPT_ID:?}.json"
if [[ -f "$report" ]]; then
  event 'source-recovery:replay'
else
  mkdir -p "$(dirname -- "$report")"
  printf '{"schemaVersion":"sdar.ugv-agent-profile.b02-source-recovery-envelope/v1","status":"passed"}\\n' >"$report"
  chmod 0600 "$report"
  event 'source-recovery:fresh'
fi
printf '{"status":"passed","action":"not_required","reportSha256":"sha256:%064d","secretsIncluded":false}\\n' 0
`;
}

function wrapperDockerShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "docker:$*" >>"\${UAP_TEST_EVENT_LOG:?}"
if [[ "\${1:-}" == 'compose' && "\${2:-}" == 'version' ]]; then printf 'Docker Compose version test\\n'; fi
`;
}

function wrapperMkdirShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${UAP_TEST_MKDIR_SIGNAL:-}" =~ ^(INT|TERM)$ && "\${1:-}" == '-m' && "\${2:-}" == '0700' && "\${3:-}" == "\${UAP_TEST_ROOT:?}/state/b02/\${UAP_TEST_SIMULATION_ID:?}" ]]; then
  printf '%s\\n' "mkdir-signal:\${UAP_TEST_MKDIR_SIGNAL}" >>"\${UAP_TEST_EVENT_LOG:?}"
  kill -s "\${UAP_TEST_MKDIR_SIGNAL}" "$PPID"
fi
exec /bin/mkdir "$@"
`;
}

function wrapperMvShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
source_path="\${2:-}"
target_path="\${3:-}"
event() { printf '%s\\n' "$1" >>"\${UAP_TEST_EVENT_LOG:?}"; }
if [[ "$source_path" == */provider-ledger-pre.json && "$target_path" == */\${UAP_TEST_SIMULATION_ID:?}/provider-ledger-pre.json ]]; then
  event 'mv:preledger'
  [[ "$(/usr/bin/stat -c '%a' "$source_path")" == '600' ]] || exit 49
  if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'preledger-seal' ]]; then exit 45; fi
  if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'preledger-seal-rmdir' && ! -f "\${UAP_TEST_ROOT:?}/preledger-mv-failed" ]]; then
    : >"\${UAP_TEST_ROOT:?}/preledger-mv-failed"
    exit 45
  fi
  if [[ "\${UAP_TEST_MV_SIGNAL:-}" =~ ^preledger:(INT|TERM)$ ]]; then
    kill -s "\${UAP_TEST_MV_SIGNAL#*:}" "$PPID"
  fi
fi
if [[ "$source_path" == */authority-gate-staging/* && "$target_path" == */\${UAP_TEST_SIMULATION_ID:?}/authority-gate.json ]]; then
  event 'mv:authority-gate'
  if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'gate-seal' ]]; then exit 46; fi
  if [[ "\${UAP_TEST_MV_SIGNAL:-}" =~ ^gate:(INT|TERM)$ ]]; then
    kill -s "\${UAP_TEST_MV_SIGNAL#*:}" "$PPID"
  fi
fi
exec /usr/bin/mv "$@"
`;
}

function wrapperRmdirShim() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'staging-rmdir' && "\${2:-}" == */preflight-staging/* ]]; then
  printf '%s\\n' 'rmdir:preflight:deferred' >>"\${UAP_TEST_EVENT_LOG:?}"
  exit 47
fi
if [[ "\${UAP_TEST_FAIL_STAGE:-}" == 'preledger-seal-rmdir' && "\${2:-}" == */b02/\${UAP_TEST_SIMULATION_ID:?} && ! -f "\${UAP_TEST_ROOT:?}/official-rmdir-failed" ]]; then
  : >"\${UAP_TEST_ROOT:?}/official-rmdir-failed"
  printf '%s\\n' 'rmdir:official:injected-failure' >>"\${UAP_TEST_EVENT_LOG:?}"
  exit 47
fi
exec /usr/bin/rmdir "$@"
`;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'sdar-b02-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

type ProviderLedgerGroup = Record<string, Record<string, unknown>[]>;

interface MutableProviderLedger {
  schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1';
  capturedAt: string;
  runtime: ProviderLedgerGroup;
  adapter: ProviderLedgerGroup;
  sdar: ProviderLedgerGroup;
}

interface RecoveryIdentityFixture {
  root: string;
  stateRoot: string;
  reportRoot: string;
  predecessorSimulationId: string;
  predecessorRunRoot: string;
  failureReportPath: string;
  beforeLedgerPath: string;
  afterLedgerPath: string;
  input: Readonly<{
    predecessorSimulationId: string;
    failureReportPath: string;
    beforeLedgerPath: string;
    afterLedgerPath: string;
  }>;
  options: Readonly<{
    stateRoot: string;
    reportRoot: string;
    now: () => string;
  }>;
  initialSnapshot: Readonly<Record<string, string>>;
}

async function attemptIdentityModule() {
  return (await import(pathToFileURL(ATTEMPT_IDENTITY).href)) as AttemptIdentityModule;
}

async function recoveryIdentityFixture(
  failureStage = 'prepare-unique-admission',
): Promise<RecoveryIdentityFixture> {
  const root = await temporaryDirectory();
  const stateRoot = join(root, 'state');
  const reportRoot = join(root, 'reports/ugv-agent-profile-simulation');
  const attemptsRoot = join(reportRoot, 'attempts');
  const predecessorSimulationId = 'uap-p3-b02-test-run-0001';
  const predecessorRunRoot = join(stateRoot, 'b02', predecessorSimulationId);
  const beforeLedgerPath = join(predecessorRunRoot, 'provider-ledger-pre.json');
  const afterLedgerPath = join(predecessorRunRoot, 'provider-ledger-recovery.json');
  const failureReportPath = join(
    attemptsRoot,
    `uap-p3-b02-failure-${predecessorSimulationId}-20260821120010000-fixture.redacted.json`,
  );

  await createExistingState(stateRoot);
  await mkdir(predecessorRunRoot, { recursive: true, mode: 0o700 });
  await mkdir(attemptsRoot, { recursive: true, mode: 0o700 });
  await chmod(join(stateRoot, 'b02'), 0o700);
  await chmod(predecessorRunRoot, 0o700);
  await chmod(attemptsRoot, 0o700);
  await privateText(join(predecessorRunRoot, 'first-attempt.sentinel'), 'immutable-first-failure');
  await privateJson(beforeLedgerPath, emptyProviderLedger('2026-08-21T12:00:00.000Z'));
  await privateJson(afterLedgerPath, emptyProviderLedger('2026-08-21T12:00:20.000Z'));
  await privateJson(failureReportPath, {
    schemaVersion: 'sdar.ugv-agent-profile.a2a-move-failure/v1',
    status: 'failed',
    task: 'UAP-P3-B02',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    generatedAt: '2026-08-21T12:00:10.000Z',
    bootstrapRunId: 'uap-p3-b01-test-run',
    simulationId: predecessorSimulationId,
    stage: failureStage,
    exitCode: 41,
    sideEffectWindow: {
      yesEntered: true,
      restoreAttempted: true,
      restoredSideEffects: 'NO',
      restoreVerified: true,
    },
    activityAssessment: 'unknown_unless_private_ledgers_are_reconciled',
    secretsIncluded: false,
    endpointsIncluded: false,
    downstreamDeviceIdsIncluded: false,
    modelValuesIncluded: false,
    modelEndpointsIncluded: false,
    modelCredentialsIncluded: false,
  });

  const input = Object.freeze({
    predecessorSimulationId,
    failureReportPath,
    beforeLedgerPath,
    afterLedgerPath,
  });
  const options = Object.freeze({
    stateRoot,
    reportRoot,
    now: () => '2026-08-21T12:20:20.000Z',
  });
  const fixture = {
    root,
    stateRoot,
    reportRoot,
    predecessorSimulationId,
    predecessorRunRoot,
    failureReportPath,
    beforeLedgerPath,
    afterLedgerPath,
    input,
    options,
    initialSnapshot: Object.freeze({}),
  } satisfies RecoveryIdentityFixture;
  return {
    ...fixture,
    initialSnapshot: await recoveryFixtureSnapshot(fixture),
  };
}

async function recoveryFixtureSnapshot(fixture: {
  stateRoot: string;
  predecessorRunRoot: string;
  failureReportPath: string;
  beforeLedgerPath: string;
  afterLedgerPath: string;
}) {
  const [
    bootstrapRunId,
    initialSimulationId,
    controlToken,
    sentinel,
    beforeLedger,
    afterLedger,
    failureReport,
  ] = await Promise.all([
    readFile(join(fixture.stateRoot, 'run-id'), 'utf8'),
    readFile(join(fixture.stateRoot, 'simulation-run-id'), 'utf8'),
    readFile(join(fixture.stateRoot, 'control-api.token'), 'utf8'),
    readFile(join(fixture.predecessorRunRoot, 'first-attempt.sentinel'), 'utf8'),
    readFile(fixture.beforeLedgerPath, 'utf8'),
    readFile(fixture.afterLedgerPath, 'utf8'),
    readFile(fixture.failureReportPath, 'utf8'),
  ]);
  return Object.freeze({
    bootstrapRunId,
    initialSimulationId,
    controlToken,
    sentinel,
    beforeLedger,
    afterLedger,
    failureReport,
  });
}

async function expectNoPublicBeforeIdentity(
  fixture: RecoveryIdentityFixture,
  expectCleanStaging: boolean,
) {
  const identityRoot = join(fixture.stateRoot, 'b02', 'attempt-identities');
  const identityEntries = (await directoryEntriesOrEmpty(identityRoot)).filter((entry) =>
    entry.endsWith('.json'),
  );
  const attemptEntries = await readdir(join(fixture.reportRoot, 'attempts'));
  const publicEntries = attemptEntries.filter((entry) =>
    entry.startsWith('uap-p3-b02-recovery-reconciliation-'),
  );
  expect(identityEntries).toHaveLength(identityEntries.length > 0 ? 1 : 0);
  expect(publicEntries.length).toBeLessThanOrEqual(identityEntries.length);
  let recordSimulationId: string | undefined;
  if (identityEntries[0] !== undefined) {
    const record = JSON.parse(
      await readFile(join(identityRoot, identityEntries[0]), 'utf8'),
    ) as Record<string, unknown>;
    if (typeof record['simulationId'] !== 'string')
      throw new Error('expected private recovery simulation identity');
    recordSimulationId = record['simulationId'];
  }
  if (!expectCleanStaging) return { recordSimulationId };
  for (const stagingRoot of [
    join(fixture.stateRoot, 'b02', 'attempt-identity-staging'),
    join(fixture.reportRoot, 'attempts', '.uap-p3-b02-recovery-staging'),
  ]) {
    expect(await directoryEntriesOrEmpty(stagingRoot)).toEqual([]);
  }
  return { recordSimulationId };
}

async function expectSingleRecoveryPair(fixture: RecoveryIdentityFixture, simulationId: string) {
  const identityEntries = (
    await directoryEntriesOrEmpty(join(fixture.stateRoot, 'b02', 'attempt-identities'))
  ).filter((entry) => entry.endsWith('.json'));
  const publicEntries = (await readdir(join(fixture.reportRoot, 'attempts'))).filter((entry) =>
    entry.startsWith('uap-p3-b02-recovery-reconciliation-'),
  );
  expect(identityEntries).toEqual([`${fixture.predecessorSimulationId}.json`]);
  expect(publicEntries).toEqual([
    `uap-p3-b02-recovery-reconciliation-${simulationId}.redacted.json`,
  ]);
  for (const stagingRoot of [
    join(fixture.stateRoot, 'b02', 'attempt-identity-staging'),
    join(fixture.reportRoot, 'attempts', '.uap-p3-b02-recovery-staging'),
  ])
    expect(await directoryEntriesOrEmpty(stagingRoot)).toEqual([]);
}

async function directoryEntriesOrEmpty(path: string) {
  return readdir(path).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  });
}

interface ProjectorAuthorityFixture {
  readonly repositoryRoot: string;
  readonly reportRoot: string;
  readonly stateRoot: string;
  readonly dotEnvPath: string;
  readonly simulationId: string;
  readonly a2aIdempotencyKey: string;
  readonly identityRecordSha256: string;
  readonly inputPath: string;
  readonly preStatusPath: string;
  readonly executionStatusPath: string;
  readonly finalStatusPath: string;
  readonly sourceRecoveryReportPath: string;
  readonly authorityGateReportPath: string;
  readonly outputPath: string;
  readonly sourceRecoveryEnvelope: Readonly<{
    schemaVersion: string;
    reportSha256: string;
    report: Readonly<Record<string, unknown>>;
  }>;
  readonly authorityGateReport: Readonly<Record<string, unknown>>;
  readonly projectorOptions: Readonly<Record<string, string>>;
}

type ProjectorAuthorityFault =
  | 'source-missing'
  | 'gate-missing'
  | 'source-tampered'
  | 'gate-tampered'
  | 'source-other-identity'
  | 'gate-other-identity';

type ProjectorSupervisorFault =
  | 'legacy-final'
  | 'execution-active-id'
  | 'revision-gap'
  | 'server-reused'
  | 'control-drift'
  | 'bootstrap-drift';

async function projectorAuthorityFixture(): Promise<ProjectorAuthorityFixture> {
  const recovery = await recoveryIdentityFixture();
  const identity = await attemptIdentityModule();
  const issued = await identity.issueB02AttemptIdentity(recovery.input, recovery.options);
  const identityRecordSha256 = issued.record['recordSha256'];
  if (typeof identityRecordSha256 !== 'string')
    throw new Error('expected issued identity record hash');
  const repositoryRoot = recovery.root;
  const reportRoot = recovery.reportRoot;
  const stateRoot = recovery.stateRoot;
  const dotEnvPath = join(recovery.root, '.env');
  const runRoot = join(stateRoot, 'b02', issued.simulationId);
  const inputPath = join(runRoot, 'report-private.json');
  const preStatusPath = join(runRoot, 'supervisor-pre.json');
  const executionStatusPath = join(runRoot, 'supervisor-execution.json');
  const finalStatusPath = join(runRoot, 'supervisor-final.json');
  const sourceRecoveryReportPath = join(
    stateRoot,
    'b02',
    'source-recovery-reports',
    `${issued.simulationId}.json`,
  );
  const authorityGateReportPath = join(runRoot, 'authority-gate.json');
  const outputPath = join(reportRoot, 'uap-p3-b02-verification.json');
  const sourceReport = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-source-recovery/v1',
    status: 'passed',
    evidenceClass: 'real_public_api',
    observedAt: '2026-08-21T12:21:00.000Z',
    action: 'not_required',
    identityRecordSha256,
    simulationIdSha256: sha256(issued.simulationId),
    source: Object.freeze({
      revision: 1,
      snapshotRevision: 1,
      snapshotChecksum: '1'.repeat(64),
      validUntilBefore: '2026-08-21T12:26:00.000Z',
      validUntilAfter: '2026-08-21T12:26:00.000Z',
      nativeRevision: 1,
      nativeChecksum: '2'.repeat(64),
      projectionContract: 'sdar-registry-v1',
      remainingTtlMsBefore: 300_000,
    }),
    binding: Object.freeze({
      revision: 1,
      catalogRevision: '1.0.0:1',
      catalogChecksum: '3'.repeat(64),
      availabilityValidUntil: '2026-08-21T12:42:00.000Z',
      remainingTtlMs: 1_260_000,
      operationCount: 10,
    }),
    runtime: Object.freeze({
      toolRevision: 1,
      catalogRevision: '1.0.0:1',
      catalogChecksum: '3'.repeat(64),
      discoveryValidUntil: '2026-08-21T12:42:00.000Z',
      remainingTtlMs: 1_260_000,
      operationCount: 10,
    }),
    capability: Object.freeze({
      version: 1,
      definitionHash: '4'.repeat(64),
      policyHash: `sha256:${'5'.repeat(64)}`,
    }),
    checks: Object.freeze([
      'issued_attempt_identity_authorized',
      'pre_command_authority_frozen',
      'registry_full_200_matches_binding',
      'binding_and_runtime_runway_not_less_than_20_minutes',
      'formal_supervisor_no_capture',
      'source_refresh_runway_not_less_than_270_seconds',
      'no_materialize_or_rebind_port',
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
  const evidence = (await import(pathToFileURL(EVIDENCE).href)) as EvidenceModule;
  const sourceRecoveryEnvelope = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-source-recovery-envelope/v1',
    reportSha256: `sha256:${evidence.sha256CanonicalJson(sourceReport)}`,
    report: sourceReport,
  });
  const authorityGateReport = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.b02-authority-gate/v1',
    status: 'passed',
    task: 'UAP-P3-B02',
    simulationIdSha256: prefixedSha256(issued.simulationId),
    admissionIdempotencyKeySha256: prefixedSha256(issued.a2aIdempotencyKey),
    observedAt: '2026-08-21T12:21:30.000Z',
    budgetsMs: ADMISSION_BUDGETS_MS,
    minimumRemainingTtlMs: Object.freeze({
      source: 270_000,
      binding: 1_230_000,
      runtimeDiscovery: 1_230_000,
      readiness: 30_000,
    }),
    etagChecks: Object.freeze([
      'source_strong_etag_body_contract_valid',
      'capability_strong_etag_body_contract_valid',
      'readiness_strong_etag_canonical_body_hash_valid',
    ]),
    authorityChecks: Object.freeze([
      'source_binding_candidate_lineage_exact',
      'runtime_discovery_catalog_exact',
      'capability_provider_policy_exact',
      'readiness_implementation_partition_exact',
      'same_round_observed_at',
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });

  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await chmod(runRoot, 0o700);
  await createDotEnv(dotEnvPath);
  await Promise.all([
    privateJson(
      inputPath,
      privateReport(issued.simulationId, issued.a2aIdempotencyKey, '2026-08-21T12:22:00.000Z'),
    ),
    privateJson(
      preStatusPath,
      supervisorStatusFixture('NO', 1, null, SUPERVISOR_PROCESS_HASHES.preServer),
    ),
    privateJson(
      executionStatusPath,
      supervisorStatusFixture(
        'YES',
        2,
        issued.simulationId,
        SUPERVISOR_PROCESS_HASHES.executionServer,
      ),
    ),
    privateJson(
      finalStatusPath,
      supervisorStatusFixture('NO', 3, null, SUPERVISOR_PROCESS_HASHES.finalServer),
    ),
    privateJson(sourceRecoveryReportPath, sourceRecoveryEnvelope),
    privateJson(authorityGateReportPath, authorityGateReport),
  ]);

  return Object.freeze({
    repositoryRoot,
    reportRoot,
    stateRoot,
    dotEnvPath,
    simulationId: issued.simulationId,
    a2aIdempotencyKey: issued.a2aIdempotencyKey,
    identityRecordSha256,
    inputPath,
    preStatusPath,
    executionStatusPath,
    finalStatusPath,
    sourceRecoveryReportPath,
    authorityGateReportPath,
    outputPath,
    sourceRecoveryEnvelope,
    authorityGateReport,
    projectorOptions: Object.freeze({ repositoryRoot, stateRoot, dotEnvPath }),
  });
}

async function injectProjectorAuthorityFault(
  fixture: ProjectorAuthorityFixture,
  fault: ProjectorAuthorityFault,
) {
  if (fault === 'source-missing') {
    await unlink(fixture.sourceRecoveryReportPath);
    return;
  }
  if (fault === 'gate-missing') {
    await unlink(fixture.authorityGateReportPath);
    return;
  }
  if (fault === 'source-tampered') {
    await privateJson(fixture.sourceRecoveryReportPath, {
      ...fixture.sourceRecoveryEnvelope,
      reportSha256: `sha256:${'0'.repeat(64)}`,
    });
    return;
  }
  if (fault === 'gate-tampered') {
    await privateJson(fixture.authorityGateReportPath, {
      ...fixture.authorityGateReport,
      minimumRemainingTtlMs: {
        source: ADMISSION_BUDGETS_MS.source - 1,
        binding: 1_230_000,
        runtimeDiscovery: 1_230_000,
        readiness: 30_000,
      },
    });
    return;
  }
  if (fault === 'source-other-identity') {
    const report = {
      ...fixture.sourceRecoveryEnvelope.report,
      simulationIdSha256: sha256('uap-p3-b02-other-identity-0001'),
    };
    const evidence = (await import(pathToFileURL(EVIDENCE).href)) as EvidenceModule;
    await privateJson(fixture.sourceRecoveryReportPath, {
      ...fixture.sourceRecoveryEnvelope,
      report,
      reportSha256: `sha256:${evidence.sha256CanonicalJson(report)}`,
    });
    return;
  }
  await privateJson(fixture.authorityGateReportPath, {
    ...fixture.authorityGateReport,
    simulationIdSha256: prefixedSha256('uap-p3-b02-other-identity-0001'),
  });
}

async function injectProjectorSupervisorFault(
  fixture: ProjectorAuthorityFixture,
  fault: ProjectorSupervisorFault,
) {
  if (fault === 'legacy-final') {
    await privateJson(fixture.finalStatusPath, {
      status: 'running',
      processCount: 3,
      sideEffects: 'NO',
    });
    return;
  }
  if (fault === 'execution-active-id') {
    await privateJson(
      fixture.executionStatusPath,
      supervisorStatusFixture(
        'YES',
        2,
        'uap-p3-b02-different-projector-identity',
        SUPERVISOR_PROCESS_HASHES.executionServer,
      ),
    );
    return;
  }
  if (fault === 'revision-gap') {
    await privateJson(
      fixture.executionStatusPath,
      supervisorStatusFixture(
        'YES',
        3,
        fixture.simulationId,
        SUPERVISOR_PROCESS_HASHES.executionServer,
      ),
    );
    return;
  }
  if (fault === 'server-reused') {
    await privateJson(
      fixture.executionStatusPath,
      supervisorStatusFixture('YES', 2, fixture.simulationId, SUPERVISOR_PROCESS_HASHES.preServer),
    );
    return;
  }
  if (fault === 'control-drift') {
    const final = supervisorStatusFixture('NO', 3, null, SUPERVISOR_PROCESS_HASHES.finalServer);
    await privateJson(fixture.finalStatusPath, {
      ...final,
      processIdentitySha256: {
        ...final.processIdentitySha256,
        nodeControlWorker: prefixedSha256('uap-b02-supervisor-drifted-control-worker'),
      },
    });
    return;
  }
  const final = supervisorStatusFixture('NO', 3, null, SUPERVISOR_PROCESS_HASHES.finalServer);
  await privateJson(fixture.finalStatusPath, {
    ...final,
    bootstrapRunId: 'uap-p3-b01-different-bootstrap-generation',
  });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function prefixedSha256(value: string) {
  return `sha256:${sha256(value)}`;
}

function zeroDispatchCollectionPaths() {
  return [
    ['runtimeIdempotencyRecords', 'runtime', 'idempotencyRecords'],
    ['runtimeProviderTasks', 'runtime', 'providerTasks'],
    ['runtimeAdmissionIntents', 'runtime', 'admissionIntents'],
    ['adapterExecutions', 'adapter', 'executions'],
    ['adapterDeviceToolCalls', 'adapter', 'deviceToolCalls'],
    ['adapterMutationJournal', 'adapter', 'mutationJournal'],
    ['adapterCommandAcks', 'adapter', 'commandAcks'],
    ['sdarModelInvocations', 'sdar', 'modelInvocations'],
    ['sdarMcpInvocations', 'sdar', 'mcpInvocations'],
    ['sdarStageModelRoutes', 'sdar', 'stageModelRoutes'],
    ['sdarModelProviders', 'sdar', 'modelProviders'],
    ['sdarInitialTaskAdmissions', 'sdar', 'initialTaskAdmissions'],
    ['sdarCapabilityAttempts', 'sdar', 'capabilityAttempts'],
    ['sdarGovernedConfirmations', 'sdar', 'governedConfirmations'],
    ['sdarRemoteAdmissionIntents', 'sdar', 'remoteAdmissionIntents'],
    ['sdarContinuationSnapshots', 'sdar', 'continuationSnapshots'],
    ['sdarContinuationAttempts', 'sdar', 'continuationAttempts'],
    ['sdarTerminalOutcomes', 'sdar', 'terminalOutcomes'],
    ['sdarWorkflowNodeEvents', 'sdar', 'workflowNodeEvents'],
    ['sdarTasks', 'sdar', 'tasks'],
    ['sdarGoals', 'sdar', 'goals'],
    ['sdarGoalContracts', 'sdar', 'goalContracts'],
    ['sdarUserGoalPlans', 'sdar', 'userGoalPlans'],
    ['sdarWorkflowPlans', 'sdar', 'workflowPlans'],
    ['sdarWorkflowInstances', 'sdar', 'workflowInstances'],
    ['sdarSkillExecutions', 'sdar', 'skillExecutions'],
    ['sdarSkillExecutionEvents', 'sdar', 'skillExecutionEvents'],
    ['sdarProcessedResults', 'sdar', 'processedResults'],
  ] as const;
}

function emptyProviderLedger(capturedAt: string): MutableProviderLedger {
  return {
    schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1',
    capturedAt,
    runtime: {
      idempotencyRecords: [],
      providerTasks: [],
      admissionIntents: [],
    },
    adapter: {
      executions: [],
      deviceToolCalls: [],
      mutationJournal: [],
      commandAcks: [],
    },
    sdar: emptySdar(),
  };
}

function appendQualificationRead(ledger: MutableProviderLedger, simulationId: string): void {
  const taskId = 'qualification-read-task-1';
  ledger.adapter['deviceToolCalls']?.push({
    callId: 'qualification-call-1',
    call_id: 'qualification-call-1',
    taskId,
    task_id: taskId,
    toolName: 'get_status',
    tool_name: 'get_status',
    argumentHash: 'a'.repeat(64),
    argument_hash: 'a'.repeat(64),
    outcome: 'accepted',
    occurredAt: '2026-08-21T12:00:10.100Z',
  });
  ledger.sdar['mcpInvocations']?.push({
    status: 'succeeded',
    taskId: null,
    task_id: null,
    capabilityAttemptId: null,
    controlConfirmationId: null,
    controlProviderBindingId: null,
    controlArgumentsHash: null,
    controlDispatchHash: null,
    toolName: 'vehicle_get_state',
    tool_name: 'vehicle_get_state',
    executionMode: 'simulation',
    simulationId,
    simulation_id: simulationId,
    arguments: { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
    error_code: null,
    error_message: null,
    startedAt: '2026-08-21T12:00:10.000Z',
    completedAt: '2026-08-21T12:00:10.200Z',
    execution_semantics_json: {
      effect: 'read_only',
      execution: 'synchronous',
      replay: 'allowed',
    },
    result_json: {
      isError: false,
      evidence: [{ subjectRef: `execution:vehicle:ugv1:sync:${taskId}` }],
      structuredContent: {
        identity: { resourceId: 'vehicle:ugv1', executionMode: 'simulation' },
      },
    },
  });
}

function appendPreconfirmationFailure(ledger: MutableProviderLedger, simulationId: string): void {
  const taskId = 'task-preconfirmation-failure-1';
  const contextId = 'context-preconfirmation-failure-1';
  const goalId = 'goal-preconfirmation-failure-1';
  const bindingId = 'binding-preconfirmation-failure-1';
  const attemptId = 'capability-attempt-preconfirmation-failure-1';
  const idempotencyKey = `uap-p3-b02-a2a-${createHash('sha256').update(simulationId).digest('hex')}`;
  ledger.sdar['initialTaskAdmissions']?.push({
    taskId,
    task_id: taskId,
    contextId,
    context_id: contextId,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    capabilityAttemptId: attemptId,
    capabilityBindingId: bindingId,
    capability_binding_id: bindingId,
  });
  ledger.sdar['capabilityAttempts']?.push({
    taskId,
    task_id: taskId,
    attemptId,
    attemptNo: 1,
    attempt_no: 1,
    capabilityBindingId: bindingId,
    reason: 'initial',
    status: 'failed',
    planId: null,
    plan_id: null,
    skill_version_refs: ['skill:embodied.move_to:1'],
    provider_binding_refs: ['ugv-smpp-uap-p3-b01-binding'],
  });
  ledger.sdar['tasks']?.push({
    taskId,
    task_id: taskId,
    contextId,
    context_id: contextId,
    goalId,
    goal_id: goalId,
    phase: 'failed',
    phase_message:
      'Task preparation failed with UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED: exact authority required.',
    planId: null,
    plan_id: null,
    selectedSkillId: null,
    selected_skill_id: null,
    user_id: 'uap-p3-b02-requester',
    request_metadata: {
      user_id: 'uap-p3-b02-requester',
      idempotency_key: idempotencyKey,
      structured_input: {
        resourceId: 'vehicle:ugv1',
        target: { frame: 'WGS84', x: 106.8134463, y: 29.72034353 },
      },
      'io.sdar/requestedCapability': {
        exposureId: 'a2a.embodied.move',
        versionConstraint: '2',
        requestId: idempotencyKey,
      },
    },
  });
  ledger.sdar['goals']?.push({
    goalId,
    goal_id: goalId,
    contextId,
    context_id: contextId,
    version: 1,
    goalVersion: 1,
    status: 'active',
  });
  ledger.sdar['goalContracts']?.push({
    goalId,
    goal_id: goalId,
    goalVersion: 1,
    goal_version: 1,
  });
  ledger.sdar['userGoalPlans']?.push({
    goalId,
    goal_id: goalId,
    goalVersion: 1,
    goal_version: 1,
    revision: 1,
    status: 'active',
  });
}

function appendAwaitingConfirmationPlanningFailure(
  ledger: MutableProviderLedger,
  simulationId: string,
): void {
  appendPreconfirmationFailure(ledger, simulationId);
  const task = ledger.sdar['tasks']?.[0];
  const attempt = ledger.sdar['capabilityAttempts']?.[0];
  if (task === undefined || attempt === undefined)
    throw new Error('preconfirmation fixture missing');
  const taskId = String(task['taskId']);
  const goalId = String(task['goalId']);
  const planId = `plan-${taskId}`;
  const executionId = `skill-execution-${planId}`;
  Object.assign(task, {
    phase: 'awaiting_plan_confirmation',
    phase_message: 'Plan confirmation required.',
    planId,
    plan_id: planId,
    selectedSkillId: 'embodied.move_to',
    selected_skill_id: 'embodied.move_to',
    selectedSkillVersion: 1,
    selected_skill_version: 1,
  });
  Object.assign(attempt, {
    status: 'prepared',
    planId,
    plan_id: planId,
    started_at: null,
    completedAt: null,
    completed_at: null,
  });
  const nodes = [
    {
      nodeId: 'ugv_initial_state',
      type: 'mcp_tool',
      tool: { toolName: 'vehicle_get_state' },
    },
    { nodeId: 'ugv_context_current_position', type: 'condition' },
    { nodeId: 'ugv_context_resource_state', type: 'condition' },
    { nodeId: 'ugv_context_permission', type: 'condition' },
    {
      nodeId: 'ugv_navigate',
      type: 'mcp_tool',
      tool: { toolName: 'vehicle_navigate' },
      arguments: {
        resourceId: 'vehicle:ugv1',
        mission: {
          type: 'point',
          target: { longitude: 106.8134463, latitude: 29.72034353 },
        },
        stopOnObstacle: true,
      },
    },
    {
      nodeId: 'ugv_final_state',
      type: 'mcp_tool',
      tool: { toolName: 'vehicle_get_state' },
    },
    { nodeId: 'ugv_evidence_final_position', type: 'condition' },
    { nodeId: 'ugv_success', type: 'result' },
    { nodeId: 'ugv_failure', type: 'result' },
  ];
  ledger.sdar['workflowPlans']?.push({
    planId,
    plan_id: planId,
    goalId,
    goal_id: goalId,
    goalVersion: 1,
    goal_version: 1,
    confirmation_status: 'awaiting_confirmation',
    confirmed_at: null,
    attempt_count: 1,
    definition_json: { nodes },
  });
  ledger.sdar['skillExecutions']?.push({
    taskId,
    task_id: taskId,
    goalId,
    goal_id: goalId,
    skillId: 'embodied.move_to',
    skill_id: 'embodied.move_to',
    skillVersion: 1,
    skill_version: 1,
    workflowPlanId: planId,
    workflow_plan_id: planId,
    executionId,
    execution_id: executionId,
    applicability_status: 'satisfied',
  });
  const eventTypes = [
    'skill.discovered',
    'skill.applicability_assessed',
    'skill.selected',
    'skill.mode_selected',
    'skill.context_resolved',
    'skill.composition_started',
    'skill.plan_generated',
    'skill.procedure_compiled',
    'skill.plan_compliance_passed',
    'skill.hard_gate_triggered',
    'skill.human_intervention',
  ];
  ledger.sdar['skillExecutionEvents']?.push(
    ...eventTypes.map((eventType, index) => ({
      executionId,
      execution_id: executionId,
      sequenceNumber: index + 1,
      sequence_number: index + 1,
      eventType,
      event_type: eventType,
    })),
  );
}

function appendConfirmedPretransportReadinessFailure(
  ledger: MutableProviderLedger,
  simulationId: string,
): void {
  appendAwaitingConfirmationPlanningFailure(ledger, simulationId);
  const task = ledger.sdar['tasks']?.[0];
  const attempt = ledger.sdar['capabilityAttempts']?.[0];
  const workflowPlan = ledger.sdar['workflowPlans']?.[0];
  const execution = ledger.sdar['skillExecutions']?.[0];
  const admission = ledger.sdar['initialTaskAdmissions']?.[0];
  const navigate = (workflowPlan?.['definition_json'] as Record<string, unknown> | undefined)?.[
    'nodes'
  ] as Record<string, unknown>[] | undefined;
  if (
    task === undefined ||
    attempt === undefined ||
    workflowPlan === undefined ||
    execution === undefined ||
    admission === undefined ||
    navigate?.[4] === undefined
  )
    throw new Error('confirmed pretransport fixture missing');
  const taskId = String(task['taskId']);
  const contextId = String(task['contextId']);
  const goalId = String(task['goalId']);
  const planId = String(workflowPlan['planId']);
  const attemptId = String(attempt['attemptId']);
  const bindingId = String(admission['capabilityBindingId']);
  const argumentsHash = '877aca18cc4b53152c90791ac0abf8345db36e1f370d66579f1caa5d2ae54fa3';
  const invocationId = 'mcp-invocation-pretransport-failure-1';
  const completedAt = '2026-08-21T12:00:12.300Z';
  Object.assign(task, {
    phase: 'failed',
    phase_message: 'Confirmed Task execution failed with TASK_CAPABILITY_TERMINAL_GUARD_FAILED.',
    error_code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
  });
  Object.assign(attempt, {
    status: 'failed',
    started_at: completedAt,
    completedAt,
    completed_at: completedAt,
  });
  Object.assign(workflowPlan, {
    confirmation_status: 'confirmed',
    confirmed_at: '2026-08-21T12:00:11.900Z',
  });
  const executionId = String(execution['executionId']);
  ledger.sdar['skillExecutionEvents']?.push(
    {
      executionId,
      execution_id: executionId,
      sequenceNumber: 12,
      sequence_number: 12,
      eventType: 'skill.execution_started',
      event_type: 'skill.execution_started',
      statusAfter: 'executing',
    },
    {
      executionId,
      execution_id: executionId,
      sequenceNumber: 13,
      sequence_number: 13,
      eventType: 'skill.execution_failed',
      event_type: 'skill.execution_failed',
      statusAfter: 'failed',
      details_json: { errorCode: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' },
    },
  );
  const deviceTaskId = 'task-state-read-pretransport-1';
  ledger.adapter['deviceToolCalls']?.push({
    callId: 'state-read-pretransport-call-1',
    call_id: 'state-read-pretransport-call-1',
    taskId: deviceTaskId,
    task_id: deviceTaskId,
    toolName: 'get_status',
    tool_name: 'get_status',
    argumentHash: 'a'.repeat(64),
    argument_hash: 'a'.repeat(64),
    outcome: 'accepted',
    occurredAt: '2026-08-21T12:00:12.100Z',
  });
  ledger.sdar['mcpInvocations']?.push({
    status: 'succeeded',
    taskId,
    task_id: taskId,
    capabilityAttemptId: attemptId,
    controlConfirmationId: null,
    controlProviderBindingId: null,
    controlArgumentsHash: null,
    controlDispatchHash: null,
    toolName: 'vehicle_get_state',
    tool_name: 'vehicle_get_state',
    executionMode: 'simulation',
    simulationId,
    simulation_id: simulationId,
    arguments: { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
    error_code: null,
    error_message: null,
    startedAt: '2026-08-21T12:00:12.000Z',
    completedAt: '2026-08-21T12:00:12.200Z',
    execution_semantics_json: {
      effect: 'read_only',
      execution: 'synchronous',
      replay: 'allowed',
    },
    result_json: {
      isError: false,
      evidence: [{ subjectRef: `execution:vehicle:ugv1:sync:${deviceTaskId}` }],
      structuredContent: {
        identity: { resourceId: 'vehicle:ugv1', executionMode: 'simulation' },
      },
    },
  });
  ledger.sdar['modelInvocations']?.push({
    invocationId: 'model-invocation-result-processing-1',
    taskId: null,
    stage: 'result_processing',
    operation: 'structured_generation',
    status: 'succeeded',
    errorCode: null,
    createdAt: '2026-08-21T12:00:20.000Z',
  });
  ledger.sdar['governedConfirmations']?.push({
    taskId,
    task_id: taskId,
    planId,
    plan_id: planId,
    capabilityAttemptId: attemptId,
    capabilityBindingId: bindingId,
    toolName: 'vehicle_navigate',
    tool_name: 'vehicle_navigate',
    argumentsHash,
    arguments_hash: argumentsHash,
    consumedAt: null,
    consumed_at: null,
    consumedInvocationId: null,
    consumedDispatchHash: null,
    revoked_at: null,
    confirmed_at: '2026-08-21T12:00:11.900Z',
    expires_at: '2026-08-21T12:05:11.900Z',
  });
  ledger.sdar['remoteAdmissionIntents']?.push({
    taskId,
    task_id: taskId,
    contextId,
    context_id: contextId,
    capabilityAttemptId: attemptId,
    operationName: 'vehicle_navigate',
    operation_name: 'vehicle_navigate',
    argumentsHash,
    arguments_hash: argumentsHash,
    invocationId,
    status: 'closed',
    reason_code: 'UGV_GOVERNED_CONTROL_READINESS_STALE',
    dispatch_hash: null,
    dispatched_at: null,
    materializedAt: null,
    materialized_at: null,
    recordedInvocationId: null,
    recorded_invocation_id: null,
    remote_receipt_json: null,
    local_envelope_json: {
      agentTaskId: taskId,
      workflowPlanId: planId,
      executionContext: { mode: 'simulation', simulationId },
    },
  });
  ledger.sdar['workflowInstances']?.push({
    goalId,
    goal_id: goalId,
    planId,
    plan_id: planId,
    status: 'failed',
    completedAt,
    result_json: null,
    errors_json: {
      runtime: { code: 'UGV_GOVERNED_CONTROL_READINESS_STALE' },
    },
    input_json: {
      skillInput: {
        resourceId: 'vehicle:ugv1',
        target: { frame: 'WGS84', x: 106.8134463, y: 29.72034353 },
      },
    },
  });
}

function appendTerminalProviderSafeFailure(
  ledger: MutableProviderLedger,
  simulationId: string,
): void {
  appendConfirmedPretransportReadinessFailure(ledger, simulationId);
  const task = ledger.sdar['tasks']?.[0];
  const attempt = ledger.sdar['capabilityAttempts']?.[0];
  const confirmation = ledger.sdar['governedConfirmations']?.[0];
  const intent = ledger.sdar['remoteAdmissionIntents']?.[0];
  const workflow = ledger.sdar['workflowInstances']?.[0];
  if (
    task === undefined ||
    attempt === undefined ||
    confirmation === undefined ||
    intent === undefined ||
    workflow === undefined
  )
    throw new Error('terminal-safe fixture missing');
  const taskId = String(task['taskId']);
  const attemptId = String(attempt['attemptId']);
  const providerTaskId = 'provider-task-terminal-safe-1';
  const invocationId = 'mcp-invocation-terminal-safe-1';
  const externalExecutionId = 'vehicle:ugv1:chassis:terminal-safe-1';
  const argumentHash = String(confirmation['argumentsHash']);
  const missionId = 'mission-terminal-safe-1';
  const argumentsValue = {
    resourceId: 'vehicle:ugv1',
    mission: {
      type: 'point',
      target: { longitude: 106.8134463, latitude: 29.72034353 },
    },
    stopOnObstacle: true,
  };
  const result = {
    status: 'completed',
    resourceId: 'vehicle:ugv1',
    missionId,
    correlationStrength: 'STRICT_CORRELATED',
    stationaryAtCompletion: true,
    endPosition: {
      type: 'geodetic',
      crs: 'EPSG:4326',
      longitude: 106.8134428,
      latitude: 29.7204045,
    },
  };
  Object.assign(confirmation, {
    consumedAt: '2026-08-21T12:00:12.250Z',
    consumed_at: '2026-08-21T12:00:12.250Z',
    consumedInvocationId: invocationId,
    consumedDispatchHash: 'sha256:dispatch-terminal-safe',
  });
  Object.assign(intent, {
    invocationId,
    status: 'uncertain',
    reason_code: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
    dispatch_hash: 'sha256:dispatch-terminal-safe',
    dispatched_at: '2026-08-21T12:00:12.250Z',
  });
  Object.assign(workflow, {
    errors_json: { runtime: { code: 'FROZEN_CREATE_TASK_RESULT_INVALID' } },
  });
  ledger.runtime['idempotencyRecords']?.push({
    rowId: `auth:vehicle_navigate:${invocationId}:simulation:${simulationId}`,
    state: 'COMPLETE',
    taskId: providerTaskId,
    operationName: 'vehicle_navigate',
    idempotencyKey: invocationId,
    stable_task_id: providerTaskId,
    simulation_key: simulationId,
    argumentHash,
    lease_owner: null,
    lease_expires_at: null,
    synchronous_result: null,
  });
  ledger.runtime['providerTasks']?.push({
    taskId: providerTaskId,
    providerId: 'isr.vehicle.ugv.ugv1',
    operationName: 'vehicle_navigate',
    executionMode: 'simulation',
    simulationId,
    arguments: argumentsValue,
    argumentHash,
    externalExecutionId,
    internalState: 'TERMINAL_COMPLETED',
    mcpStatus: 'completed',
    substate: null,
    error: null,
    terminal_at: '2026-08-21T12:01:50.000Z',
    result: { structuredContent: result },
  });
  ledger.runtime['admissionIntents']?.push({
    taskId: providerTaskId,
    state: 'PUBLISHED',
    operationName: 'vehicle_navigate',
    simulationId,
    arguments: argumentsValue,
    argumentHash,
  });
  ledger.adapter['executions']?.push({
    taskId: providerTaskId,
    state: 'SUCCEEDED',
    operationName: 'vehicle_navigate',
    resourceId: 'vehicle:ugv1',
    externalExecutionId,
    argumentHash,
    execution_context: { executionMode: 'SIMULATION', simulationId },
  });
  ledger.adapter['deviceToolCalls']?.push(
    {
      callId: 'path-call-terminal-safe-1',
      taskId: providerTaskId,
      toolName: 'ugv_path_follow_mission',
      outcome: 'accepted',
    },
    {
      callId: 'control-call-terminal-safe-1',
      taskId: providerTaskId,
      toolName: 'ugv_mission_control',
      outcome: 'accepted',
    },
  );
  ledger.adapter['mutationJournal']?.push(
    {
      rowId: `${providerTaskId}:start:01:primary`,
      taskId: providerTaskId,
      phase: 'PRIMARY',
      stepId: 'start:01:primary',
      toolName: 'ugv_path_follow_mission',
      state: 'ACCEPTED',
      externalMissionId: missionId,
    },
    {
      rowId: `${providerTaskId}:start:02:followup`,
      taskId: providerTaskId,
      phase: 'FOLLOWUP',
      stepId: 'start:02:followup',
      toolName: 'ugv_mission_control',
      state: 'ACCEPTED',
      externalMissionId: missionId,
    },
  );
  ledger.sdar['mcpInvocations']?.push({
    invocationId,
    status: 'failed',
    error_code: 'FROZEN_CREATE_TASK_RESULT_INVALID',
    result_json: null,
    taskId,
    capabilityAttemptId: attemptId,
    simulationId,
    toolName: 'vehicle_navigate',
    arguments: argumentsValue,
    controlArgumentsHash: argumentHash,
  });
}

async function transactionFixture() {
  const directory = await temporaryDirectory();
  const repositoryRoot = join(directory, 'repository');
  const attempts = join(repositoryRoot, 'reports/ugv-agent-profile-simulation/attempts');
  const index = join(
    repositoryRoot,
    'reports/ugv-agent-profile-simulation/uap-p3-b02-verification.json',
  );
  const module = (await import(pathToFileURL(EVIDENCE).href)) as EvidenceModule;
  const document = {
    schemaVersion: 'sdar.ugv-agent-profile.a2a-move/v1',
    status: 'passed',
    task: 'UAP-P3-B02',
    bootstrapRunId: 'bootstrap-run-1',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    secretsIncluded: false,
    endpointsIncluded: false,
    downstreamDeviceIdsIncluded: true,
    modelRouteIdentityHashesIncluded: true,
    modelValuesIncluded: false,
    modelEndpointsIncluded: false,
    modelCredentialsIncluded: false,
  };
  const options = {
    attemptDirectory: attempts,
    prefix: 'uap-p3-b02-transaction-test',
    document,
    indexPath: index,
    repositoryRoot,
    createIndex: (attemptPath: string) => ({
      schemaVersion: 'sdar.ugv-agent-profile.a2a-move-index/v1',
      status: 'passed',
      task: 'UAP-P3-B02',
      bootstrapRunId: 'bootstrap-run-1',
      evidenceClass: 'external_simulation',
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attemptPath.slice(repositoryRoot.length + 1),
      firstPassAttemptSha256: module.sha256CanonicalJson(document),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentityHashesIncluded: true,
      modelValuesIncluded: false,
      modelEndpointsIncluded: false,
      modelCredentialsIncluded: false,
    }),
  };
  return { module, options, attempts, index };
}

async function privateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function supervisorStatusFixture(
  sideEffects: 'NO' | 'YES',
  manifestRevision: number,
  activeSimulationRunId: string | null,
  serverIdentitySha256: string,
) {
  return {
    schemaVersion: 'sdar.ugv-agent-profile.host-process-status/v2',
    status: 'running',
    processCount: 3,
    sideEffects,
    bootstrapRunId: 'uap-p3-b01-test-run',
    manifestRevision,
    activeSimulationRunId,
    processIdentitySha256: {
      server: serverIdentitySha256,
      nodeControlApi: SUPERVISOR_PROCESS_HASHES.nodeControlApi,
      nodeControlWorker: SUPERVISOR_PROCESS_HASHES.nodeControlWorker,
    },
  } as const;
}

async function createExistingState(stateRoot: string) {
  await mkdir(join(stateRoot, 'pms'), { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  await chmod(join(stateRoot, 'pms'), 0o700);
  await privateText(join(stateRoot, 'run-id'), 'uap-p3-b01-test-run');
  await privateText(join(stateRoot, 'simulation-run-id'), 'uap-p3-b02-test-run-0001');
  await privateJson(join(stateRoot, 'state-manifest.json'), {
    schemaVersion: 'ugv-agent-profile.local-state/v1',
    owner: 'UAP-P3-B01',
    repositoryRoot: REPOSITORY_ROOT,
    smppComposeProject: 'sdar-uap-p3-b01-smpp',
    sdarComposeProject: 'sdar-uap-p3-b01-sdar',
    secretsIncluded: false,
  });
  for (const name of [
    'control-api.token',
    'control-operator-api.token',
    'control-viewer-api.token',
    'control-security-api.token',
    'control-organization-api.token',
    'runtime-control-service.token',
    'cognitive-management.token',
    'governed-control.token',
    'artifact-management.token',
  ])
    await privateText(join(stateRoot, name), `test-${name}-value`);
  await privateText(join(stateRoot, 'pms/runtime-registration.token'), 'registration-token-value');
  await privateText(
    join(stateRoot, 'pms/pms-database-url'),
    'postgresql://test-provider-db.invalid/provider',
  );
  await privateJson(join(stateRoot, 'pms/postgres-provisioning.json'), {
    adminDatabaseUrl: 'postgresql://test-admin-db.invalid/postgres',
    runtimePassword: 'test-runtime-password-value',
  });
}

async function privateText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${value}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function createDotEnv(path: string) {
  const masterKey = Buffer.alloc(32, 7).toString('base64');
  const source = [
    `SDAR_MASTER_KEY_BASE64=${masterKey}`,
    'SDAR_UGV_MODEL_PROVIDER_ID=private-provider-value',
    'SDAR_UGV_MODEL_BASE_URL=http://127.0.0.1:18001/v1',
    'SDAR_UGV_MODEL_NAME=private-model-value',
    'SDAR_UGV_MODEL_EMBEDDING_NAME=private-embedding-value',
    'SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID=private-embedding-provider-value',
    'SDAR_UGV_MODEL_EMBEDDING_BASE_URL=http://127.0.0.1:18002/v1',
    'SDAR_UGV_MODEL_API_STYLE=openai_chat_completions',
    'SDAR_UGV_MODEL_TIMEOUT_MS=30000',
    'SDAR_UGV_REAL_MODEL_ENABLED=YES',
    'SDAR_UGV_MODEL_API_KEY=test-private-api-key',
  ].join('\n');
  await writeFile(path, `${source}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function emptySdar() {
  return {
    modelInvocations: [],
    mcpInvocations: [],
    stageModelRoutes: [],
    modelProviders: [],
    initialTaskAdmissions: [],
    capabilityAttempts: [],
    governedConfirmations: [],
    remoteAdmissionIntents: [],
    continuationSnapshots: [],
    continuationAttempts: [],
    terminalOutcomes: [],
    workflowNodeEvents: [],
    tasks: [],
    goals: [],
    goalContracts: [],
    userGoalPlans: [],
    workflowPlans: [],
    workflowInstances: [],
    skillExecutions: [],
    skillExecutionEvents: [],
    processedResults: [],
  };
}

function privateReport(
  simulationId = 'uap-p3-b02-test-run-0001',
  admissionIdempotencyKey = 'admission-1',
  generatedAt = '2026-08-21T12:00:10.000Z',
) {
  const deviceCallIds = [
    'device-call-1',
    'device-call-2',
    'device-call-3',
    'device-call-4',
    'device-call-5',
  ];
  const mutationRowIds = ['mutation-row-1', 'mutation-row-2'];
  return {
    schemaVersion: 'sdar.ugv-agent-profile.a2a-move/v1',
    status: 'passed',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observationClass: 'external_runtime_and_postgresql',
    generatedAt,
    simulationId,
    qualification: {
      simulationId,
      invocationId: 'qualification-1',
      resultHash: `sha256:${'a'.repeat(64)}`,
      completedAt: '2026-08-21T12:00:00.000Z',
      observedAt: '2026-08-21T12:00:00.000Z',
      revision: 'b'.repeat(64),
      mqttIngressSequence: 1,
      serverId: 'server-1',
      providerBindingId: 'binding-1',
      providerId: 'isr.vehicle.ugv.ugv1',
      operationName: 'vehicle_get_state',
      resourceId: 'vehicle:ugv1',
      sourcePosition: { longitude: 120, latitude: 30 },
      target: { x: 120.00001, y: 30, frame: 'WGS84' },
    },
    admission: {
      taskId: 'task-1',
      contextId: 'context-1',
      messageId: 'message-1',
      idempotencyKey: admissionIdempotencyKey,
      exposureId: 'a2a.embodied.move',
      initialRequestCount: 1,
      confirmationRequestCount: 1,
    },
    execution: {
      planId: 'plan-1',
      workflowInstanceId: 'workflow-instance-1',
      waitingExternalObserved: true,
      activeContinuationObserved: true,
      terminalContinuationObserved: true,
      a2aTerminalState: 'TASK_STATE_COMPLETED',
      taskPhase: 'completed',
    },
    lineage: {
      goalId: 'goal-1',
      goalVersion: 1,
      goalContractHash: `sha256:${'c'.repeat(64)}`,
      userGoalPlanId: 'goal-plan-1',
      userGoalPlanRevision: 1,
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'workflow-instance-1',
      skillExecutionId: 'skill-execution-1',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      confirmationId: 'confirmation-1',
      continuationId: 'continuation-1',
      continuationSnapshotId: 'snapshot-1',
      continuationAttemptId: 'continuation-attempt-1',
      terminalOutcomeId: 'outcome-1',
      terminalEvidenceId: 'evidence-1',
      navigateNodeStartedCount: 1,
      taskId: 'task-1',
      capabilityAttemptId: 'attempt-1',
      navigateInvocationId: 'navigate-1',
      remoteBindingId: 'remote-binding-1',
      remoteTaskId: 'remote-task-1',
      providerIdempotencyKey: 'navigate-1',
      providerLedgerTaskId: 'remote-task-1',
      providerExternalExecutionId: 'external-execution-1',
      providerDeviceCallIds: deviceCallIds,
      providerMutationRowIds: mutationRowIds,
      providerExternalMissionId: 'mission-1',
      providerMissionCorrelationId: 'provider-correlation-1',
      providerIdentityValidated: true,
    },
    calls: {
      initialStateReads: 1,
      navigateInvocations: 1,
      finalStateReads: 1,
      forbiddenInvocations: 0,
    },
    state: {
      initial: {
        observedAt: '2026-08-21T12:00:01.000Z',
        revision: 'd'.repeat(64),
        mqttIngressSequence: 2,
      },
      provider: {
        observedAt: '2026-08-21T12:00:02.000Z',
        revision: 'e'.repeat(64),
        mqttIngressSequence: 3,
        cursorSha256: `sha256:${'f'.repeat(64)}`,
        field: 'chassis.position.geodetic',
        topic: '/ugv/gnss',
      },
      final: {
        observedAt: '2026-08-21T12:00:03.000Z',
        revision: 'e'.repeat(64),
        mqttIngressSequence: 3,
      },
      sourcePosition: { longitude: 120, latitude: 30 },
      target: { x: 120.00001, y: 30, frame: 'WGS84' },
      providerPosition: { longitude: 120.00001, latitude: 30 },
      finalPosition: { longitude: 120.00001, latitude: 30 },
      targetErrorM: 0,
      displacementM: 0.96,
    },
    providerLedger: {
      invocationId: 'navigate-1',
      providerTaskId: 'remote-task-1',
      externalExecutionId: 'external-execution-1',
      externalExecutionIdSha256: `sha256:${'1'.repeat(64)}`,
      argumentHash: '2'.repeat(64),
      deviceCallIds,
      deviceCallIdsSha256: `sha256:${'3'.repeat(64)}`,
      mutationRowIds,
      mutationRowIdsSha256: `sha256:${'4'.repeat(64)}`,
      externalMissionId: 'mission-1',
      externalMissionIdSha256: `sha256:${'5'.repeat(64)}`,
      correlationId: 'provider-correlation-1',
      providerIdentityValidated: true,
      runtimeTaskCount: 1,
      runtimeIdempotencyCount: 1,
      adapterExecutionCount: 1,
      southboundDeviceCallCount: 5,
      southboundStateReadCount: 3,
      southboundMutationCallCount: 2,
      mutationStepCount: 2,
      forbiddenOperationCount: 0,
      uncertainMutationCount: 0,
      beforeSha256: `sha256:${'6'.repeat(64)}`,
      afterSha256: `sha256:${'7'.repeat(64)}`,
    },
    sdarInvocations: {
      invocationCount: 4,
      qualificationInvocationId: 'qualification-1',
      initialStateInvocationId: 'initial-1',
      navigateInvocationId: 'navigate-1',
      finalStateInvocationId: 'final-1',
      capabilityAttemptId: 'attempt-1',
      admissionKeySeparatedFromProviderKey: true,
    },
    modelRuntime: {
      configurationLoaded: true,
      invocationCount: 1,
      succeededCount: 1,
      failedCount: 0,
      workflowPlanningAttemptCount: 1,
      invocations: [
        {
          invocationId: 'model-invocation-1',
          stage: 'workflow_planning',
          status: 'succeeded',
          providerId: 'private-provider-value',
          model: 'private-model-value',
          operation: 'structured_generation',
        },
      ],
      routeProviderRefs: ['workflow_planning:private-provider-value:private-model-value'],
    },
    safety: {
      outerPlanConfirmations: 1,
      secondConfirmations: 0,
      automaticWriteRetries: 0,
      navigationDispatches: 1,
      forbiddenOperations: 0,
    },
    redaction: {
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentitiesIncluded: true,
      modelEndpointsIncluded: false,
      modelCredentialsIncluded: false,
    },
  };
}
