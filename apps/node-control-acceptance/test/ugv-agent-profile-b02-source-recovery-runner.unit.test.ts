import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const RUNNER_PATH = resolve(
  import.meta.dirname,
  '../../../scripts/ugv-agent-profile-simulation/recover-b02-source-authority.mjs',
);
const ATTEMPT_ID = 'uap-p3-b02-recoveryrunner01';
const IDENTITY_HASH = `sha256:${'a'.repeat(64)}`;
const temporaryRoots: string[] = [];

interface RunnerResult {
  readonly report: Readonly<Record<string, unknown>>;
  readonly reportPath: string;
  readonly reportSha256: string;
}

type RecoveryRunner = (
  environment: NodeJS.ProcessEnv,
  dependencies: Readonly<Record<string, unknown>>,
) => Promise<RunnerResult>;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('UAP-P3-B02 Source recovery runner replay', () => {
  it('revalidates identity and current NO while returning an exact existing report read-only', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    const capture = vi.fn(captureFirstWriter);
    const current = vi.fn(() => Promise.resolve(supervisorNo()));
    const recover = vi.fn(() => Promise.resolve(recoveryReport('refreshed')));
    const verifyReplay = vi.fn(() => Promise.resolve({ status: 'current' }));
    const dependencies = {
      stateRoot: root,
      reportRoot: join(root, 'public-reports'),
      validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
      captureSupervisorNo: capture,
      currentSupervisorStatus: current,
      recoverSource: recover,
      verifyReplayAuthority: verifyReplay,
    };

    const first = await run(environment(), dependencies);
    const before = await lstat(first.reportPath);
    const beforeSource = await readFile(first.reportPath, 'utf8');
    expect(before.mode & 0o777).toBe(0o600);
    expect(first.report).toMatchObject({ action: 'refreshed' });

    const second = await run(environment(), dependencies);
    const after = await lstat(second.reportPath);
    const afterSource = await readFile(second.reportPath, 'utf8');

    expect(dependencies.validateIssuedAttemptIdentity).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledOnce();
    expect(current).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(verifyReplay).toHaveBeenCalledOnce();
    expect(second.report).toEqual(first.report);
    expect(second.reportSha256).toBe(first.reportSha256);
    expect(after.ino).toBe(before.ino);
    expect(afterSource).toBe(beforeSource);
  }, 15_000);

  it('resumes capture-only state after a post-refresh crash with total Source bootstrap one', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    let sourceFresh = false;
    let sourceBootstraps = 0;
    let reportWrites = 0;
    const recover = vi.fn(() => {
      if (!sourceFresh) {
        sourceFresh = true;
        sourceBootstraps += 1;
        return Promise.resolve(recoveryReport('refreshed'));
      }
      return Promise.resolve(recoveryReport('not_required'));
    });
    const writeReport = vi.fn(async (path: string, value: unknown) => {
      reportWrites += 1;
      if (reportWrites === 1) throw new Error('injected process termination after Source success');
      await privateFirstWriter(path, value);
    });
    const capture = vi.fn(captureFirstWriter);
    const dependencies = {
      stateRoot: root,
      reportRoot: join(root, 'public-reports'),
      validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
      captureSupervisorNo: capture,
      currentSupervisorStatus: vi.fn(() => Promise.resolve(supervisorNo())),
      recoverSource: recover,
      verifyReplayAuthority: vi.fn(() => Promise.resolve({ status: 'current' })),
      writePrivateReport: writeReport,
    };

    await expect(run(environment(), dependencies)).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_REPORT_WRITE_FAILED',
    });
    const resumed = await run(environment(), dependencies);

    expect(resumed.report).toMatchObject({ action: 'not_required' });
    expect(sourceBootstraps).toBe(1);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledOnce();
    expect(dependencies.currentSupervisorStatus).toHaveBeenCalledOnce();
    expect(writeReport).toHaveBeenCalledTimes(2);
    expect((await lstat(resumed.reportPath)).mode & 0o777).toBe(0o600);
  });

  it('rejects an existing report whose identity fields do not match fresh authorization', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    const dependencies = {
      stateRoot: root,
      reportRoot: join(root, 'public-reports'),
      validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
      captureSupervisorNo: vi.fn(captureFirstWriter),
      currentSupervisorStatus: vi.fn(() => Promise.resolve(supervisorNo())),
      recoverSource: vi.fn(() => Promise.resolve(recoveryReport('not_required'))),
      verifyReplayAuthority: vi.fn(() => Promise.resolve({ status: 'current' })),
    };
    const first = await run(environment(), dependencies);
    const envelope = JSON.parse(await readFile(first.reportPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const report = { ...(envelope['report'] as Record<string, unknown>) };
    report['identityRecordSha256'] = `sha256:${'b'.repeat(64)}`;
    envelope['report'] = report;
    envelope['reportSha256'] = `sha256:${canonicalHash(report)}`;
    await writeFile(first.reportPath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await chmod(first.reportPath, 0o600);

    await expect(run(environment(), dependencies)).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_REPORT_INVALID',
    });
    expect(dependencies.recoverSource).toHaveBeenCalledOnce();
  });

  it('blocks an exact existing report when current read-only authority reproof drifts', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    const verifyReplay = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('current authority drift'), {
          code: 'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT',
        }),
      ),
    );
    const dependencies = {
      stateRoot: root,
      reportRoot: join(root, 'public-reports'),
      validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
      captureSupervisorNo: vi.fn(captureFirstWriter),
      currentSupervisorStatus: vi.fn(() => Promise.resolve(supervisorNo())),
      recoverSource: vi.fn(() => Promise.resolve(recoveryReport('not_required'))),
      verifyReplayAuthority: verifyReplay,
    };
    await run(environment(), dependencies);

    await expect(run(environment(), dependencies)).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_REPLAY_AUTHORITY_DRIFT',
    });
    expect(verifyReplay).toHaveBeenCalledOnce();
    expect(dependencies.recoverSource).toHaveBeenCalledOnce();
  });

  it('compares the complete persisted v2 supervisor identity on replay', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    const current = vi.fn(() =>
      Promise.resolve({
        ...supervisorNo(),
        manifestRevision: 2,
      }),
    );
    const dependencies = {
      stateRoot: root,
      reportRoot: join(root, 'public-reports'),
      validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
      captureSupervisorNo: vi.fn(captureFirstWriter),
      currentSupervisorStatus: current,
      recoverSource: vi.fn(() => Promise.resolve(recoveryReport('not_required'))),
      verifyReplayAuthority: vi.fn(() => Promise.resolve({ status: 'current' })),
    };
    await run(environment(), dependencies);

    await expect(run(environment(), dependencies)).rejects.toMatchObject({
      code: 'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_CAPTURE_DRIFT',
    });
    expect(current).toHaveBeenCalledOnce();
    expect(dependencies.verifyReplayAuthority).not.toHaveBeenCalled();
  });

  it('rejects a formal NO capture from another bootstrap generation before recovery', async () => {
    const root = await temporaryRoot();
    const run = await recoveryRunner();
    const recover = vi.fn(() => Promise.resolve(recoveryReport('not_required')));
    const capture = vi.fn(async (_mode: string, path: string) => {
      const value = {
        ...supervisorNo(),
        bootstrapRunId: 'uap-p3-b01-different-bootstrap-generation',
      };
      await privateFirstWriter(path, value);
      return value;
    });

    await expect(
      run(environment(), {
        stateRoot: root,
        reportRoot: join(root, 'public-reports'),
        validateIssuedAttemptIdentity: vi.fn(() => Promise.resolve(authorization())),
        captureSupervisorNo: capture,
        recoverSource: recover,
      }),
    ).rejects.toMatchObject({ code: 'UGV_B02_SOURCE_RECOVERY_SUPERVISOR_NOT_NO' });
    expect(capture).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
  });
});

