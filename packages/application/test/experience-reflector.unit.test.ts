import { describe, expect, it } from 'vitest';

import {
  createKnowledgeCandidateIdentity,
  type ExperienceJob,
  type ExperienceObservation,
  type ExperienceReflection,
  type GoalExperienceEpisode,
  type KnowledgeCandidateSnapshot,
  type KnowledgeCandidateIdentity,
} from '../../domain/src/index.js';
import {
  ExperienceReflectorService,
  KnowledgeCuratorService,
  KnowledgeDeltaValidator,
  KnowledgeIdentityService,
  fingerprintKnowledgeIdentity,
} from '../src/cognitive/index.js';
import type {
  CognitiveStructuredModelStageInvoker,
  GoalExperienceEpisodeRepository,
  ObservationRepository,
  ReflectionJobRepository,
  ReflectionRepository,
} from '../src/cognitive/ports.js';

describe('G09 knowledge identity and curator boundaries', () => {
  it('merges the same reusable job after removing device, location and date instances', async () => {
    const service = identityService(0.94);
    const draft = identity({
      jobToBeDone: 'Inspect pump P-17 in Shanghai on 2026-07-23 and verify pressure evidence',
      objectiveTerms: ['inspect', 'pump', 'pressure'],
      deliverable: 'pressure evidence report',
      instanceTerms: ['P-17', 'Shanghai', '2026-07-23'],
    });
    const existing = identity({
      jobToBeDone: 'Inspect pump P-22 in Beijing on 2026-07-20 and verify pressure evidence',
      objectiveTerms: ['inspect', 'pump', 'pressure'],
      deliverable: 'pressure evidence report',
      instanceTerms: ['P-22', 'Beijing', '2026-07-20'],
    });
    expect(fingerprintKnowledgeIdentity(draft)).toBe(fingerprintKnowledgeIdentity(existing));

    const decision = await service.compare({
      draft,
      candidates: [
        {
          knowledgeId: 'knowledge-1',
          revision: 2,
          fingerprint: `sha256:${'1'.repeat(64)}`,
          identity: existing,
        },
      ],
    });

    expect(decision).toMatchObject({
      disposition: 'same_knowledge',
      targetKnowledgeId: 'knowledge-1',
      targetRevision: 2,
    });
    expect(decision.semanticScore).toBe(0.94);
    expect(decision.lexicalScore).toBeGreaterThan(0.7);
  });

  it('does not merge materially different deliverables or a recent intent boundary', async () => {
    const service = identityService(0.99);
    const base = identity({ deliverable: 'inspection report', recentIntentBoundary: 'intent-a' });

    await expect(
      service.compare({
        draft: identity({ deliverable: 'repair work order', recentIntentBoundary: 'intent-a' }),
        candidates: [candidate(base)],
      }),
    ).resolves.toMatchObject({ disposition: 'create_new', reason: 'deliverable_boundary' });
    await expect(
      service.compare({
        draft: identity({ deliverable: 'inspection report', recentIntentBoundary: 'intent-b' }),
        candidates: [candidate(base)],
      }),
    ).resolves.toMatchObject({ disposition: 'create_new', reason: 'recent_intent_boundary' });
  });

  it('defaults low-confidence identity to a new candidate instead of merging', async () => {
    const decision = await identityService(0.51).compare({
      draft: identity(),
      candidates: [candidate(identity())],
    });
    expect(decision).toMatchObject({
      disposition: 'create_new',
      reason: 'identity_confidence_low',
    });
    expect(decision.targetKnowledgeId).toBeUndefined();
  });

  it('uses an exact Candidate fingerprint without a semantic model call', async () => {
    const draft = identity();
    const service = new KnowledgeIdentityService({
      similarity: {
        compare: () => Promise.reject(new Error('semantic comparison must not run')),
      },
      policy: {
        semanticThreshold: 0.82,
        lexicalThreshold: 0.55,
        combinedThreshold: 0.72,
      },
    });
    await expect(
      service.compare({
        draft,
        candidates: [
          {
            ...candidate(draft),
            fingerprint: fingerprintKnowledgeIdentity(draft),
          },
        ],
      }),
    ).resolves.toMatchObject({
      disposition: 'same_knowledge',
      confidence: 1,
      targetKnowledgeId: 'knowledge-1',
    });
  });

  it('turns invalid curator JSON into NO_CHANGE and never creates active knowledge', async () => {
    const curator = new KnowledgeCuratorService({
      model: new InvalidCuratorModel(),
      validator: new KnowledgeDeltaValidator(),
      clock: { now: () => '2026-07-23T07:40:00.000Z' },
      nextDeltaId: () => 'delta-1',
    });
    const result = await curator.proposeDelta({
      reflectionId: 'reflection-1',
      draft: {
        knowledgeKind: 'planning_heuristic',
        title: 'Verify pressure evidence',
        summary: 'Collect cited pressure evidence before declaring completion.',
        risk: 'low',
        identity: identity(),
        supportEvidence: [evidence('support')],
        contradictionEvidence: [evidence('contradiction')],
      },
      identity: {
        disposition: 'create_new',
        confidence: 0.4,
        semanticScore: 0.4,
        lexicalScore: 0.4,
        reason: 'identity_confidence_low',
      },
      existing: undefined,
    });

    expect(result).toMatchObject({ operation: 'NO_CHANGE' });
    expect(result.candidate).toBeUndefined();
    expect(result.supportEvidence[0]).toMatchObject({
      polarity: 'support',
      sourceEpisodeIds: ['episode-1'],
      outcomeRefs: ['runtime-terminal-outcome:outcome-1'],
    });
    expect(result.contradictionEvidence[0]).toMatchObject({ polarity: 'contradiction' });
  });

  it('rejects Curator merge lineage that was not returned by deterministic duplicate search', async () => {
    const curator = new KnowledgeCuratorService({
      model: new UnknownMergeCuratorModel(),
      validator: new KnowledgeDeltaValidator(),
      clock: { now: () => '2026-07-23T07:40:00.000Z' },
      nextDeltaId: () => 'delta-merge-1',
    });
    const result = await curator.proposeDelta({
      reflectionId: 'reflection-1',
      draft: {
        knowledgeKind: 'planning_heuristic',
        title: 'Verify pressure evidence',
        summary: 'Collect cited pressure evidence before declaring completion.',
        risk: 'low',
        identity: identity(),
        supportEvidence: [evidence('support')],
        contradictionEvidence: [],
      },
      identity: {
        disposition: 'same_knowledge',
        confidence: 0.95,
        semanticScore: 0.95,
        lexicalScore: 0.95,
        reason: 'identity_match',
        targetKnowledgeId: 'knowledge-1',
        targetRevision: 1,
      },
      existing: undefined,
      knownKnowledgeIds: ['knowledge-1'],
    });

    expect(result).toMatchObject({ operation: 'NO_CHANGE', reason: 'curator_relation_unknown' });
  });

  it('persists candidate-only Reflection with helpful and harmful source/outcome lineage', async () => {
    const observations = new FakeObservationRepository(observation());
    const reflections = new FakeReflectionRepository();
    const jobs = new FakeReflectionJobs();
    const model = new ReflectionAndCuratorModel();
    const service = reflector({ observations, reflections, jobs, model });
    const sourceObservation = observations.item;

    await service.reflect(reflectionJob(), 'reflector-1');
    await service.reflect(reflectionJob(), 'reflector-1');

    expect(reflections.items).toHaveLength(1);
    const reflection = reflections.items[0];
    expect(reflection).toMatchObject({
      status: 'completed',
      observationIds: ['observation-1'],
      impacts: [
        expect.objectContaining({ disposition: 'helpful' }),
        expect.objectContaining({ disposition: 'harmful' }),
      ],
    });
    expect(reflection?.deltas[0]).toMatchObject({
      operation: 'CREATE_REVISION',
      candidate: { status: 'candidate', revision: 1 },
      supportEvidence: [
        expect.objectContaining({
          sourceEpisodeIds: ['episode-1'],
          outcomeRefs: ['runtime-terminal-outcome:outcome-1'],
        }),
      ],
      contradictionEvidence: [expect.objectContaining({ polarity: 'contradiction' })],
    });
    expect(reflection?.deltas[0]?.candidate?.status).not.toBe('active');
    expect(jobs.completed).toEqual([
      { jobId: 'reflect-job-1', reflectionId: reflection?.reflectionId },
      { jobId: 'reflect-job-1', reflectionId: reflection?.reflectionId },
    ]);
    expect(observations.item).toBe(sourceObservation);
  });

  it('records invalid Reflection JSON as no-op without a Candidate mutation', async () => {
    const reflections = new FakeReflectionRepository();
    const jobs = new FakeReflectionJobs();
    const service = reflector({
      observations: new FakeObservationRepository(observation()),
      reflections,
      jobs,
      model: new InvalidReflectionModel(),
    });

    await service.reflect(reflectionJob(), 'reflector-1');

    expect(reflections.items).toHaveLength(1);
    expect(reflections.items[0]).toMatchObject({ status: 'no_op', deltas: [] });
    expect(jobs.failures).toEqual([]);
  });

  it('retries and dead-letters operational Reflector failure without changing Observation', async () => {
    const source = observation();
    const observations = new FakeObservationRepository(source);
    const reflections = new FakeReflectionRepository();
    const jobs = new FakeReflectionJobs();
    const service = reflector({
      observations,
      reflections,
      jobs,
      model: new FailingReflectionModel(),
    });

    await service.reflect(reflectionJob({ maxAttempts: 1 }), 'reflector-1');

    expect(reflections.items).toEqual([]);
    expect(jobs.failures).toEqual([
      expect.objectContaining({
        errorCode: 'EXPERIENCE_REFLECTION_FAILED',
        retryAt: undefined,
      }),
    ]);
    expect(observations.item).toBe(source);
  });
});

