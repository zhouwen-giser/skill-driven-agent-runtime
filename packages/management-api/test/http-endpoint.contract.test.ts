import { afterEach, describe, expect, it } from 'vitest';

import {
  startManagementHttpEndpoint,
  type ManagementHttpEndpointHandle,
  type ManagementOperations,
} from '../src/index.js';

describe('management HTTP API contract', () => {
  let endpoint: ManagementHttpEndpointHandle | undefined;

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
  });

  it('reads and updates the unified Task wait timeout', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskWaitTimeouts: {
          getPolicy: () =>
            Promise.resolve({ timeoutSeconds: 300, updatedAt: '2026-07-12T00:00:00.000Z' }),
          updatePolicy: (timeoutSeconds) =>
            Promise.resolve({ timeoutSeconds, updatedAt: '2026-07-12T00:01:00.000Z' }),
        },
      },
    });
    await expect(
      (await fetch(`${endpoint.baseUrl}/api/v1/system/task-wait-policy`)).json(),
    ).resolves.toMatchObject({ timeoutSeconds: 300 });
    const update = await fetch(`${endpoint.baseUrl}/api/v1/system/task-wait-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutSeconds: 60 }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ timeoutSeconds: 60 });
  });

  it('exposes persisted processed-result evidence by Task', async () => {
    const configured = operations();
    const result = {
      resultId: 'processed-result-1',
      taskId: 'task-1',
      skillId: 'skill-1',
      skillVersion: 1,
      normalized: {
        data: { status: 'online' },
        errors: [],
        originalSize: 19,
        contextValue: { status: 'online' },
        contextTruncated: false,
        summary: 'Successful result with 19 JSON characters.',
      },
      output: { text: 'Online.', structured: { status: 'online' } },
      facts: [{ name: 'status', value: 'online', confidence: 1 }],
      valuable: true,
      valueSummary: 'Useful.',
      memoryCandidates: [{ kind: 'fact' as const, content: 'Online.', confidence: 1 }],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        resultProcessing: {
          get: () => Promise.resolve(result),
          list: () => Promise.resolve([result]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/processed-results`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ valuable: true })] });
  });

  it('advertises the trusted-intranet no-auth risk and returns credential-free MCP data', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const health = await fetch(`${endpoint.baseUrl}/api/v1/health`);
    expect(health.headers.get('x-sdar-security-warning')).toBe('trusted-intranet-only-no-auth');
    await expect(health.json()).resolves.toEqual({
      status: 'ok',
      authentication: 'none',
      deployment: 'trusted-intranet-only',
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`);
    expect(JSON.stringify(await response.json())).not.toContain('credential');
  });

  it('rejects invalid external input with a stable error envelope before application calls', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId: '', endpoint: 'file:///tmp/server', credentialHeaders: {} }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'REQUEST_VALIDATION_FAILED' },
    });
  });

  it('does not expose unexpected infrastructure error details', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations(true) });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`);
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('MANAGEMENT_INTERNAL_ERROR');
    expect(body).not.toContain('database-password');
  });

  it('fails explicitly instead of using a fallback when no authoring model is configured', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/skills/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_AUTHORING_MODEL_NOT_CONFIGURED' },
    });
  });

  it('fails explicitly when semantic and final selection providers are not configured', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/skill-selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Inspect a device.' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_SELECTION_MODEL_NOT_CONFIGURED' },
    });
  });

  it('exposes the same confirmed-plan state through confirmation and execution endpoints', async () => {
    const configured = operations();
    const confirm = (planId: string) =>
      Promise.resolve({
        planId,
        goalId: 'goal-1',
        goalVersion: 1,
        confirmationStatus: 'confirmed' as const,
        attemptCount: 1,
        createdAt: '2026-07-12T00:00:00.000Z',
      });
    const execute = (input: { instanceId: string; planId: string; input: unknown }) =>
      Promise.resolve({
        instanceId: input.instanceId,
        planId: input.planId,
        workflowDefinitionId: 'workflow-1',
        workflowVersion: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        skillVersions: [],
        budgetLimits: {
          maxReplans: 3,
          maxDurationSeconds: 60,
          maxLlmCalls: 10,
          maxMcpCalls: 10,
          maxCost: 100,
        },
        budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
        status: 'succeeded' as const,
        input: input.input,
        errors: {},
        startedAt: '2026-07-12T00:00:00.000Z',
        completedAt: '2026-07-12T00:00:01.000Z',
      });
    endpoint = await startManagementHttpEndpoint({
      operations: { ...configured, workflows: { ...configured.workflows, confirm, execute } },
    });
    const confirmation = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/confirm`, {
      method: 'POST',
    });
    expect(confirmation.status).toBe(200);
    await expect(confirmation.json()).resolves.toMatchObject({
      planId: 'plan-1',
      confirmationStatus: 'confirmed',
    });
    const execution = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'instance-1', input: { request: 'run' } }),
    });
    expect(execution.status).toBe(201);
    await expect(execution.json()).resolves.toMatchObject({
      instanceId: 'instance-1',
      planId: 'plan-1',
      status: 'succeeded',
    });
  });

  it('exposes persisted human-confirmation resume for a paused Workflow instance', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          resumeHumanConfirmation: ({ instanceId, confirmed }) =>
            Promise.resolve({
              instanceId,
              planId: 'plan-1',
              workflowDefinitionId: 'workflow-1',
              workflowVersion: 1,
              goalId: 'goal-1',
              goalVersion: 1,
              skillVersions: [],
              budgetLimits: {
                maxReplans: 3,
                maxDurationSeconds: 60,
                maxLlmCalls: 10,
                maxMcpCalls: 10,
                maxCost: 100,
              },
              budgetUsage: {
                replanCount: 0,
                durationMs: 2,
                llmCalls: 0,
                mcpCalls: 1,
                cost: 1,
              },
              status: 'succeeded' as const,
              input: {},
              result: confirmed,
              errors: {},
              startedAt: '2026-07-12T00:00:00.000Z',
              completedAt: '2026-07-12T00:00:02.000Z',
            }),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/workflows/instances/instance-1/human-confirmation`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instanceId: 'instance-1',
      status: 'succeeded',
      result: true,
    });
  });

  it('exposes plan-scoped pause, resume, and cancel execution controls', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          pauseForPlan: (planId) => Promise.resolve(workflowInstance(planId, 'paused')),
          resumePauseForPlan: (planId) =>
            Promise.resolve({
              disposition: 'resumed' as const,
              instance: workflowInstance(planId, 'succeeded'),
            }),
          cancelForPlan: (planId) => Promise.resolve(workflowInstance(planId, 'canceled')),
        },
      },
    });
    for (const [action, status] of [
      ['pause', 'paused'],
      ['resume', 'succeeded'],
      ['cancel', 'canceled'],
    ] as const) {
      const response = await fetch(
        `${endpoint.baseUrl}/api/v1/workflows/plans/plan-control/${action}`,
        { method: 'POST' },
      );
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain(status);
    }
  });

  it('exposes Goal creation and the persisted outer-control entry point', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goals: {
          ...configured.goals,
          create: (input) =>
            Promise.resolve({
              ...input,
              constraints: input.constraints ?? [],
              successCriteria: input.successCriteria ?? [],
              version: 1,
              status: 'active' as const,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            }),
        },
        workflowControls: {
          ...configured.workflowControls,
          start: (input) =>
            Promise.resolve({
              ...input,
              status: 'awaiting_confirmation' as const,
              currentPlanId: input.initialPlanId,
              roundCount: 1,
              replanCount: 1,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:01.000Z',
            }),
        },
      },
    });
    const goal = await fetch(`${endpoint.baseUrl}/api/v1/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goalId: 'goal-1',
        contextId: 'context-1',
        title: 'Goal',
        description: 'Complete the task.',
      }),
    });
    expect(goal.status).toBe(201);
    await expect(goal.json()).resolves.toMatchObject({ goalId: 'goal-1', status: 'active' });
    const control = await fetch(`${endpoint.baseUrl}/api/v1/workflow-controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        controlId: 'control-1',
        contextId: 'context-1',
        goalId: 'goal-1',
        goalVersion: 1,
        initialPlanId: 'plan-1',
        input: {},
        skillIds: ['skill-1'],
        planningInstruction: 'Complete the task.',
      }),
    });
    expect(control.status).toBe(201);
    await expect(control.json()).resolves.toMatchObject({
      controlId: 'control-1',
      status: 'awaiting_confirmation',
      replanCount: 1,
    });
  });

  it('exposes Goal Patch apply and history contracts', async () => {
    const configured = operations();
    const patch = {
      patchId: 'patch-1',
      goalId: 'goal-1',
      fromVersion: 1,
      toVersion: 2,
      instruction: 'Add temperature.',
      changes: { successCriteria: ['Return temperature.'] },
      decisionSummary: 'Added temperature.',
      compensationWarnings: ['No automatic compensation was attempted.'],
      invalidatedPlanIds: ['plan-1'],
      invalidatedInstanceIds: ['instance-1'],
      newPlanId: 'plan-2',
      beforeGoal: goalRecord(1),
      afterGoal: { ...goalRecord(1), version: 2 },
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goalPatches: {
          apply: () => Promise.resolve(patch),
          get: () => Promise.resolve(patch),
          list: () => Promise.resolve([patch]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/patches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePlanId: 'plan-1', instruction: 'Add temperature.' }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      patchId: 'patch-1',
      toVersion: 2,
      newPlanId: 'plan-2',
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/patches`).then((value) => value.json()),
    ).resolves.toMatchObject({ items: [{ patchId: 'patch-1' }] });
  });

  it('exposes ordered Goal and relationship history for a context', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goals: {
          ...configured.goals,
          history: () =>
            Promise.resolve({
              goals: [goalRecord(1)],
              transitions: [
                {
                  transitionId: 'transition-1',
                  contextId: 'context-1',
                  fromGoalId: 'goal-old',
                  toGoalId: 'goal-1',
                  relationship: 'related_successor',
                  decisionSummary: 'Related next phase.',
                  requestText: 'Continue.',
                  createdAt: '2026-07-12T00:00:00.000Z',
                },
              ],
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/contexts/context-1/goals`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      goals: [expect.objectContaining({ goalId: 'goal-1' })],
      transitions: [expect.objectContaining({ relationship: 'related_successor' })],
    });
  });

  it('exposes Goal cancellation and immutable cancellation history', async () => {
    const configured = operations();
    const record = {
      cancellationId: 'goal-cancellation-1',
      goalId: 'goal-1',
      goalVersion: 1,
      reason: 'Operator canceled.',
      canceledTaskIds: ['task-1'],
      invalidatedPlanIds: ['plan-1'],
      canceledInstanceIds: ['instance-1'],
      warnings: ['No automatic compensation ran.'],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goalCancellations: {
          cancel: () => Promise.resolve(record),
          get: () => Promise.resolve(record),
          list: () => Promise.resolve([record]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator canceled.' }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject(record);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/cancellations`).then((value) => value.json()),
    ).resolves.toMatchObject({ items: [record] });
  });

  it('exposes task-plan binding and validated admin plan revision contracts', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        tasks: {
          ...configured.tasks,
          attachPlan: (taskId, input) =>
            Promise.resolve({
              taskId,
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Inspect.',
              requestMetadata: {},
              phase: 'awaiting_plan_confirmation' as const,
              phaseMessage: 'Plan confirmation required.',
              goalId: input.goalId,
              goalVersion: input.goalVersion,
              planId: input.planId,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            }),
          followUp: (input) =>
            Promise.resolve({
              taskId: input.taskId,
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Inspect.',
              requestMetadata: {},
              phase:
                input.action === 'confirm_plan'
                  ? ('executing' as const)
                  : input.action === 'reject_plan'
                    ? ('canceled' as const)
                    : ('awaiting_plan_confirmation' as const),
              phaseMessage: `Action ${input.action}.`,
              goalId: 'goal-1',
              goalVersion: 1,
              planId: input.action === 'revise_plan' ? 'plan-2' : 'plan-1',
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:01.000Z',
            }),
        },
        workflowRevisions: {
          ...configured.workflowRevisions,
          reviseAdmin: (input) =>
            Promise.resolve({
              planId: input.newPlanId,
              goalId: 'goal-1',
              goalVersion: 1,
              sourcePlanId: input.sourcePlanId,
              revisionKind:
                input.format === 'dsl' ? ('admin_dsl' as const) : ('admin_dag' as const),
              confirmationStatus: 'awaiting_confirmation' as const,
              attemptCount: 1,
              createdAt: '2026-07-12T00:00:00.000Z',
            }),
        },
      },
    });
    const attached = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/plan`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: 'plan-1', goalId: 'goal-1', goalVersion: 1 }),
    });
    expect(attached.status).toBe(200);
    await expect(attached.json()).resolves.toMatchObject({ taskId: 'task-1', planId: 'plan-1' });
    const confirmed = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_plan', messageText: 'Confirm.' }),
    });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({ phase: 'executing' });

    const revised = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPlanId: 'plan-2', format: 'dag', definition: { nodes: [] } }),
    });
    expect(revised.status).toBe(201);
    await expect(revised.json()).resolves.toMatchObject({
      planId: 'plan-2',
      sourcePlanId: 'plan-1',
      revisionKind: 'admin_dag',
      confirmationStatus: 'awaiting_confirmation',
    });
  });

  it('creates and semantically searches source-traceable global memories', async () => {
    const configured = operations();
    const item = {
      memoryId: 'memory-1',
      type: 'fact' as const,
      content: { deviceId: 'device-17' },
      summary: 'The target device is device-17.',
      status: 'active' as const,
      sourceRefs: ['task-source'],
      supersedes: [],
      confidence: 0.9,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        memories: {
          create: () => Promise.resolve(item),
          get: () => Promise.resolve(item),
          search: () => Promise.resolve([{ item, score: 1 }]),
        },
        goalInputInference: {
          list: () =>
            Promise.resolve([
              {
                inferenceId: 'inference-1',
                taskId: 'task-1',
                contextId: 'context-1',
                outcome: 'inferred' as const,
                decisionSummary: 'Memory identified device-17.',
                usedSources: [
                  {
                    sourceId: 'memory:memory-1',
                    kind: 'global_memory' as const,
                    summary: item.summary,
                    content: item.content,
                  },
                ],
                inferredGoal: {
                  title: 'Inspect',
                  description: 'Inspect device-17.',
                  constraints: [],
                  successCriteria: ['Inspected'],
                },
                createdAt: item.createdAt,
              },
            ]),
        },
      },
    });
    const created = await fetch(`${endpoint.baseUrl}/api/v1/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'fact',
        content: { deviceId: 'device-17' },
        summary: item.summary,
        sourceRefs: ['task-source'],
        confidence: 0.9,
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject(item);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/memories/search?q=target%20device&limit=5`).then((value) =>
        value.json(),
      ),
    ).resolves.toMatchObject({ items: [{ item: { memoryId: 'memory-1' }, score: 1 }] });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/input-inferences`).then((value) =>
        value.json(),
      ),
    ).resolves.toMatchObject({
      items: [{ outcome: 'inferred', usedSources: [{ sourceId: 'memory:memory-1' }] }],
    });
  });
});

