import { describe, expect, it } from 'vitest';

import type {
  CognitiveDomainEvent,
  ExperienceJob,
  GoalExperienceEpisode,
} from '../../domain/src/index.js';
import {
  CognitiveOutboxPublisher,
  ExperienceEligibilityPolicy,
  ExperienceJobReconciler,
  ExperienceJobService,
  GoalExperienceEpisodeBuilder,
} from '../src/cognitive/index.js';
import type {
  CognitiveOutboxRepository,
  ExperienceJobQueuePort,
  ExperienceJobRepository,
  GoalExperienceEpisodeRepository,
} from '../src/cognitive/ports.js';

describe('G07 Experience outbox, jobs and Goal Episodes', () => {
  it('rejects missing critical authority facts instead of inventing default Experience', () => {
    const policy = new ExperienceEligibilityPolicy();
    expect(policy.evaluate({})).toEqual({
      eligible: false,
      reasonCodes: [
        'missing_goal_contract',
        'missing_current_plan',
        'missing_user_goal_judgment',
        'missing_terminal_outcome',
      ],
    });
    expect(
      policy.evaluate({
        contract: { goalId: 'goal-1' },
        currentPlan: { planId: 'plan-1' },
        userGoalJudgment: { status: 'achieved' },
        terminalOutcome: { authority: 'another_controller' },
      }),
    ).toEqual({ eligible: false, reasonCodes: ['invalid_terminal_authority'] });
  });

  it('builds a deterministic immutable Episode while excluding secrets and private reasoning', async () => {
    const episodes = new FakeEpisodes();
    const builder = new GoalExperienceEpisodeBuilder({
      facts: {
        readGoalFacts: () =>
          Promise.resolve({
            task: { taskId: 'task-1', contextId: 'context-1' },
            contract: {
              goalId: 'goal-1',
              objective:
                'Inspect pump with authorization=Bearer abc.def for owner@example.test via postgresql://operator:local-only@localhost/sdar.',
            },
            currentPlan: { planId: 'plan-1', revision: 1 },
            planRevisions: [{ planId: 'plan-1', revision: 1 }],
            attempts: [{ attemptId: 'attempt-1', status: 'achieved', credential: 'do-not-store' }],
            userGoalJudgment: { decisionId: 'decision-1', status: 'achieved' },
            terminalOutcome: {
              outcomeId: 'outcome-1',
              kind: 'achieved',
              authority: 'user_goal_plan_controller',
            },
            interactions: [{ episodeId: 'interaction-1', privateReasoning: 'do-not-store' }],
            sourceRefs: [sourceRef('source-contract', 'goal_contract', 'goal-1')],
          }),
      },
      episodes,
      eligibility: new ExperienceEligibilityPolicy(),
      clock: { now: () => '2026-07-23T06:00:00.000Z' },
      nextEpisodeId: () => `goal-episode-${String(episodes.items.length + 1)}`,
    });

    const first = await builder.build({ goalId: 'goal-1', goalVersion: 1 });
    const second = await builder.build({ goalId: 'goal-1', goalVersion: 1 });

    expect(first.episodeHash).toBe(second.episodeHash);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.terminalOutcomeRef).toBe('runtime-terminal-outcome:outcome-1');
    expect(JSON.stringify(first.snapshot)).not.toContain('do-not-store');
    expect(JSON.stringify(first.snapshot)).not.toMatch(
      /abc\.def|owner@example\.test|operator:local-only/iu,
    );
    expect(first.redactionCodes).toEqual([
      'credentials_excluded',
      'private_reasoning_excluded',
      'unnecessary_pii_excluded',
    ]);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
  });

  it('processes duplicate terminal delivery once and retries from PostgreSQL without Redis authority', async () => {
    const jobs = new FakeJobs();
    const episodes = new FakeEpisodes();
    const queue = new FakeQueue();
    const episode = goalEpisode();
    const service = new ExperienceJobService({
      jobs,
      episodes,
      builder: { build: () => Promise.resolve(episode) },
      clock: { now: () => '2026-07-23T06:00:00.000Z' },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 4_000 },
    });
    const event = terminalEvent();

    await jobs.createEpisodeJob(event, '2026-07-23T06:00:00.000Z');
    await jobs.createEpisodeJob(event, '2026-07-23T06:00:00.000Z');
    expect(jobs.items).toHaveLength(1);

    const [claimed] = await service.claim('worker-1', 10);
    expect(claimed?.status).toBe('leased');
    if (claimed === undefined) throw new Error('Expected a claimed job.');
    await service.process(claimed, 'worker-1');
    await service.process(claimed, 'worker-1');
    expect(episodes.items).toHaveLength(1);
    expect(jobs.items[0]?.status).toBe('completed');

    jobs.items.push(job({ jobId: 'job-rebuild', idempotencyKey: 'terminal:outcome-2' }));
    const reconciler = new ExperienceJobReconciler({ jobs, queue });
    await reconciler.requeue('2026-07-23T06:00:00.000Z');
    queue.jobIds.length = 0;
    await reconciler.requeue('2026-07-23T06:00:00.000Z');
    expect(queue.jobIds).toEqual(['job-rebuild']);
  });

  it('appends validated outbox events and dead-letters exhausted jobs for manual replay', async () => {
    const outbox = new FakeOutbox();
    const publisher = new CognitiveOutboxPublisher({ repository: outbox });
    await publisher.append(terminalEvent());
    expect(outbox.events).toHaveLength(1);

    const jobs = new FakeJobs();
    const episodes = new FakeEpisodes();
    const service = new ExperienceJobService({
      jobs,
      episodes,
      builder: { build: () => Promise.reject(new Error('MISSING_AUTHORITY_FACT')) },
      clock: { now: () => '2026-07-23T06:00:00.000Z' },
      retryPolicy: { maxAttempts: 1, baseBackoffMs: 1_000, maxBackoffMs: 4_000 },
    });
    const pending = job({ maxAttempts: 1 });
    jobs.items.push(pending);
    const [claimed] = await service.claim('worker-1', 1);
    if (claimed === undefined) throw new Error('Expected a claimed job.');
    await expect(service.process(claimed, 'worker-1')).resolves.toBeUndefined();
    expect(jobs.items[0]?.status).toBe('dead_letter');
    expect(jobs.deadLetters).toHaveLength(1);
    const [deadLetter] = jobs.deadLetters;
    if (deadLetter === undefined) throw new Error('Expected a dead letter.');
    await jobs.replayDeadLetter(deadLetter.deadLetterId, 'operator-1', '2026-07-23T06:01:00.000Z');
    expect(jobs.items[0]?.status).toBe('pending');
  });
});

