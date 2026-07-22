import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createAgentTask,
  createBusinessEventInboxRecord,
  createBusinessEventContinuityRecord,
  createBusinessEventRelationProjection,
  createCompletedEffect,
  createOutcomeDecision,
  createProgressObservation,
  createRecoveryDecision,
  createSkillAttempt,
  createUserGoalCompletionContract,
  createUserGoalPlan,
} from '../../domain/src/index.js';
import { PostgresAgentTaskRepository, PostgresUserGoalRuntimeRepository } from '../src/index.js';

const databaseName = 'sdar_v122_user_goal_runtime_integration';
const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const targetUrl = replaceDatabase(adminUrl, databaseName);
let pool: Pool;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: targetUrl, max: 8 });
  await applyRuntimeMigrations(pool);
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context.v122','anonymous','2026-07-22T00:00:00Z','2026-07-22T00:00:00Z');
     INSERT INTO goal(goal_id,context_id,version,title,description,constraints_json,
       success_criteria_json,status,created_at,updated_at)
     VALUES('goal.v122','context.v122',1,'Goal','Goal description','[]','[]','active',
       '2026-07-22T00:00:00Z','2026-07-22T00:00:00Z')`,
  );
});

afterAll(async () => {
  await pool.end();
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe('PostgresUserGoalRuntimeRepository', () => {
  it('round-trips a contract and plan and lets exactly one CAS contender win', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    await repository.saveContract(contract(), `sha256:${'a'.repeat(64)}`, timestamp(0));
    await repository.createPlan(plan());
    await expect(repository.findPlan('plan.v122.1')).resolves.toEqual(plan());

    const results = await Promise.all([
      repository.compareAndSetPlanStatus({
        planId: 'plan.v122.1',
        expectedLockVersion: 1,
        expectedStatus: 'validated',
        status: 'active',
        updatedAt: timestamp(1),
      }),
      repository.compareAndSetPlanStatus({
        planId: 'plan.v122.1',
        expectedLockVersion: 1,
        expectedStatus: 'validated',
        status: 'active',
        updatedAt: timestamp(1),
      }),
    ]);
    expect(results.filter((result) => result === 2)).toHaveLength(1);
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
  });

  it('enforces one active Attempt per Skill Goal under a race', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    await expect(repository.listReadySkillGoals('plan.v122.1')).resolves.toMatchObject([
      { skillGoalId: 'skill-goal.v122' },
    ]);
    const attempts = ['attempt.v122.1', 'attempt.v122.2'].map((attemptId, index) =>
      repository.createDispatchIntent(
        createSkillAttempt({
          attemptId,
          planId: 'plan.v122.1',
          skillGoalId: 'skill-goal.v122',
          ordinal: index + 1,
          status: 'dispatch_intent',
          strategyFingerprint: `sha256:${String(index + 1).repeat(64)}`,
          budget: { maxAttempts: 2, consumedAttempts: index },
          createdAt: timestamp(2 + index),
        }),
      ),
    );
    const settled = await Promise.allSettled(attempts);
    expect(settled).toHaveLength(2);
    expect(settled.filter((result) => result.status === 'fulfilled' && result.value)).toHaveLength(
      1,
    );
    expect(settled.filter((result) => result.status === 'fulfilled' && !result.value)).toHaveLength(
      1,
    );
    await expect(repository.listReadySkillGoals('plan.v122.1')).resolves.toEqual([]);
  });

  it('persists progress and forbids the same recovery strategy across restart', async () => {
    const firstRepository = new PostgresUserGoalRuntimeRepository(pool);
    const observation = createProgressObservation({
      progressObservationId: 'progress.v122.1',
      planId: 'plan.v122.1',
      classification: 'stalled',
      vector: progressVector(),
      observedAt: timestamp(4),
    });
    const decision = createRecoveryDecision({
      recoveryDecisionId: 'recovery.v122.1',
      planId: 'plan.v122.1',
      skillGoalId: 'skill-goal.v122',
      action: 'replacement_attempt',
      reasonCode: 'STALLED_CHANGED_STRATEGY',
      strategyFingerprint: `sha256:${'8'.repeat(64)}`,
      createdAt: timestamp(4),
    });
    await firstRepository.saveProgressAndDecision(observation, decision);

    const restartedRepository = new PostgresUserGoalRuntimeRepository(pool);
    await expect(restartedRepository.findLatestProgress('plan.v122.1')).resolves.toEqual(
      observation,
    );
    await expect(
      restartedRepository.saveProgressAndDecision(
        createProgressObservation({
          ...observation,
          progressObservationId: 'progress.v122.2',
          observedAt: timestamp(5),
        }),
        createRecoveryDecision({
          ...decision,
          recoveryDecisionId: 'recovery.v122.2',
          createdAt: timestamp(5),
        }),
      ),
    ).rejects.toThrow('same recovery strategy');
  });

  it('keeps completed effects append-only and forbids replay until explicit invalidation', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    const effect = createCompletedEffect({
      completedEffectId: 'completed-effect.v122.1',
      goalId: 'goal.v122',
      planId: 'plan.v122.1',
      skillGoalId: 'skill-goal.v122',
      status: 'verified',
      effectFingerprint: `sha256:${'9'.repeat(64)}`,
      evidenceRefs: ['evidence.v122'],
      createdAt: timestamp(6),
    });
    await repository.saveCompletedEffect(effect);
    await expect(repository.listValidCompletedEffects('goal.v122')).resolves.toEqual([effect]);
    await expect(
      repository.saveCompletedEffect(
        createCompletedEffect({
          ...effect,
          completedEffectId: 'completed-effect.v122.replay',
          createdAt: timestamp(7),
        }),
      ),
    ).rejects.toThrow('COMPLETED_EFFECT_REPLAY_FORBIDDEN');

    const invalidation = createCompletedEffect({
      ...effect,
      completedEffectId: 'completed-effect.v122.invalidated',
      status: 'invalidated',
      predecessorEffectId: effect.completedEffectId,
      evidenceRefs: ['evidence.v122.invalidation'],
      createdAt: timestamp(8),
    });
    await repository.saveCompletedEffect(invalidation);
    await expect(repository.listValidCompletedEffects('goal.v122')).resolves.toEqual([]);
    await expect(
      repository.saveCompletedEffect(
        createCompletedEffect({
          ...effect,
          completedEffectId: 'completed-effect.v122.replacement',
          evidenceRefs: ['evidence.v122.replacement'],
          createdAt: timestamp(9),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('commits a non-terminal Skill Goal outcome and activates only its required successor', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    await pool.query(
      `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
       VALUES('context.v122.multi','anonymous',$1,$1)`,
      [timestamp(10)],
    );
    await pool.query(
      `INSERT INTO goal(goal_id,context_id,version,title,description,constraints_json,
         success_criteria_json,status,created_at,updated_at)
       VALUES('goal.v122.multi','context.v122.multi',1,'Multi Goal','Complete both criteria',
         '[]','[]','active',$1,$1)`,
      [timestamp(10)],
    );
    await new PostgresAgentTaskRepository(pool).save(
      createAgentTask({
        taskId: 'task.v122.multi',
        contextId: 'context.v122.multi',
        userId: 'anonymous',
        requestText: 'Complete both criteria.',
        requestMetadata: {},
        timestamp: timestamp(10),
      }),
    );
    const baseCriterion = contract().criteria[0];
    const baseSkillGoal = plan().skillGoals[0];
    if (baseCriterion === undefined || baseSkillGoal === undefined)
      throw new Error('USER_GOAL_TEST_FIXTURE_INCOMPLETE');
    const multiContract = createUserGoalCompletionContract({
      ...contract(),
      goalId: 'goal.v122.multi',
      criteria: [
        { ...baseCriterion, criterionId: 'criterion.v122.first' },
        { ...baseCriterion, criterionId: 'criterion.v122.second' },
      ],
    });
    await repository.saveContract(multiContract, `sha256:${'1'.repeat(64)}`, timestamp(10));
    const firstGoal = {
      ...baseSkillGoal,
      skillGoalId: 'skill-goal.v122.first',
      coveredCriterionIds: ['criterion.v122.first'],
      status: 'judging' as const,
    };
    const secondGoal = {
      ...baseSkillGoal,
      skillGoalId: 'skill-goal.v122.second',
      coveredCriterionIds: ['criterion.v122.second'],
      status: 'pending' as const,
    };
    await repository.createPlan(
      createUserGoalPlan({
        ...plan(),
        planId: 'plan.v122.multi',
        goalId: 'goal.v122.multi',
        status: 'active',
        contractHash: `sha256:${'1'.repeat(64)}`,
        contentHash: `sha256:${'2'.repeat(64)}`,
        skillGoals: [firstGoal, secondGoal],
        dependencies: [
          {
            dependencyId: 'dependency.v122.multi',
            predecessorSkillGoalId: firstGoal.skillGoalId,
            successorSkillGoalId: secondGoal.skillGoalId,
            predicate: 'required',
          },
        ],
        createdAt: timestamp(10),
      }),
    );
    const attempt = createSkillAttempt({
      attemptId: 'attempt.v122.multi.first',
      planId: 'plan.v122.multi',
      skillGoalId: firstGoal.skillGoalId,
      ordinal: 1,
      status: 'judging',
      strategyFingerprint: `sha256:${'3'.repeat(64)}`,
      budget: { maxAttempts: 2, consumedAttempts: 1 },
      createdAt: timestamp(11),
    });
    await repository.createAttempt(attempt);
    const taskDecision = createOutcomeDecision({
      outcomeDecisionId: 'decision.v122.multi.task',
      level: 'task_goal',
      subjectId: 'task-goal-contract.v122.multi',
      status: 'achieved',
      confidence: 'high',
      ruleIds: ['explicit_evidence'],
      criterionRefs: [],
      effectRefs: ['effect.v122'],
      evidenceRefs: ['evidence.v122'],
      artifactRefs: [],
      summary: 'The first Task Goal is achieved.',
      createdAt: timestamp(12),
    });
    const skillDecision = createOutcomeDecision({
      ...taskDecision,
      outcomeDecisionId: 'decision.v122.multi.skill',
      level: 'skill_goal',
      subjectId: firstGoal.skillGoalId,
      criterionRefs: ['criterion.v122.first'],
      summary: 'The first Skill Goal is achieved.',
    });
    const userDecision = createOutcomeDecision({
      ...taskDecision,
      outcomeDecisionId: 'decision.v122.multi.user',
      level: 'user_goal',
      subjectId: 'goal.v122.multi',
      status: 'unknown',
      criterionRefs: ['criterion.v122.first'],
      summary: 'The User Goal remains working.',
    });
    await repository.commitWorkingOutcome(
      {
        userGoalPlanId: 'plan.v122.multi',
        taskGoalContract: {
          schemaVersion: '1.0',
          taskGoalContractId: 'task-goal-contract.v122.multi',
          planId: 'plan.v122.multi',
          skillGoalId: firstGoal.skillGoalId,
          attemptId: attempt.attemptId,
          agentTaskId: 'task.v122.multi',
          requiredEffectRefs: ['effect.v122'],
          evidenceRequirements: ['evidence.v122'],
          artifactRequirements: [],
        },
        taskGoalContractHash: `sha256:${'4'.repeat(64)}`,
        taskDecision,
        skillDecision,
        userDecision,
        skillAttemptId: attempt.attemptId,
        skillGoalId: firstGoal.skillGoalId,
        completedEffects: [
          createCompletedEffect({
            completedEffectId: 'completed-effect.v122.multi.first',
            goalId: 'goal.v122.multi',
            planId: 'plan.v122.multi',
            skillGoalId: firstGoal.skillGoalId,
            status: 'verified',
            effectFingerprint: `sha256:${'5'.repeat(64)}`,
            evidenceRefs: ['evidence.v122'],
            createdAt: timestamp(12),
          }),
        ],
      },
      timestamp(12),
    );

    await expect(repository.listReadySkillGoals('plan.v122.multi')).resolves.toEqual([
      expect.objectContaining({ skillGoalId: secondGoal.skillGoalId, status: 'ready' }),
    ]);
    await expect(repository.listSkillGoalOutcomeDecisions('plan.v122.multi')).resolves.toEqual([
      expect.objectContaining({ subjectId: firstGoal.skillGoalId, status: 'achieved' }),
    ]);
  });

  it('deduplicates Business Events and advances admitted/processed cursors independently', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    await repository.saveBusinessEventSubscription({
      subscriptionId: 'subscription.v122',
      providerId: 'provider.v122',
      streamId: 'stream.v122',
      generation: 1,
      status: 'current',
      lastDurablyAdmittedSequence: '0',
      lastProcessedSequence: '0',
      createdAt: timestamp(5),
      updatedAt: timestamp(5),
    });
    const event = createBusinessEventInboxRecord({
      inboxId: 'inbox.v122.1',
      subscriptionId: 'subscription.v122',
      eventId: 'event.v122.1',
      sequence: '9007199254740993',
      envelopeHash: `sha256:${'d'.repeat(64)}`,
      envelope: { type: 'resource.changed' },
      status: 'admitted',
      admittedAt: timestamp(6),
    });
    await expect(repository.admitBusinessEvent(event)).resolves.toEqual({ created: true });
    await expect(repository.admitBusinessEvent(event)).resolves.toEqual({ created: false });
    await expect(
      repository.admitBusinessEvent({
        ...event,
        inboxId: 'inbox.v122.conflict',
        envelopeHash: `sha256:${'e'.repeat(64)}`,
      }),
    ).rejects.toThrow('BUSINESS_EVENT_IDENTITY_HASH_MISMATCH');
    await expect(
      repository.findBusinessEventSubscription('subscription.v122'),
    ).resolves.toMatchObject({
      lastDurablyAdmittedSequence: event.sequence,
      lastProcessedSequence: '0',
    });
    await expect(repository.claimBusinessEventInbox(1)).resolves.toEqual([
      expect.objectContaining({ inboxId: event.inboxId, status: 'processing' }),
    ]);
    await repository.markBusinessEventFailed(event.inboxId, 'TEMPORARY_FAILURE', true);
    await expect(repository.claimBusinessEventInbox(1)).resolves.toEqual([
      expect.objectContaining({ inboxId: event.inboxId, status: 'processing' }),
    ]);
    await repository.markBusinessEventProcessed(event.inboxId, timestamp(7));
    await expect(
      repository.findBusinessEventSubscription('subscription.v122'),
    ).resolves.toMatchObject({ lastProcessedSequence: event.sequence });
  });

  it('persists continuity once, drains the closed generation and admits a new current stream', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    const continuity = createBusinessEventContinuityRecord({
      continuityId: 'continuity.v122.1',
      subscriptionId: 'subscription.v122',
      previousStreamId: 'stream.v122',
      newStreamId: 'stream.v122.next',
      reasonCode: 'SOURCE_CURSOR_EXPIRED',
      affectedSourceIds: ['adapter.vehicle'],
      gapDetectedAt: timestamp(8),
      lastReplayableSequence: '9007199254740993',
      lastContinuousSequence: '9007199254740992',
      createdAt: timestamp(8),
    });
    await expect(repository.recordBusinessEventContinuity(continuity)).resolves.toEqual({
      created: true,
    });
    await expect(
      repository.recordBusinessEventContinuity({
        ...continuity,
        continuityId: 'continuity.v122.duplicate',
      }),
    ).resolves.toEqual({ created: false });
    await expect(
      repository.findBusinessEventSubscription('subscription.v122'),
    ).resolves.toMatchObject({
      status: 'draining_closed',
      lastReplayableSequence: continuity.lastReplayableSequence,
    });

    await repository.saveBusinessEventSubscription({
      subscriptionId: 'subscription.v122.next',
      providerId: 'provider.v122',
      streamId: continuity.newStreamId,
      generation: 2,
      status: 'current',
      lastDurablyAdmittedSequence: '0',
      lastProcessedSequence: '0',
      createdAt: timestamp(9),
      updatedAt: timestamp(9),
    });
    await expect(repository.findCurrentBusinessEventSubscription('provider.v122')).resolves.toEqual(
      expect.objectContaining({
        subscriptionId: 'subscription.v122.next',
        generation: 2,
        status: 'current',
      }),
    );
    await expect(repository.findLatestBusinessEventSubscription('provider.v122')).resolves.toEqual(
      expect.objectContaining({ subscriptionId: 'subscription.v122.next' }),
    );
  });

  it('persists a relation projection without granting completeness to partial results', async () => {
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    const projection = createBusinessEventRelationProjection({
      relationProjectionId: 'relation.v122.1',
      inboxId: 'inbox.v122.1',
      status: 'incomplete',
      relationHash: `sha256:${'f'.repeat(64)}`,
      taskIds: ['task-1'],
      total: 2,
      projectionToken: 'gBPxViIkwV7OC0RjF7VKaw',
      createdAt: timestamp(10),
    });
    await expect(
      repository.saveBusinessEventRelationProjection(projection),
    ).resolves.toBeUndefined();
    const result = await pool.query<{ status: string; relation_json: unknown }>(
      'SELECT status,relation_json FROM event_relation_projection WHERE relation_projection_id=$1',
      [projection.relationProjectionId],
    );
    expect(result.rows[0]).toEqual({ status: 'incomplete', relation_json: projection });
  });
});

function contract() {
  return createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: 'goal.v122',
    goalVersion: 1,
    title: 'Goal',
    description: 'Goal description',
    constraints: [],
    criteria: [
      {
        criterionId: 'criterion.v122',
        description: 'Result exists.',
        required: true,
        expectedEffectRefs: ['effect.v122'],
        evidenceRequirements: ['evidence.v122'],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
}

function plan() {
  return createUserGoalPlan({
    schemaVersion: '1.0',
    planId: 'plan.v122.1',
    goalId: 'goal.v122',
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash: `sha256:${'a'.repeat(64)}`,
    contentHash: `sha256:${'b'.repeat(64)}`,
    skillGoals: [
      {
        skillGoalId: 'skill-goal.v122',
        requiredResult: 'Result exists.',
        capabilityNeeds: ['result.production'],
        coveredCriterionIds: ['criterion.v122'],
        requiredEffectRefs: ['effect.v122'],
        evidenceRequirements: ['evidence.v122'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: timestamp(0),
  });
}

function timestamp(seconds: number): string {
  return `2026-07-22T00:00:${String(seconds).padStart(2, '0')}.000Z`;
}

function progressVector() {
  return {
    requiredCriterionCount: 1,
    satisfiedCriterionRefs: [],
    effectRefs: [],
    evidenceRefs: [],
    artifactRefs: [],
    invalidatedEffectRefs: [],
    uncertainty: 1,
    attemptOrdinal: 1,
    planRevision: 1,
    strategyFingerprint: `sha256:${'7'.repeat(64)}`,
    remainingBudget: { task: 1, workflow: 1, attempt: 1, plan: 3 },
  } as const;
}

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}