async function recoveryRunner(): Promise<RecoveryRunner> {
  const loaded: unknown = await import(pathToFileURL(RUNNER_PATH).href);
  if (typeof loaded !== 'object' || loaded === null || !('runB02SourceAuthorityRecovery' in loaded))
    throw new Error('Source recovery runner export missing');
  const candidate = loaded.runB02SourceAuthorityRecovery;
  if (typeof candidate !== 'function') throw new Error('Source recovery runner export invalid');
  return candidate as RecoveryRunner;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sdar-b02-source-replay-'));
  temporaryRoots.push(root);
  return root;
}

async function captureFirstWriter(
  _mode: string,
  path: string,
): Promise<ReturnType<typeof supervisorNo>> {
  const value = supervisorNo();
  await privateFirstWriter(path, value);
  return value;
}

async function privateFirstWriter(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await writeFile(path, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function supervisorNo() {
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.host-process-status/v2',
    status: 'running',
    processCount: 3,
    sideEffects: 'NO',
    bootstrapRunId: 'uap-p3-b01-bootstrap-runner',
    manifestRevision: 1,
    activeSimulationRunId: null,
    processIdentitySha256: Object.freeze({
      server: `sha256:${'6'.repeat(64)}`,
      nodeControlApi: `sha256:${'7'.repeat(64)}`,
      nodeControlWorker: `sha256:${'8'.repeat(64)}`,
    }),
  });
}