function operations(failServerList = false): ManagementOperations {
  const unused = () => Promise.reject(new Error('UNEXPECTED_OPERATION'));
  return {
    goals: { create: unused, get: unused, history: unused },
    goalPatches: { apply: unused, get: unused, list: () => Promise.resolve([]) },
    goalCancellations: { cancel: unused, get: unused, list: () => Promise.resolve([]) },
    tasks: { attachPlan: unused, followUp: unused, get: unused },
    taskWaitTimeouts: { getPolicy: unused, updatePolicy: unused },
    resultProcessing: { get: unused, list: () => Promise.resolve([]) },
    memories: { create: unused, get: unused, search: () => Promise.resolve([]) },
    goalInputInference: { list: () => Promise.resolve([]) },
    graph: {
      create: unused,
      delete: unused,
      list: () => Promise.resolve([]),
    },
    mcp: {
      checkHealth: unused,
      delete: unused,
      listDependencyWarnings: () => Promise.resolve([]),
      listInvocations: () => Promise.resolve([]),
      listServers: () =>
        failServerList
          ? Promise.reject(new Error('database-password leaked by driver'))
          : Promise.resolve([
              {
                serverId: 'mcp.devices',
                name: 'Devices',
                endpoint: 'https://mcp.example.test/mcp',
                transport: 'streamable_http',
                status: 'enabled',
                toolRevision: 1,
                createdAt: '2026-07-11T10:00:00.000Z',
                updatedAt: '2026-07-11T10:00:00.000Z',
              },
            ]),
      listTools: () => Promise.resolve([]),
      refresh: unused,
      register: unused,
      updateToolEnhancement: unused,
      updateCredentials: unused,
    },
    models: {
      configureProvider: unused,
      listInvocations: () => Promise.resolve([]),
      route: unused,
    },
    prompts: {
      create: unused,
      disable: unused,
      effect: unused,
      listVersions: () => Promise.resolve([]),
      publish: unused,
      rollback: unused,
    },
    skills: {
      diff: unused,
      listCurrentVersions: () => Promise.resolve([]),
      listVersions: () => Promise.resolve([]),
      register: unused,
      rollback: unused,
      setEnabled: unused,
    },
    temporarySkills: {
      complete: unused,
      create: unused,
      listByTask: () => Promise.resolve([]),
    },
    workflows: {
      cancelForPlan: unused,
      confirm: unused,
      execute: unused,
      pauseForPlan: unused,
      resumeHumanConfirmation: unused,
      resumePauseForPlan: unused,
      plan: unused,
      validate: () => Promise.resolve({ valid: false, errors: [] }),
    },
    workflowControls: {
      continueAfterConfirmation: unused,
      get: unused,
      listRounds: () => Promise.resolve([]),
      start: unused,
    },
    workflowRevisions: { get: unused, reviseAdmin: unused },
  };
}

function goalRecord(version: number) {
  return {
    goalId: 'goal-1',
    contextId: 'context-1',
    version,
    title: 'Goal',
    description: 'Complete it.',
    constraints: [],
    successCriteria: [],
    status: 'active' as const,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function workflowInstance(planId: string, status: 'paused' | 'succeeded' | 'canceled') {
  return {
    instanceId: 'instance-control',
    planId,
    workflowDefinitionId: 'workflow-control',
    workflowVersion: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
    status,
    input: {},
    errors: {},
    startedAt: '2026-07-12T00:00:00.000Z',
    ...(status === 'paused'
      ? {
          pendingConfirmation: {
            nodeId: 'next',
            prompt: 'Paused.',
            kind: 'task_pause' as const,
            pausedAt: '2026-07-12T00:00:01.000Z',
          },
        }
      : { completedAt: '2026-07-12T00:00:02.000Z' }),
  };
}
