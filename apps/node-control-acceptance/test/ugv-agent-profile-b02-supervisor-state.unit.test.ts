import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const SCRIPT = resolve(
  import.meta.dirname,
  '../../../scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs',
);
const PROJECTOR = resolve(
  import.meta.dirname,
  '../../../scripts/ugv-agent-profile-simulation/project-a2a-move-report.mjs',
);
const SIMULATION_ID = 'uap-p3-b02-capturev2unit01';
const BOOTSTRAP_RUN_ID = 'uap-p3-b01-bootstrap-capture-v2';

interface SupervisorStateModule {
  readonly validateB02SupervisorState: (
    value: unknown,
    expectedSideEffects: 'NO' | 'YES',
    expectedSimulationRunId?: string,
  ) => Readonly<Record<string, unknown>>;
  readonly captureB02SupervisorState: (
    expectedSideEffects: 'NO' | 'YES',
    outputPath: string,
    dependencies: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>;
}

interface FailureRecorderModule {
  readonly isB02SupervisorRestoredNo: (value: unknown, bootstrapRunId: string) => boolean;
}

interface ProjectorModule {
  readonly validateB02SupervisorTransition: (
    pre: unknown,
    execution: unknown,
    final: unknown,
    identity: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
}

describe('UAP-P3-B02 private supervisor capture v2', () => {
  it('accepts and preserves only the exact eight-key NO identity', async () => {
    const module = await supervisorStateModule();
    const input = supervisorStatus('NO', 7, null);

    const validated = module.validateB02SupervisorState(input, 'NO');

    expect(validated).toEqual(input);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated['processIdentitySha256'])).toBe(true);
    expect(() =>
      module.validateB02SupervisorState(
        { status: 'running', processCount: 3, sideEffects: 'NO' },
        'NO',
      ),
    ).toThrow('UAP_B02_SUPERVISOR_STATE_INVALID');
    expect(() =>
      module.validateB02SupervisorState(
        {
          ...input,
          processIdentitySha256: {
            ...(input['processIdentitySha256'] as Record<string, string>),
            pid: `sha256:${'f'.repeat(64)}`,
          },
        },
        'NO',
      ),
    ).toThrow('UAP_B02_SUPERVISOR_STATE_INVALID');
  });

  it('binds a YES capture to the exact issued simulation identity', async () => {
    const module = await supervisorStateModule();
    const input = supervisorStatus('YES', 8, SIMULATION_ID);

    expect(module.validateB02SupervisorState(input, 'YES', SIMULATION_ID)).toEqual(input);
    expect(() => module.validateB02SupervisorState(input, 'YES')).toThrow(
      'UAP_B02_SUPERVISOR_STATE_INVALID',
    );
    expect(() =>
      module.validateB02SupervisorState(input, 'YES', 'uap-p3-b02-differentunit01'),
    ).toThrow('UAP_B02_SUPERVISOR_STATE_INVALID');
  });

  it('writes only the validated private identity returned by processStatus', async () => {
    const module = await supervisorStateModule();
    const value = supervisorStatus('YES', 8, SIMULATION_ID);
    const getStatus = vi.fn(() => Promise.resolve(value));
    const write = vi.fn(() => Promise.resolve());

    await expect(
      module.captureB02SupervisorState('YES', '/private/supervisor-execution.json', {
        getStatus,
        write,
        expectedSimulationRunId: SIMULATION_ID,
      }),
    ).resolves.toEqual(value);
    expect(getStatus).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith('/private/supervisor-execution.json', value);
  });

  it('uses the issued ambient identity and fails closed on a mismatched ambient identity', async () => {
    const module = await supervisorStateModule();
    const value = supervisorStatus('YES', 8, SIMULATION_ID);
    const write = vi.fn(() => Promise.resolve());

    await expect(
      module.captureB02SupervisorState('YES', '/private/supervisor-execution.json', {
        getStatus: vi.fn(() => Promise.resolve(value)),
        write,
        environment: { UGV_SIMULATION_RUN_ID: SIMULATION_ID },
      }),
    ).resolves.toEqual(value);
    await expect(
      module.captureB02SupervisorState('YES', '/private/supervisor-execution-wrong.json', {
        getStatus: vi.fn(() => Promise.resolve(value)),
        write,
        environment: { UGV_SIMULATION_RUN_ID: 'uap-p3-b02-differentunit01' },
      }),
    ).rejects.toThrow('UAP_B02_SUPERVISOR_STATE_INVALID');
    expect(write).toHaveBeenCalledOnce();
  });

  it('marks failure restoration verified only for the exact v2 NO identity and bootstrap', async () => {
    const recorder = await failureRecorderModule();
    const restored = supervisorStatus('NO', 9, null);

    expect(recorder.isB02SupervisorRestoredNo(restored, BOOTSTRAP_RUN_ID)).toBe(true);
    expect(
      recorder.isB02SupervisorRestoredNo(
        { status: 'running', processCount: 3, sideEffects: 'NO' },
        BOOTSTRAP_RUN_ID,
      ),
    ).toBe(false);
    expect(recorder.isB02SupervisorRestoredNo(restored, 'uap-p3-b01-different-bootstrap')).toBe(
      false,
    );
    expect(
      recorder.isB02SupervisorRestoredNo(
        { ...restored, activeSimulationRunId: SIMULATION_ID },
        BOOTSTRAP_RUN_ID,
      ),
    ).toBe(false);
  });