function reflector(input: {
  observations: FakeObservationRepository;
  reflections: FakeReflectionRepository;
  jobs: FakeReflectionJobs;
  model: CognitiveStructuredModelStageInvoker;
}) {
  const curator = new KnowledgeCuratorService({
    model: input.model,
    validator: new KnowledgeDeltaValidator(),
    clock: { now: () => '2026-07-23T07:40:00.000Z' },
    nextDeltaId: () => 'delta-1',
  });
  return new ExperienceReflectorService({
    jobs: input.jobs,
    observations: input.observations,
    episodes: new FakeEpisodeRepository(episode()),
    reflections: input.reflections,
    identity: identityService(0.95),
    curator,
    model: input.model,
    clock: { now: () => '2026-07-23T07:40:00.000Z' },
    nextReflectionId: () => 'reflection-1',
    retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 4_000 },
  });
}

function identityService(score: number): KnowledgeIdentityService {
  return new KnowledgeIdentityService({
    similarity: { compare: () => Promise.resolve(score) },
    policy: {
      semanticThreshold: 0.82,
      lexicalThreshold: 0.55,
      combinedThreshold: 0.72,
    },
  });
}

function identity(overrides: Partial<KnowledgeCandidateIdentity> = {}): KnowledgeCandidateIdentity {
  return createKnowledgeCandidateIdentity({
    jobToBeDone: 'Inspect a pump and verify pressure evidence',
    objectiveTerms: ['inspect', 'pump', 'pressure'],
    criterionTerms: ['verified'],
    artifactTerms: ['report'],
    capabilityTerms: ['sensor.read'],
    tags: ['inspection'],
    deliverable: 'inspection report',
    recentIntentBoundary: 'intent-a',
    ...overrides,
  });
}

