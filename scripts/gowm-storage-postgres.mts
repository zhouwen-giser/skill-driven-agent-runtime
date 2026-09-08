import { verifyGowmOutcomeWriteScope } from '../packages/persistence-postgres/test/gowm-outcome-write-scope.postgres-cases.js';
import { verifyGowmGoalOutcomes } from '../packages/persistence-postgres/test/gowm-goal-outcome.postgres-cases.js';
import { verifyGowmGatewayCases } from '../packages/persistence-postgres/test/gowm-gateway.postgres-cases.js';
import { verifyGowmEvidenceRetention } from '../packages/runtime-control-persistence-postgres/test/gowm-evidence-retention.postgres-cases.js';
import { verifyGowmEvidenceCases } from '../packages/runtime-control-persistence-postgres/test/gowm-evidence.postgres-cases.js';
import { verifyGowmBusinessEventCases } from '../packages/persistence-postgres/test/gowm-business-events.postgres-cases.js';
import { verifyGowmWaitTimeoutCases } from '../packages/persistence-postgres/test/gowm-wait-timeout.postgres-cases.js';
import { verifyGowmProjectionCases } from '../packages/persistence-postgres/test/gowm-projection.postgres-cases.js';
import { verifyGowmPlanningCorrectionCases } from '../packages/persistence-postgres/test/gowm-planning-correction.postgres-cases.js';
import { verifyGowmRecoveryCases } from '../packages/persistence-postgres/test/gowm-recovery.postgres-cases.js';
import { verifyGowmRemoteCases } from '../packages/persistence-postgres/test/gowm-remote.postgres-cases.js';
import { verifyGowmTargetCases } from '../packages/persistence-postgres/test/gowm-targets.postgres-cases.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { Pool } from 'pg';

import { createAgentTask, bindTaskGoal, transitionTask } from '../packages/domain/src/task.js';
import { createGoal, createGoalExecutionContract } from '../packages/domain/src/goal.js';
import type { WorkflowPlanRecord } from '../packages/domain/src/workflow.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresGoalRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowExecutionRepository,
} from '../packages/persistence-postgres/src/repositories.js';
import {
  gowmSharedPoolConfiguration,
  verifyGowmStorageContract,
} from '../packages/persistence-postgres/src/gowm-storage-contract.js';

