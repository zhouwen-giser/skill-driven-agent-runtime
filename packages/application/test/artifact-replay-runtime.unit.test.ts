import { describe, expect, it } from 'vitest';

import {
  ArtifactReplayValidationApplicationService,
  ReplayValidationRunReconciler,
  ReplayValidationTriggerDispatcher,
  type HistoricalReplayOutcome,
  type ReplayDatasetBuild,
  type ReplayValidationCaseFixture,
  type ReplayValidationRepository,
  type ReplayValidationRunRecord,
  type ReplayValidationSource,
  type ReplayValidationTrigger,
  type ReplayValidationWakeQueue,
  type ReplayValidationWork,
} from '../src/index.js';
import { USER_GOAL_RUNTIME_LIMITS } from '../../domain/src/index.js';

const at = '2026-07-28T20:00:00.000Z';
const later = '2026-07-28T20:01:00.000Z';
const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;

describe('P05 Artifact replay runtime', () => {
  it('dispatches one durable PostgreSQL run and stores all four isolated Dataset purposes', async () => {
    const repository = new FakeRepository();
    repository.triggers = [trigger()];
    repository.sources = sourceCohort();
    const queue = new FakeQueue();
    const dispatched = await new ReplayValidationTriggerDispatcher(repository, queue, {
      now: () => at,
    }).dispatch();
    expect(dispatched).toBe(1);
    expect(repository.savedBuild).toBeDefined();
    expect(Object.keys(repository.savedBuild?.manifests ?? {}).sort()).toEqual([
      'candidate_development',
      'counterexample',
      'discovery',
      'promotion_holdout',
    ]);
    expect(repository.savedBuild?.leakage.passed).toBe(true);
    expect(queue.items).toEqual(['validation-run-runtime']);
  });

  it('turns cancellation into a terminal PostgreSQL state without loading work', async () => {
    const repository = new FakeRepository();
    const service = new ArtifactReplayValidationApplicationService(
      repository,
      { now: () => later },
      { maxAttempts: 5, baseBackoffMs: 100, maxBackoffMs: 1_000 },
    );
    await service.process(
      run({
        workState: 'leased',
        leaseOwner: 'worker-p05',
        leaseToken: 'lease-p05',
        cancelRequestedAt: at,
      }),
      'worker-p05',
    );
    expect(repository.loadCount).toBe(0);
    expect(repository.failed).toEqual([
      expect.objectContaining({
        errorCode: 'ARTIFACT_REPLAY_VALIDATION_CANCELED',
      }),
    ]);
    expect(repository.failed[0]).not.toHaveProperty('retryAt');
  });

  it('uses bounded retry for a missing immutable source and dead-letters at the limit', async () => {
    const repository = new FakeRepository();
    const service = new ArtifactReplayValidationApplicationService(
      repository,
      { now: () => later },
      { maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 1_000 },
    );
    await service.process(
      run({ workState: 'leased', leaseOwner: 'worker-p05', leaseToken: 'lease-1', attempt: 1 }),
      'worker-p05',
    );
    await service.process(
      run({ workState: 'leased', leaseOwner: 'worker-p05', leaseToken: 'lease-2', attempt: 2 }),
      'worker-p05',
    );
    expect(repository.failed[0]).toMatchObject({
      errorCode: 'ARTIFACT_REPLAY_VALIDATION_SOURCE_NOT_FOUND',
      retryAt: '2026-07-28T20:01:00.100Z',
    });
    expect(repository.failed[1]).toMatchObject({
      errorCode: 'ARTIFACT_REPLAY_VALIDATION_SOURCE_NOT_FOUND',
    });
    expect(repository.failed[1]).not.toHaveProperty('retryAt');
  });

  it('rebuilds Redis wakes entirely from PostgreSQL requeueable state', async () => {
    const repository = new FakeRepository();
    repository.requeueable = [
      run({ validationRunId: 'validation-run-a' }),
      run({ validationRunId: 'validation-run-b' }),
    ];
    const queue = new FakeQueue();
    const count = await new ReplayValidationRunReconciler(repository, queue).requeue(at);
    expect(count).toBe(2);
    expect(queue.items).toEqual(['validation-run-a', 'validation-run-b']);
  });
});

class FakeQueue implements ReplayValidationWakeQueue {
  readonly items: string[] = [];

  enqueue(validationRunId: string): Promise<void> {
    this.items.push(validationRunId);
    return Promise.resolve();
  }
}

class FakeRepository implements ReplayValidationRepository {
  triggers: readonly ReplayValidationTrigger[] = [];
  sources: readonly ReplayValidationSource[] = [];
  requeueable: readonly ReplayValidationRunRecord[] = [];
  savedBuild: ReplayDatasetBuild | undefined;
  loadCount = 0;
  readonly failed: {
    readonly errorCode: string;
    readonly retryAt?: string;
  }[] = [];

  listPendingTriggers(): Promise<readonly ReplayValidationTrigger[]> {
    return Promise.resolve(this.triggers);
  }

  listSources(): Promise<readonly ReplayValidationSource[]> {
    return Promise.resolve(this.sources);
  }

  persistDatasetAndCreateRun(
    _trigger: ReplayValidationTrigger,
    build: ReplayDatasetBuild,
  ): Promise<ReplayValidationRunRecord> {
    this.savedBuild = build;
    return Promise.resolve(run({ validationRunId: 'validation-run-runtime' }));
  }