function authorization() {
  return {
    schemaVersion: 'sdar.ugv-agent-profile.b02-attempt-authorization/v1',
    status: 'authorized',
    task: 'UAP-P3-B02',
    kind: 'recovery_issued',
    bootstrapRunId: 'uap-p3-b01-bootstrap-runner',
    simulationId: ATTEMPT_ID,
    identityRecordSha256: IDENTITY_HASH,
    record: {
      bootstrapRunId: 'uap-p3-b01-bootstrap-runner',
      simulationId: ATTEMPT_ID,
      recordSha256: IDENTITY_HASH,
    },
  };
}

function recoveryReport(action: 'not_required' | 'refreshed') {
  return {
    schemaVersion: 'sdar.ugv-agent-profile.b02-source-recovery/v1',
    status: 'passed',
    evidenceClass: 'real_public_api',
    observedAt: '2026-08-22T12:00:00.000Z',
    action,
    identityRecordSha256: IDENTITY_HASH,
    simulationIdSha256: createHash('sha256').update(ATTEMPT_ID).digest('hex'),
    source: {
      revision: 1,
      snapshotRevision: 1,
      snapshotChecksum: '1'.repeat(64),
      validUntilBefore:
        action === 'refreshed' ? '2026-08-22T12:00:00.000Z' : '2026-08-22T12:05:00.000Z',
      validUntilAfter: '2026-08-22T12:05:00.000Z',
      nativeRevision: 1,
      nativeChecksum: '2'.repeat(64),
      projectionContract: 'sdar-registry-v1',
      remainingTtlMsBefore: action === 'refreshed' ? 0 : 300_000,
      ...(action === 'refreshed' ? { syncOutcome: 'not_modified' } : {}),
    },
    binding: {
      revision: 1,
      catalogRevision: '1.0.0:1',
      catalogChecksum: '3'.repeat(64),
      availabilityValidUntil: '2026-08-22T12:20:00.000Z',
      remainingTtlMs: 1_200_000,
      operationCount: 10,
    },
    runtime: {
      toolRevision: 1,
      catalogRevision: '1.0.0:1',
      catalogChecksum: '3'.repeat(64),
      discoveryValidUntil: '2026-08-22T12:20:00.000Z',
      remainingTtlMs: 1_200_000,
      operationCount: 10,
    },
    capability: {
      version: 2,
      definitionHash: '4'.repeat(64),
      policyHash: `sha256:${'5'.repeat(64)}`,
    },
    checks: [],
    redaction: {
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    },
  };
}

function environment(): NodeJS.ProcessEnv {
  return {
    SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10091',
    SDAR_CONTROL_API_TOKEN: 'node-control-api-token',
    SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:10998',
    UGV_B02_SOURCE_RECOVERY_ATTEMPT_ID: ATTEMPT_ID,
    SMPP_SDAR_SOURCE_ID: 'smpp-source-ugv1-uap-p3-b01',
    SMPP_SDAR_SOURCE_NAME: 'UGV Profile Source',
    SMPP_ENVIRONMENT: 'simulation',
    SMPP_SDAR_REGISTRY_ENDPOINT:
      'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
    SMPP_REGISTRY_CREDENTIAL_REF: 'unauthenticated://none',
    SMPP_SNAPSHOT_TTL_SECONDS: '300',
    SMPP_UGV_EXTERNAL_PROVIDER_ID: 'isr.vehicle.ugv.ugv1',
    SMPP_UGV_EXTERNAL_SERVER_ID: 'uap-p3-b01-runtime-1',
    SDAR_UGV_LOCAL_SERVER_ID: 'ugv-smpp-uap-p3-b01',
    SDAR_UGV_BINDING_ID: 'ugv-smpp-uap-p3-b01-binding',
  };
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