const url = process.env['GOWM_BUSINESS_TEST_DATABASE_URL'];
const consumerUrl = process.env['GOWM_BUSINESS_CONSUMER_TEST_DATABASE_URL'];
const peerUrl = process.env['GOWM_BUSINESS_PEER_TEST_DATABASE_URL'];
if (!url || !consumerUrl || !peerUrl || process.env['GOWM_BUSINESS_SMOKE_ENABLE'] !== 'true') {
  process.stdout.write('NOT_RUN: explicit isolated database and smoke enable required.\n');
  process.exitCode = 2;
} else {
  const pool = new Pool(gowmSharedPoolConfiguration(consumerUrl));
  const fixturePool = new Pool({ connectionString: url });
  const peerPool = new Pool({ connectionString: peerUrl });
  const results: { scenario: string; status: 'PASS' }[] = [];
  const run = `sdar-pg-${randomUUID()}`;
  try {
    const client = await pool.connect();
    try {
      const db = await client.query<{ name: string }>('SELECT current_database() AS name');
      assert.match(db.rows[0]?.name ?? '', /test/iu);
      await verifyGowmStorageContract(client, 'contracts/gowm-shared-storage/current');
      assert.equal(
        (await client.query<{ path: string }>("SELECT current_setting('search_path') AS path"))
          .rows[0]?.path,
        'ugv_sdar,public,pg_catalog',
      );
    } finally {
      client.release();
    }
    results.push({
      scenario: 'Read-only contract verification restores the business search_path',
      status: 'PASS',
    });

    // Test seeder owns only fixture directory entries. Native runtime rows below
    // are written by the same SDAR repositories used by normal Server assembly.
    const dataScope = `TEST:${run}`;
    const devices = [`${run}-a`, `${run}-b`];
    const bindings = [randomUUID(), randomUUID()];
    await fixturePool.query(
      "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','SDAR isolated repository verification')",
      [dataScope],
    );
    for (let index = 0; index < devices.length; index++) {
      await fixturePool.query(
        "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
        [devices[index], dataScope],
      );
      await fixturePool.query(
        "INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type) VALUES($1,$2,$3,$1,'synthetic SDAR test device','UGV')",
        [devices[index], dataScope, run],
      );
      await fixturePool.query(
        'INSERT INTO gowm_device.device_service_binding(binding_id,data_scope_key,device_id,smpp_service_key,provider_id,resource_id,sdar_service_key,sdar_mcp_server_id) VALUES($1,$2,$3,$4,$5,$3,$6,$7)',
        [
          bindings[index],
          dataScope,
          devices[index],
          run,
          'synthetic-peer',
          'sdar-test',
          `${run}-synthetic-server`,
        ],
      );
    }
    const scope = {
      allowedDeviceIds: devices,
      sdarServiceKey: 'sdar-test',
      includeNonDevice: false,
    };
    const timestamp = new Date().toISOString();
    const contextId = `${run}-context`;
    await new PostgresConversationContextRepository(pool).save({
      contextId,
      userId: 'test',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const goal = createGoal({
      goalId: `${run}-goal`,
      contextId,
      title: 'Shared test Goal',
      description: 'Persistence only; no model or MCP execution',
      timestamp,
    });
    await new PostgresGoalRepository(pool).save(goal);
    const tasks = new PostgresAgentTaskRepository(pool, undefined, undefined, scope);
    const plans = new PostgresWorkflowPlanRepository(pool, undefined, scope);
    const workflows = new PostgresWorkflowExecutionRepository(pool, undefined, scope);
    const goalContract = createGoalExecutionContract(goal);
    for (const [index, deviceId] of devices.entries()) {
      const bindingId = bindings[index];
      assert.ok(bindingId);
      const queuedTask = createAgentTask({
        taskId: `${run}-task-${index}`,
        contextId,
        userId: 'test',
        requestText: 'Storage fixture',
        requestMetadata: {},
        timestamp,
        deviceOwnership: { deviceId, bindingId, sdarServiceKey: scope.sdarServiceKey },
      });
      const deliberating = transitionTask(
        transitionTask(queuedTask, 'context_loading', 'fixture', timestamp),
        'goal_deliberation',
        'fixture',
        timestamp,
      );
      const task = bindTaskGoal(deliberating, {
        goalId: goal.goalId,
        goalVersion: goal.version,
        timestamp,
      });
      await tasks.save(task);
      assert.deepEqual((await tasks.findById(task.taskId))?.deviceOwnership, task.deviceOwnership);
      const planId = `${run}-plan-${index}`;
      await plans.saveAttempt({
        planId,
        executionTaskId: task.taskId,
        goalContract,
        attempt: 1,
        candidate: {},
        validationErrors: [],
        valid: false,
        createdAt: timestamp,
      });
      const root = await plans.findPlan(planId);
      assert.equal(root?.executionTaskId, task.taskId);
      assert.equal(root.definition, undefined);
      const plan: WorkflowPlanRecord = {
        planId,
        executionTaskId: task.taskId,
        goalId: goal.goalId,
        goalVersion: goal.version,
        goalContract,
        confirmationStatus: 'failed',
        attemptCount: 1,
        createdAt: timestamp,
      };
      await plans.savePlan(plan);
      assert.equal((await plans.findPlan(planId))?.confirmationStatus, 'failed');
      await assert.rejects(plans.savePlan(plan), /WORKFLOW_PLANNING_ROOT_CONFLICT/u);
      // A second, separately identified root tests instance/event writes. It does
      // not claim LangGraph execution or satisfy the normal Server smoke scenario.
      const instancePlanId = `${planId}-instance-fixture`;
      await plans.savePlan({
        ...plan,
        planId: instancePlanId,
        confirmationStatus: 'awaiting_confirmation',
      });
      await workflows.saveInstance({
        instanceId: `${run}-instance-${index}`,
        planId: instancePlanId,
        workflowDefinitionId: 'synthetic-definition',
        workflowVersion: 1,
        goalId: goal.goalId,
        goalVersion: goal.version,
        skillVersions: [],
        budgetLimits: {
          maxReplans: 0,
          maxDurationSeconds: 60,
          maxLlmCalls: 0,
          maxMcpCalls: 0,
          maxCost: 0,
        },
        budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 },
        status: 'running',
        input: {},
        errors: {},
        startedAt: timestamp,
      });
      await workflows.saveNodeEvents([
        {
          eventId: `${run}-event-${index}`,
          instanceId: `${run}-instance-${index}`,
          nodeId: 'same-node',
          sequence: 1,
          eventType: 'node_started',
          timestamp,
          summary: 'Synthetic repository event; no tool execution',
        },
      ]);
      assert.equal((await workflows.listNodeEvents(`${run}-instance-${index}`)).length, 1);
    }
    results.push({
      scenario:
        'Two devices share a Goal and persist Task/Plan/Attempt/Instance/Native Event through production repositories',
      status: 'PASS',
    });
    const onlyA = { ...scope, allowedDeviceIds: [devices[0]!] };
    assert.equal(
      await new PostgresAgentTaskRepository(pool, undefined, undefined, onlyA).findById(
        `${run}-task-1`,
      ),
      undefined,
    );
    assert.equal(
      await new PostgresWorkflowPlanRepository(pool, undefined, onlyA).findPlan(`${run}-plan-1`),
      undefined,
    );
    assert.equal(
      (
        await new PostgresWorkflowExecutionRepository(pool, undefined, onlyA).listNodeEvents(
          `${run}-instance-1`,
        )
      ).length,
      0,
    );
    const lineage = await pool.query(
      'SELECT * FROM gowm_business_v1.sdar_tasks WHERE device_id=ANY($1::text[])',
      [devices],
    );
    assert.equal(lineage.rowCount, 2);
    results.push({
      scenario: 'Scoped reads exclude the other device; GOWM read model sees both native Tasks',
      status: 'PASS',
    });
    for (const scenario of await verifyGowmGatewayCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmProjectionCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmPlanningCorrectionCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmEvidenceCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmTargetCases(pool, scope, run, goalContract))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmRemoteCases(pool, peerPool, scope, run, goalContract))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmBusinessEventCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmRecoveryCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmWaitTimeoutCases(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    for (const scenario of await verifyGowmGoalOutcomes(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    await verifyGowmOutcomeWriteScope(pool, scope, run);
    results.push({
      scenario: 'Outcome writer scope, rollback, invalidation and terminal boundary',
      status: 'PASS',
    });
    for (const scenario of await verifyGowmEvidenceRetention(pool, scope, run))
      results.push({ scenario, status: 'PASS' });
    const directory = 'reports/sdar-gowm-shared-storage-integration-v0.1';
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/postgres-task-workflow-results.json`,
      JSON.stringify(
        {
          status: 'PASS',
          scope: 'Repository subset only; normal Server/MCP smoke remains pending',
          acceptanceStatus: 'INCOMPLETE',
          knownContractGaps: ['auxiliary-link-contract-gap.json'],
          run,
          results,
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'PASS', run, scenarios: results.length, scope: 'repository-subset-only' })}\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'GOWM_POSTGRES_TEST_FAILED'}\n`,
    );
    process.exitCode = 1;
  } finally {
    await Promise.all([pool.end(), fixturePool.end(), peerPool.end()]);
  }
}