function candidate(value: KnowledgeCandidateIdentity) {
  return {
    knowledgeId: 'knowledge-1',
    revision: 1,
    fingerprint: `sha256:${'1'.repeat(64)}`,
    identity: value,
  };
}

function evidence(polarity: 'support' | 'contradiction') {
  return {
    evidenceId: `evidence-${polarity}`,
    polarity,
    observationId: 'observation-1',
    statementIds: [`statement-${polarity}`],
    sourceEpisodeIds: ['episode-1'],
    sourceRefIds: ['source-outcome'],
    outcomeRefs: ['runtime-terminal-outcome:outcome-1'],
    summary: `${polarity} evidence`,
    createdAt: '2026-07-23T07:39:00.000Z',
  } as const;
}

class InvalidCuratorModel implements CognitiveStructuredModelStageInvoker {
  generate() {
    return Promise.resolve({
      structuredResult: { operation: 'ACTIVATE_NOW' },
      invocationId: 'model-1',
    });
  }
}

class UnknownMergeCuratorModel implements CognitiveStructuredModelStageInvoker {
  generate() {
    return Promise.resolve({
      structuredResult: {
        operation: 'SUGGEST_MERGE',
        relatedKnowledgeIds: ['knowledge-never-returned'],
        reason: 'Merge with a fabricated target.',
      },
      invocationId: 'model-merge-1',
    });
  }
}

