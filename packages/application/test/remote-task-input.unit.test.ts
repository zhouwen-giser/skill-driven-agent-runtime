import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { FrozenV1McpClient, FrozenV1RuntimeLifecycleAdapter } from '../../mcp-adapter/src/index.js';
import {
  PostgresRemoteTaskInputRepository,
  PostgresRemoteTaskRepository,
  PostgresWorkflowContinuationRepository,
} from '../../persistence-postgres/src/index.js';

import {
  createRemoteTaskBinding,
  createRemoteTaskInputLink,
  type RemoteTaskBinding,
  type RemoteTaskInputLink,
  type RemoteTaskSnapshot,
  type RemoteTaskControlEvent,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  RemoteTaskInputService,
  type RemoteTaskInputAttempt,
  type RemoteTaskInputRepository,
} from '../src/index.js';

describe('RemoteTaskInputService', () => {
  it('activates an input_required control as an existing Task input without planning', async () => {
    const binding = remoteBinding();
    let activated: Parameters<RemoteTaskInputRepository['activate']>[0] | undefined;
    const fixture = serviceFixture(binding, {
      activate(input) {
        activated = input;
        return Promise.resolve(true);
      },
    });

    await expect(
      fixture.service.process({
        eventId: 'control-event-1',
        bindingId: binding.bindingId,
        eventType: 'task.input_required',
      }),
    ).resolves.toBe('activated');

    expect(activated).toMatchObject({
      request: { taskId: 'task-1', source: 'remote_task', status: 'waiting' },
      link: {
        bindingId: 'binding-1',
        workflowNodeRunId: 'instance-1:node-1:1',
        status: 'waiting',
      },
    });
    expect(fixture.events).toHaveLength(1);
  });

  it('validates structured and deterministic single-field text elicitation responses', async () => {
    const binding = remoteBinding();
    const fixture = serviceFixture(binding);

    await expect(
      fixture.service.prepareResponse('input-request-1', {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).resolves.toEqual({
      approval: { action: 'accept', content: { approved: true } },
    });
    await expect(fixture.service.prepareResponse('input-request-1', 'yes')).rejects.toMatchObject({
      code: 'REMOTE_TASK_INPUT_SCHEMA_MISMATCH',
    });
    fixture.link = inputLink({
      requestedSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { type: 'string' } },
      },
    });
    await expect(fixture.service.prepareResponse('input-request-1', 'yes')).resolves.toEqual({
      approval: { action: 'accept', content: { answer: 'yes' } },
    });
  });

  it('records update acknowledgement and transport uncertainty then always re-arms polling', async () => {
    const binding = remoteBinding();
    const fixture = serviceFixture(binding);
    fixture.link = { ...fixture.link, status: 'answered' };

    await fixture.service.submitAnswer('input-request-1', {
      approval: { action: 'accept', content: { approved: true } },
    });
    expect(fixture.sender).toHaveBeenCalledTimes(1);
    expect(fixture.attempts[0]).toMatchObject({ status: 'acknowledged' });
    expect(fixture.pollJobs).toEqual([
      expect.objectContaining({ bindingId: 'binding-1', expectedVersion: 3 }),
    ]);

    fixture.binding = remoteBinding();
    fixture.link = { ...inputLink(), status: 'answered' };
    fixture.sender.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(
      fixture.service.submitAnswer('input-request-1', {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).resolves.toBeUndefined();
    expect(fixture.attempts.at(-1)).toMatchObject({
      status: 'provider_unreachable',
      errorCode: 'MCP_TASK_UPDATE_PROVIDER_UNREACHABLE',
    });
  });

  it('uses persisted keys and closed submission status without a transport observation cache', async () => {
    const fixture = serviceFixture(remoteBinding());
    fixture.link = { ...fixture.link, status: 'answered' };
    await expect(
      fixture.service.submitAnswer('input-request-1', {
        injected: { action: 'accept', content: {} },
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_TASK_INPUT_RESPONSE_INVALID' });
    expect(fixture.sender).not.toHaveBeenCalled();
    await fixture.service.submitAnswer('input-request-1', {
      approval: { action: 'accept', content: { approved: true } },
    });
    // The persisted status, not the lifetime of the transport client, prevents resubmission.
    await expect(
      fixture.service.submitAnswer('input-request-1', {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_TASK_INPUT_LINK_NOT_ANSWERED' });
    expect(fixture.sender).toHaveBeenCalledTimes(1);
  });
});

function serviceFixture(
  initialBinding: RemoteTaskBinding,
  overrides: Partial<RemoteTaskInputRepository> = {},
) {
  const state: {
    binding: RemoteTaskBinding;
    link: RemoteTaskInputLink;
    attempts: RemoteTaskInputAttempt[];
  } = { binding: initialBinding, link: inputLink(), attempts: [] };
  const events: unknown[] = [];
  const pollJobs: unknown[] = [];
  const sender = vi.fn().mockResolvedValue({ acknowledged: true, protocolRevision: '2026-test' });
  const repository: RemoteTaskInputRepository = {
    findEligibleRequests: (_bindingId, requests) => Promise.resolve(requests),
    claimUpdate: () => {
      const eligible = state.link.inputRequests;
      state.link = { ...state.link, status: 'update_uncertain' };
      state.binding = {
        ...state.binding,
        localState: 'polling',
        version: state.binding.version + 1,
      };
      return Promise.resolve({
        inputRequests: eligible,
        expectedBindingVersion: state.binding.version,
      });
    },
    activate: () => Promise.resolve(true),
    findLink: () => Promise.resolve(state.link),
    recordUpdateOutcome(input) {
      state.attempts.push(input.attempt);
      state.link = { ...state.link, status: input.status, updatedAt: input.observedAt };
      state.binding = {
        ...state.binding,
        localState: 'polling',
        nextPollAt: input.observedAt,
        updatedAt: input.observedAt,
        version: state.binding.version + 1,
      };
      return Promise.resolve({ applied: true, binding: state.binding });
    },
    listAttempts: () => Promise.resolve(state.attempts),
    ...overrides,
  };
  let clockIndex = 0;
  const service = new RemoteTaskInputService({
    continuations: {
      finishControl: () => Promise.resolve(),
      claimControl: () =>
        Promise.resolve({
          eventId: 'control-event-1',
          bindingId: 'binding-1',
          type: 'task.input_required',
          remoteRevision: 'remote-revision-1',
          resultHash: 'a'.repeat(64),
          payload: inputRequiredPayload(),
          status: 'claimed',
          createdAt: '2026-07-17T00:00:00.000Z',
          claimedAt: '2026-07-17T00:00:01.000Z',
        }),
    },
    remoteTasks: { findById: () => Promise.resolve(state.binding) },
    inputs: repository,
    tasks: { findById: () => Promise.resolve(undefined) },
    events: {
      publish(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    sender: { updateRemoteTask: sender },
    pollQueue: {
      enqueue(job) {
        pollJobs.push(job);
        return Promise.resolve();
      },
      state: () => Promise.resolve('missing'),
      listDeadLetters: () => Promise.resolve([]),
      retryDeadLetter: () => Promise.resolve(),
    },
    schemas: new AjvJsonSchemaValidator(),
    serial: { run: (_contextId, operation) => operation() },
    clock: {
      now: () => new Date(Date.UTC(2026, 6, 17, 0, 0, clockIndex++)).toISOString(),
    },
    ids: {
      nextInputRequestId: () => 'input-request-new',
      nextClaimToken: () => 'claim-1',
      nextProtocolAttemptId: () => `protocol-attempt-${String(state.attempts.length + 1)}`,
      nextEventId: () => 'runtime-event-1',
    },
  });
  return {
    service,
    events,
    pollJobs,
    sender,
    get attempts() {
      return state.attempts;
    },
    get link() {
      return state.link;
    },
    set link(value: RemoteTaskInputLink) {
      state.link = value;
    },
    set binding(value: RemoteTaskBinding) {
      state.binding = value;
    },
  };
}

function remoteBinding(): RemoteTaskBinding {
  const binding = {
    ...createRemoteTaskBinding({
      bindingId: 'binding-1',
      serverId: 'mcp-server-1',
      operationName: 'approve',
      remoteTaskId: 'remote-task-1',
      agentTaskId: 'task-1',
      contextId: 'context-1',
      goalId: 'goal-1',
      goalVersion: 1,
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-1',
      workflowNodeId: 'node-1',
      workflowNodeRunId: 'instance-1:node-1:1',
      mcpInvocationId: 'invocation-1',
      protocolStatus: 'input_required',
      protocolRevision: '2026-test',
      tasksSchemaRevision: 'schema-test',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-test',
        baselineSha256: 'a'.repeat(64),
        serverDiscoverySnapshotId: 'snapshot-1',
      },
      taskBehavior: 'server_directed',
      taskCancellation: 'task_cancel',
      runtimeRevision: '1',
      remoteRevision: 'remote-revision-1',
      executionContext: { mode: 'live' },
      authoritySnapshot: testAuthoritySnapshot('mcp-server-1', 'credential-1'),
      credentialRevision: 'credential-1',
      sessionRevision: 'session-1',
      lastProviderUpdatedAt: '2026-07-17T00:00:00.000Z',
      pollIntervalMs: 1_000,
      createdAt: '2026-07-17T00:00:00.000Z',
    }),
  };
  delete binding.nextPollAt;
  return { ...binding, localState: 'awaiting_input' };
}

function testAuthoritySnapshot(serverId: string, credentialRevision: string) {
  return {
    schemaVersion: '1.0' as const,
    capturedAt: '2026-07-17T00:00:00.000Z',
    runtime: {
      serverId,
      endpoint: `https://${serverId}.test/mcp`,
      serverUpdatedAt: credentialRevision,
      toolRevision: 1,
      protocolSnapshotId: 'snapshot-1',
      catalogRevision: 'catalog-revision-1',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 1,
    },
  };
}

function inputLink(input: Readonly<{ requestedSchema?: unknown }> = {}): RemoteTaskInputLink {
  return createRemoteTaskInputLink({
    inputRequestId: 'input-request-1',
    controlEventId: 'control-event-1',
    bindingId: 'binding-1',
    remoteTaskId: 'remote-task-1',
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'instance-1:node-1:1',
    remoteRevision: 'remote-revision-1',
    resultHash: 'a'.repeat(64),
    inputRequests: {
      approval: {
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message: 'Approve?',
          requestedSchema: input.requestedSchema ?? {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: { approved: { type: 'boolean' } },
          },
        },
      },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
  });
}

function inputRequiredPayload() {
  return {
    remoteTaskId: 'remote-task-1',
    status: 'input_required',
    createdAt: '2026-07-17T00:00:00.000Z',
    lastUpdatedAt: '2026-07-17T00:00:00.000Z',
    ttlMs: null,
    protocolRevision: '2026-test',
    tasksSchemaRevision: 'schema-test',
    inputRequests: inputLink().inputRequests,
  };
}

// Real application + Runtime wire adapter + PostgreSQL repositories; SQL rows are doubled.
// This is not PostgreSQL locking, rollback, or integration evidence.
describe('durable per-binding input keys [query double]', () => {
  it.each(['input', 'missing_continuation', 'terminal'] as const)(
    'claims %s controls without weakening the terminal continuation guard',
    async (kind) => {
      const event = {
        event_id: 'control-1',
        binding_id: 'binding-1',
        event_type: kind === 'terminal' ? 'task.completed' : 'task.input_required',
        remote_revision: '6',
        runtime_revision: '6',
        result_hash: 'a'.repeat(64),
        payload_json: {},
        status: 'pending',
        created_at: '2026-08-26T09:00:00.000Z',
        claimed_at: null,
        processed_at: null,
        error_code: null,
        continuation_claim_token: null,
        continuation_claim_expires_at: null,
        continuation_claim_attempt: 0,
      };
      const query = vi.fn((sql: string) =>
        Promise.resolve(
          sql.includes('SELECT * FROM remote_task_control_event')
            ? { rows: [event], rowCount: 1 }
            : sql.includes('AS present')
              ? { rows: [{ present: kind !== 'missing_continuation' }], rowCount: 1 }
              : sql.includes('UPDATE remote_task_control_event')
                ? { rows: [{ ...event, status: 'claimed' }], rowCount: 1 }
                : { rows: [], rowCount: 0 },
        ),
      );
      const pool = {
        connect: () => Promise.resolve({ query, release: () => undefined }),
      } as unknown as Pool;
      const claim = new PostgresWorkflowContinuationRepository(pool).claimControl({
        eventId: 'control-1',
        claimToken: 'claim',
        claimedAt: '2026-08-26T09:00:01.000Z',
        expiresAt: '2026-08-26T09:00:31.000Z',
      });
      if (kind === 'terminal') {
        await expect(claim).rejects.toMatchObject({
          code: 'WORKFLOW_CONTINUATION_BINDING_STATE_MISMATCH',
        });
        expect(query).toHaveBeenCalledWith('ROLLBACK');
      } else {
        if (kind === 'input')
          await expect(claim).resolves.toMatchObject({
            type: 'task.input_required',
            status: 'claimed',
          });
        else await expect(claim).resolves.toBeUndefined();
        expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE remote_task_binding'))).toBe(
          false,
        );
      }
    },
  );
  it.each(['acknowledged', 'uncertain'] as const)(
    'does not resend %s keys across revisions, mixed links and fresh services',
    async (outcome) => {
      const f = durableFixture();
      const first = await f.observe('6', ['k']);
      if (outcome === 'uncertain') f.failNextUpdate();
      await f.answer(first);
      await f.answer(await f.observe('7', ['k']));
      await f.answer(await f.observe('8', ['k', 'j']));
      expect(f.sent.map(Object.keys)).toEqual([['k'], ['j']]);
      expect(f.lastLink()['input_requests_json']).toEqual({ j: f.request });
      expect(f.binding['last_task_snapshot_json']).toMatchObject({
        inputRequests: { k: f.request, j: f.request },
      });
      expect(f.attempts.map((attempt) => attempt['status'])).toEqual([
        outcome === 'acknowledged' ? 'acknowledged' : 'provider_unreachable',
        'acknowledged',
      ]);
    },
  );

  it.each(['waiting', 'answered'] as const)(
    'replaces an unsent %s link without closing the same open Provider key',
    async (oldStatus) => {
      const f = durableFixture();
      await f.activate(await f.observe('6', ['k']));
      const old = f.lastLink();
      old['status'] = oldStatus;
      await f.activate(await f.observe('7', ['k']));
      const current = f.lastLink();
      expect(current['input_request_id']).not.toBe(old['input_request_id']);
      expect(current['input_requests_json']).toEqual({ k: f.request });
      old['status'] = 'answered';
      await expect(
        f.service().submitAnswer(String(old['input_request_id']), { k: f.response }),
      ).rejects.toMatchObject({ code: 'REMOTE_TASK_INPUT_BINDING_STALE' });
      await f.sendCurrent();
      expect(f.sent.map(Object.keys)).toEqual([['k']]);
    },
  );

  it('does not reserve twice or retry a crash after the durable pre-send reservation', async () => {
    const f = durableFixture();
    await f.activate(await f.observe('6', ['k']));
    const link = f.lastLink();
    link['status'] = 'answered';
    const reservation = {
      inputRequestId: String(link['input_request_id']),
      expectedBindingVersion: Number(f.binding['version']),
      startedAt: '2026-08-26T09:00:10.000Z',
    };
    expect(await f.inputs().claimUpdate(reservation)).toEqual({
      inputRequests: { k: f.request },
      expectedBindingVersion: reservation.expectedBindingVersion + 1,
    });
    expect(f.binding['local_state']).toBe('polling');
    expect(f.binding['next_poll_at']).toBe(reservation.startedAt);
    expect(await f.inputs().claimUpdate(reservation)).toBeUndefined();
    expect(f.sent).toEqual([]);
    expect(f.attempts).toEqual([]);
    await expect(
      f.service().submitAnswer(reservation.inputRequestId, { k: f.response }),
    ).rejects.toMatchObject({ code: 'REMOTE_TASK_INPUT_LINK_NOT_ANSWERED' });
    await f.answer(await f.observe('7', ['k', 'j']));
    expect(f.sent.map(Object.keys)).toEqual([['j']]);
    expect(f.attempts).toHaveLength(1); // Reservation itself is never an acknowledgement.
  });

  it.each(['working', 'different_keys'] as const)(
    'keeps a truly superseded key closed after accepted detailed %s',
    async (change) => {
      const f = durableFixture();
      await f.observe('6', ['k']);
      await f.observe('7', change === 'working' ? [] : ['j']);
      await f.answer(await f.observe('8', ['k', 'j']));
      expect(f.sent.map(Object.keys)).toEqual([['j']]);
    },
  );

  it('ignores basic input_required and rejected wrong-instance history for key closure', async () => {
    const f = durableFixture();
    await f.observe('6', ['k']);
    f.basicInputObservation();
    expect(await f.inputs().findEligibleRequests('binding-1', { k: f.request })).toEqual({
      k: f.request,
    });
    await f.observe('100', [], 'wrong-instance');
    await f.answer(await f.observe('7', ['k']));
    expect(f.rejections).toEqual(['identity_conflict']);
    expect(f.sent.map(Object.keys)).toEqual([['k']]);
  });

  it('retains the actual acknowledgement when a later observation wins the binding CAS', async () => {
    const f = durableFixture();
    await f.activate(await f.observe('6', ['k']));
    f.afterNextWire(() => f.observe('7', ['k']));
    await expect(f.sendCurrent()).rejects.toMatchObject({
      code: 'REMOTE_TASK_INPUT_BINDING_STALE',
    });
    expect(f.lastLink()['status']).toBe('update_acknowledged');
    expect(f.attempts[0]).toMatchObject({ status: 'acknowledged' });
    await f.answer(await f.observe('8', ['k', 'j']));
    expect(f.sent.map(Object.keys)).toEqual([['k'], ['j']]);
  });
});

function durableFixture() {
  const at = '2026-08-26T09:00:00.000Z';
  const identity = {
    profileVersion: '1.0' as const,
    providerId: 'provider-A',
    providerInstanceId: 'A',
  };
  const request = inputLink().inputRequests['approval'];
  const response = { action: 'accept', content: { approved: true } };
  const base: RemoteTaskSnapshot = {
    remoteTaskId: 'remote-task-1',
    status: 'working',
    createdAt: at,
    lastUpdatedAt: at,
    ttlMs: null,
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'frozen-1.0',
    runtimeRevision: '5',
    providerIdentity: identity,
  };
  const initial: RemoteTaskBinding = {
    ...remoteBinding(),
    protocolStatus: 'working',
    localState: 'polling',
    runtimeRevision: '5',
    remoteRevision: '5',
    providerIdentity: identity,
    lastTaskSnapshot: base,
    lastTaskProjection: 'detailed',
  };
  const binding: Record<string, unknown> = {};
  for (const key of 'skill_goal_id skill_attempt_id parent_workflow_instance_id parent_skill_call_id task_ttl_ms task_expires_at provider_substate requested_timing_json simulation_id next_poll_at poll_claim_token poll_claimed_at poll_claim_expires_at result_snapshot_json error_snapshot_json last_safe_error_code invalidated_at terminal_at provider_revision'.split(
    ' ',
  ))
    binding[key] = null;
  for (const [key, value] of Object.entries(initial))
    binding[key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)] = value;
  Object.assign(binding, {
    protocol_contract_json: initial.protocolContract,
    authority_snapshot_json: initial.authoritySnapshot,
    binding_authority_json: initial.bindingAuthority,
    provider_identity_json: identity,
    last_task_snapshot_json: base,
    execution_mode: 'live',
  });
  const history: {
    payload: Record<string, unknown>;
    accepted: boolean;
    source: string;
    type: string;
  }[] = [];
  const links = new Map<string, Record<string, unknown>>();
  const controls = new Map<string, Record<string, unknown>>();
  const attempts: Record<string, unknown>[] = [];
  const rejections: string[] = [];
  const sent: Record<string, unknown>[] = [];
  let sequence = 0;
  let inputId = 0;
  let tick = 0;
  let wireFails = false;
  let afterWire: (() => Promise<unknown>) | undefined;
  const now = () => new Date(Date.parse(at) + ++tick * 1000).toISOString();
  const rows = (values: Record<string, unknown>[] = []) => ({
    rows: values,
    rowCount: values.length,
  });
  const json = (value: unknown) =>
    typeof value === 'string' ? (JSON.parse(value) as Record<string, unknown>) : {};
  const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('SELECT * FROM remote_task_binding')) return rows([{ ...binding }]);
    if (sql.includes("AS status,payload_json->'inputRequests'")) {
      expect(sql).toContain("accepted AND observation_source<>'admission'");
      return rows(
        history
          .filter((h) => h.accepted && h.source !== 'admission' && h.type.startsWith('task.'))
          .map((h) => ({
            status: h.payload['status'],
            input_requests: h.payload['inputRequests'] ?? null,
          })),
      );
    }
    if (sql.includes('SELECT link.input_requests_json'))
      return rows(
        [...links.values()].filter(
          (link) =>
            ['update_acknowledged', 'update_uncertain', 'provider_advanced'].includes(
              String(link['status']),
            ) || attempts.some((a) => a['input_request_id'] === link['input_request_id']),
        ),
      );
    if (
      sql.includes('SELECT * FROM remote_task_input_link') ||
      sql.includes('SELECT link.* FROM remote_task_binding')
    ) {
      const link = links.get(String(values[0]));
      if (link === undefined) return rows();
      if (
        sql.includes('binding.version=$2') &&
        (link['status'] !== 'answered' ||
          binding['version'] !== values[1] ||
          controls.get(String(link['control_event_id']))?.['runtime_revision'] !==
            binding['runtime_revision'] ||
          binding['local_state'] !== 'awaiting_input')
      )
        return rows();
      return rows([{ ...link }]);
    }
    if (sql.includes('AS conflict'))
      return rows([
        {
          conflict: history.some(
            (h) =>
              h.accepted &&
              Object.entries((h.payload['inputRequests'] ?? {}) as Record<string, unknown>).some(
                ([key, value]) =>
                  Object.hasOwn(json(values[1]), key) &&
                  JSON.stringify(json(values[1])[key]) !== JSON.stringify(value),
              ),
          ),
        },
      ]);
    if (sql.includes('AS next_sequence')) return rows([{ next_sequence: history.length + 1 }]);
    if (sql.includes('INSERT INTO remote_task_observation')) {
      history.push({
        payload: json(values[6]),
        accepted: values[7] === true,
        source: String(values[10]),
        type: String(values[3]),
      });
      if (typeof values[8] === 'string') rejections.push(values[8]);
    }
    if (sql.includes('INSERT INTO remote_task_control_event')) {
      const event = {
        event_id: values[0],
        binding_id: values[1],
        event_type: values[2],
        remote_revision: values[3],
        runtime_revision: values[4],
        result_hash: values[5],
        payload_json: json(values[6]),
        status: 'pending',
        created_at: values[7],
        claimed_at: null,
        processed_at: null,
        error_code: null,
      };
      controls.set(String(values[0]), event);
      return rows([event]);
    }
    if (sql.includes('SELECT event.event_id')) {
      const event = controls.get(String(values[0]));
      if (
        event === undefined ||
        (sql.includes('event.runtime_revision=binding.runtime_revision') &&
          event['runtime_revision'] !== binding['runtime_revision'])
      )
        return rows();
      return rows([{ ...binding, ...event }]);
    }
    if (sql.includes('UPDATE agent_task')) return rows([{ task_id: 'task-1' }]);
    if (sql.includes('INSERT INTO remote_task_input_link')) {
      const columns = [
        'input_request_id',
        'control_event_id',
        'binding_id',
        'remote_task_id',
        'workflow_instance_id',
        'workflow_node_id',
        'workflow_node_run_id',
        'remote_revision',
        'result_hash',
      ];
      const link = Object.fromEntries(columns.map((key, i) => [key, values[i]]));
      Object.assign(link, {
        input_requests_json: json(values[9]),
        status: 'waiting',
        created_at: values[10],
        updated_at: values[10],
      });
      links.set(String(values[0]), link);
    }
    if (sql.includes('UPDATE remote_task_input_link')) {
      const link = links.get(String(values[0]));
      if (link === undefined) return rows();
      link['status'] = sql.includes("SET status='update_uncertain'")
        ? 'update_uncertain'
        : values[1];
      link['updated_at'] = values[sql.includes("SET status='update_uncertain'") ? 1 : 2];
      return rows([link]);
    }
    if (sql.includes('INSERT INTO remote_task_input_attempt')) {
      attempts.push({
        attempt_id: values[0],
        input_request_id: values[1],
        binding_id: values[2],
        status: values[4],
      });
    }
    if (sql.includes('UPDATE remote_task_binding')) {
      if (values[1] !== binding['version']) return rows();
      const set = sql.split('SET ')[1]?.split('WHERE ')[0] ?? '';
      for (const match of set.matchAll(/([a-z_]+)=(?:\$(\d+)|NULL|'([^']*)')/gu)) {
        const key = match[1];
        if (key === undefined) throw new Error('TEST_COLUMN_REQUIRED');
        const value = match[2] === undefined ? (match[3] ?? null) : values[Number(match[2]) - 1];
        binding[key] = key.endsWith('_json') && typeof value === 'string' ? json(value) : value;
      }
      binding['version'] = Number(binding['version']) + 1;
      return rows([{ ...binding }]);
    }
    if (sql.includes('UPDATE remote_task_control_event'))
      return rows([{ binding_id: 'binding-1' }]);
    return rows();
  });
  const pool = {
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  } as unknown as Pool;
  let wire: Record<string, unknown> = {};
  const client = new FrozenV1McpClient(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('TEST_WIRE_BODY_REQUIRED');
    const message = JSON.parse(init.body) as {
      id: number;
      method: string;
      params: { inputResponses: Record<string, unknown> };
    };
    if (message.method === 'tasks/update') {
      sent.push(message.params.inputResponses);
      const hook = afterWire;
      afterWire = undefined;
      await hook?.();
      if (wireFails) {
        wireFails = false;
        throw new Error('uncertain transport');
      }
    }
    return Response.json({
      jsonrpc: '2.0',
      id: message.id,
      result: message.method === 'tasks/update' ? { resultType: 'complete' } : wire,
    });
  });
  const inputs = () => new PostgresRemoteTaskInputRepository(pool);
  const remoteTasks = () => new PostgresRemoteTaskRepository(pool);
  const service = () => {
    const adapter = new FrozenV1RuntimeLifecycleAdapter({ client, now: () => at });
    return new RemoteTaskInputService({
      inputs: inputs(),
      remoteTasks: remoteTasks(),
      tasks: { findById: () => Promise.resolve(undefined) },
      continuations: {
        claimControl: ({ eventId }) => {
          const event = controls.get(eventId);
          if (event === undefined) return Promise.resolve(undefined);
          return Promise.resolve({
            eventId,
            bindingId: 'binding-1',
            type: 'task.input_required',
            remoteRevision: String(event['remote_revision']),
            runtimeRevision: String(event['runtime_revision']),
            resultHash: String(event['result_hash']),
            payload: event['payload_json'],
            status: 'claimed',
            createdAt: at,
          } as RemoteTaskControlEvent);
        },
        finishControl: () => Promise.resolve(),
      },
      sender: {
        updateRemoteTask: (input) =>
          adapter.update({ ...input, endpoint: 'https://provider.test/mcp', headers: {} }),
      },
      events: { publish: () => Promise.resolve() },
      pollQueue: {
        enqueue: () => Promise.resolve(),
        state: () => Promise.resolve('missing'),
        listDeadLetters: () => Promise.resolve([]),
        retryDeadLetter: () => Promise.resolve(),
      },
      schemas: new AjvJsonSchemaValidator(),
      serial: { run: (_id, operation) => operation() },
      clock: { now },
      ids: {
        nextInputRequestId: () => `input-${String(++inputId)}`,
        nextClaimToken: () => 'claim',
        nextEventId: () => `event-${String(tick)}`,
        nextProtocolAttemptId: () => `attempt-${String(tick)}`,
      },
    });
  };
  const observe = async (revision: string, keys: string[], instance = 'A') => {
    wire = {
      resultType: 'complete',
      taskId: 'remote-task-1',
      status: keys.length ? 'input_required' : 'working',
      createdAt: at,
      lastUpdatedAt: at,
      ttlMs: null,
      _meta: {
        'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision: revision },
        'io.sdar/providerIdentity': { ...identity, providerInstanceId: instance },
      },
      ...(keys.length
        ? { inputRequests: Object.fromEntries(keys.map((key) => [key, request])) }
        : {}),
    };
    const snapshot = await new FrozenV1RuntimeLifecycleAdapter({ client, now: () => at }).get({
      endpoint: 'https://provider.test/mcp',
      headers: {},
      remoteTaskId: 'remote-task-1',
      outputValidator: new AjvJsonSchemaValidator(),
    });
    const id = `observation-${String(++sequence)}`;
    const result = await remoteTasks().recordExternalSnapshot({
      bindingId: 'binding-1',
      expectedVersion: Number(binding['version']),
      snapshot,
      observationId: id,
      source: 'notification',
      controlEventId: `${id}-control`,
      resultHash: 'a'.repeat(64),
      observedAt: now(),
    });
    return result.applied ? result.controlEvent : undefined;
  };
  const lastLink = () => {
    const link = [...links.values()].at(-1);
    if (link === undefined) throw new Error('TEST_LINK_REQUIRED');
    return link;
  };
  const activate = async (control: RemoteTaskControlEvent | undefined) => {
    if (control === undefined) return;
    expect(
      await service().process({
        eventId: control.eventId,
        bindingId: 'binding-1',
        eventType: 'task.input_required',
      }),
    ).toBe('activated');
  };
  const sendCurrent = async () => {
    const link = lastLink();
    const responses = Object.fromEntries(
      Object.keys(link['input_requests_json'] as object).map((key) => [key, response]),
    );
    const prepared = await service().prepareResponse(String(link['input_request_id']), responses);
    link['status'] = 'answered'; // Models the existing durable A2A Task-input response transaction.
    await service().submitAnswer(String(link['input_request_id']), prepared);
  };
  return {
    binding,
    request,
    response,
    attempts,
    sent,
    rejections,
    service,
    inputs,
    observe,
    activate,
    lastLink,
    sendCurrent,
    answer: async (control: RemoteTaskControlEvent | undefined) => {
      if (control !== undefined) {
        await activate(control);
        await sendCurrent();
      }
    },
    failNextUpdate: () => {
      wireFails = true;
    },
    afterNextWire: (hook: () => Promise<unknown>) => {
      afterWire = hook;
    },
    basicInputObservation: () => {
      history.push({
        payload: { status: 'input_required' },
        accepted: true,
        source: 'notification',
        type: 'task.snapshot',
      });
    },
  };
}