  it('projects only verified identity and sequential revisions for the exact three-state transition', async () => {
    const projector = await projectorModule();
    const transition = supervisorTransition();

    expect(
      projector.validateB02SupervisorTransition(
        transition.pre,
        transition.execution,
        transition.final,
        supervisorProjectionIdentity(),
      ),
    ).toEqual({
      restoredSideEffects: 'NO',
      processCount: 3,
      identityVerified: true,
      revisions: { pre: 7, execution: 8, final: 9 },
    });
  });

  it.each([
    [
      'bootstrap drift',
      (transition: ReturnType<typeof supervisorTransition>) => ({
        ...transition,
        final: { ...transition.final, bootstrapRunId: 'uap-p3-b01-different-bootstrap' },
      }),
    ],
    [
      'non-sequential revision',
      (transition: ReturnType<typeof supervisorTransition>) => ({
        ...transition,
        execution: { ...transition.execution, manifestRevision: 9 },
      }),
    ],
    [
      'stable server identity',
      (transition: ReturnType<typeof supervisorTransition>) => ({
        ...transition,
        execution: {
          ...transition.execution,
          processIdentitySha256: transition.pre['processIdentitySha256'],
        },
      }),
    ],
    [
      'control identity drift',
      (transition: ReturnType<typeof supervisorTransition>) => ({
        ...transition,
        final: {
          ...transition.final,
          processIdentitySha256: {
            ...(transition.final.processIdentitySha256 as Record<string, string>),
            nodeControlWorker: `sha256:${'e'.repeat(64)}`,
          },
        },
      }),
    ],
  ])('rejects %s across the three supervisor captures', async (_name, mutate) => {
    const projector = await projectorModule();
    const transition = mutate(supervisorTransition());

    expect(() =>
      projector.validateB02SupervisorTransition(
        transition.pre,
        transition.execution,
        transition.final,
        supervisorProjectionIdentity(),
      ),
    ).toThrow('UAP_B02_SUPERVISOR_IDENTITY_INVALID');
  });

  it('rejects an execution capture whose active identity is not the issued identity', async () => {
    const projector = await projectorModule();
    const transition = supervisorTransition();

    expect(() =>
      projector.validateB02SupervisorTransition(
        transition.pre,
        {
          ...transition.execution,
          activeSimulationRunId: 'uap-p3-b02-differentunit01',
        },
        transition.final,
        supervisorProjectionIdentity(),
      ),
    ).toThrow('UAP_B02_SUPERVISOR_EXECUTION_WINDOW_INVALID');
  });
});

async function supervisorStateModule(): Promise<SupervisorStateModule> {
  const loaded: unknown = await import(pathToFileURL(SCRIPT).href);
  if (typeof loaded !== 'object' || loaded === null) throw new Error('module missing');
  return loaded as SupervisorStateModule;
}

async function failureRecorderModule(): Promise<FailureRecorderModule> {
  const script = resolve(
    import.meta.dirname,
    '../../../scripts/ugv-agent-profile-simulation/record-b02-failure.mjs',
  );
  const loaded: unknown = await import(pathToFileURL(script).href);
  if (typeof loaded !== 'object' || loaded === null) throw new Error('module missing');
  return loaded as FailureRecorderModule;
}

async function projectorModule(): Promise<ProjectorModule> {
  const loaded: unknown = await import(pathToFileURL(PROJECTOR).href);
  if (typeof loaded !== 'object' || loaded === null) throw new Error('module missing');
  return loaded as ProjectorModule;
}

function supervisorStatus(
  sideEffects: 'NO' | 'YES',
  manifestRevision: number,
  activeSimulationRunId: string | null,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 'sdar.ugv-agent-profile.host-process-status/v2',
    status: 'running',
    processCount: 3,
    sideEffects,
    bootstrapRunId: BOOTSTRAP_RUN_ID,
    manifestRevision,
    activeSimulationRunId,
    processIdentitySha256: {
      server: `sha256:${'1'.repeat(64)}`,
      nodeControlApi: `sha256:${'2'.repeat(64)}`,
      nodeControlWorker: `sha256:${'3'.repeat(64)}`,
    },
  };
}

function supervisorTransition() {
  const pre = supervisorStatus('NO', 7, null);
  const controls = pre['processIdentitySha256'] as Record<string, string>;
  return {
    pre,
    execution: {
      ...supervisorStatus('YES', 8, SIMULATION_ID),
      processIdentitySha256: {
        ...controls,
        server: `sha256:${'4'.repeat(64)}`,
      },
    },
    final: {
      ...supervisorStatus('NO', 9, null),
      processIdentitySha256: {
        ...controls,
        server: `sha256:${'5'.repeat(64)}`,
      },
    },
  };
}

function supervisorProjectionIdentity() {
  return {
    simulationId: SIMULATION_ID,
    stateBootstrapRunId: BOOTSTRAP_RUN_ID,
    authorizedBootstrapRunId: BOOTSTRAP_RUN_ID,
  };
}
