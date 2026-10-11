import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { WorkflowPlanCommitService } from '../../application/src/workflow-plan-commit.js';
import { workflowPlanCandidate } from '../../application/src/workflow-plan-candidate.js';
import { canonicalHash } from '../../application/src/mcp-task-readiness.js';
import type { PlanWorkflowInput } from '../../application/src/workflow-planning-contracts.js';
import type {
  DslExecutionReadiness,
  GoalExecutionContract,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { PostgresWorkflowPlanRepository } from '../src/repositories.js';

/** The same formal commit regressions run against ordinary and restricted-role GOWM PostgreSQL. */
export async function verifyWorkflowPlanCommitCases(
  pool: Pool,
  run: string,
  goalContract: GoalExecutionContract,
  scope?: DeviceWorkScope,
  taskId?: string,
): Promise<string[]> {
  const timestamp = new Date().toISOString();
  const repository = new PostgresWorkflowPlanRepository(pool, undefined, scope);
  const commits = new WorkflowPlanCommitService({ repository });
  function fixture(suffix: string) {
    const planId = `${run}-${suffix}`;
    const definition = {
      workflowDefinitionId: `${planId}-definition`,
      version: 1,
      goalId: goalContract.goalId,
      goalVersion: goalContract.version,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result' as const,
          value: { op: 'literal' as const, value: true },
        },
      ],
      edges: [],
    };
    const readiness: DslExecutionReadiness = {
      readinessId: `${planId}-readiness`,
      workflowPlanId: planId,
      planAttempt: 2,
      checkPhase: 'planning',
      dslHash: canonicalHash(definition),
      disposition: 'confirmation_required',
      permittedActions: ['request_confirmation'],
      guardAction: 'request_confirmation',
      guardReasonCodes: ['fixture_confirmation_required'],
      confirmationRequired: true,
      createdAt: timestamp,
    };
    const plan: WorkflowPlanRecord = {
      planId,
      ...(taskId === undefined ? {} : { executionTaskId: taskId }),
      goalId: goalContract.goalId,
      goalVersion: goalContract.version,
      goalContract,
      definition,
      executionReadiness: readiness,
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 2,
      createdAt: timestamp,
    };
    const input: PlanWorkflowInput = {
      planId,
      workflowDefinitionId: definition.workflowDefinitionId,
      workflowVersion: definition.version,
      goalId: plan.goalId,
      goalVersion: plan.goalVersion,
      goalContract,
      ...(taskId === undefined ? {} : { taskId }),
      planningInstruction: 'Owned PostgreSQL formal commit regression',
    };
    const candidate = workflowPlanCandidate({
      outcome: 'ready',
      plan,
      supersedeSourcePlan: false,
      planningAudits: [
        ...[1, 2].map((attempt) => ({
          kind: 'attempt' as const,
          persisted: false,
          attempt: {
            planId,
            goalContract,
            ...(taskId === undefined ? {} : { executionTaskId: taskId }),
            attempt,
            candidate: definition,
            validationErrors: [],
            valid: true,
            createdAt: timestamp,
          },
        })),
        { kind: 'readiness', evaluation: { readiness, snapshots: [] } },
      ],
    });
    return { candidate, input, plan, readiness };
  }
  async function assertNoWrites(planId: string) {
    const counts = await pool.query<{ plans: string; attempts: string; readiness: string }>(
      `SELECT (SELECT count(*) FROM workflow_plan WHERE plan_id=$1)::text plans,
        (SELECT count(*) FROM workflow_plan_attempt WHERE plan_id=$1)::text attempts,
        (SELECT count(*) FROM task_execution_readiness WHERE workflow_plan_id=$1)::text readiness`,
      [planId],
    );
    assert.deepEqual(counts.rows, [{ plans: '0', attempts: '0', readiness: '0' }]);
  }

  // Test-only Pool facade: inject a real PostgreSQL error once, after both deferred attempts.
  let injectFailure = true;
  const failurePool = {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql: string, values?: readonly unknown[]) {
          if (injectFailure && sql.includes('INSERT INTO task_execution_readiness')) {
            injectFailure = false;
            await client.query('SELECT 1/0');
          }
          return client.query(sql, values === undefined ? undefined : [...values]);
        },
        release: () => {
          client.release();
        },
      };
    },
  } as unknown as Pool;
  const retry = fixture('atomic-retry');
  const retryCommits = new WorkflowPlanCommitService({
    repository: new PostgresWorkflowPlanRepository(failurePool, undefined, scope),
  });
  await assert.rejects(retryCommits.commit(retry.candidate, retry.input), { code: '22012' });
  assert.equal(injectFailure, false);
  await assertNoWrites(retry.plan.planId);
  await retryCommits.commit(retry.candidate, retry.input);
  assert.deepEqual(
    (await repository.findPlan(retry.plan.planId))?.executionReadiness,
    retry.readiness,
  );
  const attempts = await pool.query(
    'SELECT attempt FROM workflow_plan_attempt WHERE plan_id=$1 ORDER BY attempt',
    [retry.plan.planId],
  );
  assert.deepEqual(attempts.rows, [{ attempt: 1 }, { attempt: 2 }]);

  const idempotent = await commits.commit(retry.candidate, retry.input);
  assert.deepEqual(idempotent.executionReadiness, retry.readiness);
  assert.equal(idempotent.confirmationStatus, 'awaiting_confirmation');
  // A different in-memory assessment of the same DSL cannot replace durable confirmation blockers.
  const fresh = workflowPlanCandidate({
    outcome: 'ready',
    supersedeSourcePlan: false,
    planningAudits: [],
    plan: {
      ...retry.plan,
      executionReadiness: { ...retry.readiness, disposition: 'ready', confirmationRequired: false },
    },
  });
  assert.deepEqual((await commits.commit(fresh, retry.input)).executionReadiness, retry.readiness);
  await repository.confirmPlan(retry.plan.planId, {
    confirmedAt: timestamp,
    ...(taskId === undefined ? {} : { taskId }),
  });
  const confirmed = await commits.commit(retry.candidate, retry.input);
  assert.equal(confirmed.confirmationStatus, 'confirmed');
  assert.deepEqual(confirmed.executionReadiness, retry.readiness);
  assert.deepEqual(
    (await repository.findConfirmedDefinition(retry.input.workflowDefinitionId, 1))
      ?.executionReadiness,
    retry.readiness,
  );
  const evaluations = await pool.query(
    'SELECT readiness_id FROM task_execution_readiness WHERE workflow_plan_id=$1',
    [retry.plan.planId],
  );
  assert.equal(evaluations.rowCount, 1);

  const source = fixture('cas-source');
  await commits.commit(source.candidate, source.input);
  const revision = fixture('cas-revision');
  const stale = workflowPlanCandidate({
    outcome: 'ready',
    planningAudits: revision.candidate.planningAudits,
    plan: { ...revision.plan, sourcePlanId: source.plan.planId, revisionKind: 'natural_language' },
    supersedeSourcePlan: true,
  });
  const winner = fixture('cas-winner');
  await repository.savePlanAndSupersede(winner.plan, source.plan.planId);
  await assert.rejects(
    commits.commit(stale, revision.input),
    /WORKFLOW_REVISION_SOURCE_NOT_ACTIVE/u,
  );
  await assertNoWrites(revision.plan.planId);
  assert.equal((await repository.findPlan(source.plan.planId))?.confirmationStatus, 'superseded');
  assert.equal(
    (await repository.findPlan(winner.plan.planId))?.confirmationStatus,
    'awaiting_confirmation',
  );

  const failed = fixture('formal-failed');
  const failedPlan = { ...failed.plan };
  delete failedPlan.definition;
  delete failedPlan.executionReadiness;
  const failedCandidate = workflowPlanCandidate({
    outcome: 'failed',
    plan: { ...failedPlan, confirmationStatus: 'failed' },
    supersedeSourcePlan: false,
    failureMessage: 'Invalid candidate fixture',
    planningAudits: failed.candidate.planningAudits.filter((audit) => audit.kind === 'attempt'),
  });
  await assert.rejects(commits.commit(failedCandidate, failed.input), {
    code: 'WORKFLOW_PLANNING_FAILED',
  });
  assert.equal((await repository.findPlan(failed.plan.planId))?.confirmationStatus, 'failed');
  await assert.rejects(commits.commit(failedCandidate, failed.input), {
    code: 'WORKFLOW_PLANNING_FAILED',
  });
  return [
    'Formal Workflow commit rolls back deferred attempts/root/readiness on a PostgreSQL error and retries the identical immutable candidate',
    'Idempotent awaiting/confirmed Workflow commits and child-definition reads retain durable confirmation-required readiness over a fresh candidate assessment',
    'Rejected Workflow revision CAS leaves no deferred attempts, readiness or orphan GOWM planning root and preserves the winning revision',
    'Failed Workflow candidates persist their formal failure and remain idempotent after atomic audit submission',
  ];
}
