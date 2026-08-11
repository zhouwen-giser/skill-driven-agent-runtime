import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Task, TaskState } from '@a2a-js/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HOME_LAB_A2A_READ_ONLY_TURNS,
  assertMcpInvocations,
  assertModelRuntimeReady,
  assertReadOnlyPlan,
  runHomeLabA2AReadOnly,
  structuredOutcome,
  validateTurns,
} from '../src/home-lab-a2a-read-only-driver.js';

const timestamp = '2026-08-10T12:00:00.000Z';
const requiredModelStages = [
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
] as const;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('home-lab A2A read-only safety gates', () => {
  it('rejects a replaced write intent before any network or A2A client access', async () => {
    const request = vi.fn<typeof fetch>();
    const createA2AClient = vi.fn();
    const turns = HOME_LAB_A2A_READ_ONLY_TURNS.map((turn, index) =>
      index === 0 ? { ...turn, toolName: 'light_set_power' } : turn,
    );

    await expect(
      runHomeLabA2AReadOnly(
        { ...baseConfiguration('execute'), turns },
        { fetch: request, createA2AClient },
      ),
    ).rejects.toMatchObject({ code: 'A2A_WRITE_INTENT_FORBIDDEN' });
    expect(request).not.toHaveBeenCalled();
    expect(createA2AClient).not.toHaveBeenCalled();
  });

  it('fails before Node Control mutation when Model authority is absent', async () => {
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.pathname === '/api/v1/health') return Promise.resolve(json({ status: 'ok' }));
      if (url.pathname === '/api/v1/models/providers') return Promise.resolve(json({ items: [] }));
      if (url.pathname === '/api/v1/models/routes') return Promise.resolve(json({ items: [] }));
      throw new Error(`UNEXPECTED_REQUEST:${url.pathname}`);
    });
    const createA2AClient = vi.fn();

    await expect(
      runHomeLabA2AReadOnly(baseConfiguration('execute'), { fetch: request, createA2AClient }),
    ).rejects.toMatchObject({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' });
    expect(createA2AClient).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([input]) => requestUrl(input).origin)).toEqual([
      'http://127.0.0.1:29998',
      'http://127.0.0.1:29998',
      'http://127.0.0.1:29998',
    ]);
  });

  it('requires every cognitive route to use an enabled Provider', () => {
    expect(() => assertModelRuntimeReady([], [])).toThrow(
      expect.objectContaining({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' }),
    );
    expect(() =>
      assertModelRuntimeReady(
        [{ providerId: 'provider-1', enabled: true }],
        requiredModelStages.slice(1).map((stage) => ({ stage, providerId: 'provider-1' })),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_MODEL_RUNTIME_NOT_CONFIGURED' }));
    expect(
      assertModelRuntimeReady(
        [{ providerId: 'provider-1', enabled: true }],
        requiredModelStages.map((stage) => ({ stage, providerId: 'provider-1' })),
      ),
    ).toEqual({ configuredProviderCount: 1 });
  });

  it('admits exactly one qualified read Tool and rejects LLM or write nodes', () => {
    const turn = HOME_LAB_A2A_READ_ONLY_TURNS[0];
    if (turn === undefined) throw new Error('LIGHT_TURN_MISSING');
    const nodes = [
      { type: 'mcp_tool', tool: { serverId: turn.serverId, toolName: turn.toolName } },
      { type: 'condition' },
      { type: 'result' },
      { type: 'error_handler' },
    ];
    expect(() => {
      assertReadOnlyPlan({ definition: { nodes } }, turn);
    }).not.toThrow();
    expect(() => {
      assertReadOnlyPlan({ definition: { nodes: [...nodes, { type: 'llm' }] } }, turn);
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));
    expect(() => {
      assertReadOnlyPlan(
        {
          definition: {
            nodes: [
              {
                type: 'mcp_tool',
                tool: { serverId: turn.serverId, toolName: 'light_set_power' },
              },
            ],
          },
        },
        turn,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_PLAN_UNQUALIFIED_OPERATION' }));
  });

  it('rejects side-effecting or evidence-free MCP records even under the read Tool name', () => {
    const turn = HOME_LAB_A2A_READ_ONLY_TURNS[0];
    if (turn === undefined) throw new Error('LIGHT_TURN_MISSING');
    const output = stateFor('light');
    const invocation = providerInvocation(turn, output);
    expect(() => {
      assertMcpInvocations({ items: [invocation] }, turn, output);
    }).not.toThrow();
    expect(() => {
      assertMcpInvocations(
        {
          items: [
            {
              ...invocation,
              executionSemantics: { ...invocation.executionSemantics, effect: 'side_effecting' },
            },
          ],
        },
        turn,
        output,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_MCP_EVIDENCE_INVALID' }));
    expect(() => {
      assertMcpInvocations(
        { items: [{ ...invocation, result: { ...invocation.result, evidence: [] } }] },
        turn,
        output,
      );
    }).toThrow(expect.objectContaining({ code: 'A2A_MCP_EVIDENCE_INVALID' }));
  });

  it('accepts only the requested public resource state and rejects physical entity identity', () => {
    const turn = HOME_LAB_A2A_READ_ONLY_TURNS[0];
    if (turn === undefined) throw new Error('LIGHT_TURN_MISSING');
    const output = stateFor('light');
    expect(structuredOutcome(a2aTask('light'), turn)).toEqual(output);
    expect(() =>
      structuredOutcome(a2aTask('light', { ...output, resourceId: 'another-light' }), turn),
    ).toThrow(expect.objectContaining({ code: 'A2A_RESOURCE_IDENTITY_MISMATCH' }));
    expect(() =>
      structuredOutcome(
        a2aTask('light', { ...output, entityId: 'light.private_physical_id' }),
        turn,
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_SENSITIVE_EVIDENCE_FORBIDDEN' }));
  });

  it('keeps the two-turn scenario immutable', () => {
    expect(validateTurns(HOME_LAB_A2A_READ_ONLY_TURNS)).toEqual(HOME_LAB_A2A_READ_ONLY_TURNS);
  });
});

describe('home-lab A2A restart recovery', () => {
  it('re-queries stable getTask, cognitive/runtime evidence, and immutable bindings after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdar-g08-a2a-'));
    temporaryDirectories.push(directory);
    const checkpointFile = join(directory, 'checkpoint.json');
    const scenario = restartScenario();
    await writeFile(checkpointFile, `${JSON.stringify(scenario.checkpoint, null, 2)}\n`, 'utf8');
    const getTask = vi.fn(({ id }: Readonly<{ id: string }>) => {
      const task = scenario.tasks.get(id);
      if (task === undefined) throw new Error(`TASK_NOT_FOUND:${id}`);
      return Promise.resolve(task);
    });
    const sendMessage = vi.fn();
    const createA2AClient = vi.fn(() => Promise.resolve({ getTask, sendMessage }));
    const requestedPaths: string[] = [];
    const request = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      requestedPaths.push(`${url.origin}${url.pathname}${url.search}`);
      if (url.origin === 'http://127.0.0.1:29998')
        return Promise.resolve(runtimeResponse(url, scenario));
      if (url.origin === 'http://127.0.0.1:20080') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer node-control-token');
        return Promise.resolve(nodeControlResponse(url, scenario));
      }
      throw new Error(`UNEXPECTED_ORIGIN:${url.origin}`);
    });

    const report = await runHomeLabA2AReadOnly(
      {
        ...baseConfiguration('verify-restart'),
        checkpointFile,
        restartEvidenceId: 'runtime-restart-evidence-1',
      },
      { fetch: request, createA2AClient, now: () => timestamp },
    );

    expect(report).toMatchObject({
      status: 'passed',
      mode: 'verify-restart',
      a2aReadOnlyReady: true,
      restartRecoveryVerified: true,
      contextId: 'context-g08',
      modelAuthority: { configuredProviderCount: 1, failedInvocationCount: 0 },
      safety: { writeOperationsInvoked: 0, physicalWritesInvoked: 0 },
    });
    expect(report.turns).toHaveLength(2);
    expect(getTask).toHaveBeenCalledTimes(4);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(requestedPaths).toEqual(
      expect.arrayContaining([
        'http://127.0.0.1:29998/api/v1/tasks/task-light/understanding',
        'http://127.0.0.1:29998/api/v1/mcp/invocations?taskId=task-light',
        'http://127.0.0.1:20080/api/v1/tasks/task-light',
        'http://127.0.0.1:20080/api/v1/tasks/task-light/capability-binding',
      ]),
    );
    expect(
      request.mock.calls.every(([, init]) => init?.method === undefined || init.method === 'GET'),
    ).toBe(true);
  });
});

function baseConfiguration(mode: 'execute' | 'verify-restart') {
  return {
    mode,
    a2aBaseUrl: 'http://127.0.0.1:29999',
    runtimeManagementBaseUrl: 'http://127.0.0.1:29998',
    nodeControlBaseUrl: 'http://127.0.0.1:20080',
    nodeControlBearerToken: 'node-control-token',
    runId: 'goal-run-g08-unit',
    pollIntervalMs: 10,
    maxPolls: 2,
  } as const;
}

function restartScenario() {
  const tasks = new Map<string, Task>();
  const turns = HOME_LAB_A2A_READ_ONLY_TURNS.map((turn) => {
    const taskId = `task-${turn.kind}`;
    const goalId = `goal-${turn.kind}`;
    const planId = `plan-${turn.kind}`;
    const task = a2aTask(turn.kind, undefined, taskId);
    tasks.set(taskId, task);
    const output = stateFor(turn.kind);
    const taskSnapshot = {
      id: task.id,
      contextId: task.contextId,
      state: task.status?.state,
      internalPhase: task.metadata?.['internalPhase'],
      outputHash: sha256(canonical(output)),
    };
    return {
      kind: turn.kind,
      taskId,
      contextId: 'context-g08',
      goalId,
      goalVersion: 1,
      planId,
      capabilityId: turn.capabilityId,
      exposureId: turn.exposureId,
      skillId: turn.skillId,
      serverId: turn.serverId,
      operationName: turn.toolName,
      resourceId: turn.resourceId,
      a2aTaskHash: sha256(canonical(taskSnapshot)),
      structuredOutcomeHash: sha256(canonical(output)),
      capabilityBindingHash: turn.kind === 'light' ? 'a'.repeat(64) : 'b'.repeat(64),
    };
  });
  return {
    tasks,
    checkpoint: {
      schemaVersion: 'sdar.home-lab-a2a-checkpoint/v1',
      runId: 'goal-run-g08-unit',
      createdAt: timestamp,
      contextId: 'context-g08',
      turns,
    },
  };
}

type RestartScenario = ReturnType<typeof restartScenario>;

function runtimeResponse(url: URL, scenario: RestartScenario): Response {
  if (url.pathname === '/api/v1/health') return json({ status: 'ok' });
  if (url.pathname === '/api/v1/models/providers')
    return json({ items: [{ providerId: 'provider-1', enabled: true }] });
  if (url.pathname === '/api/v1/models/routes')
    return json({
      items: requiredModelStages.map((stage) => ({ stage, providerId: 'provider-1' })),
    });
  const taskId = pathCapture(url.pathname, /^\/api\/v1\/tasks\/([^/]+)$/u);
  if (taskId !== undefined) {
    const saved = savedTurn(scenario, taskId);
    return json({
      taskId,
      contextId: saved.contextId,
      phase: 'completed',
      goalId: saved.goalId,
      goalVersion: saved.goalVersion,
      planId: saved.planId,
      selectedSkillId: saved.skillId,
      selectedSkillVersion: 1,
      output: { text: 'Current state.', structured: stateFor(saved.kind) },
    });
  }
  const understandingTaskId = pathCapture(
    url.pathname,
    /^\/api\/v1\/tasks\/([^/]+)\/understanding$/u,
  );
  if (understandingTaskId !== undefined) {
    const saved = savedTurn(scenario, understandingTaskId);
    return json({
      taskId: understandingTaskId,
      disposition: 'contract_candidate',
      modelInvocationId: `model-understanding-${saved.kind}`,
      capabilityRequirements: [
        { capabilityId: saved.capabilityId, required: true, available: true },
      ],
    });
  }
  const eventTaskId = pathCapture(url.pathname, /^\/api\/v1\/tasks\/([^/]+)\/events$/u);
  if (eventTaskId !== undefined) return json({ items: [{ taskId: eventTaskId }] });
  const goalId = pathCapture(url.pathname, /^\/api\/v1\/goals\/([^/]+)$/u);
  if (goalId !== undefined) {
    const saved = scenario.checkpoint.turns.find((turn) => turn.goalId === goalId);
    if (saved === undefined) throw new Error(`GOAL_NOT_FOUND:${goalId}`);
    return json({
      goalId,
      contextId: saved.contextId,
      version: saved.goalVersion,
      status: 'achieved',
    });
  }
  const tracePlanId = pathCapture(url.pathname, /^\/api\/v1\/workflows\/plans\/([^/]+)\/trace$/u);
  if (tracePlanId !== undefined)
    return json({
      instance: { planId: tracePlanId, status: 'succeeded' },
      events: [{ nodeId: 'read', eventType: 'node_succeeded' }],
    });
  const planId = pathCapture(url.pathname, /^\/api\/v1\/workflows\/plans\/([^/]+)$/u);
  if (planId !== undefined) {
    const saved = scenario.checkpoint.turns.find((turn) => turn.planId === planId);
    if (saved === undefined) throw new Error(`PLAN_NOT_FOUND:${planId}`);
    return json({
      planId,
      definition: {
        nodes: [
          {
            nodeId: 'read',
            type: 'mcp_tool',
            tool: { serverId: saved.serverId, toolName: saved.operationName },
          },
          { nodeId: 'result', type: 'result' },
        ],
      },
    });
  }
  if (url.pathname === '/api/v1/models/invocations')
    return json({
      items: requiredModelStages.map((stage) => ({ stage, status: 'succeeded' })),
    });
  if (url.pathname === '/api/v1/mcp/invocations') {
    const saved = savedTurn(scenario, url.searchParams.get('taskId') ?? '');
    return json({
      items: [
        providerInvocation(
          {
            serverId: saved.serverId,
            toolName: saved.operationName,
            resourceId: saved.resourceId,
            kind: saved.kind,
          },
          stateFor(saved.kind),
        ),
      ],
    });
  }
  throw new Error(`UNEXPECTED_RUNTIME_REQUEST:${url.pathname}${url.search}`);
}

function nodeControlResponse(url: URL, scenario: RestartScenario): Response {
  const bindingTaskId = pathCapture(
    url.pathname,
    /^\/api\/v1\/tasks\/([^/]+)\/capability-binding$/u,
  );
  if (bindingTaskId !== undefined) {
    const saved = savedTurn(scenario, bindingTaskId);
    return json({
      taskId: bindingTaskId,
      requestedCapabilityId: saved.capabilityId,
      capabilityVersion: 1,
      exposureId: saved.exposureId,
      exposureVersion: 1,
      initialImplementationRefs: [`skill:${saved.skillId}:1`],
      bindingHash: saved.capabilityBindingHash,
    });
  }
  const taskId = pathCapture(url.pathname, /^\/api\/v1\/tasks\/([^/]+)$/u);
  if (taskId !== undefined) return json({ taskId });
  throw new Error(`UNEXPECTED_NODE_CONTROL_REQUEST:${url.pathname}`);
}

function savedTurn(scenario: RestartScenario, taskId: string) {
  const saved = scenario.checkpoint.turns.find((turn) => turn.taskId === taskId);
  if (saved === undefined) throw new Error(`SAVED_TURN_NOT_FOUND:${taskId}`);
  return saved;
}

function a2aTask(
  kind: 'light' | 'climate',
  output = stateFor(kind),
  taskId = `task-${kind}`,
): Task {
  return Task.fromJSON({
    id: taskId,
    contextId: 'context-g08',
    status: { state: TaskState.TASK_STATE_COMPLETED, timestamp },
    artifacts: [
      {
        artifactId: `${taskId}:result`,
        name: 'result',
        parts: [{ data: output, mediaType: 'application/json' }],
      },
    ],
    metadata: { internalPhase: 'completed' },
  });
}

function stateFor(kind: 'light' | 'climate'): Readonly<Record<string, unknown>> {
  if (kind === 'light')
    return {
      resourceId: 'living-room-main-light',
      power: 'on',
      reachable: true,
      brightnessPercent: 72,
      observedAt: timestamp,
    };
  return {
    resourceId: 'living-room-air-conditioner',
    power: 'on',
    reachable: true,
    hvacMode: 'cool',
    currentTemperature: 25.2,
    targetTemperature: 24,
    temperatureUnit: 'C',
    observedAt: timestamp,
  };
}

function providerInvocation(
  turn: Readonly<{
    serverId: string;
    toolName: string;
    resourceId: string;
    kind: 'light' | 'climate';
  }>,
  output: Readonly<Record<string, unknown>>,
) {
  return {
    invocationId: `invocation-${turn.kind}`,
    executionMode: 'live',
    serverId: turn.serverId,
    toolName: turn.toolName,
    status: 'succeeded',
    executionSemantics: { effect: 'read_only' },
    arguments: { resourceId: turn.resourceId },
    result: {
      structuredContent: output,
      isError: false,
      evidence: [
        {
          evidenceId: `evidence-${turn.kind}`,
          evidenceType:
            turn.kind === 'light' ? 'light.state.observation' : 'climate.state.observation',
          observedAt: timestamp,
          payloadRef: { kind: 'structured_content', jsonPointer: '' },
        },
      ],
    },
  } as const;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  throw new Error('REQUEST_URL_INVALID');
}

function pathCapture(pathname: string, pattern: RegExp): string | undefined {
  return pattern.exec(pathname)?.[1];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}
