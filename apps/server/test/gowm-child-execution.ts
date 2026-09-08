import assert from 'node:assert/strict';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import { readFile } from 'node:fs/promises';
import { createSkillVersion } from '../../../packages/domain/src/index.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { WorkflowDefinition, WorkflowPlanRecord } from '../../../packages/domain/src/index.js';
import {
  WorkflowExecutionService,
  WorkflowValidator,
  SubworkflowExecutionService,
  SkillCallWorkflowService,
  WorkflowPlannerService,
  SkillCompositionPlanner,
  TransitiveSkillConfirmationEvaluator,
} from '../../../packages/application/src/index.js';
import {
  LangGraphWorkflowExecutor,
  type WorkflowRuntimePorts,
} from '../../../packages/langgraph-runtime/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  PostgresWorkflowContinuationRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowChildCallRepository,
  PostgresSkillRepository,
  PostgresSkillGraphRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresMcpRegistryRepository,
} from '../../../packages/persistence-postgres/src/index.js';

/** Real LangGraph + application services and shared PG; no Server/API or MCP claim. */
export async function verifyGowmChildExecution(
  pool: Pool,
  taskIds: readonly string[],
  kind: 'subworkflow' | 'skill' = 'subworkflow',
) {
  const run = `gowm-${kind}-child-${randomUUID()}`;
  const rows = await pool.query<{
    task_id: string;
    device_id: string;
    sdar_service_key: string;
    plan_id: string;
  }>(
    `SELECT DISTINCT ON(t.task_id) t.task_id,t.device_id,t.sdar_service_key,p.plan_id FROM agent_task t JOIN workflow_plan p ON p.gowm_task_id=t.task_id WHERE t.task_id=ANY($1::text[]) AND p.source_confirmed_plan_id IS NULL ORDER BY t.task_id,p.created_at LIMIT 2`,
    [taskIds],
  );
  assert.equal(rows.rows.length, 2);
  assert.notEqual(rows.rows[0]?.device_id, rows.rows[1]?.device_id);
  const results = [];
  for (const row of rows.rows) {
    const scope = {
      allowedDeviceIds: [row.device_id],
      sdarServiceKey: row.sdar_service_key,
      includeNonDevice: false,
    };
    const plans = new PostgresWorkflowPlanRepository(pool, undefined, scope);
    const source = await plans.findPlan(row.plan_id);
    assert.ok(source);
    const skills = new PostgresSkillRepository(pool);
    const skillId = `${run}-${row.device_id}-skill`;
    if (kind === 'skill') {
      const outcome = {
        schemaVersion: '1.0' as const,
        skillId,
        skillVersion: 1,
        effects: ['effect.document.echo'],
        evidence: ['evidence.document.result'],
        artifacts: [],
        taskGoalPolicy: {},
        confidencePolicy: {},
        sideEffectPolicy: { classification: 'read_only' },
      };
      const skill = createSkillVersion({
        outcomeSpecification: { ...outcome, specificationHash: `sha256:${canonicalHash(outcome)}` },
        skillId,
        version: 1,
        name: 'Echo document',
        summary: 'Isolated child execution fixture',
        description: 'Return the supplied document unchanged.',
        capabilities: ['document.echo'],
        workflowGuidance: 'Return input.document.',
        outputInstruction: 'Return the document string.',
        inputSchema: {
          type: 'object',
          required: ['document'],
          properties: { document: { type: 'string' } },
          additionalProperties: false,
        },
        outputSchema: { type: 'string' },
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: true },
        status: 'enabled',
        sourceKind: 'admin',
        validationPassed: true,
        createdAt: new Date().toISOString(),
      });
      await skills.saveVersionAndSetCurrent(skill, skill.createdAt);
    }
    const childDefinition: WorkflowDefinition = {
      workflowDefinitionId: `${run}-${row.device_id}-child`,
      version: 1,
      executionSemanticsVersion: '2.0',
      goalId: source.goalId,
      goalVersion: source.goalVersion,
      entryNodeId: 'confirm',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'confirm',
          name: 'Review document',
          type: 'human_confirmation',
          prompt: 'Accept parsed document',
        },
        {
          nodeId: 'result',
          name: 'Parsed document',
          type: 'result',
          value: { op: 'literal', value: true },
        },
      ],
      edges: [
        { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'success' },
        { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'failure' },
      ],
    };
    const template: WorkflowPlanRecord = {
      planId: `${run}-${row.device_id}-template`,
      goalId: source.goalId,
      goalVersion: source.goalVersion,
      goalContract: source.goalContract,
      definition: childDefinition,
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: new Date().toISOString(),
    };
    await new PostgresWorkflowPlanRepository(pool, undefined, {
      ...scope,
      includeNonDevice: true,
    }).savePlan(template);
    const rootDefinition: WorkflowDefinition = {
      ...childDefinition,
      workflowDefinitionId: `${run}-${row.device_id}-root`,
      entryNodeId: 'child',
      nodes: [
        {
          nodeId: 'child',
          name: 'Parse child',
          ...(kind === 'skill'
            ? { type: 'skill_call' as const, skillId }
            : {
                type: 'subworkflow' as const,
                workflowDefinitionId: childDefinition.workflowDefinitionId,
                workflowVersion: 1,
              }),
          input: { document: 'fixture' },
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'ref', path: ['outputs', 'child'] },
        },
      ],
      edges: [{ sourceNodeId: 'child', targetNodeId: 'result' }],
    };
    const root = {
      ...template,
      planId: `${run}-${row.device_id}-plan`,
      executionTaskId: row.task_id,
      definition: rootDefinition,
    };
    await plans.savePlan(root);
    const instances = new PostgresWorkflowExecutionRepository(pool, undefined, scope);
    const calls = new PostgresWorkflowChildCallRepository(pool, scope);
    const skillRecords = new PostgresSkillCallWorkflowRepository(pool, scope);
    let skillInput: Parameters<SkillCallWorkflowService['execute']>[0] | undefined;
    let planningCalls = 0;
    let dispatches = 0;
    const unexpected = () => Promise.reject(new Error('UNEXPECTED_EXTERNAL_CALL'));
    const ports: WorkflowRuntimePorts = {
      executeLlm: unexpected,
      callMcpTool: unexpected,
      executeSkill: (request) => {
        dispatches++;
        skillInput = {
          skillId: request.skillId,
          value: request.input,
          parentPlanId: root.planId,
          parentInstanceId: request.parentExecutionId,
          parentNodeId: request.parentNodeId,
          parentNodeRunId: request.parentNodeRunId,
          parentGoalId: root.goalId,
          parentGoalVersion: root.goalVersion,
          executionContext: request.executionContext,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(request.resumeChild === undefined ? {} : { resumeChild: request.resumeChild }),
        };
        return skillCalls.execute(skillInput);
      },
      requestHumanConfirmation: unexpected,
      decideExecutionError: () =>
        Promise.resolve({ strategy: 'terminate', summary: 'Fixture execution error' }),
      now: () => new Date().toISOString(),
      nowMilliseconds: () => Date.now(),
      executeSubworkflow: (request) => {
        dispatches++;
        return subworkflows.execute({
          workflowDefinitionId: request.workflowDefinitionId,
          workflowVersion: request.workflowVersion,
          input: request.input,
          parentInstanceId: request.parentExecutionId,
          parentNodeId: request.parentNodeId,
          parentNodeRunId: request.parentNodeRunId,
          executionContext: request.executionContext,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(request.resumeChild === undefined ? {} : { resumeChild: request.resumeChild }),
        });
      },
    };
    const execution = new WorkflowExecutionService({
      plans,
      instances,
      childCalls: calls,
      continuations: new PostgresWorkflowContinuationRepository(pool, scope),
      continuationIds: {
        nextSnapshotId: () => randomUUID(),
        nextContinuationId: () => randomUUID(),
      },
      skills,
      validator: new WorkflowValidator({
        tools: new PostgresMcpRegistryRepository(pool, scope),
        skills,
        schemas: new AjvJsonSchemaValidator(),
      }),
      executor: new LangGraphWorkflowExecutor(ports, { llm: 1, mcp: 1, skill: 1, subworkflow: 1 }),
      clock: { now: () => new Date().toISOString() },
      ids: { nextEventId: () => randomUUID() },
      systemBudgetDefaults: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 2,
        maxMcpCalls: 2,
        maxCost: 10,
      },
    });
    const subworkflows = new SubworkflowExecutionService({
      calls,
      plans,
      execution,
      clock: { now: () => new Date().toISOString() },
    });
    const validator = new WorkflowValidator({
      tools: new PostgresMcpRegistryRepository(pool, scope),
      skills,
      schemas: new AjvJsonSchemaValidator(),
    });
    const graph = new PostgresSkillGraphRepository(pool);
    let modelCandidate: WorkflowDefinition | undefined;
    const planner = new WorkflowPlannerService({
      model: {
        generateStructured: (input) => {
          assert.equal(input.taskId, row.task_id);
          assert.ok(modelCandidate);
          planningCalls++;
          return Promise.resolve(modelCandidate);
        },
      },
      validator,
      repository: plans,
      workflowSchema: JSON.parse(
        await readFile('schemas/workflow-dsl.schema.json', 'utf8'),
      ) as unknown,
      clock: { now: () => new Date().toISOString() },
      maxAttempts: 1,
      composition: new SkillCompositionPlanner({ skills, graph }),
    });
    const skillCalls = new SkillCallWorkflowService({
      skills,
      plans,
      records: skillRecords,
      execution,
      validator,
      planner: {
        plan: (input) => {
          // Local model boundary fixture: real planner validates and persists its output.
          modelCandidate = {
            workflowDefinitionId: input.workflowDefinitionId,
            version: input.workflowVersion,
            goalId: input.goalId,
            goalVersion: input.goalVersion,
            executionSemanticsVersion: '2.0',
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Echo document',
                type: 'result',
                value: { op: 'ref', path: ['input', 'document'] },
              },
            ],
            edges: [],
          };
          return planner.plan(input);
        },
      },
      confirmation: new TransitiveSkillConfirmationEvaluator({ skills, graph }),
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata: () => Promise.resolve([]),
      clock: { now: () => new Date().toISOString() },
      nextId: () => randomUUID(),
    });
    const parent = await execution.execute({
      instanceId: `${run}-${row.device_id}-instance`,
      planId: root.planId,
      input: {},
    });
    assert.equal(
      parent.status,
      kind === 'skill' ? 'succeeded' : 'paused',
      JSON.stringify(parent.errors),
    );
    const links =
      kind === 'skill'
        ? await skillRecords.listByParent(parent.instanceId)
        : await calls.listByParent(parent.instanceId);
    assert.equal(links.length, 1);
    const link = links[0];
    assert.ok(link?.childInstanceId);
    const child = await execution.get(link.childInstanceId);
    assert.equal(child?.status, kind === 'skill' ? 'succeeded' : 'paused');
    assert.equal((await plans.findPlan(link.childPlanId))?.executionTaskId, row.task_id);
    const resumed =
      kind === 'skill'
        ? parent
        : await execution.resumeHumanConfirmation({
            instanceId: parent.instanceId,
            confirmed: true,
          });
    assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed.errors));
    assert.equal(resumed.result, kind === 'skill' ? 'fixture' : true);
    if (kind === 'skill') {
      assert.ok(skillInput);
      assert.deepEqual(await skillCalls.execute(skillInput), {
        status: 'completed',
        output: 'fixture',
      });
      assert.equal(planningCalls, 1);
      assert.equal((await skillRecords.listByParent(parent.instanceId)).length, 1);
    }
    const finalChild = await execution.get(link.childInstanceId);
    assert.equal(finalChild?.status, 'succeeded');
    if (kind === 'subworkflow')
      assert.equal((await calls.listByParent(parent.instanceId)).length, 1);
    assert.equal(finalChild.budgetUsage.mcpCalls, 0);
    assert.equal(finalChild.budgetUsage.llmCalls, 0);
    assert.equal(resumed.budgetUsage.cost, 1);
    const events = await instances.listNodeEvents(link.childInstanceId);
    assert.equal(
      events.filter((event) => event.nodeId === 'result' && event.eventType === 'node_started')
        .length,
      1,
    );
    assert.equal(
      events.filter((event) => event.nodeId === 'result' && event.eventType === 'node_succeeded')
        .length,
      1,
    );
    results.push({
      deviceId: row.device_id,
      parent: parent.instanceId,
      child: link.childInstanceId,
      dispatches,
      planningCalls,
      parentCost: resumed.budgetUsage.cost,
      status: resumed.status,
    });
  }
  return { run, results };
}
