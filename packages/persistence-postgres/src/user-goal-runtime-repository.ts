import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  BusinessEventInboxRecord,
  BusinessEventContinuityRecord,
  BusinessEventRelationProjection,
  BusinessEventSubscription,
  CompletedEffect,
  OutcomeDecision,
  ProgressObservation,
  RecoveryDecision,
  EventImpactAssessment,
  EventIncident,
  RuntimeLayeredOutcomeCommit,
  SkillAttempt,
  SkillExecutionContract,
  SkillGoal,
  TaskGoalCompletionContract,
  UserGoalCompletionContract,
  UserGoalPlan,
  UserGoalPlanStatus,
} from '../../domain/src/index.js';

interface PlanRow extends QueryResultRow {
  plan_json: UserGoalPlan;
}

interface CurrentPlanRow extends PlanRow {
  lock_version: string | number;
  status: UserGoalPlanStatus;
}

interface OutcomeContextRow extends QueryResultRow {
  plan_json: UserGoalPlan;
  contract_json: UserGoalCompletionContract;
  skill_goal_json: SkillGoal;
  attempt_json: SkillAttempt;
}

interface OutcomeDecisionRow extends QueryResultRow {
  decision_json: OutcomeDecision;
}

interface ProgressObservationRow extends QueryResultRow {
  progress_observation_id: string;
  plan_id: string;
  classification: ProgressObservation['classification'];
  vector_json: ProgressObservation['vector'];
  observed_at: Date | string;
}

interface CompletedEffectRow extends QueryResultRow {
  effect_json: CompletedEffect;
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

interface BusinessEventInboxRow extends QueryResultRow {
  inbox_id: string;
  subscription_id: string;
  event_id: string;
  sequence: string;
  envelope_hash: string;
  envelope_json: unknown;
  status: BusinessEventInboxRecord['status'];
  admitted_at: Date | string;
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
    await withTransaction(this.#pool, (client) => insertUserGoalPlan(client, plan));
  }

  async replacePlan(
    source: Readonly<{ planId: string; lockVersion: number; status: UserGoalPlanStatus }>,
    plan: UserGoalPlan,
    updatedAt: string,
  ): Promise<boolean> {
    return withTransaction(this.#pool, async (client) => {
      const changed = await client.query(
        `UPDATE user_goal_plan SET status='superseded',lock_version=lock_version+1,updated_at=$4,
           plan_json=jsonb_set(plan_json,'{status}','"superseded"',false)
         WHERE plan_id=$1 AND lock_version=$2 AND status=$3`,
        [source.planId, source.lockVersion, source.status, updatedAt],
      );
      if (changed.rowCount !== 1) return false;
      await insertUserGoalPlan(client, plan);
      return true;
    });
  }