class ReflectionAndCuratorModel implements CognitiveStructuredModelStageInvoker {
  generate(input: Parameters<CognitiveStructuredModelStageInvoker['generate']>[0]) {
    const parsed = JSON.parse(input.instruction) as Record<string, unknown>;
    if ('identityDecision' in parsed) {
      return Promise.resolve({
        structuredResult: {
          operation: 'CREATE_REVISION',
          relatedKnowledgeIds: [],
          reason: 'Create candidate-only revision.',
        },
        invocationId: 'model-curator-1',
      });
    }
    return Promise.resolve({
      structuredResult: {
        impacts: [
          {
            statementId: 'statement-helpful',
            disposition: 'helpful',
            summary: 'Verified evidence helped the Outcome.',
          },
          {
            statementId: 'statement-harmful',
            disposition: 'harmful',
            summary: 'The contradicted shortcut harmed confidence.',
          },
        ],
        drafts: [
          {
            knowledgeKind: 'planning_heuristic',
            title: 'Verify evidence before completion',
            summary: 'Require cited evidence and retain contradictory counterexamples.',
            risk: 'low',
            identity: {
              jobToBeDone: 'Inspect a pump and verify pressure evidence',
              objectiveTerms: ['inspect', 'pump', 'pressure'],
              criterionTerms: ['verified'],
              artifactTerms: ['report'],
              capabilityTerms: ['sensor.read'],
              tags: ['inspection'],
              deliverable: 'inspection report',
              recentIntentBoundary: 'intent-a',
            },
            supportStatementIds: ['statement-helpful'],
            contradictionStatementIds: ['statement-harmful'],
          },
        ],
      },
      invocationId: 'model-reflection-1',
    });
  }
}

class InvalidReflectionModel implements CognitiveStructuredModelStageInvoker {
  generate() {
    return Promise.resolve({
      structuredResult: { invalid: true },
      invocationId: 'model-invalid-1',
    });
  }
}

class FailingReflectionModel implements CognitiveStructuredModelStageInvoker {
  generate(): Promise<never> {
    return Promise.reject(new Error('provider unavailable'));
  }
}

class FakeObservationRepository implements ObservationRepository {
  readonly item: ExperienceObservation;

  constructor(value: ExperienceObservation) {
    this.item = value;
  }

  findById(observationId: string) {
    return Promise.resolve(observationId === this.item.observationId ? this.item : undefined);
  }

  findByEpisode(episodeId: string) {
    return Promise.resolve(this.item.sourceEpisodeIds.includes(episodeId) ? [this.item] : []);
  }

  list() {
    return Promise.resolve([this.item]);
  }

  listPrevious() {
    return Promise.resolve([]);
  }

  save() {
    return Promise.resolve(false);
  }
}

class FakeEpisodeRepository implements GoalExperienceEpisodeRepository {
  readonly #episode: GoalExperienceEpisode;

  constructor(value: GoalExperienceEpisode) {
    this.#episode = value;
  }

