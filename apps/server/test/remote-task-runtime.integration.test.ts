import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyRuntimeMigrations } from '../src/runtime.js';
import {
  RemoteTaskAdmissionService,
  RemoteTaskPollingService,
  RemoteTaskReconciler,
  RemoteTaskInputService,
  type RemoteTaskPollJob,
  type RemoteTaskPollJobState,
  type RemoteTaskPollQueue,
  type RemoteTaskReadResult,
  type RemoteTaskSnapshotReader,
} from '../../../packages/application/src/index.js';
import {
  createRemoteTaskBinding,
  createRemoteTaskCancellationRequest,
  createWorkflowContinuationSnapshot,
  createTaskExecutionAttempt,
  type RemoteTaskAdmission,
} from '../../../packages/domain/src/index.js';
import {
  BullMqRemoteTaskPollQueue,
  BullMqRemoteTaskPollWorker,
  ContextSerialExecutor,
  type RedisConnectionConfig,
} from '../../../packages/runtime-redis/src/index.js';
import {
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskRepository,
  PostgresRemoteTaskCancellationRepository,
  PostgresRemoteTaskInputRepository,
  PostgresWorkflowContinuationRepository,
  PostgresAgentTaskRepository,
  PostgresRuntimeEventPublisher,
  PostgresRuntimeTerminalOutcomeRepository,
  PostgresTaskInputRepository,
  PostgresTaskAvailabilityEvidenceRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';

const databaseName = 'sdar_v11_remote_task_integration';
const adminConnection = 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = `postgresql://sdar:sdar_local_only@127.0.0.1:55432/${databaseName}`;
const redis: RedisConnectionConfig = { host: '127.0.0.1', port: 56379 };
const resources: { close(): Promise<void> }[] = [];
let pool: Pool;
let initializedPool: Pool | undefined;
let repository: PostgresRemoteTaskRepository;
let availabilityRepository: PostgresTaskAvailabilityEvidenceRepository;

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
  pool = new Pool({ connectionString: databaseConnection, max: 6 });
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
  await seedAuthorityRecords();
  repository = new PostgresRemoteTaskRepository(pool);
  availabilityRepository = new PostgresTaskAvailabilityEvidenceRepository(pool);
}, 60_000);

