import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSkillUsageSpecification,
  createSkillVersion,
  createRemoteTaskBinding,
  DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
  type EvolutionExperience,
  type RemoteTaskBinding,
  type SkillExecutionView,
} from '../../domain/src/index.js';

import {
  BearerCognitiveManagementAuthorizer,
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

  it('serves the unauthenticated console from the management process with the risk header', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sdar-console-'));
    try {
      await writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html><body>trusted-intranet-only-no-auth</body></html>',
        'utf8',
      );
      endpoint = await startManagementHttpEndpoint({
        operations: operations(),
        consoleDirectory: directory,
      });
      const response = await fetch(`${endpoint.baseUrl}/console`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-sdar-security-warning')).toBe('trusted-intranet-only-no-auth');
      await expect(response.text()).resolves.toContain('trusted-intranet-only-no-auth');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exposes workflow-template inventory and usage evidence', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const inventory = await fetch(`${endpoint.baseUrl}/api/v1/workflow-templates`);
    expect(inventory.status).toBe(200);
    await expect(inventory.json()).resolves.toEqual({ items: [] });
    const uses = await fetch(`${endpoint.baseUrl}/api/v1/workflow-templates/template-1/uses`);
    expect(uses.status).toBe(200);
    await expect(uses.json()).resolves.toEqual({ items: [] });
  });

  it('projects bounded P10 Gateway evidence without changing Task protocol semantics', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        gatewayEvidence: {
          findByTaskId: (taskId) =>
            Promise.resolve({
              decision: {
                decisionId: 'runtime-decision-1',
                requestId: 'request-1',
                path: 'denied',
                reasonCodes: ['GATEWAY_POLICY_DENY', 'GATEWAY_DENIED'],
              },
              record: {
                gatewayDecisionId: 'gateway-decision-1',
                requestId: 'request-1',
                reasonCodes: ['GATEWAY_POLICY_DENY', 'GATEWAY_DENIED'],
                stageResults: [{ stage: 'precheck', status: 'succeeded' }],
              },
              outboxRecorded: true,
              taskId,
            }),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/gateway-evidence`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      decision: { path: 'denied' },
      record: {
        reasonCodes: ['GATEWAY_POLICY_DENY', 'GATEWAY_DENIED'],
        stageResults: [{ stage: 'precheck', status: 'succeeded' }],
      },
      outboxRecorded: true,
    });
  });

  it('projects Business Event health, cursors, Inbox, impact and incidents without credentials', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        businessEvents: {
          start: () => Promise.resolve('started'),
          health: () => ({ providerId: 'mcp.devices', state: 'healthy', admitted: 2 }),
          listSubscriptions: () =>
            Promise.resolve([
              {
                subscriptionId: 'subscription-1',
                providerId: 'mcp.devices',
                lastDurablyAdmittedSequence: '2',
                lastProcessedSequence: '1',
              },
            ]),
          listInbox: () => Promise.resolve([{ inboxId: 'inbox-1', status: 'processed' }]),
          listAssessments: () =>
            Promise.resolve([
              { assessmentId: 'assessment-1', classification: 'current_task_goal' },
            ]),
          listIncidents: () =>
            Promise.resolve([{ incidentId: 'incident-1', incidentKind: 'continuity_loss' }]),
        },
        userGoalRuntime: {
          current: () =>
            Promise.resolve({
              plan: { planId: 'user-goal-plan-1', revision: 2, skillGoals: [] },
              outcomes: [{ outcomeDecisionId: 'judgment-1' }],
            }),
        },
      },
    });
    const health = await fetch(
      `${endpoint.baseUrl}/api/v1/business-events/providers/mcp.devices/health`,
    );
    await expect(health.json()).resolves.toMatchObject({
      enabled: true,
      health: { state: 'healthy' },
    });
    const reconnect = await fetch(
      `${endpoint.baseUrl}/api/v1/business-events/providers/mcp.devices/reconnect`,
      { method: 'POST' },
    );
    expect(reconnect.status).toBe(202);
    await expect(reconnect.json()).resolves.toMatchObject({ disposition: 'started' });
    for (const [path, id] of [
      ['subscriptions', 'subscription-1'],
      ['inbox', 'inbox-1'],
      ['impact-assessments', 'assessment-1'],
      ['incidents', 'incident-1'],
    ] as const) {
      const response = await fetch(`${endpoint.baseUrl}/api/v1/business-events/${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(id);
    }
    const plan = await fetch(
      `${endpoint.baseUrl}/api/v1/goals/goal-1/user-goal-plan?goalVersion=1`,
    );
    expect(plan.status).toBe(200);
    await expect(plan.text()).resolves.toContain('judgment-1');
  });

  it('reads and rebuilds the hash-matched Capability Summary with a bounded Level-0 index', async () => {
    const view = capabilitySummaryView();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        capabilities: {
          getSummary: () => Promise.resolve(view),
          getById: (summaryId) =>
            Promise.resolve(view.summary.summaryId === summaryId ? view : undefined),
          rebuild: () => Promise.resolve(view),
        },
      },
    });

    const read = await fetch(
      `${endpoint.baseUrl}/api/v1/capabilities/summary?maxEntries=8&maxCharacters=4096`,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual(view);
    const historical = await fetch(
      `${endpoint.baseUrl}/api/v1/capabilities/summary/${view.summary.summaryId}`,
    );
    expect(historical.status).toBe(200);
    await expect(historical.json()).resolves.toEqual(view);
    const rebuild = await fetch(`${endpoint.baseUrl}/api/v1/capabilities/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        idempotencyKey: 'summary-rebuild-1',
        actorId: 'operator-1',
        reason: 'Refresh the reviewed capability catalog projection.',
      }),
    });
    expect(rebuild.status).toBe(200);
    await expect(rebuild.json()).resolves.toEqual(view);
  });

  it('reads and rebuilds the activated Public Capability Card snapshot', async () => {
    const card = capabilityCardSnapshot();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        capabilityCards: {
          findActive: () => Promise.resolve(card),
          findById: (cardId) => Promise.resolve(card.cardId === cardId ? card : undefined),
          publish: () => Promise.resolve(card),
        },
      },
    });

    const read = await fetch(`${endpoint.baseUrl}/api/v1/capabilities/card`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual(card);
    const historical = await fetch(`${endpoint.baseUrl}/api/v1/capabilities/card/${card.cardId}`);
    expect(historical.status).toBe(200);
    await expect(historical.json()).resolves.toEqual(card);
    const rebuild = await fetch(`${endpoint.baseUrl}/api/v1/capabilities/card/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        idempotencyKey: 'card-rebuild-1',
        actorId: 'operator-1',
        reason: 'Publish the reviewed public card projection.',
      }),
    });
    expect(rebuild.status).toBe(200);
    await expect(rebuild.json()).resolves.toEqual(card);
  });

  it('reads the current Task Understanding and its immutable revision history', async () => {
    const understanding = taskUnderstandingSnapshot();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskUnderstandings: {
          findCurrent: () => Promise.resolve(understanding),
          listRevisions: () => Promise.resolve([understanding]),
        },
      },
    });

    const current = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/understanding`);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(understanding);
    const revisions = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks/task-1/understanding/revisions`,
    );
    expect(revisions.status).toBe(200);
    await expect(revisions.json()).resolves.toEqual({ items: [understanding] });
  });

  it('reads an interactive Goal session and applies a CAS/idempotent action', async () => {
    const view = interactiveGoalSessionView();
    let received: unknown;
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        goalSessions: {
          getByTask: () => Promise.resolve(view),
          applyAction: (input) => {
            received = input;
            return Promise.resolve(view);
          },
        },
      },
    });

    const current = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/goal-session`);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(view);
    const applied = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/goal-session/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        idempotencyKey: 'input-1',
        actorId: 'operator-1',
        reason: 'Approve the reviewed Goal Contract.',
        action: 'accept',
        payload: {},
      }),
    });
    expect(applied.status).toBe(200);
    expect(received).toEqual({
      sessionId: 'goal-session-1',
      expectedVersion: 1,
      idempotencyKey: 'input-1',
      actorId: 'operator-1',
      action: 'accept',
      payload: { managementReason: 'Approve the reviewed Goal Contract.' },
    });
  });

  it('optionally bearer-authenticates cognitive writes before any application mutation', async () => {
    const applyAction = vi.fn().mockResolvedValue(interactiveGoalSessionView());
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        goalSessions: {
          getByTask: () => Promise.resolve(interactiveGoalSessionView()),
          applyAction,
        },
      },
      cognitiveManagementAuthorizer: new BearerCognitiveManagementAuthorizer('b'.repeat(32)),
    });
    const body = JSON.stringify({
      expectedVersion: 1,
      idempotencyKey: 'bearer-action-1',
      actorId: 'operator-1',
      reason: 'Approve the reviewed Goal Contract.',
      action: 'accept',
      payload: {},
    });
    const unauthorized = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks/task-1/goal-session/actions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    );
    expect(unauthorized.status).toBe(401);
    expect(applyAction).not.toHaveBeenCalled();

    const authorized = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/goal-session/actions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${'b'.repeat(32)}`,
        'content-type': 'application/json',
      },
      body,
    });
    expect(authorized.status).toBe(200);
    expect(applyAction).toHaveBeenCalledTimes(1);
  });

  it('reads an interactive planning session and applies a CAS/idempotent plan patch', async () => {
    const view = interactivePlanningSessionView();
    let received: unknown;
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        planningSessions: {
          getByTask: () => Promise.resolve(view),
          applyAction: (input) => {
            received = input;
            return Promise.resolve(view);
          },
        },
      },
    });

    const current = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/planning-session`);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(view);
    const applied = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks/task-1/planning-session/actions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 1,
          idempotencyKey: 'planning-input-1',
          actorId: 'operator-1',
          reason: 'Apply the reviewed plan correction.',
          action: 'patch',
          payload: { instruction: 'Prioritize inspection evidence.' },
        }),
      },
    );
    expect(applied.status).toBe(200);
    expect(received).toEqual({
      sessionId: 'planning-session-1',
      expectedVersion: 1,
      idempotencyKey: 'planning-input-1',
      actorId: 'operator-1',
      action: 'patch',
      payload: {
        instruction: 'Prioritize inspection evidence.',
        managementReason: 'Apply the reviewed plan correction.',
      },
    });
  });

  it('reads immutable planning interactions and propagates user-scoped preference deletion', async () => {
    let deletion: unknown;
    const interactions = {
      corrections: [
        {
          correctionId: 'correction-1',
          taskId: 'task-1',
          scope: 'user',
          userId: 'user-1',
          correctionType: 'wrong_priority',
        },
      ],
      episodes: [{ episodeId: 'interaction-1', taskId: 'task-1', revision: 1 }],
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        planningInteractions: {
          listTaskInteractions: () => Promise.resolve(interactions as never),
          deleteUserScopedProjection: (userId, actorId) => {
            deletion = { userId, actorId };
            return Promise.resolve(1);
          },
        },
      },
    });

    const current = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/planning-interactions`);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(interactions);
    const deleted = await fetch(`${endpoint.baseUrl}/api/v1/users/user-1/planning-preferences`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId: 'privacy-operator' }),
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: 1 });
    expect(deletion).toEqual({ userId: 'user-1', actorId: 'privacy-operator' });
  });

  it('lists immutable Goal Episodes and manually replays inspectable Experience dead letters', async () => {
    const received: unknown[] = [];
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        experience: {
          getEpisode: (episodeId) =>
            Promise.resolve(
              episodeId === 'goal-episode-1'
                ? ({ episodeId: 'goal-episode-1', goalId: 'goal-1' } as never)
                : undefined,
            ),
          listEpisodes: (goalId, limit) => {
            received.push({ action: 'listEpisodes', goalId, limit });
            return Promise.resolve([{ episodeId: 'goal-episode-1', goalId: 'goal-1' }] as never);
          },
          listDeadLetters: (limit) => {
            received.push({ action: 'listDeadLetters', limit });
            return Promise.resolve([{ deadLetterId: 'dead-1', jobId: 'job-1' }] as never);
          },
          listObservations: (goalId, limit) => {
            received.push({ action: 'listObservations', goalId, limit });
            return Promise.resolve([
              { observationId: 'observation-1', sourceEpisodeIds: ['goal-episode-1'] },
            ] as never);
          },
          listReflections: (limit) => {
            received.push({ action: 'listReflections', limit });
            return Promise.resolve([
              { reflectionId: 'reflection-1', observationIds: ['observation-1'] },
            ] as never);
          },
          replayDeadLetter: (deadLetterId, actorId) => {
            received.push({ action: 'replayDeadLetter', deadLetterId, actorId });
            return Promise.resolve({ jobId: 'job-1', status: 'pending' } as never);
          },
        },
      },
    });

    const episodes = await fetch(
      `${endpoint.baseUrl}/api/v1/experience/episodes?goalId=goal-1&limit=20`,
    );
    expect(episodes.status).toBe(200);
    await expect(episodes.json()).resolves.toEqual({
      items: [{ episodeId: 'goal-episode-1', goalId: 'goal-1' }],
    });
    const episode = await fetch(`${endpoint.baseUrl}/api/v1/experience/episodes/goal-episode-1`);
    expect(episode.status).toBe(200);
    await expect(episode.json()).resolves.toEqual({
      episodeId: 'goal-episode-1',
      goalId: 'goal-1',
    });
    const deadLetters = await fetch(`${endpoint.baseUrl}/api/v1/experience/dead-letters?limit=10`);
    expect(deadLetters.status).toBe(200);
    await expect(deadLetters.json()).resolves.toEqual({
      items: [{ deadLetterId: 'dead-1', jobId: 'job-1' }],
    });
    const observations = await fetch(
      `${endpoint.baseUrl}/api/v1/experience/observations?goalId=goal-1&limit=30`,
    );
    expect(observations.status).toBe(200);
    await expect(observations.json()).resolves.toEqual({
      items: [{ observationId: 'observation-1', sourceEpisodeIds: ['goal-episode-1'] }],
    });
    const reflections = await fetch(`${endpoint.baseUrl}/api/v1/experience/reflections?limit=40`);
    expect(reflections.status).toBe(200);
    await expect(reflections.json()).resolves.toEqual({
      items: [{ reflectionId: 'reflection-1', observationIds: ['observation-1'] }],
    });
    const replay = await fetch(`${endpoint.baseUrl}/api/v1/experience/dead-letters/dead-1/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 0,
        idempotencyKey: 'dead-letter-replay-1',
        actorId: 'experience-operator',
        reason: 'Replay after correcting the recorded extractor failure.',
      }),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ jobId: 'job-1', status: 'pending' });
    const staleReplay = await fetch(
      `${endpoint.baseUrl}/api/v1/experience/dead-letters/dead-1/replay`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 1,
          idempotencyKey: 'dead-letter-replay-stale',
          actorId: 'experience-operator',
          reason: 'Attempt a stale replay.',
        }),
      },
    );
    expect(staleReplay.status).toBe(409);
    await expect(staleReplay.json()).resolves.toMatchObject({
      error: { code: 'EXPERIENCE_DEAD_LETTER_VERSION_CONFLICT' },
    });
    expect(received).toEqual([
      { action: 'listEpisodes', goalId: 'goal-1', limit: 20 },
      { action: 'listDeadLetters', limit: 10 },
      { action: 'listObservations', goalId: 'goal-1', limit: 30 },
      { action: 'listReflections', limit: 40 },
      { action: 'replayDeadLetter', deadLetterId: 'dead-1', actorId: 'experience-operator' },
    ]);
  });

  it('projects Task readiness windows without exposing full argument snapshots', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskAvailability: {
          listByPlan: () =>
            Promise.resolve([
              {
                readiness: {
                  readinessId: 'readiness-1',
                  workflowPlanId: 'plan-1',
                  planAttempt: 1,
                  checkPhase: 'planning' as const,
                  dslHash: 'a'.repeat(64),
                  disposition: 'confirmation_required' as const,
                  permittedActions: ['request_confirmation' as const],
                  guardAction: 'request_confirmation' as const,
                  guardReasonCodes: ['MCP_TASK_RISK_CONFIRMATION_REQUIRED:patrol'],
                  confirmationRequired: true,
                  createdAt: '2026-07-16T22:00:00.000Z',
                },
                snapshots: [
                  {
                    snapshotId: 'snapshot-1',
                    readinessId: 'readiness-1',
                    workflowPlanId: 'plan-1',
                    planAttempt: 1,
                    checkPhase: 'planning' as const,
                    nodeId: 'patrol',
                    serverId: 'provider',
                    operationName: 'vehicle_patrol',
                    arguments: {
                      unresolved: false as const,
                      value: { credential: 'must-not-leak', route: 'A' },
                    },
                    argumentsHash: 'b'.repeat(64),
                    timing: {
                      start: { mode: 'immediate' as const, startToleranceMs: 0 },
                      maxElapsedMs: null,
                    },
                    result: {
                      nodeId: 'patrol',
                      operationName: 'vehicle_patrol',
                      availability: 'restricted' as const,
                      riskLevel: 'high' as const,
                      validUntil: '2026-07-16T22:10:00.000Z',
                      earliestStartTime: '2026-07-16T22:02:00.000Z',
                      nextAvailableWindows: [
                        {
                          startTime: '2026-07-16T22:02:00.000Z',
                          endTime: '2026-07-16T22:12:00.000Z',
                        },
                      ],
                      reservationMode: 'best_effort' as const,
                      possibleEffects: ['start_rejection' as const],
                    },
                    sourceRevision: '2026-07-28/1.0',
                    checkedAt: '2026-07-16T22:00:00.000Z',
                    normalizationReasonCodes: [],
                  },
                ],
              },
            ]),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/task-readiness?phase=planning&limit=10`,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('best_effort');
    expect(body).toContain('2026-07-16T22:10:00.000Z');
    expect(body).toContain('forecast');
    expect(body).not.toContain('must-not-leak');
  });

  it('projects the complete remote Task lifecycle without credentials or raw availability arguments', async () => {
    const accepted = createRemoteTaskBinding({
      bindingId: 'binding-1',
      serverId: 'mcp.devices',
      operationName: 'device_patrol',
      remoteTaskId: 'provider-task-1',
      agentTaskId: 'task-1',
      contextId: 'context-1',
      goalId: 'goal-1',
      goalVersion: 1,
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-1',
      workflowNodeId: 'patrol',
      workflowNodeRunId: 'patrol:1',
      mcpInvocationId: 'invocation-1',
      protocolStatus: 'working',
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: '1.0.1',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
      },
      taskBehavior: 'server_directed',
      runtimeRevision: '1',
      providerSubstate: 'running',
      requestedTiming: {
        start: { mode: 'immediate', startToleranceMs: 0 },
        maxElapsedMs: 60_000,
      },
      executionContext: { mode: 'live' },
      credentialRevision: 'credential-1',
      sessionRevision: 'session-1',
      lastProviderUpdatedAt: '2026-07-17T00:00:00.000Z',
      pollIntervalMs: 1_000,
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    const binding: RemoteTaskBinding = {
      ...accepted,
      protocolStatus: 'completed',
      localState: 'closed',
      resultSnapshot: { content: [{ type: 'text', text: 'done' }], isError: false },
      terminalAt: '2026-07-17T00:00:03.000Z',
      updatedAt: '2026-07-17T00:00:03.000Z',
      version: 4,
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        tasks: {
          ...operations().tasks,
          get: () =>
            Promise.resolve({
              taskId: 'task-1',
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Patrol.',
              requestMetadata: {},
              phase: 'completed' as const,
              phaseMessage: 'Done.',
              goalId: 'goal-1',
              goalVersion: 1,
              planId: 'plan-1',
              selectedSkillId: 'skill.patrol',
              selectedSkillVersion: 2,
              createdAt: '2026-07-17T00:00:00.000Z',
              updatedAt: '2026-07-17T00:00:03.000Z',
            }),
        },
        mcp: {
          ...operations().mcp,
          listTools: () =>
            Promise.resolve([
              {
                serverId: 'mcp.devices',
                toolName: 'device_patrol',
                inputSchema: { type: 'object' },
                executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
                taskExecution: {
                  availability: 'dynamic' as const,
                  execution: 'task_required' as const,
                  cancellation: 'task_cancel' as const,
                  supportsScheduling: true,
                  supportsMaxElapsed: true,
                  supportsObservations: true,
                  revision: '1.0' as const,
                },
                discoveredAt: '2026-07-17T00:00:00.000Z',
              },
            ]),
        },
        remoteTaskLifecycle: {
          listByAgentTaskId: () =>
            Promise.resolve([
              {
                binding,
                observations: [
                  {
                    observationId: 'observation-1',
                    bindingId: 'binding-1',
                    sequence: 1,
                    type: 'task.snapshot' as const,
                    source: 'poll' as const,
                    payload: { status: 'completed' },
                    accepted: true,
                    observedAt: '2026-07-17T00:00:03.000Z',
                  },
                ],
                controls: [],
                protocolAttempts: [],
                continuations: [],
                inputRounds: [],
                cancellations: [],
                frozenProtocol: {
                  ttlMs: 60_000,
                  expiresAt: '2026-07-17T00:01:00.000Z',
                  runtimeRevision: '9',
                  providerRevision: 'provider-3',
                  latestObservationSource: 'notification',
                  pollHealth: 'healthy',
                  notificationHealth: 'observed',
                  evidenceSummary: {
                    providerItems: 1,
                    validatedRequirements: 1,
                    unsatisfiedRequirements: 0,
                  },
                },
              },
            ]),
        },
        taskAvailability: {
          listByPlan: () =>
            Promise.resolve([
              {
                readiness: {
                  readinessId: 'readiness-1',
                  workflowPlanId: 'plan-1',
                  planAttempt: 1,
                  checkPhase: 'pre_invocation' as const,
                  dslHash: 'a'.repeat(64),
                  disposition: 'ready' as const,
                  permittedActions: ['proceed' as const],
                  guardAction: 'proceed' as const,
                  guardReasonCodes: [],
                  confirmationRequired: false,
                  createdAt: '2026-07-17T00:00:00.000Z',
                },
                snapshots: [
                  {
                    snapshotId: 'availability-1',
                    readinessId: 'readiness-1',
                    workflowPlanId: 'plan-1',
                    planAttempt: 1,
                    checkPhase: 'pre_invocation' as const,
                    nodeId: 'patrol',
                    serverId: 'mcp.devices',
                    operationName: 'device_patrol',
                    arguments: { unresolved: false as const, value: { secret: 'must-not-leak' } },
                    argumentsHash: 'b'.repeat(64),
                    result: {
                      nodeId: 'patrol',
                      operationName: 'device_patrol',
                      availability: 'available' as const,
                      riskLevel: 'low' as const,
                      nextAvailableWindows: [],
                      reservationMode: 'none' as const,
                      possibleEffects: [],
                    },
                    sourceRevision: '2026-07-28/1.0.1',
                    checkedAt: '2026-07-17T00:00:00.000Z',
                    normalizationReasonCodes: [],
                  },
                ],
              },
            ]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/remote-task-lifecycle`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      correlationRoot: { taskId: 'task-1', skillId: 'skill.patrol' },
      items: [
        {
          binding: { remoteTaskId: 'provider-task-1' },
          capability: { status: 'registered' },
          protocol: {
            runtimeRevision: '9',
            latestObservationSource: 'notification',
            notificationHealth: 'observed',
          },
          finalOutcome: { providerStatus: 'completed', authoritative: true },
        },
      ],
    });
    expect(JSON.stringify(payload)).toContain('tasks/cancel acknowledgement');
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');
    expect(JSON.stringify(payload)).not.toContain('Bearer');
    expect(JSON.stringify(payload)).not.toContain('credential-1');
    expect(JSON.stringify(payload)).not.toContain('pollClaimToken');
  });

  it('routes version-constrained refresh, cooperative cancellation, and structured input', async () => {
    const captured: unknown[] = [];
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        tasks: {
          ...operations().tasks,
          followUp: (command) => {
            captured.push(command);
            return Promise.resolve({
              taskId: command.taskId,
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Run.',
              requestMetadata: {},
              phase: 'executing' as const,
              phaseMessage: 'Input accepted.',
              createdAt: '2026-07-17T00:00:00.000Z',
              updatedAt: '2026-07-17T00:00:01.000Z',
            });
          },
        },
        remoteTaskPolling: {
          process: (job) => {
            captured.push(job);
            return Promise.resolve('working');
          },
        },
        remoteTaskCancellation: {
          request: (request) => {
            captured.push(request);
            return Promise.resolve({ disposition: 'requested', deliveryScheduled: true });
          },
        },
      },
    });
    const refresh = await fetch(
      `${endpoint.baseUrl}/api/v1/remote-task-bindings/binding-1/refresh`,
      jsonPost({ expectedVersion: 7 }),
    );
    expect(refresh.status).toBe(200);
    const cancel = await fetch(
      `${endpoint.baseUrl}/api/v1/remote-task-bindings/binding-1/cancel`,
      jsonPost({ idempotencyKey: 'management-1', reasonCode: 'USER_REQUEST', summary: 'Stop.' }),
    );
    expect(cancel.status).toBe(200);
    const input = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks/task-1/actions`,
      jsonPost({
        action: 'provide_input',
        messageText: 'Structured response.',
        inputRequestId: 'input-1',
        inputContent: { form: { approved: true } },
      }),
    );
    expect(input.status).toBe(200);
    expect(captured).toEqual([
      { bindingId: 'binding-1', expectedVersion: 7 },
      {
        bindingId: 'binding-1',
        idempotencyKey: 'management-1',
        source: 'management',
        reasonCode: 'USER_REQUEST',
        summary: 'Stop.',
      },
      {
        taskId: 'task-1',
        action: 'provide_input',
        messageText: 'Structured response.',
        inputRequestId: 'input-1',
        inputContent: { form: { approved: true } },
      },
    ]);
  });

  it('exposes credential-safe MCP management operation evidence', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        mcp: {
          ...operations().mcp,
          listManagementOperations: () =>
            Promise.resolve([
              {
                operationId: 'operation-1',
                serverId: 'mcp.devices',
                operationType: 'credentials_update' as const,
                actor: 'anonymous-management' as const,
                summary: { headerNames: ['Authorization'] },
                occurredAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/operations`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      items: [expect.objectContaining({ operationType: 'credentials_update' })],
    });
    expect(JSON.stringify(payload)).not.toContain('Bearer');
  });

  it('exposes Tool semantics and validates credential-free administrator overrides', async () => {
    let captured: unknown;
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        mcp: {
          ...operations().mcp,
          listTools: (serverId) =>
            Promise.resolve([
              {
                serverId,
                toolName: 'device_status',
                inputSchema: { type: 'object' },
                executionSemantics: {
                  effect: 'read_only',
                  execution: 'synchronous',
                  cancellation: 'cooperative',
                  idempotency: 'client_request_key',
                  replay: 'allowed',
                  source: 'mcp_declared',
                },
                discoveredAt: '2026-07-16T00:00:00.000Z',
              },
            ]),
          updateToolExecutionSemantics: (serverId, toolName, values) => {
            captured = { serverId, toolName, values };
            return Promise.resolve();
          },
        },
      },
    });

    const tools = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/tools`);
    const toolsPayload = await tools.json();
    expect(toolsPayload).toEqual({
      items: [
        expect.objectContaining({
          executionSemantics: expect.objectContaining({ source: 'mcp_declared' }),
        }),
      ],
    });
    expect(JSON.stringify(toolsPayload)).not.toContain('credential');

    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/tools/device_status/execution-semantics`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          effect: 'side_effecting',
          execution: 'synchronous',
          cancellation: 'unsupported',
          idempotency: 'none',
          replay: 'forbidden',
        }),
      },
    );
    expect(response.status).toBe(204);
    expect(captured).toEqual({
      serverId: 'mcp.devices',
      toolName: 'device_status',
      values: expect.objectContaining({ effect: 'side_effecting', replay: 'forbidden' }),
    });
  });

  it('exposes persisted MCP dependency warnings for management display', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        mcp: {
          ...operations().mcp,
          listDependencyWarnings: (serverId) =>
            Promise.resolve([
              {
                warningId: 'warning-1',
                serverId,
                skillId: 'skill.device',
                skillVersion: 2,
                toolName: 'device_status',
                toolRevision: 3,
                reason: 'schema_changed' as const,
                message: 'The enabled Skill may require review.',
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/warnings`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          serverId: 'mcp.devices',
          skillId: 'skill.device',
          reason: 'schema_changed',
        }),
      ],
    });
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

  it('lists Tasks with bounded PostgreSQL query filters', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        tasks: {
          ...configured.tasks,
          list: (query) =>
            Promise.resolve([
              {
                taskId: 'task-live',
                contextId: query.contextId ?? 'context-live',
                userId: 'anonymous',
                requestText: 'Operate runtime.',
                requestMetadata: {},
                phase: query.phase ?? 'executing',
                phaseMessage: 'Executing.',
                ...(query.planId === undefined ? {} : { planId: query.planId }),
                ...(query.goalId === undefined ? {} : { goalId: query.goalId }),
                ...(query.skillId === undefined ? {} : { selectedSkillId: query.skillId }),
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:01:00.000Z',
              },
            ]),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks?contextId=context-live&phase=executing&planId=plan-live&goalId=goal-live&skillId=skill-live&limit=25`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          taskId: 'task-live',
          contextId: 'context-live',
          phase: 'executing',
          planId: 'plan-live',
          goalId: 'goal-live',
          selectedSkillId: 'skill-live',
        },
      ],
    });
  });

  it('lists credential-safe model Providers and fixed stage routes', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        models: {
          ...configured.models,
          listProviders: () =>
            Promise.resolve([
              {
                providerId: 'provider.local',
                name: 'Local model',
                kind: 'local' as const,
                apiStyle: 'openai_chat_completions' as const,
                baseUrl: 'http://127.0.0.1:11434',
                model: 'runtime-model',
                enabled: true,
                timeoutMs: 30000,
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
          listStageRoutes: () =>
            Promise.resolve([
              {
                stage: 'workflow_planning' as const,
                providerId: 'provider.local',
                updatedAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    const providers = await fetch(`${endpoint.baseUrl}/api/v1/models/providers`).then((response) =>
      response.json(),
    );
    expect(providers).toMatchObject({ items: [{ providerId: 'provider.local' }] });
    expect(JSON.stringify(providers)).not.toContain('credential');
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/models/routes`).then((response) => response.json()),
    ).resolves.toMatchObject({ items: [{ stage: 'workflow_planning' }] });
  });

  it('accepts cognitive reflection and Task Type induction model stages at the management boundary', async () => {
    const routedStages: string[] = [];
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        models: {
          ...configured.models,
          route: (stage) => {
            routedStages.push(stage);
            return Promise.resolve();
          },
        },
      },
    });

    for (const stage of [
      'experience_reflection',
      'task_type_induction',
      'capability_pattern_induction',
      'knowledge_promotion_assessment',
    ]) {
      const response = await fetch(`${endpoint.baseUrl}/api/v1/models/routes/${stage}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'provider.local' }),
      });
      expect(response.status).toBe(204);
    }
    expect(routedStages).toEqual([
      'experience_reflection',
      'task_type_induction',
      'capability_pattern_induction',
      'knowledge_promotion_assessment',
    ]);
  });

  it('lists versioned Candidate Task Types without exposing them as active knowledge', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskTypes: {
          list: (limit) =>
            Promise.resolve([
              {
                taskTypeId: 'task-type-inspection',
                revision: 2,
                status: 'candidate',
                origin: 'induced',
                fingerprint: `sha256:${'a'.repeat(64)}`,
                exemplars: [{ episodeId: 'episode-1' }, { episodeId: 'episode-2' }],
                requestedLimit: limit,
              },
            ] as never),
        },
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/task-types?limit=25`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          taskTypeId: 'task-type-inspection',
          revision: 2,
          status: 'candidate',
          origin: 'induced',
          fingerprint: `sha256:${'a'.repeat(64)}`,
          exemplars: [{ episodeId: 'episode-1' }, { episodeId: 'episode-2' }],
          requestedLimit: 25,
        },
      ],
    });
  });

  it('lists Capability Patterns and non-executable Gap Candidates', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        capabilityPatterns: {
          list: (limit) =>
            Promise.resolve([
              {
                patternId: 'capability-pattern-inspection',
                revision: 1,
                status: 'candidate',
                capabilityId: 'inspection.device',
                exactSkillVersionMappings: [
                  {
                    exactSkillVersionRef: 'skill.inspect:2',
                    requiresCurrentReadiness: true,
                    compatibilityStatus: 'requires_current_check',
                  },
                ],
                requestedLimit: limit,
              },
            ] as never),
          listGaps: () =>
            Promise.resolve([
              {
                gapId: 'capability-gap-inspection',
                status: 'candidate',
                capabilityId: 'inspection.device',
                exactSkillVersionRefs: [],
                executable: false,
                authoringProposal: {
                  reviewMode: 'manual',
                  publishAllowed: false,
                },
              },
            ] as never),
        },
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/capability-patterns?limit=25`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          patternId: 'capability-pattern-inspection',
          status: 'candidate',
          requestedLimit: 25,
          exactSkillVersionMappings: [
            {
              exactSkillVersionRef: 'skill.inspect:2',
              requiresCurrentReadiness: true,
              compatibilityStatus: 'requires_current_check',
            },
          ],
        },
      ],
      gaps: [
        {
          gapId: 'capability-gap-inspection',
          status: 'candidate',
          executable: false,
          authoringProposal: { reviewMode: 'manual', publishAllowed: false },
        },
      ],
    });
  });

  it('exposes CAS-guarded Knowledge promotion lifecycle actions', async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        knowledgePromotion: {
          list: (kind, limit) =>
            Promise.resolve([
              {
                knowledgeId: 'knowledge.test',
                kind,
                status: 'candidate',
                requestedLimit: limit,
              },
            ] as never),
          evaluate: (input) => {
            calls.push({ action: 'promote', ...input });
            return Promise.resolve({
              knowledge: {
                knowledgeId: input.knowledgeId,
                kind: input.kind,
                status: 'active',
                version: input.expectedVersion + 2,
              },
              evaluation: { status: 'passed', humanApproved: input.humanApproved },
            } as never);
          },
          reject: (input) => {
            calls.push({ action: 'reject', ...input });
            return Promise.resolve({
              knowledgeId: input.knowledgeId,
              kind: input.kind,
              status: 'rejected',
              version: input.expectedVersion + 1,
            } as never);
          },
          revalidate: (input) => {
            calls.push({ action: 'revalidate', ...input });
            return Promise.resolve({
              knowledgeId: input.knowledgeId,
              kind: input.kind,
              status: 'validating',
              version: input.expectedVersion + 1,
            } as never);
          },
          deprecate: (input) => {
            calls.push({ action: 'deprecate', ...input });
            return Promise.resolve({
              knowledgeId: input.knowledgeId,
              kind: input.kind,
              status: 'deprecated',
              version: input.expectedVersion + 1,
            } as never);
          },
          rebuildActiveProjections: () => Promise.resolve(0),
        },
      },
    });

    const inventory = await fetch(`${endpoint.baseUrl}/api/v1/knowledge/heuristics?limit=25`);
    expect(inventory.status).toBe(200);
    await expect(inventory.json()).resolves.toMatchObject({
      items: [
        {
          knowledgeId: 'knowledge.test',
          kind: 'planning_heuristic',
          requestedLimit: 25,
        },
      ],
    });

    const requests = [
      {
        action: 'promote',
        body: {
          expectedVersion: 1,
          idempotencyKey: 'promote-1',
          actorId: 'operator.test',
          reason: 'Approve the reviewed heuristic evidence.',
          humanApproved: true,
          policyAllowed: true,
        },
      },
      {
        action: 'reject',
        body: {
          expectedVersion: 1,
          idempotencyKey: 'reject-1',
          actorId: 'operator.test',
          reason: 'Unsafe generalization.',
        },
      },
      {
        action: 'revalidate',
        body: {
          expectedVersion: 3,
          idempotencyKey: 'revalidate-1',
          actorId: 'system.policy',
          reason: 'policy_changed',
        },
      },
      {
        action: 'deprecate',
        body: {
          expectedVersion: 3,
          idempotencyKey: 'deprecate-1',
          actorId: 'operator.test',
          reason: 'Retire superseded active knowledge.',
        },
      },
    ] as const;
    for (const request of requests) {
      const response = await fetch(
        `${endpoint.baseUrl}/api/v1/knowledge/planning_heuristic/knowledge.test/${request.action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body),
        },
      );
      expect(response.status).toBe(200);
    }
    expect(calls).toEqual([
      expect.objectContaining({
        action: 'promote',
        kind: 'planning_heuristic',
        knowledgeId: 'knowledge.test',
        humanApproved: true,
      }),
      expect.objectContaining({ action: 'reject', reason: 'Unsafe generalization.' }),
      expect.objectContaining({ action: 'revalidate', reason: 'policy_changed' }),
      expect.objectContaining({ action: 'deprecate', expectedVersion: 3 }),
    ]);
  });

  it('exposes durable cognitive write audit details without private reasoning', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        cognitiveManagementAudit: {
          list: (limit) =>
            Promise.resolve([
              {
                actionId: 'cognitive-management-action-1',
                operation: 'knowledge_promote',
                subjectId: 'planning_heuristic:knowledge.test',
                expectedVersion: 1,
                idempotencyKey: 'promote-1',
                actorId: 'operator.test',
                reason: 'Reviewed evidence passed.',
                requestHash: `sha256:${'a'.repeat(64)}`,
                status: 'completed',
                result: { status: 'active' },
                claimedAt: '2026-07-26T10:00:00.000Z',
                completedAt: '2026-07-26T10:00:01.000Z',
                updatedAt: '2026-07-26T10:00:01.000Z',
                requestedLimit: limit,
              },
            ] as never),
        },
      },
    });

    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/cognitive-management/actions?limit=25`,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('knowledge_promote');
    expect(text).toContain('Reviewed evidence passed.');
    expect(text).toContain('"requestedLimit":25');
    expect(text).not.toContain('chainOfThought');
  });

  it('reads and updates disabled-by-default Memory retention controls', async () => {
    const policy = {
      reviewAfterDays: 90,
      archiveAfterDays: 365,
      deleteAfterDays: 730,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        memoryRetention: {
          getPolicy: () => Promise.resolve(policy),
          updatePolicy: (input) => Promise.resolve({ ...input, updatedAt: policy.updatedAt }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/system/memory-retention-policy`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject(policy);
    const updated = await fetch(`${endpoint.baseUrl}/api/v1/system/memory-retention-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...policy, reviewAfterDays: 30 }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ reviewAfterDays: 30 });
  });

  it('reads and updates the authoritative Evolution threshold and exposes trigger logs', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evolutionPolicy: {
          getPolicy: () =>
            Promise.resolve({ successThreshold: 2, updatedAt: '2026-07-12T00:00:00.000Z' }),
          updatePolicy: (successThreshold) =>
            Promise.resolve({ successThreshold, updatedAt: '2026-07-12T00:01:00.000Z' }),
          listTriggers: () =>
            Promise.resolve([
              {
                triggerId: 'trigger-1',
                capabilityFingerprint: 'fingerprint-1',
                experienceId: 'experience-1',
                successfulExperienceCount: 1,
                configuredThreshold: 2,
                decision: 'below_threshold' as const,
                createdAt: '2026-07-12T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/system/evolution-policy`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ successThreshold: 2 });
    const update = await fetch(`${endpoint.baseUrl}/api/v1/system/evolution-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ successThreshold: 3 }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ successThreshold: 3 });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/evolution-triggers`).then((response) => response.json()),
    ).resolves.toMatchObject({
      items: [{ configuredThreshold: 2, decision: 'below_threshold' }],
    });
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

  it('exposes queryable post-terminal enhancement failures without changing authority', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        runtimeTerminalOutcomes: {
          find: (outcomeId) =>
            Promise.resolve({
              outcomeId,
              kind: 'achieved' as const,
              taskId: 'task-1',
              goalId: 'goal-1',
              goalVersion: 1,
              controlId: 'control-1',
              controlStatus: 'achieved' as const,
              resultId: 'result-1',
              summary: 'Committed before enhancement.',
              enhancementWarnings: [
                {
                  source: 'result_memory' as const,
                  code: 'MEMORY_EMBEDDING_INVALID',
                  message: 'Embedding failed.',
                  occurredAt: '2026-07-16T00:00:01.000Z',
                },
              ],
              committedAt: '2026-07-16T00:00:00.000Z',
            }),
        },
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/runtime-terminal-outcomes/outcome-1`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: 'achieved',
      enhancementWarnings: [{ source: 'result_memory', code: 'MEMORY_EMBEDDING_INVALID' }],
    });
  });

  it('exposes the five-component Task quality report', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskQuality: {
          getByTask: (taskId) =>
            Promise.resolve({
              reportId: 'quality-1',
              taskId,
              goalId: 'goal-1',
              goalVersion: 1,
              workflowInstanceId: 'instance-1',
              processedResultId: 'result-1',
              assessments: [
                {
                  component: 'goal',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['goal:1'],
                },
                {
                  component: 'workflow',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['workflow:1'],
                },
                {
                  component: 'skill',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['skill:1'],
                },
                {
                  component: 'result_quality',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['result:1'],
                },
                {
                  component: 'tool_call',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['tool:1'],
                },
              ],
              overallScore: 1,
              status: 'passed',
              createdAt: '2026-07-13T00:00:00.000Z',
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/quality-report`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      taskId: 'task-1',
      assessments: [
        { component: 'goal' },
        { component: 'workflow' },
        { component: 'skill' },
        { component: 'result_quality' },
        { component: 'tool_call' },
      ],
    });
  });

  it('lists low-confidence implicit feedback linked to a Task', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        implicitFeedback: {
          listByTask: (taskId) =>
            Promise.resolve([
              {
                feedbackId: 'feedback-1',
                kind: 'requested_redo',
                sourceTaskId: taskId,
                triggerTaskId: taskId,
                contextId: 'context-1',
                confidence: 0.35,
                evidenceSummary: 'The revision text requested a redo.',
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/implicit-feedback`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      items: [{ kind: 'requested_redo', sourceTaskId: 'task-1', confidence: 0.35 }],
    });
  });

  it('exposes the report-linked Evaluation influence record', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evaluationInfluences: {
          getByReport: (reportId) =>
            Promise.resolve({
              influenceId: 'influence-1',
              reportId,
              taskId: 'task-1',
              experienceId: 'experience-1',
              skillObservationId: 'observation-1',
              workflowDisposition: 'rejected_low_quality',
              promptDisposition: 'candidate_created',
              promptId: 'prompt-workflow',
              promptVersion: 2,
              promptStage: 'workflow_planning',
              createdAt: '2026-07-13T01:00:00.000Z',
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/task-quality-reports/report-1/influence`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      reportId: 'report-1',
      experienceId: 'experience-1',
      promptDisposition: 'candidate_created',
    });
  });

  it('filters operational Evaluation analytics by Skill, version, model, and Tool', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evaluationAnalytics: {
          summarize: (filters) =>
            Promise.resolve({
              filters,
              sampleCount: 2,
              successCount: 1,
              successRate: 0.5,
              averageDurationMs: 150,
              totalCost: 4,
              averageCost: 2,
              failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
              mcpUsage: [],
              modelEffects: [],
              versionStability: [
                {
                  skillId: 'skill-1',
                  skillVersion: 2,
                  sampleCount: 2,
                  successRate: 0.5,
                  averageQuality: 0.6,
                  qualityDeviation: 0.2,
                  stabilityScore: 0.4,
                },
              ],
              qualityTrend: [],
              capabilityGrowth: [],
              optimizationSuggestions: [],
            }),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/evaluation/analytics?skillId=skill-1&skillVersion=2&providerId=provider-1&model=model-a&serverId=mcp-1&toolName=read`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      filters: {
        skillId: 'skill-1',
        skillVersion: 2,
        providerId: 'provider-1',
        model: 'model-a',
        serverId: 'mcp-1',
        toolName: 'read',
      },
      successRate: 0.5,
      averageDurationMs: 150,
      totalCost: 4,
      failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
      versionStability: [{ stabilityScore: 0.4 }],
    });
  });

  it('advertises the trusted-intranet no-auth risk and returns credential-free MCP data', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const health = await fetch(`${endpoint.baseUrl}/api/v1/health`);
    expect(health.headers.get('x-sdar-security-warning')).toBe('trusted-intranet-only-no-auth');
    await expect(health.json()).resolves.toEqual({
      status: 'ok',
      authentication: 'none',
      deployment: 'trusted-intranet-only',
      historicalDataRetention: {
        default: 'indefinite',
        automaticArchive: false,
        automaticDelete: false,
        policyFieldsAreAdvisory: true,
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`);
    expect(JSON.stringify(await response.json())).not.toContain('credential');
  });

  it('exposes frozen Provider protocol evidence, baseline audit and immutable mode guard', async () => {
    const base = operations();
    const frozenCalls: string[] = [];
    const server = (await base.mcp.listServers())[0];
    if (server === undefined) throw new Error('MCP_SERVER_FIXTURE_MISSING');
    const evidence = {
      server: { ...server, protocolMode: 'frozen_v1' as const },
      currentDiscovery: {
        snapshotId: 'snapshot-1',
        serverId: server.serverId,
        protocolMode: 'frozen_v1' as const,
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
        supportedVersions: ['2026-07-28'],
        capabilities: {},
        serverInfo: {},
        taskNotifications: true,
        discoveredAt: '2026-07-19T00:00:00.000Z',
        toolRevision: 1,
      },
      tools: [
        {
          toolName: 'move_to',
          taskBehavior: 'server_directed',
          outputSchemaHash: 'b'.repeat(64),
        },
      ],
      notificationStatus: 'streaming_supported' as const,
      warnings: [],
      operations: {
        registerOrRefresh: 'frozen_registry' as const,
        protocolDiagnosis: true as const,
        reconnect: 'component_required' as const,
        forceReconciliation: true as const,
        baselineAudit: true as const,
      },
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...base,
        mcpProtocol: {
          listProviders: () => Promise.resolve([evidence]),
          diagnose: () => Promise.resolve(evidence),
          auditBaseline: () =>
            Promise.resolve({
              serverId: server.serverId,
              expectedBaselineSha256: 'a'.repeat(64),
              actualBaselineSha256: 'a'.repeat(64),
              passed: true,
            }),
        },
        frozenMcp: {
          register: (input) => {
            frozenCalls.push(`register:${input.serverId}`);
            return Promise.resolve({ server: { serverId: input.serverId } } as never);
          },
          refresh: (serverId) => {
            frozenCalls.push(`refresh:${serverId}`);
            return Promise.resolve({ server: { serverId } } as never);
          },
        },
        frozenMcpNotifications: {
          reconnect: (serverId) => {
            frozenCalls.push(`reconnect:${serverId}`);
            return Promise.resolve({
              serverId,
              disposition: 'started' as const,
              taskIds: ['remote-task-1'],
            });
          },
        },
      },
    });

    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`).then((response) => response.json()),
    ).resolves.toMatchObject({
      items: [
        {
          protocolMode: 'frozen_v1',
          supportedVersions: ['2026-07-28'],
          baselineHash: 'a'.repeat(64),
          taskNotifications: true,
          taskBehavior: [{ toolName: 'move_to', taskBehavior: 'server_directed' }],
          outputSchemaHash: [{ toolName: 'move_to', outputSchemaHash: 'b'.repeat(64) }],
        },
      ],
    });
    const audit = await fetch(
      `${endpoint.baseUrl}/api/v1/mcp/servers/${server.serverId}/protocol-baseline-audit`,
      { method: 'POST' },
    );
    expect(audit.status).toBe(200);
    await expect(audit.json()).resolves.toMatchObject({ passed: true });
    const registration = await fetch(
      `${endpoint.baseUrl}/api/v1/mcp/servers`,
      jsonPost({
        serverId: 'provider-new',
        name: 'Frozen Provider',
        endpoint: 'https://provider-new.test/mcp',
        credentialHeaders: { Authorization: 'Bearer secret' },
      }),
    );
    expect(registration.status).toBe(201);
    const refresh = await fetch(
      `${endpoint.baseUrl}/api/v1/mcp/servers/${server.serverId}/refresh`,
      { method: 'POST' },
    );
    expect(refresh.status).toBe(200);
    const reconnect = await fetch(
      `${endpoint.baseUrl}/api/v1/mcp/servers/${server.serverId}/notifications/reconnect`,
      { method: 'POST' },
    );
    expect(reconnect.status).toBe(202);
    await expect(reconnect.json()).resolves.toMatchObject({ disposition: 'started' });
    expect(frozenCalls).toEqual([
      'register:provider-new',
      `refresh:${server.serverId}`,
      `reconnect:${server.serverId}`,
    ]);
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

  it('validates/imports Skill Packages and exposes exact usage catalog/version contracts', async () => {
    const skillVersion = createSkillVersion({
      skillId: 'embodied.move-to',
      version: 1,
      name: 'Move To',
      summary: 'Move safely.',
      description: 'Moves a resource.',
      capabilities: ['embodied.move'],
      workflowGuidance: 'Move safely.',
      outputInstruction: 'Return final position.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      outcomeSpecification: {
        schemaVersion: '1.0' as const,
        skillId: 'embodied.move-to',
        skillVersion: 1,
        specificationHash: `sha256:${'5'.repeat(64)}`,
        effects: ['effect.final_position'],
        evidence: ['evidence.final_position'],
        artifacts: [],
        taskGoalPolicy: {},
        confidencePolicy: {},
        sideEffectPolicy: {},
      },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-17T11:00:00.000Z',
      usageSpecification: createSkillUsageSpecification({
        apiVersion: 'sdar.io/v1alpha1',
        visibility: { userSelectable: true, composable: true, internalOnly: false },
        normative: {
          constraints: ['Stay safe.'],
          forbiddenActions: [],
          requiredConfirmations: [],
          noApplicableSkill: 'reject',
        },
        adaptive: {
          instructions: ['Prefer safety.'],
          optimizationHints: [],
          allowPreferredProviderFallback: false,
        },
        contextRequirements: [],
        modes: {
          supported: ['guidance'],
          defaultMode: 'guidance',
          guidance: { summary: 'Guide.', instructions: ['Guide.'] },
        },
        taskBindings: [],
        evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
      }),
    });
    const candidate = {
      skillVersion,
      packageChecksum: 'a'.repeat(64),
      packageRoot: '/reviewed/embodied.move_to',
      fileChecksums: { 'manifest.json': 'b'.repeat(64) },
      skillMarkdown: '# Move To',
      validatedAt: '2026-07-17T10:59:00.000Z',
    };
    let importAttempts = 0;
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skills: {
          ...operations().skills,
          validatePackage: () => Promise.resolve(candidate),
          importPackageRoot: () => {
            importAttempts += 1;
            return importAttempts === 1
              ? Promise.resolve(skillVersion)
              : Promise.reject(
                  Object.assign(new Error('SKILL_IMPORT_VERSION_CONFLICT'), {
                    code: 'SKILL_IMPORT_VERSION_CONFLICT',
                  }),
                );
          },
          readExactVersion: () => Promise.resolve(skillVersion),
          listCatalog: () => Promise.resolve([]),
        },
      },
    });

    const validated = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-packages/validate`,
      jsonPost({ packageRoot: candidate.packageRoot }),
    );
    expect(validated.status).toBe(200);
    const validationBody = await validated.text();
    expect(validationBody).toContain(candidate.packageChecksum);
    expect(validationBody).not.toContain(candidate.skillMarkdown);
    expect(
      (
        await fetch(
          `${endpoint.baseUrl}/api/v1/skill-packages/import`,
          jsonPost({ packageRoot: candidate.packageRoot }),
        )
      ).status,
    ).toBe(201);
    const staleImport = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-packages/import`,
      jsonPost({ packageRoot: candidate.packageRoot }),
    );
    expect(staleImport.status).toBe(400);
    await expect(staleImport.json()).resolves.toMatchObject({
      error: { code: 'SKILL_IMPORT_VERSION_CONFLICT' },
    });
    expect(
      (
        await fetch(
          `${endpoint.baseUrl}/api/v1/skills/${encodeURIComponent(skillVersion.skillId)}/versions/1`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${endpoint.baseUrl}/api/v1/skills/catalog?mode=procedure&userSelectable=true`))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${endpoint.baseUrl}/api/v1/skills/catalog?userSelectable=not-a-boolean`))
        .status,
    ).toBe(400);
  });

  it('publishes a persisted A2A Skill draft only through the management draft route', async () => {
    const draft = {
      draftId: 'draft-task-1',
      taskId: 'task-1',
      contextId: 'context-1',
      requestedBy: 'anonymous',
      intent: 'create' as const,
      requestText: 'Create a detailed read-only device inspection Skill.',
      status: 'draft' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillAuthoring: {
          authorAndRegister: () => Promise.reject(new Error('UNUSED')),
          getDraft: () => Promise.resolve(draft),
          publishDraft: (_draftId, input) =>
            Promise.resolve({
              draft: {
                ...draft,
                status: 'published' as const,
                publishedSkillId: input.skillId,
                publishedSkillVersion: 1,
                publishedBy: input.actor,
                publishedAt: '2026-07-12T00:01:00.000Z',
              },
              skill: {
                skillId: input.skillId,
                version: 1,
                name: 'Published draft',
                summary: 'Published.',
                description: draft.requestText,
                capabilities: ['inspection'],
                workflowGuidance: 'Inspect.',
                outputInstruction: 'Return.',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                toolPolicy: input.toolPolicy,
                runtimePolicy: input.runtimePolicy,
                status: input.status,
                sourceKind: 'a2a_draft' as const,
                validationPassed: true,
                createdAt: '2026-07-12T00:01:00.000Z',
              },
            }),
        },
      },
    });
    const read = await fetch(`${endpoint.baseUrl}/api/v1/skill-drafts/draft-task-1`);
    await expect(read.json()).resolves.toMatchObject({ status: 'draft' });
    const published = await fetch(`${endpoint.baseUrl}/api/v1/skill-drafts/draft-task-1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'operator@example.test',
        skillId: 'skill.a2a.published',
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
      }),
    });
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      draft: { status: 'published', publishedBy: 'operator@example.test' },
      skill: { sourceKind: 'a2a_draft', status: 'enabled' },
    });
  });

  it('records and lists Skill quality warnings without a status mutation operation', async () => {
    const warning = {
      warningId: 'warning-1',
      skillId: 'skill.quality',
      skillVersion: 1,
      kind: 'consecutive_low_score' as const,
      observationIds: ['observation-1', 'observation-2', 'observation-3'],
      observedValue: 0.2,
      threshold: 0.4,
      summary: 'Low scores.',
      status: 'active' as const,
      skillStatusAtCreation: 'enabled' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillQuality: {
          record: (input) =>
            Promise.resolve({
              observation: {
                observationId: 'observation-3',
                ...input,
                createdAt: warning.createdAt,
              },
              warnings: [warning],
            }),
          listWarnings: () => Promise.resolve([warning]),
        },
      },
    });
    const recorded = await fetch(
      `${endpoint.baseUrl}/api/v1/skills/skill.quality/quality-observations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillVersion: 1,
          evaluationRef: 'evaluation-3',
          score: 0.2,
          successful: false,
        }),
      },
    );
    expect(recorded.status).toBe(201);
    await expect(recorded.json()).resolves.toMatchObject({ warnings: [{ status: 'active' }] });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/skill-quality-warnings?skillId=skill.quality`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({ items: [{ warningId: 'warning-1' }] });
  });

  it('fails explicitly when semantic and final selection providers are not configured', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/skill-selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goalContract: {
          goalId: 'goal-1',
          version: 1,
          title: 'Inspect device',
          description: 'Inspect a device.',
          constraints: [],
          successCriteria: ['status returned'],
        },
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_SELECTION_MODEL_NOT_CONFIGURED' },
    });
  });

  it('exposes auditable Skill induction and simulation reports', async () => {
    const proposedSkill = {
      skillId: 'skill.existing',
      name: 'Corrected Skill',
      summary: 'Corrected summary.',
      description: 'Corrected description.',
      capabilities: ['inspection'],
      workflowGuidance: 'Validate before calling the Tool.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
      usageSpecification: createSkillUsageSpecification({
        apiVersion: 'sdar.io/v1alpha1',
        visibility: { userSelectable: true, composable: true, internalOnly: false },
        normative: {
          constraints: [],
          forbiddenActions: [],
          requiredConfirmations: [],
          noApplicableSkill: 'reject',
        },
        adaptive: {
          instructions: ['Validate before calling the Tool.'],
          optimizationHints: [],
          allowPreferredProviderFallback: false,
        },
        contextRequirements: [],
        modes: {
          supported: ['procedure'],
          defaultMode: 'procedure',
          procedure: { summary: 'Validate and call.', instructions: ['Validate.'] },
        },
        taskBindings: [],
        evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
      }),
      outcomeSpecification: {
        schemaVersion: '1.0' as const,
        skillId: 'skill.existing',
        skillVersion: 1,
        specificationHash: `sha256:${'a'.repeat(64)}`,
        effects: ['device.status.observed'],
        evidence: ['device-status'],
        artifacts: [],
        taskGoalPolicy: {},
        confidencePolicy: {},
        sideEffectPolicy: {},
      },
    };
    const candidate = {
      candidateId: 'candidate-1',
      capabilityFingerprint: 'fingerprint-1',
      successfulExperienceCount: 2,
      requiredSuccessThreshold: 2,
      sourceExperienceIds: ['experience-1', 'experience-2'],
      status: 'published' as const,
      inductionReport: {
        consistent: true,
        stable: true,
        generalizable: true,
        duplicateSkillId: 'skill.existing',
        duplicateScore: 0.9,
        evolutionKind: 'new_version' as const,
        targetSkillId: 'skill.existing',
        boundaryDecisionSummary: 'The capability boundary is unchanged.',
        decisionSummary: 'Create a new version.',
      },
      validationReport: { allPassed: true, cases: [], decisionSummary: 'All passed.' },
      publishedSkillId: 'skill.evolved',
      publishedSkillVersion: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
      evaluatedAt: '2026-07-12T00:01:00.000Z',
    };
    const correction = {
      correctionId: 'correction-1',
      candidateId: candidate.candidateId,
      capabilityFingerprint: candidate.capabilityFingerprint,
      actor: 'operator@example.test',
      summary: 'Correct boundary handling.',
      beforeSkill: proposedSkill,
      afterSkill: proposedSkill,
      diff: [{ path: '/workflowGuidance', before: 'Call.', after: 'Validate.' }],
      validationReport: candidate.validationReport,
      outcome: 'published' as const,
      createdAt: '2026-07-12T00:02:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillEvolution: {
          get: () => Promise.resolve(candidate),
          evaluateAndPublish: () => Promise.resolve(candidate),
          correctAndRevalidate: () => Promise.resolve({ candidate, correction }),
          listCorrections: () => Promise.resolve([correction]),
        },
      },
    });

    const read = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1`,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      status: 'published',
      validationReport: { allPassed: true },
      inductionReport: {
        evolutionKind: 'new_version',
        targetSkillId: 'skill.existing',
        boundaryDecisionSummary: 'The capability boundary is unchanged.',
      },
    });
    const simulate = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/simulate`,
      { method: 'POST' },
    );
    expect(simulate.status).toBe(200);
    await expect(simulate.json()).resolves.toMatchObject({ publishedSkillId: 'skill.evolved' });
    const corrected = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/corrections`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: correction.actor,
          summary: correction.summary,
          proposedSkill,
        }),
      },
    );
    expect(corrected.status).toBe(200);
    await expect(corrected.json()).resolves.toMatchObject({
      correction: { correctionId: 'correction-1', actor: 'operator@example.test' },
    });
    const history = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/corrections`,
    );
    await expect(history.json()).resolves.toMatchObject({
      items: [{ correctionId: 'correction-1', diff: [{ path: '/workflowGuidance' }] }],
    });
  });

  it('lists replayable Evolution Experiences by Goal', async () => {
    const experience: EvolutionExperience = {
      experienceId: 'experience-1',
      controlId: 'control-1',
      roundIndex: 0,
      taskId: 'task-1',
      contextId: 'context-1',
      goal: {
        goalId: 'goal-1',
        version: 1,
        title: 'Goal',
        description: 'Complete it.',
        constraints: [],
        successCriteria: ['Complete'],
      },
      workflow: {
        workflowDefinitionId: 'workflow-1',
        version: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        entryNodeId: 'result',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        edges: [],
      },
      instanceId: 'instance-1',
      skillVersions: [{ skillId: 'skill-1', version: 1 }],
      tools: [],
      input: {},
      result: true,
      errors: {},
      evaluation: { decision: 'achieved', summary: 'Complete.' },
      successful: true,
      durationMs: 10,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evolutionExperiences: {
          get: () => Promise.resolve(experience),
          listByGoal: () => Promise.resolve([experience]),
          listBySkill: () => Promise.resolve([experience]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/evolution-experiences`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          goal: { goalId: 'goal-1' },
          workflow: { workflowDefinitionId: 'workflow-1' },
          evaluation: { decision: 'achieved' },
        },
      ],
    });
  });

  it('exposes the same confirmed-plan state through confirmation and execution endpoints', async () => {
    const configured = operations();
    const confirm = (planId: string) =>
      Promise.resolve({
        planId,
        goalId: 'goal-1',
        goalVersion: 1,
        goalContract: {
          goalId: 'goal-1',
          version: 1,
          title: 'Manage workflow',
          description: 'Manage the workflow.',
          constraints: [],
          successCriteria: ['done'],
        },
        confirmationStatus: 'confirmed' as const,
        confirmedAt: '2026-07-12T00:00:01.000Z',
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
      confirmedAt: '2026-07-12T00:00:01.000Z',
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

  it('requires and forwards one complete Goal contract for standalone Workflow planning', async () => {
    const configured = operations();
    const contract = {
      goalId: 'goal-plan-contract',
      version: 2,
      title: 'Plan safely',
      description: 'Produce a safe Workflow.',
      constraints: ['read-only'],
      successCriteria: ['validated Workflow returned'],
    } as const;
    let received: Parameters<ManagementOperations['workflows']['plan']>[0] | undefined;
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          plan: (input) => {
            received = input;
            return Promise.resolve({
              planId: input.planId,
              goalId: input.goalId,
              goalVersion: input.goalVersion,
              goalContract: input.goalContract,
              confirmationStatus: 'failed' as const,
              attemptCount: 1,
              createdAt: '2026-07-12T00:00:00.000Z',
            });
          },
        },
      },
    });
    const body = {
      planId: 'plan-contract',
      workflowDefinitionId: 'workflow-contract',
      workflowVersion: 1,
      goalId: contract.goalId,
      goalVersion: contract.version,
      goalContract: contract,
      planningInstruction: 'Plan from the complete contract.',
      compositionRoot: { skillId: 'skill.root.contract', skillVersion: 3 },
    };
    const response = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    expect(received?.goalContract).toEqual(contract);
    expect(received?.compositionRoot).toEqual({
      skillId: 'skill.root.contract',
      skillVersion: 3,
    });

    const missing = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, goalContract: undefined }),
    });
    expect(missing.status).toBe(400);
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

  it('returns an ordered Workflow instance trace for replay', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          trace: (instanceId) =>
            Promise.resolve({
              instance: { ...workflowInstance('plan-trace', 'succeeded'), instanceId },
              events: [
                {
                  eventId: 'event-1',
                  instanceId,
                  sequence: 1,
                  nodeId: 'start',
                  eventType: 'node_succeeded' as const,
                  timestamp: '2026-07-13T00:00:00.125Z',
                  durationMs: 125,
                  summary: 'start node succeeded.',
                },
              ],
            }),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/workflows/instances/instance-trace`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instance: { instanceId: 'instance-trace', status: 'succeeded' },
      events: [{ sequence: 1, nodeId: 'start', eventType: 'node_succeeded', durationMs: 125 }],
    });
  });

  it('filters Task-linked runtime, model, MCP, and plan trace evidence', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        runtimeEvents: {
          listByTask: (taskId) =>
            Promise.resolve([
              {
                eventId: 'runtime-event-1',
                taskId,
                contextId: 'context-1',
                eventType: 'task.phase_changed' as const,
                timestamp: '2026-07-13T00:00:00.000Z',
                summary: 'Task executing.',
              },
            ]),
        },
        models: {
          ...configured.models,
          listInvocationsByTask: (taskId) =>
            Promise.resolve([
              {
                invocationId: 'model-invocation-1',
                taskId,
                stage: 'goal' as const,
                providerId: 'provider-1',
                model: 'model-1',
                operation: 'structured_generation' as const,
                promptId: 'prompt-goal',
                promptVersion: 3,
                request: { instruction: 'Displayable rendered prompt.' },
                context: {},
                rawResponse: { content: '{"decision":"continue"}' },
                structuredResult: { decision: 'continue', decisionSummary: 'Proceed.' },
                durationMs: 5,
                status: 'succeeded' as const,
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
        mcp: {
          ...configured.mcp,
          listInvocationsByTask: (taskId) =>
            Promise.resolve([
              {
                invocationId: 'mcp-invocation-1',
                taskId,
                contextId: 'context-1',
                executionMode: 'live' as const,
                serverId: 'server-1',
                toolName: 'tool-1',
                executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
                arguments: {},
                status: 'succeeded' as const,
                startedAt: '2026-07-13T00:00:00.000Z',
                completedAt: '2026-07-13T00:00:00.005Z',
                durationMs: 5,
              },
            ]),
        },
        workflows: {
          ...configured.workflows,
          traceForPlan: (planId) =>
            Promise.resolve({
              instance: workflowInstance(planId, 'succeeded'),
              events: [],
            }),
        },
      },
    });
    const [events, models, mcp, trace] = await Promise.all([
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-linked/events`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/models/invocations?taskId=task-linked`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/mcp/invocations?taskId=task-linked`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-linked/trace`).then((response) =>
        response.json(),
      ),
    ]);
    expect(events).toMatchObject({ items: [{ taskId: 'task-linked' }] });
    expect(models).toMatchObject({
      items: [
        {
          taskId: 'task-linked',
          promptId: 'prompt-goal',
          promptVersion: 3,
          request: { instruction: 'Displayable rendered prompt.' },
          rawResponse: { content: '{"decision":"continue"}' },
          structuredResult: { decisionSummary: 'Proceed.' },
        },
      ],
    });
    expect(mcp).toMatchObject({ items: [{ taskId: 'task-linked' }] });
    expect(trace).toMatchObject({ instance: { planId: 'plan-linked' }, events: [] });
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
      triggeringTaskId: 'task-1',
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
      body: JSON.stringify({
        sourcePlanId: 'plan-1',
        instruction: 'Add temperature.',
        taskId: 'task-1',
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      patchId: 'patch-1',
      triggeringTaskId: 'task-1',
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
              goalContract: {
                goalId: 'goal-1',
                version: 1,
                title: 'Revise workflow',
                description: 'Revise the workflow.',
                constraints: [],
                successCriteria: ['valid'],
              },
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
      durability: 'durable' as const,
      authority: 'admin' as const,
      durabilityReason: 'The operator supplied a stable target identifier.',
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        memories: {
          refine: () => Promise.resolve(item),
          get: () => Promise.resolve(item),
          search: () => Promise.resolve([{ item, score: 1 }]),
          supersede: () =>
            Promise.resolve({ ...item, memoryId: 'memory-2', supersedes: ['memory-1'] }),
          invalidate: () => Promise.resolve(),
          listTransitions: () => Promise.resolve([]),
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
    const superseded = await fetch(`${endpoint.baseUrl}/api/v1/memories/memory-1/supersede`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'fact',
        content: { deviceId: 'device-18' },
        summary: 'The target device is device-18.',
        sourceRefs: ['task-new'],
        confidence: 0.95,
        actor: 'operator.test',
        reason: 'New evidence.',
      }),
    });
    expect(superseded.status).toBe(201);
    await expect(superseded.json()).resolves.toMatchObject({
      memoryId: 'memory-2',
      supersedes: ['memory-1'],
    });
    expect(
      (
        await fetch(`${endpoint.baseUrl}/api/v1/memories/memory-2/invalidate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actor: 'operator.test', reason: 'Retracted.' }),
        })
      ).status,
    ).toBe(204);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/memories/memory-1/transitions`).then((value) =>
        value.json(),
      ),
    ).resolves.toEqual({ items: [] });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/input-inferences`).then((value) =>
        value.json(),
      ),
    ).resolves.toMatchObject({
      items: [{ outcome: 'inferred', usedSources: [{ sourceId: 'memory:memory-1' }] }],
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/skill-input-resolutions`).then((value) =>
        value.json(),
      ),
    ).resolves.toEqual({ items: [] });
  });

  it('queries Skill execution evidence, tree, hard gates and degraded reasons', async () => {
    const execution: SkillExecutionView = {
      executionId: 'execution-root',
      taskId: 'task-skill-execution',
      goalId: 'goal-skill-execution',
      goalVersion: 1,
      skillId: 'skill-root',
      skillVersion: 2,
      selectionRef: 'selection-root',
      applicabilityStatus: 'satisfied',
      usagePolicy: {} as SkillExecutionView['usagePolicy'],
      workflowPlanId: 'plan-root',
      workflowDefinitionId: 'workflow-root',
      workflowDefinitionVersion: 1,
      status: 'degraded',
      events: [
        {
          eventId: 'event-degraded',
          executionId: 'execution-root',
          eventType: 'skill.execution_degraded',
          statusAfter: 'degraded',
          summary: 'Provider completed with bounded fallback evidence.',
          details: { reasonCode: 'PROVIDER_FALLBACK' },
          occurredAt: '2026-07-17T12:00:03.000Z',
        },
      ],
      references: [
        {
          linkId: 'link-provider',
          executionId: 'execution-root',
          kind: 'provider',
          referenceId: 'provider-1',
          referenceType: 'task.provider',
          sourceSystem: 'mcp_registry',
          producerRefs: [],
          metadata: {},
          createdAt: '2026-07-17T12:00:00.000Z',
        },
        {
          linkId: 'link-gate',
          executionId: 'execution-root',
          kind: 'hard_gate',
          referenceId: 'final-position',
          referenceType: 'position.observation',
          sourceSystem: 'skill_policy',
          producerRefs: [],
          metadata: { required: true },
          createdAt: '2026-07-17T12:00:00.000Z',
        },
      ],
      createdAt: '2026-07-17T12:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillExecutions: {
          find: (executionId) =>
            Promise.resolve(executionId === execution.executionId ? execution : undefined),
          listByTask: () => Promise.resolve([execution]),
          listChildren: () => Promise.resolve([]),
        },
      },
    });

    const collection = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks/task-skill-execution/skill-executions`,
    );
    expect(collection.status).toBe(200);
    await expect(collection.json()).resolves.toMatchObject({
      warnings: expect.arrayContaining([expect.stringContaining('Task and Workflow')]),
      items: [
        {
          executionId: 'execution-root',
          taskProviderReferences: [{ referenceId: 'provider-1' }],
          hardGates: [{ referenceId: 'final-position' }],
          degradedReason: { details: { reasonCode: 'PROVIDER_FALLBACK' } },
        },
      ],
      tree: [{ item: { executionId: 'execution-root' }, children: [] }],
    });
    const detail = await fetch(`${endpoint.baseUrl}/api/v1/skill-executions/execution-root`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      item: { executionId: 'execution-root', status: 'degraded' },
      tree: { item: { executionId: 'execution-root' } },
    });
  });
});

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function taskUnderstandingSnapshot() {
  return {
    schemaVersion: '1.0' as const,
    understandingId: 'understanding-1',
    taskId: 'task-1',
    revision: 1,
    originalRequest: 'Inspect pump-17.',
    objective: 'Inspect pump-17.',
    taskTypeCandidates: [],
    capabilityRequirements: [],
    knownConstraints: ['Read only.'],
    knownDimensions: [
      { kind: 'target' as const, value: 'pump-17', source: 'user_request' as const },
    ],
    assumptions: [],
    missingDimensions: [],
    confidence: 0.9,
    disposition: 'contract_candidate' as const,
    sourceRefs: [],
    modelInvocationId: 'model-invocation-1',
    policyVersion: 'task-understanding-v1',
    stateHash: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-07-23T03:20:00.000Z',
  };
}

function interactiveGoalSessionView() {
  return {
    outcome: 'duplicate' as const,
    session: {
      schemaVersion: '1.0' as const,
      sessionId: 'goal-session-1',
      taskId: 'task-1',
      state: 'goal_review' as const,
      version: 1,
      currentUnderstandingId: 'understanding-1',
      currentCandidateId: 'candidate-1',
      currentCandidateRevision: 1,
      clarificationRounds: 0,
      revisionCount: 1,
      maxClarificationRounds: 4,
      maxRevisions: 4,
      maxElapsedMs: 900_000,
      createdAt: '2026-07-23T03:30:00.000Z',
      updatedAt: '2026-07-23T03:30:00.000Z',
    },
    candidate: {
      schemaVersion: '1.0' as const,
      candidateId: 'candidate-1',
      sessionId: 'goal-session-1',
      revision: 1,
      status: 'candidate' as const,
      contract: {
        title: 'Inspect device',
        description: 'Inspect the selected device.',
        constraints: [],
        successCriteria: ['Inspection evidence exists.'],
      },
      contractHash: `sha256:${'b'.repeat(64)}`,
      sourceRefs: [],
      modelInvocationId: 'model-invocation-1',
      diff: { changedFields: ['title' as const] },
      createdAt: '2026-07-23T03:30:00.000Z',
    },
  };
}

function interactivePlanningSessionView() {
  return {
    outcome: 'duplicate' as const,
    session: {
      schemaVersion: '1.0' as const,
      sessionId: 'planning-session-1',
      taskId: 'task-1',
      goalSessionId: 'goal-session-1',
      confirmedContractCandidateId: 'candidate-1',
      goalId: 'goal-1',
      goalVersion: 1,
      state: 'plan_review' as const,
      version: 1,
      currentCandidateId: 'plan-candidate-1',
      currentCandidateRevision: 1,
      revisionCount: 1,
      maxRevisions: 4,
      maxElapsedMs: 900_000,
      createdAt: '2026-07-23T04:00:00.000Z',
      updatedAt: '2026-07-23T04:00:00.000Z',
    },
    candidate: {
      schemaVersion: '1.0' as const,
      candidateId: 'plan-candidate-1',
      sessionId: 'planning-session-1',
      revision: 1,
      status: 'candidate' as const,
      plan: {
        schemaVersion: '1.0' as const,
        planId: 'user-goal-plan-1',
        goalId: 'goal-1',
        goalVersion: 1,
        revision: 1,
        revisionKind: 'initial' as const,
        status: 'validated' as const,
        contractHash: `sha256:${'a'.repeat(64)}`,
        contentHash: `sha256:${'b'.repeat(64)}`,
        skillGoals: [],
        dependencies: [],
        inheritedCompletedEffectIds: [],
        forbiddenReplayFingerprints: [],
        createdAt: '2026-07-23T04:00:00.000Z',
      },
      planHash: `sha256:${'b'.repeat(64)}`,
      validation: { valid: true, errorCodes: [], checks: [] },
      diff: { changedFields: [], addedSkillGoalIds: [], removedSkillGoalIds: [] },
      experienceHints: [],
      confirmationPolicy: 'manual_all' as const,
      riskLevel: 'low' as const,
      planningMetadata: { priorities: {}, parallelGroups: {} },
      sourceRefs: [],
      createdAt: '2026-07-23T04:00:00.000Z',
    },
  };
}

function operations(failServerList = false): ManagementOperations {
  const unused = () => Promise.reject(new Error('UNEXPECTED_OPERATION'));
  return {
    goals: { create: unused, get: unused, history: unused },
    goalPatches: { apply: unused, get: unused, list: () => Promise.resolve([]) },
    goalCancellations: { cancel: unused, get: unused, list: () => Promise.resolve([]) },
    tasks: { attachPlan: unused, followUp: unused, get: unused, list: () => Promise.resolve([]) },
    taskWaitTimeouts: { getPolicy: unused, updatePolicy: unused },
    resultProcessing: { get: unused, list: () => Promise.resolve([]) },
    taskQuality: { getByTask: unused },
    implicitFeedback: { listByTask: () => Promise.resolve([]) },
    evaluationInfluences: { getByReport: unused },
    evaluationAnalytics: { summarize: unused },
    memories: {
      refine: unused,
      get: unused,
      search: () => Promise.resolve([]),
      supersede: unused,
      invalidate: unused,
      listTransitions: () => Promise.resolve([]),
    },
    runtimeEvents: { listByTask: () => Promise.resolve([]) },
    runtimeTerminalOutcomes: { find: unused },
    memoryRetention: { getPolicy: unused, updatePolicy: unused },
    goalInputInference: { list: () => Promise.resolve([]) },
    skillInputResolution: { get: unused, list: () => Promise.resolve([]) },
    skillQuality: { record: unused, listWarnings: () => Promise.resolve([]) },
    workflowTemplates: {
      listTemplates: () => Promise.resolve([]),
      listUses: () => Promise.resolve([]),
    },
    graph: {
      create: unused,
      delete: unused,
      list: () => Promise.resolve([]),
    },
    mcp: {
      delete: unused,
      listDependencyWarnings: () => Promise.resolve([]),
      listInvocations: () => Promise.resolve([]),
      listInvocationsByTask: () => Promise.resolve([]),
      listManagementOperations: () => Promise.resolve([]),
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
                protocolMode: 'frozen_v1' as const,
                createdAt: '2026-07-11T10:00:00.000Z',
                updatedAt: '2026-07-11T10:00:00.000Z',
              },
            ]),
      listTools: () => Promise.resolve([]),
      updateToolEnhancement: unused,
      updateToolExecutionSemantics: unused,
    },
    models: {
      configureProvider: unused,
      listInvocations: () => Promise.resolve([]),
      listInvocationsByTask: () => Promise.resolve([]),
      listProviders: () => Promise.resolve([]),
      listStageRoutes: () => Promise.resolve([]),
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
      importPackageRoot: unused,
      listCatalog: () => Promise.resolve([]),
      listCurrentVersions: () => Promise.resolve([]),
      listVersions: () => Promise.resolve([]),
      readExactVersion: unused,
      register: unused,
      rollback: unused,
      setEnabled: unused,
      validatePackage: unused,
    },
    capabilities: { getSummary: unused, getById: unused, rebuild: unused },
    capabilityCards: { findActive: unused, findById: unused, publish: unused },
    taskUnderstandings: { findCurrent: unused, listRevisions: () => Promise.resolve([]) },
    temporarySkills: {
      complete: unused,
      create: unused,
      listByTask: () => Promise.resolve([]),
    },
    skillEvolution: {
      evaluateAndPublish: unused,
      get: unused,
      correctAndRevalidate: unused,
      listCorrections: () => Promise.resolve([]),
    },
    evolutionExperiences: {
      get: unused,
      listByGoal: () => Promise.resolve([]),
      listBySkill: () => Promise.resolve([]),
    },
    evolutionPolicy: {
      getPolicy: unused,
      updatePolicy: unused,
      listTriggers: () => Promise.resolve([]),
    },
    workflows: {
      cancelForPlan: unused,
      confirm: unused,
      execute: unused,
      pauseForPlan: unused,
      resumeHumanConfirmation: unused,
      resumePauseForPlan: unused,
      trace: unused,
      traceForPlan: unused,
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

function capabilitySummaryView() {
  const catalogHash = `sha256:${'a'.repeat(64)}`;
  return {
    summary: {
      schemaVersion: '1.0' as const,
      summaryId: 'summary.api.1',
      revision: 1,
      catalogHash,
      generationPolicyVersion: 'capability-policy-v1',
      status: 'active' as const,
      items: [],
      sourceRefs: [],
      builtAt: '2026-07-23T01:20:00.000Z',
    },
    index: {
      schemaVersion: '1.0' as const,
      summaryId: 'summary.api.1',
      catalogHash,
      entries: [],
      characterCount: 2,
      truncated: false,
    },
  };
}

function capabilityCardSnapshot() {
  const catalogHash = `sha256:${'b'.repeat(64)}`;
  const generatedAt = '2026-07-23T02:00:00.000Z';
  return {
    schemaVersion: '1.0' as const,
    cardId: 'card.api.1',
    revision: 1,
    summaryId: 'summary.api.1',
    catalogHash,
    generationPolicyVersion: 'capability-policy-v1',
    profileVersion: '1.0' as const,
    status: 'active' as const,
    agentName: 'Skill-Driven Agent Runtime',
    description: 'Public deterministic capability profile.',
    profile: {
      profileVersion: '1.0' as const,
      catalogHash,
      domains: ['inspection'],
      capabilities: [],
      limitations: [],
      generatedAt,
    },
    publicSkills: [],
    sourceSkillRefs: ['skill.public:1'],
    generationMode: 'deterministic' as const,
    cardContentHash: `sha256:${'c'.repeat(64)}`,
    generatedAt,
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
