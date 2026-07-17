import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyRuntimeMigrations } from '../src/runtime.js';
import {
  RemoteTaskContinuationService,
  RemoteTaskPollingService,
  SkillCallWorkflowService,
  WorkflowExecutionService,
  WorkflowValidator,
  type RemoteTaskPollJob,
  type RemoteTaskPollJobState,
  type RemoteTaskPollQueue,
  type RemoteTaskContinuationJob,
  type RemoteTaskReadResult,
  type RemoteTaskSnapshotReader,
} from '../../../packages/application/src/index.js';
import {
  createRemoteTaskBinding,
  createSkillVersion,
  type RemoteTaskAdmission,
  type RuntimeExecutionContext,
  type WorkflowDefinition,
  type WorkflowMcpCallOutcome,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  LangGraphWorkflowExecutor,
  type WorkflowRuntimePorts,
} from '../../../packages/langgraph-runtime/src/index.js';
import {
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresSkillRepository,
  PostgresWorkflowContinuationRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowPlanRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import {
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskContinuationWorker,
  ContextSerialExecutor,
  type RedisConnectionConfig,
} from '../../../packages/runtime-redis/src/index.js';

const databaseName = 'sdar_v11_remote_composition_integration';
const adminConnection = 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = `postgresql://sdar:sdar_local_only@127.0.0.1:55432/${databaseName}`;
const redis: RedisConnectionConfig = { host: '127.0.0.1', port: 56379 };
const timestamp = '2026-07-17T08:00:00.000Z';
const resources: { close(): Promise<void> }[] = [];
let pool: Pool;
let initializedPool: Pool | undefined;

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminConnection });
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
  pool = new Pool({ connectionString: databaseConnection, max: 8 });
  initializedPool = pool;
  const bootstrap = await readFile(
    new URL('../../../infra/postgres/init/0001_sdar_bootstrap.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(bootstrap);
  await applyRuntimeMigrations(pool, {
    profile: 'v1.1-isolated',
    isolationAcknowledged: true,
  });
}, 60_000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE remote_task_input_attempt,remote_task_input_link,remote_task_cancel_attempt,
       remote_task_cancel_request,task_availability_snapshot,task_execution_readiness,
       workflow_continuation_attempt,workflow_continuation_wait_binding,
       workflow_continuation_snapshot,remote_task_protocol_attempt,remote_task_control_event,
       remote_task_observation,remote_task_binding,skill_call_workflow,workflow_node_event,
       workflow_instance,mcp_invocation,workflow_plan_attempt,workflow_control,agent_task,
       workflow_plan,skill_version,skill,mcp_tool,mcp_server,goal,conversation_context CASCADE`,
  );
});

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

afterAll(async () => {
  await initializedPool?.end();
  const admin = new Pool({ connectionString: adminConnection });
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

describe('remote MCP Task composition acceptance', () => {
  it('keeps two bindings independent and invokes their parallel join once after both complete', async () => {
    const authority = await seedAuthority('parallel');
    const definition = parallelDefinition(authority.goalId);
    const plans = new PostgresWorkflowPlanRepository(pool);
    await saveConfirmedPlan(plans, authority, 'parallel-plan', definition);
    await seedWorkflowControl(authority, 'parallel-plan');
    const remoteTasks = new PostgresRemoteTaskRepository(pool);
    const joinCalls = vi.fn(() => immediate({ joined: true }));
    const execution = workflowExecution(plans, remoteTasks, authority, definition, joinCalls);

    const initial = await execution.execute({
      instanceId: 'parallel-instance',
      planId: 'parallel-plan',
      input: {},
      continuationAuthority: authority,
      executionContext: { mode: 'live' },
    });

    expect(initial.status).toBe('waiting_external');
    const continuations = new PostgresWorkflowContinuationRepository(pool);
    const firstSnapshot = await continuations.findCurrent(initial.instanceId);
    expect(firstSnapshot).toMatchObject({ stateVersion: 1, lifecycle: 'active' });
    expect(firstSnapshot?.waitingNodeRuns.map((wait) => wait.sourceId).sort()).toEqual([
      'parallel-binding-left',
      'parallel-binding-right',
    ]);
    expect(joinCalls).not.toHaveBeenCalled();

    const queueName = `sdar-composition-parallel-${randomUUID()}`;
    const continuationQueue = new BullMqRemoteTaskContinuationQueue({
      connection: redis,
      queueName,
    });
    const service = continuationService(continuations, remoteTasks, execution);
    const worker = new BullMqRemoteTaskContinuationWorker({
      connection: redis,
      queueName,
      concurrency: 1,
      processor: service,
    });
    resources.push(worker, continuationQueue);
    worker.start();

    const leftEvent = await completeRemoteTask(remoteTasks, 'parallel-binding-left', 'left');
    await continuationQueue.enqueue(leftEvent);
    await waitFor(async () => (await continuationQueue.state(leftEvent.eventId)) === 'completed');

    const afterLeft = await execution.get(initial.instanceId);
    expect(afterLeft?.status).toBe('waiting_external');
    const secondSnapshot = await continuations.findCurrent(initial.instanceId);
    expect(secondSnapshot).toMatchObject({
      stateVersion: 2,
      predecessorSnapshotId: firstSnapshot?.snapshotId,
    });
    expect(secondSnapshot?.waitingNodeRuns).toEqual([
      expect.objectContaining({ sourceId: 'parallel-binding-right', state: 'waiting' }),
    ]);
    expect(joinCalls).not.toHaveBeenCalled();

    await continuationQueue.enqueue(leftEvent);
    await waitFor(async () => (await continuationQueue.state(leftEvent.eventId)) === 'completed');
    expect(joinCalls).not.toHaveBeenCalled();
    await expect(continuations.listAttempts(initial.instanceId)).resolves.toHaveLength(1);

    const rightEvent = await completeRemoteTask(remoteTasks, 'parallel-binding-right', 'right');
    await continuationQueue.enqueue(rightEvent);
    await waitFor(async () => (await continuationQueue.state(rightEvent.eventId)) === 'completed');

    await expect(execution.get(initial.instanceId)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(joinCalls).toHaveBeenCalledTimes(1);
    await expect(continuations.findCurrent(initial.instanceId)).resolves.toBeUndefined();
    await expect(continuations.listAttempts(initial.instanceId)).resolves.toEqual([
      expect.objectContaining({ status: 'waiting_external', snapshotStateVersion: 1 }),
      expect.objectContaining({ status: 'succeeded', snapshotStateVersion: 2 }),
    ]);
    const events = await new PostgresWorkflowExecutionRepository(pool).listNodeEvents(
      initial.instanceId,
    );
    expect(
      events.filter((event) => event.nodeId === 'join' && event.eventType === 'node_started'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.nodeId === 'join' && event.eventType === 'node_succeeded'),
    ).toHaveLength(1);
    await expect(remoteTasks.listControlEvents('parallel-binding-left')).resolves.toHaveLength(1);
    await expect(remoteTasks.listControlEvents('parallel-binding-right')).resolves.toHaveLength(1);
  }, 30_000);

  it('completes a remote-waiting child Skill before propagating its validated result to the parent', async () => {
    const authority = await seedAuthority('child');
    const plans = new PostgresWorkflowPlanRepository(pool);
    const skills = new PostgresSkillRepository(pool);
    const skill = createSkillVersion({
      skillId: 'remote-child-skill',
      version: 1,
      name: 'Remote child Skill',
      summary: 'Runs one remote child operation.',
      description: 'Integration fixture for persisted child continuation lineage.',
      capabilities: ['remote-child'],
      workflowGuidance: 'Run the registered remote operation once.',
      outputInstruction: 'Return the remote structured result.',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['child'],
        properties: { child: { const: 'done' } },
      },
      toolPolicy: {
        required: [{ serverId: authority.serverId, toolName: 'remote' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: true },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: timestamp,
    });
    await skills.saveVersionAndSetCurrent(skill, timestamp);
    const childDefinition = childDefinitionFor(authority.goalId);
    const parentDefinition = parentDefinitionFor(authority.goalId, skill.skillId);
    await saveConfirmedPlan(plans, authority, 'child-plan', childDefinition);
    await saveConfirmedPlan(plans, authority, 'parent-plan', parentDefinition);
    await seedWorkflowControl(authority, 'parent-plan');

    const remoteTasks = new PostgresRemoteTaskRepository(pool);
    const lineage = new PostgresSkillCallWorkflowRepository(pool);
    const ports = runtimePorts(
      async (input) => {
        if (input.workflowNodeId !== 'child-remote') throw new Error('UNEXPECTED_REMOTE_NODE');
        await seedInvocation(
          authority,
          'child-invocation',
          input.executionId,
          input.executionContext,
        );
        const binding = createRemoteTaskBinding({
          ...remoteAdmission(authority, {
            bindingId: 'child-binding',
            workflowPlanId: 'child-plan',
            workflowDefinitionId: childDefinition.workflowDefinitionId,
            workflowInstanceId: input.executionId,
            workflowNodeId: input.workflowNodeId,
            workflowNodeRunId: input.workflowNodeRunId,
            mcpInvocationId: 'child-invocation',
          }),
          parentWorkflowInstanceId: 'parent-instance',
          parentSkillCallId: 'child-skill-call',
        });
        await remoteTasks.admit(binding, 'child-admission-observation');
        return externalWait(binding);
      },
      async (input) => {
        const child = await execution.execute({
          instanceId: 'child-instance',
          planId: 'child-plan',
          input: input.input,
          skillIds: [skill.skillId],
          continuationAuthority: authority,
          executionContext: input.executionContext,
        });
        expect(child.status).toBe('waiting_external');
        await lineage.save({
          callId: 'child-skill-call',
          parentPlanId: 'parent-plan',
          parentInstanceId: input.parentExecutionId,
          parentNodeId: input.parentNodeId,
          childInstanceId: child.instanceId,
          childPlanId: 'child-plan',
          skillId: skill.skillId,
          skillVersion: skill.version,
          confirmationStatus: 'confirmed',
          status: 'waiting_external',
          evaluationSummary: 'Child Workflow is waiting for its remote MCP Task.',
          createdAt: timestamp,
        });
        return {
          status: 'waiting_external' as const,
          wait: {
            waitId: `child-workflow-${child.instanceId}`,
            kind: 'child_workflow' as const,
            sourceId: child.instanceId,
            nodeId: input.parentNodeId,
            nodeRunId: input.parentNodeRunId,
            state: 'waiting' as const,
          },
        };
      },
    );
    const continuations = new PostgresWorkflowContinuationRepository(pool);
    const instances = new PostgresWorkflowExecutionRepository(pool);
    const validator = new WorkflowValidator({
      tools: new PostgresMcpRegistryRepository(pool, { v11TaskMetadata: true }),
      skills,
      schemas: new AjvJsonSchemaValidator(),
    });
    const execution = new WorkflowExecutionService({
      plans,
      instances,
      validator,
      executor: new LangGraphWorkflowExecutor(ports, callCosts),
      clock: advancingClock(),
      ids: { nextEventId: sequentialId('child-node-event') },
      continuationIds: {
        nextSnapshotId: sequentialId('child-snapshot'),
        nextContinuationId: sequentialId('child-continuation'),
      },
      continuations,
      skills,
      systemBudgetDefaults: budget,
    });

    const parent = await execution.execute({
      instanceId: 'parent-instance',
      planId: 'parent-plan',
      input: {},
      continuationAuthority: authority,
      executionContext: { mode: 'live' },
    });
    expect(parent.status).toBe('waiting_external');
    await expect(lineage.findByChildInstanceId('child-instance')).resolves.toMatchObject({
      callId: 'child-skill-call',
      parentInstanceId: 'parent-instance',
      parentNodeId: 'child-skill',
      childInstanceId: 'child-instance',
      status: 'waiting_external',
    });
    await expect(remoteTasks.findById('child-binding')).resolves.toMatchObject({
      parentWorkflowInstanceId: 'parent-instance',
      parentSkillCallId: 'child-skill-call',
      workflowInstanceId: 'child-instance',
    });

    const skillCalls = new SkillCallWorkflowService({
      skills,
      planner: { plan: () => Promise.reject(new Error('UNUSED_CHILD_PLANNER')) },
      validator,
      execution,
      plans,
      confirmation: { evaluate: () => Promise.reject(new Error('UNUSED_CONFIRMATION')) },
      records: lineage,
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata: () => Promise.resolve([]),
      clock: { now: () => '2026-07-17T08:01:00.000Z' },
      nextId: sequentialId('unused-child-id'),
    });
    const propagationOrder: string[] = [];
    const service = continuationService(
      continuations,
      remoteTasks,
      execution,
      async ({ instance }) => {
        const persistedChild = await instances.findInstance(instance.instanceId);
        expect(persistedChild?.status).toBe('succeeded');
        propagationOrder.push('child-persisted');
        const child = await skillCalls.completeExternalChild(instance);
        propagationOrder.push('lineage-completed');
        const parentSnapshot = await continuations.findCurrent(child.parentInstanceId);
        const parentWait = parentSnapshot?.waitingNodeRuns.find(
          (wait) =>
            wait.kind === 'child_workflow' &&
            wait.sourceId === child.childInstanceId &&
            wait.nodeId === child.parentNodeId,
        );
        if (parentSnapshot === undefined || parentWait === undefined)
          throw new Error('PARENT_CHILD_CONTINUATION_NOT_FOUND');
        await execution.continueExternal({
          instanceId: child.parentInstanceId,
          continuationAttemptId: 'parent-propagation-attempt',
          resolution:
            child.outcome.kind === 'completed'
              ? {
                  kind: 'completed',
                  waitId: parentWait.waitId,
                  nodeRunId: parentWait.nodeRunId,
                  result: child.outcome.result,
                }
              : {
                  kind: 'failed',
                  waitId: parentWait.waitId,
                  nodeRunId: parentWait.nodeRunId,
                  error: child.outcome.error,
                },
        });
        propagationOrder.push('parent-propagated');
      },
    );

    const event = await completeRemoteTask(remoteTasks, 'child-binding', 'child');
    const queueName = `sdar-composition-child-${randomUUID()}`;
    const continuationQueue = new BullMqRemoteTaskContinuationQueue({
      connection: redis,
      queueName,
    });
    const worker = new BullMqRemoteTaskContinuationWorker({
      connection: redis,
      queueName,
      concurrency: 1,
      processor: service,
    });
    resources.push(worker, continuationQueue);
    worker.start();
    await continuationQueue.enqueue(event);
    await waitFor(async () => (await continuationQueue.state(event.eventId)) === 'completed');

    expect(propagationOrder).toEqual(['child-persisted', 'lineage-completed', 'parent-propagated']);
    await expect(execution.get('child-instance')).resolves.toMatchObject({
      status: 'succeeded',
      result: { child: 'done' },
    });
    await expect(execution.get('parent-instance')).resolves.toMatchObject({
      status: 'succeeded',
      result: { child: 'done' },
    });
    await expect(lineage.findByChildInstanceId('child-instance')).resolves.toMatchObject({
      status: 'succeeded',
      evaluationSummary: expect.stringContaining('output passed'),
    });
    await expect(continuations.findCurrent('child-instance')).resolves.toBeUndefined();
    await expect(continuations.findCurrent('parent-instance')).resolves.toBeUndefined();
    await expect(continuations.listAttempts('child-instance')).resolves.toHaveLength(1);
    await continuationQueue.enqueue(event);
    await waitFor(async () => (await continuationQueue.state(event.eventId)) === 'completed');
    await expect(continuations.listAttempts('child-instance')).resolves.toHaveLength(1);
    const parentEvents = await instances.listNodeEvents('parent-instance');
    expect(
      parentEvents.filter(
        (nodeEvent) =>
          nodeEvent.nodeId === 'child-skill' && nodeEvent.eventType === 'node_succeeded',
      ),
    ).toHaveLength(1);
  }, 30_000);
});

const budget = {
  maxReplans: 3,
  maxDurationSeconds: 60,
  maxLlmCalls: 10,
  maxMcpCalls: 10,
  maxCost: 100,
};
const callCosts = { llm: 1, mcp: 1, skill: 1, subworkflow: 1 };

interface Authority {
  readonly agentTaskId: string;
  readonly contextId: string;
  readonly workflowControlId: string;
  readonly goalId: string;
  readonly serverId: string;
}

async function seedAuthority(suffix: string): Promise<Authority> {
  const authority = {
    agentTaskId: `${suffix}-agent-task`,
    contextId: `${suffix}-context`,
    workflowControlId: `${suffix}-control`,
    goalId: `${suffix}-goal`,
    serverId: `${suffix}-server`,
  };
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES($1,'integration-user',$2,$2)`,
    [authority.contextId, timestamp],
  );
  await pool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES($1,$2,1,'Composition Goal','Remote Task composition acceptance','active',$3,$3)`,
    [authority.goalId, authority.contextId, timestamp],
  );
  await pool.query(
    `INSERT INTO agent_task(task_id,context_id,user_id,request_text,request_metadata,phase,
                            phase_message,goal_id,goal_version,created_at,updated_at)
     VALUES($1,$2,'integration-user','Run composition acceptance','{}'::jsonb,'executing',
            'Composition execution active',$3,1,$4,$4)`,
    [authority.agentTaskId, authority.contextId, authority.goalId, timestamp],
  );
  await pool.query(
    `INSERT INTO mcp_server(server_id,name,endpoint,transport,status,tool_revision,
                            encrypted_credential,created_at,updated_at)
     VALUES($1,'Composition Provider','http://127.0.0.1:1','streamable_http','enabled',1,
            'encrypted-integration-value',$2,$2)`,
    [authority.serverId, timestamp],
  );
  for (const toolName of ['remote', 'join'])
    await pool.query(
      `INSERT INTO mcp_tool(server_id,tool_name,input_schema_json,discovered_at)
       VALUES($1,$2,'{"type":"object","additionalProperties":false}'::jsonb,$3)`,
      [authority.serverId, toolName, timestamp],
    );
  return authority;
}

async function seedWorkflowControl(authority: Authority, planId: string): Promise<void> {
  await pool.query(
    `INSERT INTO workflow_control(control_id,context_id,goal_id,goal_version,task_id,status,
                                  current_plan_id,input_json,skill_ids_json,planning_instruction,
                                  round_count,replan_count,created_at,updated_at)
     VALUES($1,$2,$3,1,$4,'running',$5,'{}'::jsonb,'[]'::jsonb,
            'Run composition acceptance',0,0,$6,$6)`,
    [
      authority.workflowControlId,
      authority.contextId,
      authority.goalId,
      authority.agentTaskId,
      planId,
      timestamp,
    ],
  );
}

async function saveConfirmedPlan(
  plans: PostgresWorkflowPlanRepository,
  authority: Authority,
  planId: string,
  definition: WorkflowDefinition,
): Promise<void> {
  await plans.savePlan({
    planId,
    goalId: authority.goalId,
    goalVersion: 1,
    goalContract: {
      goalId: authority.goalId,
      version: 1,
      title: 'Composition Goal',
      description: 'Remote Task composition acceptance',
      constraints: [],
      successCriteria: [],
    },
    definition,
    confirmationStatus: 'confirmed',
    attemptCount: 1,
    createdAt: timestamp,
  });
}

function parallelDefinition(goalId: string): WorkflowDefinition {
  return {
    workflowDefinitionId: 'parallel-remote-workflow',
    version: 1,
    goalId,
    goalVersion: 1,
    entryNodeId: 'parallel',
    exitNodeIds: ['join'],
    nodes: [
      {
        nodeId: 'parallel',
        name: 'Parallel remote operations',
        type: 'parallel',
        branchEntryNodeIds: ['left', 'right'],
      },
      {
        nodeId: 'left',
        name: 'Left remote operation',
        type: 'mcp_tool',
        tool: { serverId: 'parallel-server', toolName: 'remote' },
        arguments: {},
      },
      {
        nodeId: 'right',
        name: 'Right remote operation',
        type: 'mcp_tool',
        tool: { serverId: 'parallel-server', toolName: 'remote' },
        arguments: {},
      },
      {
        nodeId: 'join',
        name: 'Join remote results',
        type: 'mcp_tool',
        tool: { serverId: 'parallel-server', toolName: 'join' },
        arguments: {},
      },
    ],
    edges: [
      { sourceNodeId: 'parallel', targetNodeId: 'left' },
      { sourceNodeId: 'parallel', targetNodeId: 'right' },
      { sourceNodeId: 'left', targetNodeId: 'join' },
      { sourceNodeId: 'right', targetNodeId: 'join' },
    ],
  };
}

function childDefinitionFor(goalId: string): WorkflowDefinition {
  return {
    workflowDefinitionId: 'remote-child-workflow',
    version: 1,
    goalId,
    goalVersion: 1,
    entryNodeId: 'child-remote',
    exitNodeIds: ['child-result'],
    nodes: [
      {
        nodeId: 'child-remote',
        name: 'Child remote operation',
        type: 'mcp_tool',
        tool: { serverId: 'child-server', toolName: 'remote' },
        arguments: {},
      },
      {
        nodeId: 'child-result',
        name: 'Child result',
        type: 'result',
        value: {
          op: 'ref',
          path: ['outputs', 'child-remote', 'data', 'structuredContent'],
        },
      },
    ],
    edges: [{ sourceNodeId: 'child-remote', targetNodeId: 'child-result' }],
  };
}

function parentDefinitionFor(goalId: string, skillId: string): WorkflowDefinition {
  return {
    workflowDefinitionId: 'remote-parent-workflow',
    version: 1,
    goalId,
    goalVersion: 1,
    entryNodeId: 'child-skill',
    exitNodeIds: ['parent-result'],
    nodes: [
      {
        nodeId: 'child-skill',
        name: 'Invoke remote child Skill',
        type: 'skill_call',
        skillId,
        input: {},
      },
      {
        nodeId: 'parent-result',
        name: 'Parent result',
        type: 'result',
        value: { op: 'ref', path: ['outputs', 'child-skill'] },
      },
    ],
    edges: [{ sourceNodeId: 'child-skill', targetNodeId: 'parent-result' }],
  };
}

function workflowExecution(
  plans: PostgresWorkflowPlanRepository,
  remoteTasks: PostgresRemoteTaskRepository,
  authority: Authority,
  definition: WorkflowDefinition,
  joinCalls: () => WorkflowMcpCallOutcome,
): WorkflowExecutionService {
  const ports = runtimePorts(async (input) => {
    if (input.workflowNodeId === 'join') return joinCalls();
    const side = input.workflowNodeId === 'left' ? 'left' : 'right';
    const invocationId = `parallel-invocation-${side}`;
    await seedInvocation(authority, invocationId, input.executionId, input.executionContext);
    const binding = createRemoteTaskBinding(
      remoteAdmission(authority, {
        bindingId: `parallel-binding-${side}`,
        workflowPlanId: 'parallel-plan',
        workflowDefinitionId: definition.workflowDefinitionId,
        workflowInstanceId: input.executionId,
        workflowNodeId: input.workflowNodeId,
        workflowNodeRunId: input.workflowNodeRunId,
        mcpInvocationId: invocationId,
      }),
    );
    await remoteTasks.admit(binding, `parallel-admission-${side}`);
    return externalWait(binding);
  });
  const skills = new PostgresSkillRepository(pool);
  const continuations = new PostgresWorkflowContinuationRepository(pool);
  return new WorkflowExecutionService({
    plans,
    instances: new PostgresWorkflowExecutionRepository(pool),
    validator: new WorkflowValidator({
      tools: new PostgresMcpRegistryRepository(pool, { v11TaskMetadata: true }),
      skills,
      schemas: new AjvJsonSchemaValidator(),
    }),
    executor: new LangGraphWorkflowExecutor(ports, callCosts),
    clock: advancingClock(),
    ids: { nextEventId: sequentialId('parallel-node-event') },
    continuationIds: {
      nextSnapshotId: sequentialId('parallel-snapshot'),
      nextContinuationId: sequentialId('parallel-continuation'),
    },
    continuations,
    skills,
    systemBudgetDefaults: budget,
  });
}

function runtimePorts(
  callMcpTool: WorkflowRuntimePorts['callMcpTool'],
  executeSkill: WorkflowRuntimePorts['executeSkill'] = () =>
    Promise.reject(new Error('UNEXPECTED_SKILL_CALL')),
): WorkflowRuntimePorts {
  let tick = 0;
  return {
    executeLlm: () => Promise.reject(new Error('UNEXPECTED_LLM_CALL')),
    callMcpTool,
    executeSkill,
    executeSubworkflow: () => Promise.reject(new Error('UNEXPECTED_SUBWORKFLOW_CALL')),
    requestHumanConfirmation: () => Promise.reject(new Error('UNEXPECTED_CONFIRMATION')),
    decideExecutionError: () =>
      Promise.resolve({ strategy: 'terminate', summary: 'Fail closed in composition acceptance.' }),
    now: () => new Date(Date.parse(timestamp) + tick++ * 10).toISOString(),
    nowMilliseconds: () => tick * 10,
  };
}

function remoteAdmission(
  authority: Authority,
  overrides: Pick<
    RemoteTaskAdmission,
    | 'bindingId'
    | 'workflowPlanId'
    | 'workflowDefinitionId'
    | 'workflowInstanceId'
    | 'workflowNodeId'
    | 'workflowNodeRunId'
    | 'mcpInvocationId'
  >,
): RemoteTaskAdmission {
  return {
    ...overrides,
    serverId: authority.serverId,
    operationName: 'remote',
    remoteTaskId: `provider-${overrides.bindingId}`,
    agentTaskId: authority.agentTaskId,
    contextId: authority.contextId,
    goalId: authority.goalId,
    goalVersion: 1,
    workflowDefinitionVersion: 1,
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'tasks-schema-revision-1',
    providerSubstate: 'queued',
    remoteRevision: 'provider-revision-1',
    executionContext: { mode: 'live' },
    credentialRevision: 'credential-revision-1',
    sessionRevision: 'session-revision-1',
    lastProviderUpdatedAt: timestamp,
    pollIntervalMs: 100,
    nextPollAt: timestamp,
    createdAt: timestamp,
  };
}

function externalWait(binding: ReturnType<typeof createRemoteTaskBinding>): WorkflowMcpCallOutcome {
  return {
    kind: 'waiting_external',
    wait: {
      waitId: binding.bindingId,
      kind: 'remote_task',
      sourceId: binding.bindingId,
      nodeId: binding.workflowNodeId,
      nodeRunId: binding.workflowNodeRunId,
      state: 'waiting',
    },
  };
}

function immediate(value: Readonly<Record<string, unknown>>): WorkflowMcpCallOutcome {
  return { kind: 'immediate', result: { ...value, content: [], isError: false } };
}

async function seedInvocation(
  authority: Authority,
  invocationId: string,
  _executionId: string,
  executionContext: RuntimeExecutionContext,
): Promise<void> {
  void _executionId;
  await pool.query(
    `INSERT INTO mcp_invocation(invocation_id,task_id,context_id,server_id,tool_name,
                                arguments_json,result_json,status,started_at,completed_at,
                                duration_ms,execution_mode,simulation_id)
     VALUES($1,$2,$3,$4,'remote','{}'::jsonb,'{"kind":"remote_task"}'::jsonb,
            'succeeded',$5,$5,0,$6,$7)`,
    [
      invocationId,
      authority.agentTaskId,
      authority.contextId,
      authority.serverId,
      timestamp,
      executionContext.mode,
      executionContext.simulationId ?? null,
    ],
  );
}

async function completeRemoteTask(
  remoteTasks: PostgresRemoteTaskRepository,
  bindingId: string,
  marker: string,
): Promise<RemoteTaskContinuationJob & { eventType: 'task.completed' }> {
  const binding = await remoteTasks.findById(bindingId);
  if (binding === undefined) throw new Error(`BINDING_NOT_FOUND:${bindingId}`);
  const polling = new RemoteTaskPollingService({
    repository: remoteTasks,
    queue: new RecordingPollQueue(),
    reader: new SequenceReader([
      {
        kind: 'snapshot',
        snapshot: {
          remoteTaskId: binding.remoteTaskId,
          status: 'completed',
          createdAt: binding.createdAt,
          lastUpdatedAt: '2026-07-17T08:00:30.000Z',
          ttlMs: 3_600_000,
          protocolRevision: binding.protocolRevision,
          tasksSchemaRevision: binding.tasksSchemaRevision,
          providerObservation: {
            revision: '1.0',
            remoteRevision: `provider-terminal-${marker}`,
            eventId: `provider-event-${marker}`,
          },
          result: {
            content: [],
            structuredContent: marker === 'child' ? { child: 'done' } : { [marker]: 'done' },
            isError: false,
          },
        },
      },
    ]),
    serial: new ContextSerialExecutor(),
    clock: { now: () => '2026-07-17T08:00:31.000Z' },
    ids: {
      nextObservationId: sequentialId(`${marker}-poll-observation`),
      nextControlEventId: sequentialId(`${marker}-control`),
      nextClaimToken: sequentialId(`${marker}-poll-claim`),
      nextProtocolAttemptId: sequentialId(`${marker}-protocol-attempt`),
    },
    hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    options: {
      minimumPollIntervalMs: 100,
      providerFailureBackoffBaseMs: 100,
      providerFailureBackoffMaximumMs: 100,
      claimLeaseMs: 1_000,
    },
  });
  await expect(polling.process({ bindingId, expectedVersion: binding.version })).resolves.toBe(
    'control_pending',
  );
  const [control] = await remoteTasks.listControlEvents(bindingId);
  if (control?.type !== 'task.completed')
    throw new Error(`COMPLETED_CONTROL_NOT_FOUND:${bindingId}`);
  return { eventId: control.eventId, bindingId, eventType: control.type };
}

function continuationService(
  continuations: PostgresWorkflowContinuationRepository,
  remoteTasks: PostgresRemoteTaskRepository,
  execution: WorkflowExecutionService,
  onContinued?: ConstructorParameters<typeof RemoteTaskContinuationService>[0]['onContinued'],
): RemoteTaskContinuationService {
  return new RemoteTaskContinuationService({
    continuations,
    remoteTasks,
    execution,
    serial: new ContextSerialExecutor(),
    clock: advancingClock(),
    ids: {
      nextClaimToken: sequentialId('continuation-claim'),
      nextAttemptId: sequentialId('continuation-attempt'),
    },
    ...(onContinued === undefined ? {} : { onContinued }),
  });
}

function advancingClock(): { now(): string } {
  let tick = 0;
  return {
    now: () => new Date(Date.parse(timestamp) + tick++ * 1_000).toISOString(),
  };
}

function sequentialId(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${String(++sequence)}`;
}

class SequenceReader implements RemoteTaskSnapshotReader {
  readonly #results: RemoteTaskReadResult[];

  constructor(results: readonly RemoteTaskReadResult[]) {
    this.#results = [...results];
  }

  readRemoteTask(): Promise<RemoteTaskReadResult> {
    const result = this.#results.shift();
    if (result === undefined) throw new Error('REMOTE_TASK_READER_SEQUENCE_EXHAUSTED');
    return Promise.resolve(result);
  }
}

class RecordingPollQueue implements RemoteTaskPollQueue {
  enqueue(_job: RemoteTaskPollJob, _runAt: string): Promise<void> {
    void _job;
    void _runAt;
    return Promise.resolve();
  }

  state(): Promise<RemoteTaskPollJobState> {
    return Promise.resolve('missing');
  }

  listDeadLetters(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  retryDeadLetter(): Promise<void> {
    return Promise.reject(new Error('REMOTE_TASK_DEAD_LETTER_NOT_FOUND'));
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('REMOTE_COMPOSITION_WAIT_TIMEOUT');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}
