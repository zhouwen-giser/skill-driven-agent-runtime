import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  BusinessEventInboxRecord,
  BusinessEventSubscription,
  SkillAttempt,
  UserGoalCompletionContract,
  UserGoalPlan,
  UserGoalPlanStatus,
} from '../../domain/src/index.js';

interface PlanRow extends QueryResultRow {
  plan_json: UserGoalPlan;
}

interface AttemptRow extends QueryResultRow {
  attempt_json: SkillAttempt;
}

interface SubscriptionRow extends QueryResultRow {
  subscription_id: string;
  provider_id: string;
  stream_id: string;
  generation: number;
  status: BusinessEventSubscription['status'];
  last_durably_admitted_sequence: string;
  last_processed_sequence: string;
  last_replayable_sequence: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InboxIdentityRow extends QueryResultRow {
  inbox_id: string;
  envelope_hash: string;
  sequence: string;
}

export class PostgresUserGoalRuntimeRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveContract(
    contract: UserGoalCompletionContract,
    contractHash: string,
    createdAt: string,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO user_goal_contract(
         goal_id,goal_version,schema_version,contract_hash,contract_json,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT(goal_id,goal_version) DO UPDATE
       SET contract_hash=EXCLUDED.contract_hash,contract_json=EXCLUDED.contract_json
       WHERE user_goal_contract.contract_hash=EXCLUDED.contract_hash`,
      [
        contract.goalId,
        contract.goalVersion,
        contract.schemaVersion,
        contractHash,
        JSON.stringify(contract),
        createdAt,
      ],
    );
  }

  async createPlan(plan: UserGoalPlan): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(
        `INSERT INTO user_goal_plan(
           plan_id,goal_id,goal_version,revision,revision_kind,status,contract_hash,
           content_hash,plan_json,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)`,
        [
          plan.planId,
          plan.goalId,
          plan.goalVersion,
          plan.revision,
          plan.revisionKind,
          plan.status,
          plan.contractHash,
          plan.contentHash,
          JSON.stringify(plan),
          plan.createdAt,
        ],
      );
      for (const [index, skillGoal] of plan.skillGoals.entries()) {
        await client.query(
          `INSERT INTO skill_goal(
             skill_goal_id,plan_id,ordinal,status,contract_json,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)`,
          [
            skillGoal.skillGoalId,
            plan.planId,
            index + 1,
            skillGoal.status,
            JSON.stringify(skillGoal),
            plan.createdAt,
          ],
        );
      }
      for (const dependency of plan.dependencies) {
        await client.query(
          `INSERT INTO skill_goal_dependency(
             dependency_id,plan_id,predecessor_skill_goal_id,successor_skill_goal_id,predicate)
           VALUES($1,$2,$3,$4,$5)`,
          [
            dependency.dependencyId,
            plan.planId,
            dependency.predecessorSkillGoalId,
            dependency.successorSkillGoalId,
            dependency.predicate,
          ],
        );
      }
    });
  }

  async findPlan(planId: string): Promise<UserGoalPlan | undefined> {
    const result = await this.#pool.query<PlanRow>(
      'SELECT plan_json FROM user_goal_plan WHERE plan_id=$1',
      [planId],
    );
    return result.rows[0]?.plan_json;
  }

  async compareAndSetPlanStatus(
    input: Readonly<{
      planId: string;
      expectedLockVersion: number;
      expectedStatus: UserGoalPlanStatus;
      status: UserGoalPlanStatus;
      updatedAt: string;
    }>,
  ): Promise<number | undefined> {
    const result = await this.#pool.query<{ lock_version: string | number }>(
      `UPDATE user_goal_plan
       SET status=$4,lock_version=lock_version+1,updated_at=$5,
           plan_json=jsonb_set(plan_json,'{status}',to_jsonb($4::text),false)
       WHERE plan_id=$1 AND lock_version=$2 AND status=$3
       RETURNING lock_version`,
      [
        input.planId,
        input.expectedLockVersion,
        input.expectedStatus,
        input.status,
        input.updatedAt,
      ],
    );
    const version = result.rows[0]?.lock_version;
    return version === undefined ? undefined : Number(version);
  }

  async createAttempt(attempt: SkillAttempt): Promise<void> {
    try {
      await this.#pool.query(
        `INSERT INTO skill_attempt(
           attempt_id,plan_id,skill_goal_id,ordinal,status,strategy_fingerprint,
           attempt_json,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          attempt.attemptId,
          attempt.planId,
          attempt.skillGoalId,
          attempt.ordinal,
          attempt.status,
          attempt.strategyFingerprint,
          JSON.stringify(attempt),
          attempt.createdAt,
          attempt.updatedAt,
        ],
      );
    } catch (error) {
      if (isPostgresError(error, '23505'))
        throw new UserGoalRuntimePersistenceError(
          'ACTIVE_SKILL_ATTEMPT_EXISTS',
          'A Skill Goal already owns the active attempt or immutable attempt identity.',
        );
      throw error;
    }
  }

  async findAttempt(attemptId: string): Promise<SkillAttempt | undefined> {
    const result = await this.#pool.query<AttemptRow>(
      'SELECT attempt_json FROM skill_attempt WHERE attempt_id=$1',
      [attemptId],
    );
    return result.rows[0]?.attempt_json;
  }

  async saveBusinessEventSubscription(subscription: BusinessEventSubscription): Promise<void> {
    await this.#pool.query(
      `INSERT INTO business_event_subscription(
         subscription_id,provider_id,stream_id,generation,status,
         last_durably_admitted_sequence,last_processed_sequence,last_replayable_sequence,
         created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10)`,
      [
        subscription.subscriptionId,
        subscription.providerId,
        subscription.streamId,
        subscription.generation,
        subscription.status,
        subscription.lastDurablyAdmittedSequence,
        subscription.lastProcessedSequence,
        subscription.lastReplayableSequence ?? null,
        subscription.createdAt,
        subscription.updatedAt,
      ],
    );
  }

  async findBusinessEventSubscription(
    subscriptionId: string,
  ): Promise<BusinessEventSubscription | undefined> {
    const result = await this.#pool.query<SubscriptionRow>(
      'SELECT * FROM business_event_subscription WHERE subscription_id=$1',
      [subscriptionId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      subscriptionId: row.subscription_id,
      providerId: row.provider_id,
      streamId: row.stream_id,
      generation: row.generation,
      status: row.status,
      lastDurablyAdmittedSequence: row.last_durably_admitted_sequence,
      lastProcessedSequence: row.last_processed_sequence,
      ...(row.last_replayable_sequence === null
        ? {}
        : { lastReplayableSequence: row.last_replayable_sequence }),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async admitBusinessEvent(
    record: BusinessEventInboxRecord,
  ): Promise<Readonly<{ created: boolean }>> {
    return withTransaction(this.#pool, async (client) => {
      const subscription = await client.query(
        'SELECT subscription_id FROM business_event_subscription WHERE subscription_id=$1 FOR UPDATE',
        [record.subscriptionId],
      );
      if (subscription.rowCount !== 1)
        throw new UserGoalRuntimePersistenceError(
          'BUSINESS_EVENT_SUBSCRIPTION_NOT_FOUND',
          'Business Event subscription does not exist.',
        );
      const existing = await client.query<InboxIdentityRow>(
        `SELECT inbox_id,envelope_hash,sequence::text
         FROM business_event_inbox
         WHERE subscription_id=$1 AND event_id=$2`,
        [record.subscriptionId, record.eventId],
      );
      const identity = existing.rows[0];
      if (identity !== undefined) {
        if (identity.envelope_hash !== record.envelopeHash || identity.sequence !== record.sequence)
          throw new UserGoalRuntimePersistenceError(
            'BUSINESS_EVENT_IDENTITY_HASH_MISMATCH',
            'Duplicate Business Event identity has different immutable content.',
          );
        return { created: false };
      }
      try {
        await client.query(
          `INSERT INTO business_event_inbox(
             inbox_id,subscription_id,event_id,sequence,envelope_hash,envelope_json,status,admitted_at)
           VALUES($1,$2,$3,$4::numeric,$5,$6::jsonb,$7,$8)`,
          [
            record.inboxId,
            record.subscriptionId,
            record.eventId,
            record.sequence,
            record.envelopeHash,
            JSON.stringify(record.envelope),
            record.status,
            record.admittedAt,
          ],
        );
      } catch (error) {
        if (isPostgresError(error, '23505'))
          throw new UserGoalRuntimePersistenceError(
            'BUSINESS_EVENT_SEQUENCE_COLLISION',
            'Business Event sequence or inbox identity collides with another event.',
          );
        throw error;
      }
      await client.query(
        `UPDATE business_event_subscription
         SET last_durably_admitted_sequence=GREATEST(last_durably_admitted_sequence,$2::numeric),
             lock_version=lock_version+1,updated_at=$3
         WHERE subscription_id=$1`,
        [record.subscriptionId, record.sequence, record.admittedAt],
      );
      return { created: true };
    });
  }

  async markBusinessEventProcessed(inboxId: string, processedAt: string): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const event = await client.query<{ subscription_id: string; sequence: string }>(
        `UPDATE business_event_inbox
         SET status='processed',processed_at=$2,error_code=NULL
         WHERE inbox_id=$1 AND status IN ('admitted','processing','retryable_failed')
         RETURNING subscription_id,sequence::text`,
        [inboxId, processedAt],
      );
      const row = event.rows[0];
      if (row === undefined)
        throw new UserGoalRuntimePersistenceError(
          'BUSINESS_EVENT_PROCESSING_CAS_FAILED',
          'Business Event was not in a processable state.',
        );
      await client.query(
        `UPDATE business_event_subscription
         SET last_processed_sequence=GREATEST(last_processed_sequence,$2::numeric),
             lock_version=lock_version+1,updated_at=$3
         WHERE subscription_id=$1`,
        [row.subscription_id, row.sequence, processedAt],
      );
    });
  }
}

export class UserGoalRuntimePersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'UserGoalRuntimePersistenceError';
    this.code = code;
  }
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isPostgresError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