  async findPlan(planId: string): Promise<UserGoalPlan | undefined> {
    const result = await this.#pool.query<PlanRow>(
      'SELECT plan_json FROM user_goal_plan WHERE plan_id=$1',
      [planId],
    );
    return result.rows[0]?.plan_json;
  }

  async findCurrentPlan(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<{ plan: UserGoalPlan; lockVersion: number }> | undefined> {
    const result = await this.#pool.query<CurrentPlanRow>(
      `SELECT plan_json,lock_version,status FROM user_goal_plan
       WHERE goal_id=$1 AND goal_version=$2
         AND status IN ('validated','active','revision_pending')
       ORDER BY revision DESC LIMIT 1`,
      [goalId, goalVersion],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          plan: { ...row.plan_json, status: row.status },
          lockVersion: Number(row.lock_version),
        };
  }

  async findReusablePlan(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<{ plan: UserGoalPlan; lockVersion: number }> | undefined> {
    const result = await this.#pool.query<CurrentPlanRow>(
      `SELECT plan.plan_json,plan.lock_version,plan.status
       FROM user_goal_plan plan
       WHERE plan.goal_id=$1 AND plan.goal_version=$2
         AND plan.status IN ('validated','active')
         AND EXISTS (
           SELECT 1 FROM skill_goal goal
           WHERE goal.plan_id=plan.plan_id AND goal.status IN ('pending','ready')
             AND NOT EXISTS (
               SELECT 1 FROM skill_goal_dependency dependency
               JOIN skill_goal predecessor
                 ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
               WHERE dependency.plan_id=plan.plan_id
                 AND dependency.successor_skill_goal_id=goal.skill_goal_id
                 AND dependency.predicate='required'
                 AND predecessor.status<>'achieved'))
       ORDER BY plan.revision DESC LIMIT 1`,
      [goalId, goalVersion],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          plan: { ...row.plan_json, status: row.status },
          lockVersion: Number(row.lock_version),
        };
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

  async nextAttemptOrdinal(skillGoalId: string): Promise<number> {
    const result = await this.#pool.query<{ next_ordinal: string | number }>(
      `SELECT COALESCE(MAX(ordinal),0)+1 AS next_ordinal
       FROM skill_attempt WHERE skill_goal_id=$1`,
      [skillGoalId],
    );
    return Number(result.rows[0]?.next_ordinal ?? 1);
  }

  async listReadySkillGoals(planId: string): Promise<readonly SkillGoal[]> {
    return withTransaction(this.#pool, async (client) => {
      await client.query(
        `UPDATE skill_goal goal
         SET status='ready',lock_version=lock_version+1,updated_at=clock_timestamp(),
             contract_json=jsonb_set(contract_json,'{status}','"ready"',false)
         WHERE goal.plan_id=$1 AND goal.status='pending'
           AND EXISTS (
             SELECT 1 FROM user_goal_plan plan
             WHERE plan.plan_id=goal.plan_id AND plan.status IN ('validated','active'))
           AND NOT EXISTS (
             SELECT 1 FROM skill_goal_dependency dependency
             JOIN skill_goal predecessor
               ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
             WHERE dependency.plan_id=goal.plan_id
               AND dependency.successor_skill_goal_id=goal.skill_goal_id
               AND dependency.predicate='required'
               AND predecessor.status<>'achieved')`,
        [planId],
      );
      const result = await client.query<{ contract_json: SkillGoal }>(
        `SELECT goal.contract_json
       FROM skill_goal goal
       JOIN user_goal_plan plan ON plan.plan_id=goal.plan_id
       WHERE goal.plan_id=$1 AND goal.status='ready'
         AND plan.status IN ('validated','active')
         AND NOT EXISTS (
           SELECT 1 FROM skill_goal_dependency dependency
           JOIN skill_goal predecessor
             ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
           WHERE dependency.plan_id=goal.plan_id
             AND dependency.successor_skill_goal_id=goal.skill_goal_id
             AND dependency.predicate='required'
             AND predecessor.status<>'achieved')
       ORDER BY goal.ordinal`,
        [planId],
      );
      return result.rows.map((row) => row.contract_json);
    });
  }

  async createDispatchIntent(attempt: SkillAttempt): Promise<boolean> {
    try {
      return await withTransaction(this.#pool, async (client) => {
        const plan = await client.query<{ status: UserGoalPlanStatus }>(
          `SELECT status FROM user_goal_plan WHERE plan_id=$1 FOR UPDATE`,
          [attempt.planId],
        );
        if (!['validated', 'active'].includes(plan.rows[0]?.status ?? 'failed')) return false;
        const claimed = await client.query(
          `UPDATE skill_goal goal SET status='dispatch_intent',lock_version=lock_version+1,
             updated_at=$3,contract_json=jsonb_set(contract_json,'{status}','"dispatch_intent"',false)
           WHERE goal.skill_goal_id=$1 AND goal.plan_id=$2 AND goal.status IN ('pending','ready')
             AND NOT EXISTS (
               SELECT 1 FROM skill_goal_dependency dependency
               JOIN skill_goal predecessor ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
               WHERE dependency.plan_id=goal.plan_id
                 AND dependency.successor_skill_goal_id=goal.skill_goal_id
                 AND dependency.predicate='required' AND predecessor.status<>'achieved')`,
          [attempt.skillGoalId, attempt.planId, attempt.createdAt],
        );
        if (claimed.rowCount !== 1) return false;
        await client.query(
          `UPDATE user_goal_plan
           SET status='active',lock_version=lock_version+1,updated_at=$2,
               plan_json=jsonb_set(plan_json,'{status}','"active"',false)
           WHERE plan_id=$1 AND status='validated'`,
          [attempt.planId, attempt.createdAt],
        );
        await client.query(
          `INSERT INTO skill_attempt(attempt_id,plan_id,skill_goal_id,ordinal,status,
             strategy_fingerprint,attempt_json,created_at,updated_at)
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
        return true;
      });
    } catch (error) {
      if (isPostgresError(error, '23505')) return false;
      throw error;
    }
  }

  async rejectDispatchIntent(attempt: SkillAttempt, updatedAt: string): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const failed = { ...attempt, status: 'failed' as const, updatedAt };
      const result = await client.query(
        `UPDATE skill_attempt SET status='failed',attempt_json=$2::jsonb,updated_at=$3,
           lock_version=lock_version+1 WHERE attempt_id=$1 AND status='dispatch_intent'`,
        [attempt.attemptId, JSON.stringify(failed), updatedAt],
      );
      if (result.rowCount !== 1) return;
      await client.query(
        `UPDATE skill_goal SET status='blocked',updated_at=$2,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}','"blocked"',false)
         WHERE skill_goal_id=$1 AND status='dispatch_intent'`,
        [attempt.skillGoalId, updatedAt],
      );
    });
  }

  async saveSelectedAttempt(attempt: SkillAttempt, updatedAt: string): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const saved = await client.query(
        `UPDATE skill_attempt SET status='selecting',attempt_json=$2::jsonb,updated_at=$3,
           lock_version=lock_version+1 WHERE attempt_id=$1 AND status='dispatch_intent'`,
        [attempt.attemptId, JSON.stringify(attempt), updatedAt],
      );
      if (saved.rowCount !== 1) throw new Error('SKILL_ATTEMPT_SELECTION_CAS_FAILED');
      await client.query(
        `UPDATE skill_goal SET status='selecting',updated_at=$2,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}','"selecting"',false)
         WHERE skill_goal_id=$1 AND status='dispatch_intent'`,
        [attempt.skillGoalId, updatedAt],
      );
    });
  }

  async saveExecutionContract(
    attempt: SkillAttempt,
    contract: SkillExecutionContract,
    updatedAt: string,
  ): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(
        `INSERT INTO skill_execution_contract(execution_contract_id,attempt_id,plan_id,
           skill_goal_id,skill_id,skill_version,contract_hash,contract_json,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          contract.executionContractId,
          attempt.attemptId,
          contract.planId,
          contract.skillGoalId,
          contract.skillId,
          contract.skillVersion,
          contract.contractHash,
          JSON.stringify(contract),
          updatedAt,
        ],
      );
      const saved = await client.query(
        `UPDATE skill_attempt SET status=$2,strategy_fingerprint=$3,attempt_json=$4::jsonb,updated_at=$5,
       lock_version=lock_version+1 WHERE attempt_id=$1 AND status='selecting'`,
        [
          attempt.attemptId,
          attempt.status,
          attempt.strategyFingerprint,
          JSON.stringify(attempt),
          updatedAt,
        ],
      );
      if (saved.rowCount !== 1) throw new Error('SKILL_ATTEMPT_EXECUTION_CONTRACT_CAS_FAILED');
      await client.query(
        `UPDATE skill_goal SET status='selecting',updated_at=$2,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}','"selecting"',false)
         WHERE skill_goal_id=$1 AND status='selecting'`,
        [attempt.skillGoalId, updatedAt],
      );
    });
  }

  async findAttempt(attemptId: string): Promise<SkillAttempt | undefined> {
    const result = await this.#pool.query<AttemptRow>(
      'SELECT attempt_json FROM skill_attempt WHERE attempt_id=$1',
      [attemptId],
    );
    return result.rows[0]?.attempt_json;
  }

  async supersedeAttemptForRecovery(
    planId: string,
    skillGoalId: string,
    attemptId: string,
    updatedAt: string,
  ): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const plan = await client.query<{ status: UserGoalPlanStatus }>(
        `SELECT status FROM user_goal_plan WHERE plan_id=$1 FOR UPDATE`,
        [planId],
      );
      if (!['validated', 'active'].includes(plan.rows[0]?.status ?? 'failed'))
        throw new Error('USER_GOAL_PLAN_NOT_RECOVERABLE');
      const attempt = await client.query<AttemptRow>(
        `SELECT attempt_json FROM skill_attempt
         WHERE attempt_id=$1 AND plan_id=$2 AND skill_goal_id=$3 FOR UPDATE`,
        [attemptId, planId, skillGoalId],
      );
      const current = attempt.rows[0]?.attempt_json;
      if (current === undefined) throw new Error('SKILL_ATTEMPT_NOT_FOUND');
      if (current.status === 'superseded') return;
      if (['achieved', 'partially_achieved', 'canceled'].includes(current.status))
        throw new Error('SKILL_ATTEMPT_NOT_RECOVERABLE');
      const superseded = { ...current, status: 'superseded' as const, updatedAt };
      const changed = await client.query(
        `UPDATE skill_attempt SET status='superseded',attempt_json=$2::jsonb,updated_at=$3,
           lock_version=lock_version+1 WHERE attempt_id=$1 AND status NOT IN
           ('achieved','partially_achieved','canceled','superseded')`,
        [attemptId, JSON.stringify(superseded), updatedAt],
      );
      if (changed.rowCount !== 1) throw new Error('SKILL_ATTEMPT_RECOVERY_CAS_FAILED');
      const skillGoal = await client.query(
        `UPDATE skill_goal SET status='ready',updated_at=$3,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}','"ready"',false)
         WHERE skill_goal_id=$1 AND plan_id=$2
           AND status NOT IN ('achieved','partially_achieved','canceled','superseded')
           AND NOT EXISTS (
             SELECT 1 FROM skill_goal_dependency dependency
             JOIN skill_goal predecessor
               ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
             WHERE dependency.plan_id=$2
               AND dependency.successor_skill_goal_id=$1
               AND dependency.predicate='required'
               AND predecessor.status<>'achieved')`,
        [skillGoalId, planId, updatedAt],
      );
      if (skillGoal.rowCount !== 1) throw new Error('SKILL_GOAL_RECOVERY_CAS_FAILED');
    });
  }

  async findOutcomeContext(workflowPlanId: string, agentTaskId: string) {
    const result = await this.#pool.query<OutcomeContextRow>(
      `SELECT user_plan.plan_json,user_contract.contract_json,
              skill_goal.contract_json AS skill_goal_json,attempt.attempt_json
       FROM workflow_plan workflow
       JOIN agent_task task ON task.task_id=$2 AND task.plan_id=workflow.plan_id
       JOIN skill_attempt attempt
         ON attempt.attempt_id=COALESCE(workflow.skill_attempt_id,task.skill_attempt_id)
       JOIN skill_goal skill_goal ON skill_goal.skill_goal_id=attempt.skill_goal_id
       JOIN user_goal_plan user_plan ON user_plan.plan_id=attempt.plan_id
       JOIN user_goal_contract user_contract
         ON user_contract.goal_id=user_plan.goal_id
        AND user_contract.goal_version=user_plan.goal_version
       WHERE workflow.plan_id=$1`,
      [workflowPlanId, agentTaskId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          plan: row.plan_json,
          contract: row.contract_json,
          skillGoal: row.skill_goal_json,
          attempt: row.attempt_json,
        };
  }

  async saveTaskGoalContract(
    contract: TaskGoalCompletionContract,
    contractHash: string,
    createdAt: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `INSERT INTO task_goal_contract(task_goal_contract_id,attempt_id,agent_task_id,
         contract_hash,contract_json,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT(attempt_id,agent_task_id) DO UPDATE
       SET task_goal_contract_id=task_goal_contract.task_goal_contract_id
       WHERE task_goal_contract.contract_hash=EXCLUDED.contract_hash`,
      [
        contract.taskGoalContractId,
        contract.attemptId,
        contract.agentTaskId,
        contractHash,
        JSON.stringify(contract),
        createdAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error('TASK_GOAL_CONTRACT_IDEMPOTENCY_CONFLICT');
  }

  async saveOutcomeDecisions(planId: string, decisions: readonly OutcomeDecision[]): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      for (const decision of decisions) {
        const result = await client.query(
          `INSERT INTO outcome_decision(outcome_decision_id,level,subject_id,plan_id,status,
             confidence,decision_json,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT(outcome_decision_id) DO UPDATE
           SET outcome_decision_id=outcome_decision.outcome_decision_id
           WHERE outcome_decision.decision_json=EXCLUDED.decision_json`,
          [
            decision.outcomeDecisionId,
            decision.level,
            decision.subjectId,
            planId,
            decision.status,
            decision.confidence,
            JSON.stringify(decision),
            decision.createdAt,
          ],
        );
        if (result.rowCount !== 1) throw new Error('OUTCOME_DECISION_IDEMPOTENCY_CONFLICT');
      }
    });
  }

  async listSkillGoalOutcomeDecisions(planId: string): Promise<readonly OutcomeDecision[]> {
    const result = await this.#pool.query<OutcomeDecisionRow>(
      `SELECT decision_json FROM outcome_decision
       WHERE plan_id=$1 AND level='skill_goal' ORDER BY created_at,outcome_decision_id`,
      [planId],
    );
    return result.rows.map((row) => row.decision_json);
  }

  async markSkillOutcome(
    attemptId: string,
    skillGoalId: string,
    achieved: boolean,
    updatedAt: string,
  ): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const attemptStatus = achieved ? 'achieved' : 'failed';
      const goalStatus = achieved ? 'achieved' : 'failed';
      await client.query(
        `UPDATE skill_attempt SET status=$2,updated_at=$3,lock_version=lock_version+1,
           attempt_json=jsonb_set(attempt_json,'{status}',to_jsonb($2::text),false)
         WHERE attempt_id=$1 AND status IN
           ('selecting','planning_workflow','awaiting_confirmation','running','waiting_external','judging')`,
        [attemptId, attemptStatus, updatedAt],
      );
      await client.query(
        `UPDATE skill_goal SET status=$2,updated_at=$3,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}',to_jsonb($2::text),false)
         WHERE skill_goal_id=$1 AND status IN ('selecting','executing','judging')`,
        [skillGoalId, goalStatus, updatedAt],
      );
    });
  }

  async commitWorkingOutcome(
    layered: RuntimeLayeredOutcomeCommit,
    updatedAt: string,
  ): Promise<void> {
    if (
      layered.userDecision.status === 'achieved' ||
      layered.skillDecision.level !== 'skill_goal' ||
      layered.skillDecision.subjectId !== layered.skillGoalId ||
      layered.completedEffects.some(
        (effect) =>
          effect.planId !== layered.userGoalPlanId ||
          effect.skillGoalId !== layered.skillGoalId ||
          effect.status !== 'verified',
      )
    )
      throw new Error('USER_GOAL_WORKING_OUTCOME_INVALID');
    await withTransaction(this.#pool, async (client) => {
      const contract = await client.query(
        `INSERT INTO task_goal_contract(task_goal_contract_id,attempt_id,agent_task_id,
           contract_hash,contract_json,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(attempt_id,agent_task_id) DO UPDATE
         SET task_goal_contract_id=task_goal_contract.task_goal_contract_id
         WHERE task_goal_contract.contract_hash=EXCLUDED.contract_hash`,
        [
          layered.taskGoalContract.taskGoalContractId,
          layered.skillAttemptId,
          layered.taskGoalContract.agentTaskId,
          layered.taskGoalContractHash,
          JSON.stringify(layered.taskGoalContract),
          updatedAt,
        ],
      );
      if (contract.rowCount !== 1) throw new Error('TASK_GOAL_CONTRACT_IDEMPOTENCY_CONFLICT');
      for (const decision of [layered.taskDecision, layered.skillDecision, layered.userDecision]) {
        const saved = await client.query(
          `INSERT INTO outcome_decision(outcome_decision_id,level,subject_id,plan_id,status,
             confidence,decision_json,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT(outcome_decision_id) DO UPDATE
           SET outcome_decision_id=outcome_decision.outcome_decision_id
           WHERE outcome_decision.decision_json=EXCLUDED.decision_json`,
          [
            decision.outcomeDecisionId,
            decision.level,
            decision.subjectId,
            layered.userGoalPlanId,
            decision.status,
            decision.confidence,
            JSON.stringify(decision),
            decision.createdAt,
          ],
        );
        if (saved.rowCount !== 1) throw new Error('OUTCOME_DECISION_IDEMPOTENCY_CONFLICT');
      }
      await insertLayeredCompletedEffects(client, layered.completedEffects);
      const attempt = await client.query(
        `UPDATE skill_attempt SET status=$2,updated_at=$3,lock_version=lock_version+1,
           attempt_json=jsonb_set(attempt_json,'{status}',to_jsonb($2::text),false)
         WHERE attempt_id=$1 AND plan_id=$4 AND skill_goal_id=$5 AND status IN
           ('selecting','planning_workflow','awaiting_confirmation','running','waiting_external','judging')`,
        [
          layered.skillAttemptId,
          layered.skillDecision.status === 'achieved' ? 'achieved' : 'failed',
          updatedAt,
          layered.userGoalPlanId,
          layered.skillGoalId,
        ],
      );
      const skillGoal = await client.query(
        `UPDATE skill_goal SET status=$2,updated_at=$3,lock_version=lock_version+1,
           contract_json=jsonb_set(contract_json,'{status}',to_jsonb($2::text),false)
         WHERE skill_goal_id=$1 AND plan_id=$4 AND status IN ('selecting','executing','judging')`,
        [
          layered.skillGoalId,
          layered.skillDecision.status === 'achieved' ? 'achieved' : 'failed',
          updatedAt,
          layered.userGoalPlanId,
        ],
      );
      if (attempt.rowCount !== 1 || skillGoal.rowCount !== 1)
        throw new Error('USER_GOAL_WORKING_SKILL_OUTCOME_CONFLICT');
      await client.query(
        `UPDATE skill_goal successor
         SET status='ready',updated_at=$2,lock_version=lock_version+1,
             contract_json=jsonb_set(successor.contract_json,'{status}','"ready"',false)
         WHERE successor.plan_id=$1 AND successor.status='pending'
           AND NOT EXISTS (
             SELECT 1 FROM skill_goal_dependency dependency
             JOIN skill_goal predecessor
               ON predecessor.skill_goal_id=dependency.predecessor_skill_goal_id
             WHERE dependency.plan_id=$1
               AND dependency.successor_skill_goal_id=successor.skill_goal_id
               AND dependency.predicate='required'
               AND predecessor.status<>'achieved'
           )`,
        [layered.userGoalPlanId, updatedAt],
      );
    });
  }

  async saveProgressAndDecision(
    observation: ProgressObservation,
    decision: RecoveryDecision,
  ): Promise<void> {
    if (observation.planId !== decision.planId) throw new Error('RECOVERY_PROGRESS_PLAN_MISMATCH');
    try {
      await withTransaction(this.#pool, async (client) => {
        const progress = await client.query(
          `INSERT INTO progress_observation(
             progress_observation_id,plan_id,classification,vector_json,observed_at)
           VALUES($1,$2,$3,$4::jsonb,$5)
           ON CONFLICT(progress_observation_id) DO UPDATE
           SET progress_observation_id=progress_observation.progress_observation_id
           WHERE progress_observation.vector_json=EXCLUDED.vector_json
             AND progress_observation.classification=EXCLUDED.classification`,
          [
            observation.progressObservationId,
            observation.planId,
            observation.classification,
            JSON.stringify(observation.vector),
            observation.observedAt,
          ],
        );
        if (progress.rowCount !== 1) throw new Error('PROGRESS_OBSERVATION_IDEMPOTENCY_CONFLICT');
        const recovery = await client.query(
          `INSERT INTO recovery_decision(
             recovery_decision_id,plan_id,skill_goal_id,attempt_id,action,reason_code,
             strategy_fingerprint,decision_json,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
           ON CONFLICT(recovery_decision_id) DO UPDATE
           SET recovery_decision_id=recovery_decision.recovery_decision_id
           WHERE recovery_decision.decision_json=EXCLUDED.decision_json`,
          [
            decision.recoveryDecisionId,
            decision.planId,
            decision.skillGoalId ?? null,
            decision.attemptId ?? null,
            decision.action,
            decision.reasonCode,
            decision.strategyFingerprint,
            JSON.stringify(decision),
            decision.createdAt,
          ],
        );
        if (recovery.rowCount !== 1) throw new Error('RECOVERY_DECISION_IDEMPOTENCY_CONFLICT');
      });
    } catch (error) {
      if (isPostgresError(error, '23505'))
        throw new UserGoalRuntimePersistenceError(
          'RECOVERY_STRATEGY_ALREADY_ATTEMPTED',
          'The same recovery strategy cannot run twice for one Skill Goal and plan.',
        );
      throw error;
    }
  }

  async findLatestProgress(planId: string): Promise<ProgressObservation | undefined> {
    const result = await this.#pool.query<ProgressObservationRow>(
      `SELECT progress_observation_id,plan_id,classification,vector_json,observed_at
       FROM progress_observation WHERE plan_id=$1
       ORDER BY observed_at DESC,progress_observation_id DESC LIMIT 1`,
      [planId],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          progressObservationId: row.progress_observation_id,
          planId: row.plan_id,
          classification: row.classification,
          vector: row.vector_json,
          observedAt: iso(row.observed_at),
        };
  }

  async saveCompletedEffect(effect: CompletedEffect): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      const goal = await client.query(`SELECT goal_id FROM goal WHERE goal_id=$1 FOR UPDATE`, [
        effect.goalId,
      ]);
      if (goal.rowCount !== 1) throw new Error('COMPLETED_EFFECT_GOAL_NOT_FOUND');
      if (effect.status === 'invalidated') {
        if (effect.predecessorEffectId === undefined)
          throw new Error('COMPLETED_EFFECT_INVALIDATION_PREDECESSOR_REQUIRED');
        const predecessor = await client.query<{ goal_id: string; effect_fingerprint: string }>(
          `SELECT goal_id,effect_fingerprint FROM completed_effect
           WHERE completed_effect_id=$1 FOR UPDATE`,
          [effect.predecessorEffectId],
        );
        if (
          predecessor.rows[0]?.goal_id !== effect.goalId ||
          predecessor.rows[0].effect_fingerprint !== effect.effectFingerprint
        )
          throw new Error('COMPLETED_EFFECT_INVALIDATION_PREDECESSOR_MISMATCH');
      } else {
        const duplicate = await client.query(
          `SELECT completed_effect_id FROM completed_effect
           WHERE goal_id=$1 AND effect_fingerprint=$2 AND status IN ('observed','verified')
             AND NOT EXISTS (
               SELECT 1 FROM completed_effect invalidation
               WHERE invalidation.predecessor_effect_id=completed_effect.completed_effect_id
                 AND invalidation.status='invalidated')
           FOR UPDATE`,
          [effect.goalId, effect.effectFingerprint],
        );
        if ((duplicate.rowCount ?? 0) > 0) throw new Error('COMPLETED_EFFECT_REPLAY_FORBIDDEN');
      }
      await client.query(
        `INSERT INTO completed_effect(completed_effect_id,goal_id,plan_id,skill_goal_id,status,
           effect_fingerprint,effect_json,predecessor_effect_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          effect.completedEffectId,
          effect.goalId,
          effect.planId,
          effect.skillGoalId ?? null,
          effect.status,
          effect.effectFingerprint,
          JSON.stringify(effect),
          effect.predecessorEffectId ?? null,
          effect.createdAt,
        ],
      );
    });
  }

  async listValidCompletedEffects(goalId: string): Promise<readonly CompletedEffect[]> {
    const result = await this.#pool.query<CompletedEffectRow>(
      `SELECT effect.effect_json FROM completed_effect effect
       WHERE effect.goal_id=$1 AND effect.status IN ('observed','verified')
         AND NOT EXISTS (
           SELECT 1 FROM completed_effect invalidation
           WHERE invalidation.predecessor_effect_id=effect.completed_effect_id
             AND invalidation.status='invalidated')
       ORDER BY effect.created_at,effect.completed_effect_id`,
      [goalId],
    );
    return result.rows.map((row) => row.effect_json);
  }

  async saveBusinessEventSubscription(subscription: BusinessEventSubscription): Promise<void> {
    await this.#pool.query(
      `INSERT INTO business_event_subscription(
         subscription_id,provider_id,stream_id,generation,status,
         last_durably_admitted_sequence,last_processed_sequence,last_replayable_sequence,
         created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10)
       ON CONFLICT(subscription_id) DO UPDATE SET
         status=EXCLUDED.status,
         last_durably_admitted_sequence=GREATEST(business_event_subscription.last_durably_admitted_sequence,EXCLUDED.last_durably_admitted_sequence),
         last_processed_sequence=GREATEST(business_event_subscription.last_processed_sequence,EXCLUDED.last_processed_sequence),
         last_replayable_sequence=COALESCE(EXCLUDED.last_replayable_sequence,business_event_subscription.last_replayable_sequence),
         lock_version=business_event_subscription.lock_version+1,
         updated_at=EXCLUDED.updated_at
       WHERE business_event_subscription.provider_id=EXCLUDED.provider_id
         AND business_event_subscription.stream_id=EXCLUDED.stream_id
         AND business_event_subscription.generation=EXCLUDED.generation`,
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

  async findCurrentBusinessEventSubscription(
    providerId: string,
  ): Promise<BusinessEventSubscription | undefined> {
    const result = await this.#pool.query<SubscriptionRow>(
      `SELECT * FROM business_event_subscription
       WHERE provider_id=$1 AND status='current'
       ORDER BY generation DESC LIMIT 1`,
      [providerId],
    );
    return result.rows[0] === undefined ? undefined : subscriptionFromRow(result.rows[0]);
  }

  async findLatestBusinessEventSubscription(
    providerId: string,
  ): Promise<BusinessEventSubscription | undefined> {
    const result = await this.#pool.query<SubscriptionRow>(
      `SELECT * FROM business_event_subscription
       WHERE provider_id=$1 ORDER BY generation DESC LIMIT 1`,
      [providerId],
    );
    return result.rows[0] === undefined ? undefined : subscriptionFromRow(result.rows[0]);
  }

  async listBusinessEventSubscriptions(
    limit: number,
  ): Promise<readonly BusinessEventSubscription[]> {
    const result = await this.#pool.query<SubscriptionRow>(
      `SELECT * FROM business_event_subscription
       ORDER BY updated_at DESC,subscription_id DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(subscriptionFromRow);
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
    return subscriptionFromRow(row);
  }

  async recordBusinessEventContinuity(
    record: BusinessEventContinuityRecord,
  ): Promise<Readonly<{ created: boolean }>> {
    return withTransaction(this.#pool, async (client) => {
      const subscription = await client.query<{ stream_id: string }>(
        `SELECT stream_id FROM business_event_subscription
         WHERE subscription_id=$1 FOR UPDATE`,
        [record.subscriptionId],
      );
      if (subscription.rows[0]?.stream_id !== record.previousStreamId)
        throw new UserGoalRuntimePersistenceError(
          'BUSINESS_EVENT_CONTINUITY_STREAM_MISMATCH',
          'Continuity does not close the persisted subscription stream.',
        );
      const inserted = await client.query(
        `INSERT INTO business_event_continuity(
           continuity_id,subscription_id,previous_stream_id,new_stream_id,reason_code,
           affected_source_ids_json,gap_detected_at,last_replayable_sequence,
           last_continuous_sequence,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::numeric,$9::numeric,$10)
         ON CONFLICT(subscription_id,previous_stream_id,new_stream_id,reason_code,last_replayable_sequence)
         DO NOTHING`,
        [
          record.continuityId,
          record.subscriptionId,
          record.previousStreamId,
          record.newStreamId,
          record.reasonCode,
          JSON.stringify(record.affectedSourceIds),
          record.gapDetectedAt,
          record.lastReplayableSequence,
          record.lastContinuousSequence ?? null,
          record.createdAt,
        ],
      );
      await client.query(
        `UPDATE business_event_subscription
         SET status='draining_closed',
             last_replayable_sequence=$2::numeric,
             lock_version=lock_version+1,updated_at=$3
         WHERE subscription_id=$1 AND status IN ('current','draining_closed')`,
        [record.subscriptionId, record.lastReplayableSequence, record.createdAt],
      );
      return { created: inserted.rowCount === 1 };
    });
  }

  async transitionBusinessEventSubscription(
    subscriptionId: string,
    status: BusinessEventSubscription['status'],
    updatedAt: string,
    lastReplayableSequence?: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE business_event_subscription SET status=$2,
         last_replayable_sequence=COALESCE($3::numeric,last_replayable_sequence),
         lock_version=lock_version+1,updated_at=$4
       WHERE subscription_id=$1`,
      [subscriptionId, status, lastReplayableSequence ?? null, updatedAt],
    );
    if (result.rowCount !== 1)
      throw new UserGoalRuntimePersistenceError(
        'BUSINESS_EVENT_SUBSCRIPTION_NOT_FOUND',
        'Business Event subscription does not exist.',
      );
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

  async claimBusinessEventInbox(limit: number): Promise<readonly BusinessEventInboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 256)
      throw new Error('BUSINESS_EVENT_CLAIM_LIMIT_INVALID');
    return withTransaction(this.#pool, async (client) => {
      const result = await client.query<BusinessEventInboxRow>(
        `WITH candidates AS (
           SELECT inbox_id FROM business_event_inbox
           WHERE status IN ('admitted','retryable_failed')
           ORDER BY admitted_at,sequence LIMIT $1 FOR UPDATE SKIP LOCKED)
         UPDATE business_event_inbox event
         SET status='processing',attempt_count=attempt_count+1,error_code=NULL
         FROM candidates WHERE event.inbox_id=candidates.inbox_id
         RETURNING event.inbox_id,event.subscription_id,event.event_id,event.sequence::text,
           event.envelope_hash,event.envelope_json,event.status,event.admitted_at`,
        [limit],
      );
      return result.rows.map(inboxFromRow);
    });
  }

  async markBusinessEventFailed(
    inboxId: string,
    errorCode: string,
    retryable: boolean,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE business_event_inbox
       SET status=$2,error_code=$3
       WHERE inbox_id=$1 AND status='processing'`,
      [inboxId, retryable ? 'retryable_failed' : 'terminal_failed', errorCode],
    );
    if (result.rowCount !== 1)
      throw new UserGoalRuntimePersistenceError(
        'BUSINESS_EVENT_PROCESSING_CAS_FAILED',
        'Business Event was not claimed for processing.',
      );
  }

  async findBusinessEventInboxByIdentity(
    subscriptionId: string,
    eventId: string,
  ): Promise<BusinessEventInboxRecord | undefined> {
    const result = await this.#pool.query<BusinessEventInboxRow>(
      `SELECT inbox_id,subscription_id,event_id,sequence::text,envelope_hash,envelope_json,
         status,admitted_at FROM business_event_inbox
       WHERE subscription_id=$1 AND event_id=$2`,
      [subscriptionId, eventId],
    );
    return result.rows[0] === undefined ? undefined : inboxFromRow(result.rows[0]);
  }

  async listBusinessEventInbox(limit: number): Promise<readonly BusinessEventInboxRecord[]> {
    const result = await this.#pool.query<BusinessEventInboxRow>(
      `SELECT inbox_id,subscription_id,event_id,sequence::text,envelope_hash,envelope_json,
         status,admitted_at FROM business_event_inbox
       ORDER BY admitted_at DESC,inbox_id DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(inboxFromRow);
  }

  async saveBusinessEventRelationProjection(
    projection: BusinessEventRelationProjection,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO event_relation_projection(
         relation_projection_id,inbox_id,status,relation_hash,relation_json,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT(inbox_id,relation_hash) DO NOTHING`,
      [
        projection.relationProjectionId,
        projection.inboxId,
        projection.status,
        projection.relationHash,
        JSON.stringify(projection),
        projection.createdAt,
      ],
    );
  }

  async saveEventImpactAssessment(assessment: EventImpactAssessment): Promise<void> {
    await this.#pool.query(
      `INSERT INTO event_impact_assessment(
         assessment_id,inbox_id,classification,confidence,goal_id,plan_id,skill_goal_id,
         action,assessment_json,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT(inbox_id) DO NOTHING`,
      [
        assessment.assessmentId,
        assessment.inboxId,
        assessment.classification,
        assessment.confidence,
        assessment.goalId ?? null,
        assessment.planId ?? null,
        assessment.skillGoalId ?? null,
        assessment.action,
        JSON.stringify(assessment),
        assessment.createdAt,
      ],
    );
  }

  async saveEventIncident(incident: EventIncident): Promise<Readonly<{ created: boolean }>> {
    const result = await this.#pool.query(
      `INSERT INTO event_incident(
         incident_id,provider_id,stream_id,dedupe_key,incident_kind,agent_task_id,
         incident_json,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT(dedupe_key) DO NOTHING`,
      [
        incident.incidentId,
        incident.providerId,
        incident.streamId,
        incident.dedupeKey,
        incident.incidentKind,
        incident.agentTaskId ?? null,
        JSON.stringify(incident),
        incident.createdAt,
      ],
    );
    return { created: result.rowCount === 1 };
  }

  async findEventIncidentByDedupeKey(dedupeKey: string): Promise<EventIncident | undefined> {
    const result = await this.#pool.query<{ incident_json: EventIncident }>(
      'SELECT incident_json FROM event_incident WHERE dedupe_key=$1',
      [dedupeKey],
    );
    return result.rows[0]?.incident_json;
  }

  async attachEventIncidentTask(
    dedupeKey: string,
    agentTaskId: string,
    incident: EventIncident,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE event_incident SET agent_task_id=$2,incident_json=$3::jsonb
       WHERE dedupe_key=$1 AND (agent_task_id IS NULL OR agent_task_id=$2)`,
      [dedupeKey, agentTaskId, JSON.stringify(incident)],
    );
    if (result.rowCount !== 1)
      throw new UserGoalRuntimePersistenceError(
        'BUSINESS_EVENT_INCIDENT_TASK_ATTACH_CONFLICT',
        'Incident task authority was already attached or the incident does not exist.',
      );
  }

  async listEventImpactAssessments(limit: number): Promise<readonly EventImpactAssessment[]> {
    const result = await this.#pool.query<{ assessment_json: EventImpactAssessment }>(
      `SELECT assessment_json FROM event_impact_assessment
       ORDER BY created_at DESC,assessment_id DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => row.assessment_json);
  }

  async listEventIncidents(limit: number): Promise<readonly EventIncident[]> {
    const result = await this.#pool.query<{ incident_json: EventIncident }>(
      `SELECT incident_json FROM event_incident
       ORDER BY created_at DESC,incident_id DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => row.incident_json);
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

async function insertUserGoalPlan(client: PoolClient, plan: UserGoalPlan): Promise<void> {
  await client.query(
    `INSERT INTO user_goal_plan(plan_id,goal_id,goal_version,revision,revision_kind,source_plan_id,status,
       contract_hash,content_hash,plan_json,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11)`,
    [
      plan.planId,
      plan.goalId,
      plan.goalVersion,
      plan.revision,
      plan.revisionKind,
      plan.sourcePlanId ?? null,
      plan.status,
      plan.contractHash,
      plan.contentHash,
      JSON.stringify(plan),
      plan.createdAt,
    ],
  );
  for (const [index, goal] of plan.skillGoals.entries())
    await client.query(
      `INSERT INTO skill_goal(skill_goal_id,plan_id,ordinal,status,contract_json,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)`,
      [goal.skillGoalId, plan.planId, index + 1, goal.status, JSON.stringify(goal), plan.createdAt],
    );
  for (const dependency of plan.dependencies)
    await client.query(
      `INSERT INTO skill_goal_dependency(dependency_id,plan_id,predecessor_skill_goal_id,
         successor_skill_goal_id,predicate) VALUES($1,$2,$3,$4,$5)`,
      [
        dependency.dependencyId,
        plan.planId,
        dependency.predecessorSkillGoalId,
        dependency.successorSkillGoalId,
        dependency.predicate,
      ],
    );
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

function subscriptionFromRow(row: SubscriptionRow): BusinessEventSubscription {
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

function inboxFromRow(row: BusinessEventInboxRow): BusinessEventInboxRecord {
  return {
    inboxId: row.inbox_id,
    subscriptionId: row.subscription_id,
    eventId: row.event_id,
    sequence: row.sequence,
    envelopeHash: row.envelope_hash,
    envelope: row.envelope_json,
    status: row.status,
    admittedAt: iso(row.admitted_at),
  };
}

async function insertLayeredCompletedEffects(
  client: PoolClient,
  effects: readonly CompletedEffect[],
): Promise<void> {
  const goalIds = [...new Set(effects.map((effect) => effect.goalId))].sort();
  for (const goalId of goalIds)
    await client.query('SELECT goal_id FROM goal WHERE goal_id=$1 FOR UPDATE', [goalId]);
  for (const effect of effects) {
    const replay = await client.query(
      `SELECT completed_effect_id FROM completed_effect
       WHERE goal_id=$1 AND effect_fingerprint=$2 AND completed_effect_id<>$3
         AND status IN ('observed','verified')
         AND NOT EXISTS (
           SELECT 1 FROM completed_effect invalidation
           WHERE invalidation.predecessor_effect_id=completed_effect.completed_effect_id
             AND invalidation.status='invalidated')`,
      [effect.goalId, effect.effectFingerprint, effect.completedEffectId],
    );
    if ((replay.rowCount ?? 0) > 0) throw new Error('COMPLETED_EFFECT_REPLAY_FORBIDDEN');
    const inserted = await client.query(
      `INSERT INTO completed_effect(completed_effect_id,goal_id,plan_id,skill_goal_id,status,
         effect_fingerprint,effect_json,predecessor_effect_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       ON CONFLICT(completed_effect_id) DO UPDATE
       SET completed_effect_id=completed_effect.completed_effect_id
       WHERE completed_effect.effect_json=EXCLUDED.effect_json`,
      [
        effect.completedEffectId,
        effect.goalId,
        effect.planId,
        effect.skillGoalId ?? null,
        effect.status,
        effect.effectFingerprint,
        JSON.stringify(effect),
        effect.predecessorEffectId ?? null,
        effect.createdAt,
      ],
    );
    if (inserted.rowCount !== 1) throw new Error('COMPLETED_EFFECT_IDEMPOTENCY_CONFLICT');
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