  claim(): Promise<readonly ReplayValidationRunRecord[]> {
    return Promise.resolve([]);
  }

  loadWork(): Promise<ReplayValidationWork | undefined> {
    this.loadCount += 1;
    return Promise.resolve(undefined);
  }

  completeAtomically(): Promise<boolean> {
    return Promise.resolve(true);
  }

  fail(
    _runId: string,
    _workerId: string,
    _leaseToken: string,
    errorCode: string,
    _errorSummary: string,
    _now: string,
    retryAt?: string,
  ): Promise<boolean> {
    this.failed.push({ errorCode, ...(retryAt === undefined ? {} : { retryAt }) });
    return Promise.resolve(true);
  }

  listRequeueable(): Promise<readonly ReplayValidationRunRecord[]> {
    return Promise.resolve(this.requeueable);
  }

  requestCancellation(): Promise<boolean> {
    return Promise.resolve(true);
  }

  purgeTenant(): Promise<number> {
    return Promise.resolve(0);
  }

  purgeExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

function trigger(): ReplayValidationTrigger {
  return {
    triggerId: 'candidate-event-p05',
    tenantId: 'tenant-p05',
    artifactId: 'artifact-p05',
    artifactVersion: 1,
    artifactHash: sha('a'),
    taskTypeId: 'task-p05',
    candidateSourceTraceRefs: ['trace-5'],
    occurredAt: at,
  };
}

function run(overrides: Partial<ReplayValidationRunRecord> = {}): ReplayValidationRunRecord {
  return {
    validationRunId: 'validation-run-p05',
    tenantId: 'tenant-p05',
    artifactId: 'artifact-p05',
    artifactVersion: 1,
    artifactHash: sha('a'),
    datasetId: 'dataset-p05',
    datasetVersion: 1,
    datasetHash: sha('b'),
    workState: 'pending',
    attempt: 0,
    maxAttempts: 5,
    availableAt: at,
    idempotencyKey: 'artifact-replay:artifact-p05:v1',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function sourceCohort(): readonly ReplayValidationSource[] {
  return [
    source(1),
    source(2),
    source(3),
    source(4),
    source(5),
    source(6),
    source(7, { counterexample: true }),
    source(8, {}, false),
  ];
}

function source(
  index: number,
  overrides: Partial<ReplayValidationSource['source']> = {},
  worldStateCaptured = true,
): ReplayValidationSource {
  const key = String(index);
  const episodeRef = `episode-${key}`;
  return {
    source: {
      tenantId: 'tenant-p05',
      sourceEpisodeRef: episodeRef,
      sourceEpisodeRevisionRef: `${episodeRef}:v1`,
      goalLineageHash: sha(key),
      requestSnapshotRef: `request-${key}`,
      requestFingerprint: sha(`r${key}`.slice(-1)),
      nearDuplicateFingerprint: sha(`n${key}`.slice(-1)),
      goalContractSnapshotRef: `contract-${key}`,
      capabilityCatalogSnapshotRef: `catalog-${key}`,
      ...(worldStateCaptured ? { worldStateSnapshotRef: `world-${key}` } : {}),
      policySnapshotRef: `policy-${key}`,
      readinessSnapshotRef: `readiness-${key}`,
      acceptedPlanSnapshotRef: `plan-${key}`,
      acceptedPlanRevisionRef: `plan-${key}:r1`,
      executionTraceSnapshotRef: `trace-${key}`,
      outcomeSnapshotRef: `outcome-${key}`,
      correctionRefs: [],
      environmentClass: `environment-${key}`,
      deviceClass: `device-${key}`,
      taskTypeId: 'task-p05',
      sourceTraceRefs: [`trace-${key}`],
      counterexample: false,
      occurredAt: new Date(
        Date.parse('2026-07-28T19:00:00.000Z') + index * 6 * 60 * 1_000,
      ).toISOString(),
      ...overrides,
    },
    fixture: fixture(episodeRef),
  };
}

function fixture(sourceEpisodeRef: string): ReplayValidationCaseFixture {
  return {
    sourceEpisodeRef,
    goalContract: {
      schemaVersion: '1.0',
      goalId: `goal-${sourceEpisodeRef}`,
      goalVersion: 1,
      title: 'Replay Goal',
      description: 'Replay fixture Goal.',
      constraints: [],
      criteria: [
        {
          criterionId: 'criterion-p05',
          description: 'P05 criterion.',
          required: true,
          expectedEffectRefs: [],
          evidenceRequirements: [],
          artifactRequirements: [],
        },
      ],
      assumptions: [],
      policy: USER_GOAL_RUNTIME_LIMITS,
    },
    parameterValues: {},
    knownCapabilityIds: [],
    readyCapabilityIds: [],
    authorityDecision: 'deny',
    historical: historical(),
  };
}

function historical(): HistoricalReplayOutcome {
  return {
    succeeded: false,
    evidenceRefs: [],
    artifactRefs: [],
    activityRefs: [],
    modelCallCount: 0,
    tokenInput: 0,
    tokenOutput: 0,
    estimatedCostUnits: 0,
    humanInteractionCount: 0,
    fallbackCount: 0,
    userPatchCount: 0,
    planningLatencyMs: 0,
  };
}
