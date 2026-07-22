import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createBusinessEventInboxRecord,
  createSkillAttempt,
  createUserGoalCompletionContract,
  createUserGoalPlan,
} from '../../domain/src/index.js';
import { PostgresUserGoalRuntimeRepository } from '../src/index.js';

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
    const attempts = ['attempt.v122.1', 'attempt.v122.2'].map((attemptId, index) =>
      repository.createAttempt(
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
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
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
      sequence: '900719925474099312345',
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
    await repository.markBusinessEventProcessed(event.inboxId, timestamp(7));
    await expect(
      repository.findBusinessEventSubscription('subscription.v122'),
    ).resolves.toMatchObject({ lastProcessedSequence: event.sequence });
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

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}