class FakeOutbox implements CognitiveOutboxRepository {
  readonly events: CognitiveDomainEvent[] = [];
  append(event: CognitiveDomainEvent) {
    this.events.push(event);
    return Promise.resolve();
  }
  dispatchTerminalEvents() {
    return Promise.resolve([]);
  }
}

class FakeQueue implements ExperienceJobQueuePort {
  readonly jobIds: string[] = [];
  enqueue(jobId: string) {
    this.jobIds.push(jobId);
    return Promise.resolve();
  }
}

class FakeEpisodes implements GoalExperienceEpisodeRepository {
  readonly items: GoalExperienceEpisode[] = [];
  findById(episodeId: string) {
    return Promise.resolve(this.items.find((item) => item.episodeId === episodeId));
  }
  findByGoal(goalId: string) {
    return Promise.resolve(this.items.filter((item) => item.goalId === goalId));
  }
  list(limit = 100, goalId?: string) {
    return Promise.resolve(
      this.items.filter((item) => goalId === undefined || item.goalId === goalId).slice(0, limit),
    );
  }
  saveIfAbsent(episode: GoalExperienceEpisode) {
    if (this.items.some((item) => item.episodeHash === episode.episodeHash)) {
      return Promise.resolve(false);
    }
    this.items.push(episode);
    return Promise.resolve(true);
  }
}

class FakeJobs implements ExperienceJobRepository {
  readonly items: ExperienceJob[] = [];
  readonly deadLetters: {
    deadLetterId: string;
    jobId: string;
    errorCode: string;
    errorSummary: string;
    failedAt: string;
  }[] = [];