beforeEach(async () => {
  await pool.query(
    'TRUNCATE remote_task_input_attempt,remote_task_input_link,remote_task_cancel_attempt,remote_task_cancel_request,task_availability_snapshot,task_execution_readiness,workflow_continuation_attempt,workflow_continuation_wait_binding,workflow_continuation_snapshot,remote_task_protocol_attempt,remote_task_control_event,remote_task_observation,remote_task_binding',
  );
  await pool.query(
    `DELETE FROM task_execution_attempt WHERE input_request_id IN (
       SELECT input_request_id FROM task_input_request WHERE source='remote_task'
     );
     DELETE FROM task_input_response WHERE input_request_id IN (
       SELECT input_request_id FROM task_input_request WHERE source='remote_task'
     );
     DELETE FROM task_input_request WHERE source='remote_task';
     UPDATE agent_task SET phase='executing',phase_message='Remote operation accepted',
       error_code=NULL,updated_at='2026-07-16T08:00:00.000Z' WHERE task_id='remote-agent-task';
     UPDATE workflow_instance SET status='running',completed_at=NULL,errors_json='{}'::jsonb
       WHERE instance_id='remote-instance'`,
  );
  await pool.query("DELETE FROM mcp_invocation WHERE invocation_id LIKE 'remote-invocation-%'");
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

describe('PostgreSQL remote MCP Task authority', () => {
  it('round-trips generic Tool semantics with isolated V1.1 task metadata', async () => {
    const v11Registry = new PostgresMcpRegistryRepository(pool, { v11TaskMetadata: true });
    const defaultRegistry = new PostgresMcpRegistryRepository(pool);
    const declaredExecutionSemantics = {
      effect: 'side_effecting',
      execution: 'task_capable',
      cancellation: 'task_cancel',
      idempotency: 'client_request_key',
      replay: 'simulation_only',
      source: 'mcp_declared',
    } as const;
    const adminExecutionSemanticsOverride = {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'cooperative',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'admin_override',
    } as const;
    const taskExecution = {
      execution: 'task_capable',
      availability: 'dynamic',
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      cancellation: 'task_cancel',
      revision: '1.0',
    } as const;
    const reference = { serverId: 'mcp-semantics-coexistence', toolName: 'dispatch' };

    await v11Registry.saveServerAndReplaceTools(
      {
        server: {
          serverId: reference.serverId,
          name: 'MCP semantics coexistence fixture',
          endpoint: 'http://127.0.0.1:1/mcp',
          transport: 'streamable_http',
          status: 'enabled',
          toolRevision: 1,
          createdAt: '2026-07-16T08:00:00.000Z',
          updatedAt: '2026-07-16T08:00:00.000Z',
        },
        encryptedCredential: 'encrypted-test-value',
      },
      [
        {
          ...reference,
          inputSchema: { type: 'object', additionalProperties: false },
          declaredExecutionSemantics,
          adminExecutionSemanticsOverride,
          executionSemantics: declaredExecutionSemantics,
          taskExecution,
          discoveredAt: '2026-07-16T08:00:00.000Z',
        },
      ],
    );

    await expect(v11Registry.listTools(reference.serverId)).resolves.toEqual([
      expect.objectContaining({
        ...reference,
        declaredExecutionSemantics,
        adminExecutionSemanticsOverride,
        executionSemantics: declaredExecutionSemantics,
        taskExecution,
      }),
    ]);
    await expect(v11Registry.getTaskOperationSemantics(reference)).resolves.toEqual(taskExecution);

    const defaultTools = await defaultRegistry.listTools(reference.serverId);
    expect(defaultTools).toEqual([
      expect.objectContaining({
        ...reference,
        declaredExecutionSemantics,
        adminExecutionSemanticsOverride,
        executionSemantics: declaredExecutionSemantics,
      }),
    ]);
    expect(defaultTools[0]).not.toHaveProperty('taskExecution');
    await expect(defaultRegistry.getTaskOperationSemantics(reference)).resolves.toBeUndefined();
  });

  it('appends immutable planning and pre-invocation availability evidence', async () => {
    const planning = {
      readinessId: 'readiness-planning-1',
      workflowPlanId: 'remote-plan',
      planAttempt: 1,
      checkPhase: 'planning' as const,
      dslHash: 'a'.repeat(64),
      disposition: 'confirmation_required' as const,
      permittedActions: ['request_confirmation' as const],
      guardAction: 'request_confirmation' as const,
      guardReasonCodes: ['MCP_TASK_RISK_CONFIRMATION_REQUIRED:remote-node'],
      confirmationRequired: true,
      createdAt: '2026-07-16T08:00:01.000Z',
    };
    const snapshot = {
      snapshotId: 'availability-planning-1',
      readinessId: planning.readinessId,
      workflowPlanId: 'remote-plan',
      planAttempt: 1,
      checkPhase: 'planning' as const,
      nodeId: 'remote-node',
      serverId: 'remote-server',
      operationName: 'remote_operation',
      arguments: { unresolved: false as const, value: { route: 'A' } },
      argumentsHash: 'b'.repeat(64),
      timing: {
        start: { mode: 'immediate' as const, startToleranceMs: 0 },
        maxElapsedMs: null,
      },
      result: {
        nodeId: 'remote-node',
        operationName: 'remote_operation',
        availability: 'restricted' as const,
        riskLevel: 'high' as const,
        validUntil: '2026-07-16T08:10:00.000Z',
        earliestStartTime: '2026-07-16T08:02:00.000Z',
        nextAvailableWindows: [],
        reservationMode: 'best_effort' as const,
        possibleEffects: ['start_rejection' as const],
      },
      sourceRevision: '2026-07-28/1.0',
      checkedAt: '2026-07-16T08:00:01.000Z',
      normalizationReasonCodes: [],
    };
    await availabilityRepository.saveEvaluation(planning, [snapshot]);
    await expect(availabilityRepository.listByPlan('remote-plan')).resolves.toEqual([
      { readiness: planning, snapshots: [snapshot] },
    ]);
    await expect(availabilityRepository.saveEvaluation(planning, [snapshot])).rejects.toMatchObject(
      { code: 'TASK_READINESS_EVIDENCE_CONFLICT' },
    );

    const preInvocation = {
      ...planning,
      readinessId: 'readiness-precall-1',
      checkPhase: 'pre_invocation' as const,
      workflowInstanceId: 'remote-instance',
      workflowNodeRunId: 'remote-node-run-1',
      disposition: 'ready' as const,
      permittedActions: ['proceed' as const],
      guardAction: 'proceed' as const,
      guardReasonCodes: [],
      confirmationRequired: false,
      createdAt: '2026-07-16T08:00:02.000Z',
    };
    await availabilityRepository.saveEvaluation(preInvocation, []);
    const evidence = await availabilityRepository.listByPlan('remote-plan');
    expect(evidence.map((item) => item.readiness.checkPhase)).toEqual([
      'pre_invocation',
      'planning',
    ]);
  });

  it('preserves correlation and simulation identity while enforcing admission and poll CAS', async () => {
    await seedInvocation(1, 'simulation', 'simulation-1');
    await seedInvocation(2, 'simulation', 'simulation-1');
    const candidate = createRemoteTaskBinding(
      admission(1, {
        executionContext: { mode: 'simulation', simulationId: 'simulation-1' },
      }),
    );

    const first = await repository.admit(candidate, 'observation-admitted-1');
    const duplicate = await repository.admit(candidate, 'observation-admitted-duplicate');

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.binding).toMatchObject({
      agentTaskId: 'remote-agent-task',
      contextId: 'remote-context',
      goalId: 'remote-goal',
      goalVersion: 1,
      workflowPlanId: 'remote-plan',
      workflowDefinitionId: 'remote-workflow',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'remote-instance',
      workflowNodeRunId: 'remote-node-run-1',
      mcpInvocationId: 'remote-invocation-1',
      executionContext: { mode: 'simulation', simulationId: 'simulation-1' },
      version: 1,
    });
    await expect(repository.listObservations(candidate.bindingId)).resolves.toHaveLength(1);
    await expect(
      repository.admit(
        createRemoteTaskBinding(
          admission(2, {
            remoteTaskId: candidate.remoteTaskId,
            executionContext: { mode: 'simulation', simulationId: 'simulation-1' },
          }),
        ),
        'observation-conflict',
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_TASK_BINDING_CONFLICT' });

    const claims = await Promise.all([
      repository.claimPoll({
        bindingId: candidate.bindingId,
        expectedVersion: 1,
        claimToken: 'claim-a',
        claimedAt: '2026-07-16T08:00:01.000Z',
        expiresAt: '2026-07-16T08:00:31.000Z',
      }),
      repository.claimPoll({
        bindingId: candidate.bindingId,
        expectedVersion: 1,
        claimToken: 'claim-b',
        claimedAt: '2026-07-16T08:00:01.000Z',
        expiresAt: '2026-07-16T08:00:31.000Z',
      }),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(1);
    await expect(repository.findById(candidate.bindingId)).resolves.toMatchObject({
      pollAttempt: 1,
      version: 2,
    });
  });

  it('persists cooperative cancellation acknowledgement separately from Provider terminal state', async () => {
    await seedInvocation(20, 'live');
    const admitted = await repository.admit(
      createRemoteTaskBinding(admission(20)),
      'observation-cancel-admitted',
    );
    const cancellations = new PostgresRemoteTaskCancellationRepository(pool);
    const requested = await cancellations.requestCancellation(
      createRemoteTaskCancellationRequest({
        requestId: 'cancel-request-20',
        bindingId: admitted.binding.bindingId,
        idempotencyKey: 'cancel-key-20',
        source: 'task',
        reasonCode: 'user_cancel',
        summary: 'User requested cooperative cancellation.',
        requestedAt: '2026-07-16T08:00:01.000Z',
      }),
      admitted.binding.version,
    );
    expect(requested).toMatchObject({
      requested: true,
      request: { deliveryStatus: 'requested' },
    });
    if (!requested.requested) throw new Error('CANCELLATION_REQUEST_REQUIRED');
    expect(requested.request.providerTerminalStatus).toBeUndefined();
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'working',
      localState: 'cancel_observing',
    });
    const claimed = await cancellations.claimCancellation({
      requestId: requested.request.requestId,
      expectedVersion: requested.request.version,
      claimToken: 'cancel-claim-20',
      claimedAt: '2026-07-16T08:00:02.000Z',
      expiresAt: '2026-07-16T08:00:32.000Z',
    });
    if (!claimed.claimed) throw new Error('CANCELLATION_CLAIM_REQUIRED');
    await cancellations.recordCancellationAcknowledged({
      requestId: claimed.request.requestId,
      expectedVersion: claimed.request.version,
      claimToken: 'cancel-claim-20',
      attempt: {
        attemptId: 'cancel-attempt-20',
        requestId: claimed.request.requestId,
        bindingId: claimed.request.bindingId,
        expectedRequestVersion: claimed.request.version,
        protocolRevision: '2026-07-28',
        status: 'acknowledged',
        startedAt: '2026-07-16T08:00:02.000Z',
        completedAt: '2026-07-16T08:00:03.000Z',
        durationMs: 1_000,
      },
      acknowledgedAt: '2026-07-16T08:00:03.000Z',
      protocolRevision: '2026-07-28',
    });
    const acknowledged = await cancellations.findCancellation('cancel-request-20');
    expect(acknowledged).toMatchObject({ deliveryStatus: 'acknowledged' });
    expect(acknowledged?.providerTerminalStatus).toBeUndefined();
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'working',
      localState: 'cancel_observing',
    });

    const cancellationPollQueue = new RecordingPollQueue();
    const cancellationIds = sequentialIds();
    const cancellationPolling = pollingService(
      cancellationPollQueue,
      new SequenceReader([
        {
          kind: 'snapshot',
          snapshot: {
            remoteTaskId: admitted.binding.remoteTaskId,
            status: 'input_required',
            createdAt: admitted.binding.createdAt,
            lastUpdatedAt: '2026-07-16T08:00:04.000Z',
            ttlMs: 3_600_000,
            protocolRevision: '2026-07-28',
            tasksSchemaRevision: 'tasks-schema-revision-1',
            providerObservation: {
              revision: '1.0',
              remoteRevision: 'provider-input-after-cancel-20',
              eventId: 'provider-input-after-cancel-event-20',
            },
            inputRequests: {
              ignored_after_cancel: {
                method: 'elicitation/create',
                params: {
                  message: 'This request must not reopen the locally cancelled Task.',
                  requestedSchema: {
                    type: 'object',
                    required: ['answer'],
                    properties: { answer: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      ]),
      cancellationIds,
      () => '2026-07-16T08:00:05.000Z',
    );
    await expect(
      cancellationPolling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 2 }),
    ).resolves.toBe('cancel_observing');
    await expect(repository.listControlEvents(admitted.binding.bindingId)).resolves.toHaveLength(0);
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'input_required',
      localState: 'cancel_observing',
      version: 4,
    });

    const terminalPolling = pollingService(
      cancellationPollQueue,
      new SequenceReader([
        {
          kind: 'snapshot',
          snapshot: {
            remoteTaskId: admitted.binding.remoteTaskId,
            status: 'cancelled',
            createdAt: admitted.binding.createdAt,
            lastUpdatedAt: '2026-07-16T08:00:06.000Z',
            ttlMs: 3_600_000,
            protocolRevision: '2026-07-28',
            tasksSchemaRevision: 'tasks-schema-revision-1',
            providerObservation: {
              revision: '1.0',
              remoteRevision: 'provider-cancelled-revision-20',
              eventId: 'provider-cancelled-event-20',
            },
          },
        },
      ]),
      cancellationIds,
      () => '2026-07-16T08:00:07.000Z',
    );
    await expect(
      terminalPolling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 4 }),
    ).resolves.toBe('control_pending');
    await expect(cancellations.findCancellation('cancel-request-20')).resolves.toMatchObject({
      deliveryStatus: 'acknowledged',
      providerTerminalStatus: 'cancelled',
    });
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'cancelled',
      localState: 'terminal_event_pending',
      version: 6,
    });
    await expect(repository.listControlEvents(admitted.binding.bindingId)).resolves.toEqual([
      expect.objectContaining({ type: 'task.cancelled', status: 'pending' }),
    ]);
  });

  it('persists input_required, A2A-shaped answer and tasks/update acknowledgement without replanning', async () => {
    await seedInvocation(21, 'live');
    const admitted = await repository.admit(
      createRemoteTaskBinding(admission(21)),
      'observation-input-admitted',
    );
    const continuations = new PostgresWorkflowContinuationRepository(pool);
    await continuations.saveSnapshot(
      createWorkflowContinuationSnapshot({
        schemaVersion: '1.0',
        snapshotId: 'input-snapshot-21',
        continuationId: 'input-continuation-21',
        stateVersion: 1,
        lifecycle: 'active',
        agentTaskId: 'remote-agent-task',
        contextId: 'remote-context',
        workflowControlId: 'remote-control',
        goalId: 'remote-goal',
        goalVersion: 1,
        workflowPlanId: 'remote-plan',
        workflowDefinitionId: 'remote-workflow',
        workflowDefinitionVersion: 1,
        workflowDefinitionHash: 'b'.repeat(64),
        inputHash: 'c'.repeat(64),
        workflowInstanceId: 'remote-instance',
        input: {},
        waitingNodeRuns: [
          {
            waitId: 'input-wait-21',
            kind: 'remote_task',
            sourceId: admitted.binding.bindingId,
            nodeId: admitted.binding.workflowNodeId,
            nodeRunId: admitted.binding.workflowNodeRunId,
            state: 'waiting',
          },
        ],
        runnableFrontier: [],
        completedNodeRunIds: [],
        nodeRunCounts: { [admitted.binding.workflowNodeId]: 1 },
        outputs: {},
        errors: {},
        routes: {},
        loopCounts: {},
        recoveryCounts: {},
        parallelJoinState: [],
        failed: false,
        executionContext: { mode: 'live' },
        budgetLimits: {
          maxReplans: 2,
          maxDurationSeconds: 60,
          maxLlmCalls: 4,
          maxMcpCalls: 4,
          maxCost: 1,
        },
        budgetUsage: {
          replanCount: 0,
          durationMs: 10,
          llmCalls: 0,
          mcpCalls: 1,
          cost: 0,
        },
        createdAt: '2026-07-16T08:00:00.000Z',
        updatedAt: '2026-07-16T08:00:00.000Z',
      }),
    );
    const pollQueue = new RecordingPollQueue();
    const ids = sequentialIds();
    const inputRequests = {
      approval: {
        method: 'elicitation/create',
        params: {
          message: 'Approve remote execution?',
          requestedSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: { approved: { type: 'boolean' } },
          },
        },
      },
    };
    const providerInputSnapshot = {
      remoteTaskId: admitted.binding.remoteTaskId,
      status: 'input_required' as const,
      createdAt: admitted.binding.createdAt,
      lastUpdatedAt: '2026-07-16T08:00:01.000Z',
      ttlMs: 3_600_000,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-schema-revision-1',
      providerObservation: {
        revision: '1.0' as const,
        remoteRevision: 'provider-input-revision-21',
        eventId: 'provider-input-event-21',
      },
      inputRequests,
    };
    const polling = pollingService(
      pollQueue,
      new SequenceReader([
        {
          kind: 'snapshot',
          snapshot: providerInputSnapshot,
        },
      ]),
      ids,
      () => '2026-07-16T08:00:02.000Z',
    );
    await expect(
      polling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 1 }),
    ).resolves.toBe('control_pending');
    const [control] = await repository.listControlEvents(admitted.binding.bindingId);
    if (control === undefined) throw new Error('INPUT_CONTROL_REQUIRED');
    const inputRepository = new PostgresRemoteTaskInputRepository(pool);
    const sender = vi
      .fn()
      .mockResolvedValue({ acknowledged: true, protocolRevision: '2026-07-28' });
    const inputService = new RemoteTaskInputService({
      continuations,
      remoteTasks: repository,
      inputs: inputRepository,
      tasks: new PostgresAgentTaskRepository(pool),
      events: new PostgresRuntimeEventPublisher(pool),
      sender: { updateRemoteTask: sender },
      pollQueue,
      schemas: new AjvJsonSchemaValidator(),
      serial: new ContextSerialExecutor(),
      clock: { now: () => '2026-07-16T08:00:03.000Z' },
      ids: {
        nextInputRequestId: () => 'input-request-21',
        nextClaimToken: () => 'input-claim-21',
        nextProtocolAttemptId: () => 'input-attempt-21',
        nextEventId: () => 'input-runtime-event-21',
      },
    });
    await expect(
      inputService.process({
        eventId: control.eventId,
        bindingId: admitted.binding.bindingId,
        eventType: 'task.input_required',
      }),
    ).resolves.toBe('activated');
    const prepared = await inputService.prepareResponse('input-request-21', {
      approval: { action: 'accept', content: { approved: true } },
    });
    const taskInputs = new PostgresTaskInputRepository(pool);
    await taskInputs.answerAndCreateAttempt({
      inputRequestId: 'input-request-21',
      taskId: 'remote-agent-task',
      response: {
        inputResponseId: 'input-response-21',
        inputRequestId: 'input-request-21',
        taskId: 'remote-agent-task',
        content: prepared,
        createdAt: '2026-07-16T08:00:04.000Z',
      },
      attempt: createTaskExecutionAttempt({
        attemptId: 'task-attempt-input-21',
        taskId: 'remote-agent-task',
        contextId: 'remote-context',
        reason: 'input_response',
        inputRequestId: 'input-request-21',
        createdAt: '2026-07-16T08:00:04.000Z',
      }),
      answeredAt: '2026-07-16T08:00:04.000Z',
      continuationPhase: 'executing',
      phaseMessage: 'Remote input saved; tasks/update queued.',
    });
    await inputService.submitAnswer('input-request-21', prepared);

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteTaskId: admitted.binding.remoteTaskId,
        inputResponses: prepared,
      }),
    );
    await expect(inputRepository.findLink('input-request-21')).resolves.toMatchObject({
      status: 'update_acknowledged',
    });
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'input_required',
      localState: 'polling',
      version: 4,
    });
    expect(pollQueue.jobs.at(-1)?.job).toMatchObject({ expectedVersion: 4 });

    const echoPolling = pollingService(
      pollQueue,
      new SequenceReader([{ kind: 'snapshot', snapshot: providerInputSnapshot }]),
      ids,
      () => '2026-07-16T08:00:05.000Z',
    );
    await expect(
      echoPolling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 4 }),
    ).resolves.toBe('working');
    await expect(repository.listControlEvents(admitted.binding.bindingId)).resolves.toHaveLength(1);
    await expect(inputRepository.findLink('input-request-21')).resolves.toMatchObject({
      status: 'update_acknowledged',
    });
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'input_required',
      localState: 'polling',
      version: 6,
    });

    const secondInputRequests = {
      comment: {
        method: 'elicitation/create',
        params: {
          message: 'Provide the remote execution note.',
          requestedSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['note'],
            properties: { note: { type: 'string' } },
          },
        },
      },
    };
    const secondRoundPolling = pollingService(
      pollQueue,
      new SequenceReader([
        {
          kind: 'snapshot',
          snapshot: {
            ...providerInputSnapshot,
            lastUpdatedAt: '2026-07-16T08:00:06.000Z',
            providerObservation: {
              revision: '1.0',
              remoteRevision: 'provider-input-revision-22',
              eventId: 'provider-input-event-22',
            },
            inputRequests: secondInputRequests,
          },
        },
      ]),
      ids,
      () => '2026-07-16T08:00:07.000Z',
    );
    await expect(
      secondRoundPolling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 6 }),
    ).resolves.toBe('control_pending');
    const controls = await repository.listControlEvents(admitted.binding.bindingId);
    expect(controls).toHaveLength(2);
    const secondControl = controls.find(
      (candidate) => candidate.remoteRevision === 'provider-input-revision-22',
    );
    if (secondControl === undefined) throw new Error('SECOND_INPUT_CONTROL_REQUIRED');
    const secondInputService = new RemoteTaskInputService({
      continuations,
      remoteTasks: repository,
      inputs: inputRepository,
      tasks: new PostgresAgentTaskRepository(pool),
      events: new PostgresRuntimeEventPublisher(pool),
      sender: { updateRemoteTask: sender },
      pollQueue,
      schemas: new AjvJsonSchemaValidator(),
      serial: new ContextSerialExecutor(),
      clock: { now: () => '2026-07-16T08:00:08.000Z' },
      ids: {
        nextInputRequestId: () => 'input-request-22',
        nextClaimToken: () => 'input-claim-22',
        nextProtocolAttemptId: () => 'input-attempt-22',
        nextEventId: () => 'input-runtime-event-22',
      },
    });
    await expect(
      secondInputService.process({
        eventId: secondControl.eventId,
        bindingId: admitted.binding.bindingId,
        eventType: 'task.input_required',
      }),
    ).resolves.toBe('activated');
    const secondPrepared = await secondInputService.prepareResponse('input-request-22', {
      comment: { action: 'accept', content: { note: 'Proceed with audit logging.' } },
    });
    await taskInputs.answerAndCreateAttempt({
      inputRequestId: 'input-request-22',
      taskId: 'remote-agent-task',
      response: {
        inputResponseId: 'input-response-22',
        inputRequestId: 'input-request-22',
        taskId: 'remote-agent-task',
        content: secondPrepared,
        createdAt: '2026-07-16T08:00:09.000Z',
      },
      attempt: createTaskExecutionAttempt({
        attemptId: 'task-attempt-input-22',
        taskId: 'remote-agent-task',
        contextId: 'remote-context',
        reason: 'input_response',
        inputRequestId: 'input-request-22',
        createdAt: '2026-07-16T08:00:09.000Z',
      }),
      answeredAt: '2026-07-16T08:00:09.000Z',
      continuationPhase: 'executing',
      phaseMessage: 'Second remote input saved; tasks/update queued.',
    });
    await secondInputService.submitAnswer('input-request-22', secondPrepared);
    expect(sender).toHaveBeenCalledTimes(2);
    await expect(inputRepository.findLink('input-request-22')).resolves.toMatchObject({
      status: 'update_acknowledged',
    });
    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      localState: 'polling',
      version: 9,
    });
  });

  it('retains a poll across queue-client restart, backs off an unreachable Provider, and emits one terminal control', async () => {
    await seedInvocation(3, 'live');
    const queueName = `sdar-remote-vertical-${randomUUID()}`;
    const initialQueue = new BullMqRemoteTaskPollQueue({ connection: redis, queueName });
    resources.push(initialQueue);
    const ids = sequentialIds();
    const createdAt = new Date(Date.now() - 1_000).toISOString();
    const admitted = await new RemoteTaskAdmissionService({
      repository,
      queue: initialQueue,
      nextObservationId: ids.nextObservationId,
    }).admit(
      admission(3, {
        createdAt,
        nextPollAt: createdAt,
        lastProviderUpdatedAt: createdAt,
      }),
    );
    await initialQueue.close();
    resources.splice(resources.indexOf(initialQueue), 1);

    const restartedQueue = new BullMqRemoteTaskPollQueue({ connection: redis, queueName });
    resources.push(restartedQueue);
    const reconciler = new RemoteTaskReconciler({
      repository,
      queue: restartedQueue,
      clock: { now: () => new Date().toISOString() },
    });
    await expect(reconciler.reconcile()).resolves.toMatchObject({
      examined: 1,
      alreadyScheduled: 1,
    });

    const reader = new SequenceReader([
      { kind: 'provider_unreachable', errorCode: 'MCP_TASK_PROVIDER_UNREACHABLE' },
      {
        kind: 'snapshot',
        snapshot: {
          remoteTaskId: admitted.binding.remoteTaskId,
          status: 'completed',
          createdAt: admitted.binding.createdAt,
          lastUpdatedAt: new Date(Date.now() + 1_000).toISOString(),
          ttlMs: 3_600_000,
          protocolRevision: '2026-07-28',
          tasksSchemaRevision: 'tasks-schema-revision-1',
          providerObservation: {
            revision: '1.0',
            remoteRevision: 'provider-revision-terminal',
            substate: 'stopping',
            eventId: 'provider-event-terminal',
            progress: { percent: 100 },
          },
          result: { content: [], structuredContent: { ok: true }, isError: false },
        },
      },
    ]);
    const polling = pollingService(restartedQueue, reader, ids);
    const worker = new BullMqRemoteTaskPollWorker({
      connection: redis,
      queueName,
      processor: polling,
    });
    resources.unshift(worker);
    worker.start();
    await waitFor(async () => (await repository.findById(admitted.binding.bindingId))?.terminalAt);
    await worker.close();
    resources.splice(resources.indexOf(worker), 1);

    const binding = await repository.findById(admitted.binding.bindingId);
    expect(binding).toMatchObject({
      protocolStatus: 'completed',
      localState: 'terminal_event_pending',
      providerFailureCount: 0,
      resultSnapshot: { structuredContent: { ok: true } },
      version: 5,
    });
    await expect(repository.listControlEvents(admitted.binding.bindingId)).resolves.toEqual([
      expect.objectContaining({ type: 'task.completed', status: 'pending' }),
    ]);
    await expect(repository.listProtocolAttempts(admitted.binding.bindingId)).resolves.toEqual([
      expect.objectContaining({ status: 'provider_unreachable' }),
      expect.objectContaining({ status: 'succeeded' }),
    ]);
    const observations = await repository.listObservations(admitted.binding.bindingId);
    expect(observations.map((item) => item.type)).toEqual([
      'task.accepted',
      'provider_unreachable',
      'task.progress',
    ]);
    await expect(
      polling.process({ bindingId: admitted.binding.bindingId, expectedVersion: 1 }),
    ).resolves.toBe('stale');
    await expect(repository.listControlEvents(admitted.binding.bindingId)).resolves.toHaveLength(1);
  });

  it('audits an older Provider snapshot without rolling authoritative state backward', async () => {
    await seedInvocation(4, 'historical-replay', 'replay-4');
    const queue = new RecordingPollQueue();
    const ids = sequentialIds();
    const candidate = createRemoteTaskBinding(
      admission(4, {
        executionContext: { mode: 'historical-replay', simulationId: 'replay-4' },
        lastProviderUpdatedAt: '2026-07-16T08:05:00.000Z',
      }),
    );
    await repository.admit(candidate, ids.nextObservationId());
    const polling = pollingService(
      queue,
      new SequenceReader([
        {
          kind: 'snapshot',
          snapshot: {
            remoteTaskId: candidate.remoteTaskId,
            status: 'working',
            createdAt: candidate.createdAt,
            lastUpdatedAt: '2026-07-16T08:04:00.000Z',
            ttlMs: null,
            pollIntervalMs: 100,
            protocolRevision: candidate.protocolRevision,
            tasksSchemaRevision: candidate.tasksSchemaRevision,
            providerObservation: {
              revision: '1.0',
              remoteRevision: 'provider-revision-old',
              substate: 'queued',
            },
          },
        },
      ]),
      ids,
      () => '2026-07-16T08:06:00.000Z',
    );

    await expect(
      polling.process({ bindingId: candidate.bindingId, expectedVersion: 1 }),
    ).resolves.toBe('stale_provider_snapshot');
    await expect(repository.findById(candidate.bindingId)).resolves.toMatchObject({
      protocolStatus: 'working',
      lastProviderUpdatedAt: '2026-07-16T08:05:00.000Z',
      localState: 'polling',
      executionContext: { mode: 'historical-replay', simulationId: 'replay-4' },
      version: 3,
    });
    const observations = await repository.listObservations(candidate.bindingId);
    expect(observations.at(-1)).toMatchObject({
      accepted: false,
      rejectionReason: 'stale_provider_revision',
      remoteRevision: 'provider-revision-old',
    });
    await expect(repository.listControlEvents(candidate.bindingId)).resolves.toHaveLength(0);
    await expect(repository.listProtocolAttempts(candidate.bindingId)).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
    ]);
    expect(queue.jobs.at(-1)?.job).toEqual({ bindingId: candidate.bindingId, expectedVersion: 3 });
  });

  it('atomically turns local Task cancellation into a cooperative Provider cancellation request', async () => {
    await seedInvocation(22, 'live');
    const admitted = await repository.admit(
      createRemoteTaskBinding(admission(22)),
      'observation-cancel-from-task-admitted',
    );
    const terminalOutcomes = new PostgresRuntimeTerminalOutcomeRepository(pool);

    await expect(
      terminalOutcomes.commitCanceled({
        outcomeId: 'terminal-outcome-remote-cancel-22',
        taskId: 'remote-agent-task',
        goalId: 'remote-goal',
        goalVersion: 1,
        controlId: 'remote-control',
        summary: 'User canceled the parent A2A Task.',
        eventId: 'event-remote-cancel-22',
        committedAt: '2026-07-16T08:00:01.000Z',
      }),
    ).resolves.toMatchObject({ kind: 'canceled', taskId: 'remote-agent-task' });

    await expect(repository.findById(admitted.binding.bindingId)).resolves.toMatchObject({
      protocolStatus: 'working',
      localState: 'cancel_observing',
      version: 2,
    });
    const cancellations = new PostgresRemoteTaskCancellationRepository(pool);
    const requestId = `remote-cancel-${createHash('md5')
      .update(`${admitted.binding.bindingId}:remote-agent-task`)
      .digest('hex')}`;
    const request = await cancellations.findCancellation(requestId);
    expect(request).toMatchObject({
      bindingId: admitted.binding.bindingId,
      source: 'task',
      reasonCode: 'local_task_cancel',
      deliveryStatus: 'requested',
    });
    expect(request?.providerTerminalStatus).toBeUndefined();
  });
});