  findById(episodeId: string) {
    return Promise.resolve(episodeId === this.#episode.episodeId ? this.#episode : undefined);
  }

  findByGoal() {
    return Promise.resolve([this.#episode]);
  }

  list() {
    return Promise.resolve([this.#episode]);
  }

  saveIfAbsent() {
    return Promise.resolve(false);
  }
}

class FakeReflectionRepository implements ReflectionRepository {
  readonly items: ExperienceReflection[] = [];

  findById(reflectionId: string) {
    return Promise.resolve(this.items.find((item) => item.reflectionId === reflectionId));
  }

  findByObservation(observationId: string) {
    return Promise.resolve(this.items.find((item) => item.observationIds.includes(observationId)));
  }

  list() {
    return Promise.resolve(this.items);
  }

  listCandidateIdentities() {
    return Promise.resolve([]);
  }

  findCandidate(): Promise<KnowledgeCandidateSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  save(reflection: ExperienceReflection) {
    if (this.items.some((item) => item.reflectionId === reflection.reflectionId)) {
      return Promise.resolve(false);
    }
    this.items.push(reflection);
    return Promise.resolve(true);
  }
}

class FakeReflectionJobs implements ReflectionJobRepository {
  readonly completed: { jobId: string; reflectionId: string | undefined }[] = [];
  readonly failures: { errorCode: string; retryAt: string | undefined }[] = [];

  claimReflection() {
    return Promise.resolve([]);
  }

  completeReflection(jobId: string, _workerId: string, _now: string, reflectionId: string) {
    this.completed.push({ jobId, reflectionId });
    return Promise.resolve();
  }

  fail(
    _jobId: string,
    _workerId: string,
    errorCode: string,
    _errorSummary: string,
    _now: string,
    retryAt?: string,
  ) {
    this.failures.push({ errorCode, retryAt });
    return Promise.resolve();
  }

  listReflectionRequeueable() {
    return Promise.resolve([]);
  }
}

function reflectionJob(overrides: Partial<ExperienceJob> = {}): ExperienceJob {
  return {
    jobId: 'reflect-job-1',
    jobType: 'reflect',
    subjectId: 'observation-1',
    status: 'leased',
    attempt: 1,
    maxAttempts: 3,
    availableAt: '2026-07-23T07:39:00.000Z',
    leaseOwner: 'reflector-1',
    leaseExpiresAt: '2026-07-23T07:41:00.000Z',
    idempotencyKey: 'reflect:observation-1',
    payload: { observationId: 'observation-1' },
    createdAt: '2026-07-23T07:39:00.000Z',
    updatedAt: '2026-07-23T07:40:00.000Z',
    ...overrides,
  };
}

function observation(): ExperienceObservation {
  return {
    schemaVersion: '1.0',
    observationId: 'observation-1',
    scope: 'goal_episode',
    sourceEpisodeIds: ['episode-1'],
    revision: 1,
    status: 'completed',
    statements: [
      {
        statementId: 'statement-helpful',
        kind: 'fact',
        summary: 'Pressure evidence was verified.',
        confidence: 1,
        sourceRefIds: ['source-outcome'],
      },
      {
        statementId: 'statement-harmful',
        kind: 'contradiction',
        summary: 'A shortcut contradicted the evidence policy.',
        confidence: 0.9,
        sourceRefIds: ['source-outcome'],
      },
    ],
    extractions: [],
    modelInvocationRefs: ['model-observation-1'],
    observationHash: `sha256:${'3'.repeat(64)}`,
    summary: { statementCount: 2 },
    createdAt: '2026-07-23T07:38:00.000Z',
  };
}

function episode(): GoalExperienceEpisode {
  return {
    schemaVersion: '1.0',
    episodeId: 'episode-1',
    goalId: 'goal-1',
    goalVersion: 1,
    taskId: 'task-1',
    contextId: 'context-1',
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: 'runtime-terminal-outcome:outcome-1',
    sourceHash: `sha256:${'1'.repeat(64)}`,
    episodeHash: `sha256:${'2'.repeat(64)}`,
    completeness: 1,
    status: 'complete',
    dataClassification: 'internal',
    snapshot: {
      contract: { objective: 'Inspect pump P-17', criteria: ['verified'] },
      currentPlan: { capabilities: ['sensor.read'] },
      attempts: [{ capabilityId: 'sensor.read' }],
    },
    sourceRefs: [
      {
        schemaVersion: '1.0',
        sourceRefId: 'source-outcome',
        sourceKind: 'runtime_terminal_outcome',
        sourceId: 'outcome-1',
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: '2026-07-23T07:37:00.000Z',
      },
    ],
    redactionCodes: [],
    createdAt: '2026-07-23T07:37:00.000Z',
  };
}