  createEpisodeJob(event: CognitiveDomainEvent, now: string) {
    const existing = this.items.find(
      (item) => item.idempotencyKey === `terminal:${String(event.payload['outcomeId'])}`,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    const created = job({
      jobId: `job-${String(this.items.length + 1)}`,
      subjectId: event.aggregateId,
      idempotencyKey: `terminal:${String(event.payload['outcomeId'])}`,
      payload: { goalId: event.aggregateId, goalVersion: event.aggregateVersion },
      createdAt: now,
      updatedAt: now,
      availableAt: now,
    });
    this.items.push(created);
    return Promise.resolve(created);
  }

  claim(_workerId: string, _now: string, _leaseMs: number, limit: number) {
    const claimed = this.items
      .filter((item) => item.status === 'pending' || item.status === 'retry_wait')
      .slice(0, limit)
      .map((item) => ({
        ...item,
        status: 'leased' as const,
        attempt: item.attempt + 1,
        leaseOwner: 'worker-1',
        leaseExpiresAt: '2026-07-23T06:01:00.000Z',
      }));
    for (const item of claimed) this.#replace(item);
    return Promise.resolve(claimed);
  }

  complete(jobId: string, _workerId: string, now: string, episodeId: string) {
    const current = this.#require(jobId);
    const { leaseOwner: _leaseOwner, leaseExpiresAt: _leaseExpiresAt, ...withoutLease } = current;
    void _leaseOwner;
    void _leaseExpiresAt;
    this.#replace({
      ...withoutLease,
      status: 'completed',
      resultRef: `goal-experience-episode:${episodeId}`,
      updatedAt: now,
    });
    return Promise.resolve();
  }

  fail(
    jobId: string,
    _workerId: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ) {
    const current = this.#require(jobId);
    const exhausted = retryAt === undefined;
    const { leaseOwner: _leaseOwner, leaseExpiresAt: _leaseExpiresAt, ...withoutLease } = current;
    void _leaseOwner;
    void _leaseExpiresAt;
    this.#replace({
      ...withoutLease,
      status: exhausted ? 'dead_letter' : 'retry_wait',
      availableAt: retryAt ?? current.availableAt,
      lastErrorCode: errorCode,
      updatedAt: now,
    });
    if (exhausted) {
      this.deadLetters.push({
        deadLetterId: `dead-${jobId}`,
        jobId,
        errorCode,
        errorSummary,
        failedAt: now,
      });
    }
    return Promise.resolve();
  }

  listRequeueable() {
    return Promise.resolve(
      this.items.filter((item) => item.status === 'pending' || item.status === 'retry_wait'),
    );
  }

  replayDeadLetter(deadLetterId: string, _actorId: string, now: string) {
    const letter = this.deadLetters.find((item) => item.deadLetterId === deadLetterId);
    if (letter === undefined) throw new Error('Dead letter not found.');
    const current = this.#require(letter.jobId);
    const replay = {
      ...current,
      status: 'pending' as const,
      attempt: 0,
      availableAt: now,
      updatedAt: now,
    };
    this.#replace(replay);
    return Promise.resolve(replay);
  }

  listDeadLetters() {
    return Promise.resolve(this.deadLetters);
  }

  #require(jobId: string) {
    const item = this.items.find((candidate) => candidate.jobId === jobId);
    if (item === undefined) throw new Error('Job not found.');
    return item;
  }

  #replace(job: ExperienceJob) {
    this.items[this.items.findIndex((item) => item.jobId === job.jobId)] = job;
  }
}

function job(overrides: Partial<ExperienceJob> = {}): ExperienceJob {
  return {
    jobId: 'job-1',
    jobType: 'episode',
    subjectId: 'goal-1',
    status: 'pending',
    attempt: 0,
    maxAttempts: 3,
    availableAt: '2026-07-23T06:00:00.000Z',
    idempotencyKey: 'terminal:outcome-1',
    payload: { goalId: 'goal-1', goalVersion: 1 },
    createdAt: '2026-07-23T06:00:00.000Z',
    updatedAt: '2026-07-23T06:00:00.000Z',
    ...overrides,
  };
}

function goalEpisode(): GoalExperienceEpisode {
  return {
    schemaVersion: '1.0',
    episodeId: 'goal-episode-1',
    goalId: 'goal-1',
    goalVersion: 1,
    taskId: 'task-1',
    contextId: 'context-1',
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: 'runtime-terminal-outcome:outcome-1',
    sourceHash: hash('a'),
    episodeHash: hash('b'),
    completeness: 1,
    status: 'complete',
    dataClassification: 'internal',
    snapshot: { terminalOutcome: { outcomeId: 'outcome-1' } },
    sourceRefs: [sourceRef('source-outcome', 'runtime_terminal_outcome', 'outcome-1')],
    redactionCodes: [],
    createdAt: '2026-07-23T06:00:00.000Z',
  };
}

function terminalEvent(): CognitiveDomainEvent {
  return {
    schemaVersion: '1.0',
    eventId: 'event-terminal-1',
    eventType: 'user_goal.terminal_committed',
    aggregateType: 'user_goal',
    aggregateId: 'goal-1',
    aggregateVersion: 1,
    occurredAt: '2026-07-23T06:00:00.000Z',
    correlation: { correlationId: 'outcome-1', taskId: 'task-1', goalId: 'goal-1' },
    payload: { outcomeId: 'outcome-1', controlId: 'control-1' },
  };
}

function sourceRef(
  sourceRefId: string,
  sourceKind: 'goal_contract' | 'runtime_terminal_outcome',
  sourceId: string,
) {
  return {
    schemaVersion: '1.0' as const,
    sourceRefId,
    sourceKind,
    sourceId,
    sourceRevision: 1,
    authority: 'runtime_fact' as const,
    dataClassification: 'internal' as const,
    capturedAt: '2026-07-23T06:00:00.000Z',
  };
}

function hash(seed: string) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}