async function seedAuthorityRecords(): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('remote-context','remote-user','2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES('remote-goal','remote-context',1,'Remote Goal','Remote MCP Task integration','active',
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_plan(plan_id,goal_id,goal_version,goal_contract_json,definition_json,confirmation_status,attempt_count,created_at)
     VALUES('remote-plan','remote-goal',1,
            '{"goalId":"remote-goal","version":1,"title":"Remote Goal","description":"Remote MCP Task integration","constraints":[],"successCriteria":[]}'::jsonb,
            '{"workflowDefinitionId":"remote-workflow","version":1}'::jsonb,
            'confirmed',1,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES('remote-plan',1,
            '{"goalId":"remote-goal","version":1,"title":"Remote Goal","description":"Remote MCP Task integration","constraints":[],"successCriteria":[]}'::jsonb,
            '{}'::jsonb,'[]'::jsonb,true,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO agent_task(task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
                            goal_id,goal_version,plan_id,created_at,updated_at)
     VALUES('remote-agent-task','remote-context','remote-user','Run remote operation','{}'::jsonb,
            'executing','Remote operation accepted','remote-goal',1,'remote-plan',
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_instance(instance_id,plan_id,workflow_definition_id,workflow_version,
                                    goal_id,goal_version,status,input_json,errors_json,started_at)
     VALUES('remote-instance','remote-plan','remote-workflow',1,'remote-goal',1,'running',
            '{}'::jsonb,'{}'::jsonb,'2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO workflow_control(
       control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,
       skill_ids_json,planning_instruction,round_count,replan_count,created_at,updated_at)
     VALUES('remote-control','remote-context','remote-goal',1,'remote-agent-task','running',
            'remote-plan','{}'::jsonb,'[]'::jsonb,'Run remote integration.',0,0,
            '2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO mcp_server(server_id,name,endpoint,transport,status,tool_revision,
                            encrypted_credential,created_at,updated_at)
     VALUES('remote-server','Remote Provider','http://127.0.0.1:1','streamable_http','enabled',1,
            'encrypted-test-value','2026-07-16T08:00:00.000Z','2026-07-16T08:00:00.000Z')`,
  );
}

async function seedInvocation(
  sequence: number,
  mode: 'live' | 'simulation' | 'historical-replay',
  simulationId?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO mcp_invocation(invocation_id,task_id,context_id,server_id,tool_name,arguments_json,
                                result_json,status,started_at,completed_at,duration_ms,execution_mode,simulation_id)
     VALUES($1,'remote-agent-task','remote-context','remote-server','remote_operation','{}'::jsonb,
            '{"kind":"remote_task"}'::jsonb,'succeeded','2026-07-16T08:00:00.000Z',
            '2026-07-16T08:00:00.001Z',1,$2,$3)`,
    [`remote-invocation-${String(sequence)}`, mode, simulationId ?? null],
  );
}

function admission(
  sequence: number,
  overrides: Partial<RemoteTaskAdmission> = {},
): RemoteTaskAdmission {
  return {
    bindingId: `remote-binding-${String(sequence)}`,
    serverId: 'remote-server',
    operationName: 'remote_operation',
    remoteTaskId: `provider-task-${String(sequence).padStart(4, '0')}`,
    agentTaskId: 'remote-agent-task',
    contextId: 'remote-context',
    goalId: 'remote-goal',
    goalVersion: 1,
    workflowPlanId: 'remote-plan',
    workflowDefinitionId: 'remote-workflow',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'remote-instance',
    workflowNodeId: 'remote-node',
    workflowNodeRunId: `remote-node-run-${String(sequence)}`,
    mcpInvocationId: `remote-invocation-${String(sequence)}`,
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'tasks-schema-revision-1',
    providerSubstate: 'queued',
    remoteRevision: 'provider-revision-1',
    executionContext: { mode: 'live' },
    credentialRevision: 'credential-revision-1',
    sessionRevision: 'session-revision-1',
    lastProviderUpdatedAt: '2026-07-16T08:00:00.000Z',
    pollIntervalMs: 100,
    nextPollAt: '2026-07-16T08:00:00.000Z',
    createdAt: '2026-07-16T08:00:00.000Z',
    ...overrides,
  };
}

function pollingService(
  queue: RemoteTaskPollQueue,
  reader: RemoteTaskSnapshotReader,
  ids: ReturnType<typeof sequentialIds>,
  now: () => string = () => new Date().toISOString(),
): RemoteTaskPollingService {
  return new RemoteTaskPollingService({
    repository,
    queue,
    reader,
    serial: new ContextSerialExecutor(),
    clock: { now },
    ids,
    hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    options: {
      minimumPollIntervalMs: 100,
      providerFailureBackoffBaseMs: 100,
      providerFailureBackoffMaximumMs: 100,
      claimLeaseMs: 1_000,
    },
  });
}

function sequentialIds() {
  let sequence = 0;
  const next = (kind: string) => `${kind}-${String(++sequence)}`;
  return {
    nextObservationId: () => next('observation'),
    nextControlEventId: () => next('control'),
    nextClaimToken: () => next('claim'),
    nextProtocolAttemptId: () => next('protocol-attempt'),
  };
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
  readonly jobs: { job: RemoteTaskPollJob; runAt: string }[] = [];

  enqueue(job: RemoteTaskPollJob, runAt: string): Promise<void> {
    this.jobs.push({ job, runAt });
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

async function waitFor(predicate: () => Promise<unknown>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('REMOTE_TASK_INTEGRATION_WAIT_TIMEOUT');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}
