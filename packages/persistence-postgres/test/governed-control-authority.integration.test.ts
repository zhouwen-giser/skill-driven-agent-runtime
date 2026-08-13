import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  FrozenMcpRegistryService,
  GovernedControlConfirmationService,
  GovernedControlInvocationAuthorizer,
  GovernedControlManagementService,
  McpRegistryService,
  RemoteTaskAdmissionService,
  governedControlSnapshotHash,
  type CurrentGovernedCapabilityAuthority,
  type GovernedControlConfirmation,
  type FrozenMcpRefreshResult,
  type RemoteTaskPollQueue,
} from '../../application/src/index.js';
import { deriveFrozenMcpCatalogAuthority } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  FrozenV1McpClient,
  FrozenV1RegistryAdapter,
  FrozenV1RuntimeLifecycleAdapter,
  startFrozenMcpTasksMockProvider,
  type FrozenMcpTasksMockProviderHandle,
} from '../../mcp-adapter/src/index.js';
import {
  PostgresGovernedControlAuthorityRepository,
  PostgresGovernedControlManagementAuthorityReader,
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskRepository,
} from '../src/index.js';

const databaseName = 'sdar_v14_governed_control_authority_integration';
const adminConnection =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = replaceDatabase(adminConnection, databaseName);

const taskId = 'task-governed-control';
const planId = 'plan-governed-control';
const bindingId = 'binding-governed-control';
const attemptId = 'attempt-governed-control';
const capabilityId = 'vehicle.ugv.move';
const capabilityVersion = 1;
const skillId = 'embodied.move_to';
const skillVersion = 3;
const serverId = 'smpp-ugv-provider';
const toolName = 'embodied.move';
const providerBindingId = 'provider-binding-ugv';
const providerId = 'provider-ugv';
const arguments_ = Object.freeze({
  resourceId: 'ugv-1',
  target: Object.freeze({ x: 12, y: 8, frame: 'map' }),
});
const planDefinition = Object.freeze({
  workflowDefinitionId: 'workflow-governed-control',
  version: 1,
  nodes: [
    {
      id: 'move-ugv',
      type: 'mcp_tool',
      serverId,
      toolName,
      arguments: arguments_,
    },
  ],
});
const planHash = governedControlSnapshotHash(planDefinition);
const argumentsHash = governedControlSnapshotHash(arguments_);
const constraints = Object.freeze(controlConstraints());

let pool: Pool;
let poolOpened = false;
let databaseCreated = false;
let provider: FrozenMcpTasksMockProviderHandle | undefined;
let registration: FrozenMcpRefreshResult;

const testCipher = Object.freeze({
  encrypt: () => 'encrypted-test-only',
  decrypt: () => Object.freeze({}),
});

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: databaseConnection, max: 4 });
  poolOpened = true;
  await applyRuntimeMigrations(pool);
  provider = await startFrozenMcpTasksMockProvider({
    moveTo: { outcome: 'remote_success' },
    createdAt: '2026-08-13T01:00:00.000Z',
  });
  registration = await new FrozenMcpRegistryService({
    repository: new PostgresMcpRegistryRepository(pool),
    discovery: new FrozenV1RegistryAdapter(new FrozenV1McpClient()),
    cipher: testCipher,
    clock: { now: () => '2026-08-13T01:00:00.000Z' },
    nextSnapshotId: () => 'snapshot-governed-control',
    baselineSha256: 'a'.repeat(64),
  }).register({
    serverId,
    name: 'Governed Control Provider',
    endpoint: provider.endpoint.href,
    credentialHeaders: {},
  });
  await seedExactAuthority();
}, 60_000);

afterAll(async () => {
  await provider?.close();
  if (!databaseCreated) return;
  if (poolOpened) await pool.end();
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

describe('PostgreSQL governed physical-control authority', () => {
  it('executes one governed fake Provider dispatch and durably reconciles terminal evidence', async () => {
    const fakeProvider = provider;
    if (fakeProvider === undefined) throw new Error('GOVERNED_CONTROL_PROVIDER_NOT_STARTED');
    let physicalDeviceWrites = 0;
    const authorityRepository = new PostgresGovernedControlAuthorityRepository(pool);
    const management = new GovernedControlManagementService({
      authority: new PostgresGovernedControlManagementAuthorityReader(pool),
      confirmations: new GovernedControlConfirmationService({
        store: authorityRepository,
        clock: { now: () => '2026-08-13T01:00:00.000Z' },
        ids: { nextConfirmationId: () => 'confirmation-governed-000-positive' },
      }),
      clock: { now: () => '2026-08-13T01:00:00.000Z' },
    });
    const issued = await management.issue({
      taskId,
      reason: 'Approve one bounded fake UGV movement for governed-control integration.',
      ttlMs: 5 * 60 * 1_000,
      principal: {
        actorId: 'human:operator-1',
        kind: 'human',
        authenticationMethod: 'oidc-mfa',
        permissions: new Set<'physical_control.confirm'>(['physical_control.confirm']),
        requestId: 'request-governed-positive',
      },
    });
    expect(issued).toMatchObject({
      confirmation: {
        confirmationId: 'confirmation-governed-000-positive',
        taskId,
        capabilityAttemptId: attemptId,
        providerBindingId,
        serverId,
        toolName,
        argumentsHash,
      },
      authority: {
        capabilityBindingId: bindingId,
        capabilityId,
        capabilityVersion,
        planId,
        planHash,
        skillId,
        skillVersion,
        arguments: arguments_,
      },
    });

    const catalog = deriveFrozenMcpCatalogAuthority(
      registration.snapshot,
      registration.tools,
      registration.server.toolRevision,
    );
    let invocationSequence = 0;
    const registryRepository = new PostgresMcpRegistryRepository(pool);
    const registry = new McpRegistryService({
      repository: registryRepository,
      cipher: testCipher,
      schemas: new AjvJsonSchemaValidator(),
      frozenLifecycle: new FrozenV1RuntimeLifecycleAdapter({
        client: new FrozenV1McpClient(),
        now: () => '2026-08-13T01:01:00.000Z',
      }),
      providerBindings: {
        loadCurrentMcpProviderBinding: ({ bindingId: requestedBindingId, localServerId }) =>
          Promise.resolve({
            observedAt: '2026-08-13T01:01:00.000Z',
            binding: {
              bindingId: requestedBindingId ?? providerBindingId,
              revision: registration.server.toolRevision,
              localServerId,
              providerId,
              endpointRef: registration.server.endpoint,
              catalogRevision: catalog.catalogRevision,
              catalogChecksum: catalog.catalogChecksum,
              operationCount: catalog.operationCount,
              availabilityValidUntil: '2026-08-13T01:10:00.000Z',
            },
          }),
      },
      controlAuthority: authorizer(authorityRepository, '2026-08-13T01:01:00.000Z'),
      clock: { now: () => '2026-08-13T01:01:00.000Z' },
      ids: {
        nextInvocationId: () => `invocation-governed-positive-${String(++invocationSequence)}`,
        nextManagementOperationId: () => 'unused-governed-management-operation',
      },
    });
    const callContext = {
      taskId,
      contextId: 'context-governed-control',
      capabilityAttemptId: attemptId,
      providerBindingId,
      providerId,
    } as const;
    const receipt = await registry.callDetailed(
      serverId,
      toolName,
      arguments_,
      undefined,
      callContext,
    );
    expect(receipt).toMatchObject({
      invocationId: 'invocation-governed-positive-1',
      outcome: {
        kind: 'remote_task',
        task: { status: 'working' },
        reconciledTask: {
          status: 'completed',
          result: {
            isError: false,
            structuredContent: {
              resourceId: 'ugv-1',
              status: 'completed',
              finalPosition: { x: 12, y: 8, frame: 'map' },
            },
            evidence: [expect.objectContaining({ evidenceType: 'position.observation' })],
          },
        },
      },
    });
    expect(fakeProvider.toolCallCount).toBe(1);
    await expect(registryRepository.listInvocationsByTask(taskId)).resolves.toEqual([
      expect.objectContaining({
        invocationId: receipt.invocationId,
        taskId,
        capabilityAttemptId: attemptId,
        controlConfirmationId: issued.confirmation.confirmationId,
        controlProviderBindingId: providerBindingId,
        controlArgumentsHash: argumentsHash,
        controlDispatchHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        executionMode: 'live',
        serverId,
        toolName,
        executionSemantics: controlExecutionSemantics(),
        status: 'succeeded',
      }),
    ]);

    await expect(
      registry.callDetailed(serverId, toolName, arguments_, undefined, callContext),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
    expect(fakeProvider.toolCallCount).toBe(1);

    if (
      receipt.outcome.kind !== 'remote_task' ||
      receipt.outcome.reconciledTask === undefined ||
      receipt.protocolContract === undefined ||
      receipt.taskBehavior === undefined
    )
      throw new Error('GOVERNED_CONTROL_REMOTE_TERMINAL_AUTHORITY_MISSING');
    const remote = receipt.outcome.task;
    const reconciled = receipt.outcome.reconciledTask;
    const runtimeRevision = remote.runtimeRevision;
    if (runtimeRevision === undefined)
      throw new Error('GOVERNED_CONTROL_REMOTE_RUNTIME_REVISION_MISSING');
    const remoteTasks = new PostgresRemoteTaskRepository(pool);
    const scheduledPolls: { bindingId: string; expectedVersion: number }[] = [];
    const pollQueue: RemoteTaskPollQueue = {
      enqueue(input) {
        scheduledPolls.push(input);
        return Promise.resolve();
      },
      state: () => Promise.resolve('scheduled'),
      listDeadLetters: () => Promise.resolve([]),
      retryDeadLetter: () => Promise.resolve(),
    };
    const admission = await new RemoteTaskAdmissionService({
      repository: remoteTasks,
      queue: pollQueue,
      nextObservationId: () => 'observation-governed-admission',
    }).admit({
      bindingId: 'remote-binding-governed-control',
      serverId,
      operationName: toolName,
      remoteTaskId: remote.remoteTaskId,
      agentTaskId: taskId,
      contextId: 'context-governed-control',
      goalId: 'goal-governed-control',
      goalVersion: 1,
      workflowPlanId: planId,
      workflowDefinitionId: 'workflow-governed-control',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'workflow-instance-governed-control',
      workflowNodeId: 'move-ugv',
      workflowNodeRunId: 'move-ugv:1',
      mcpInvocationId: receipt.invocationId,
      protocolStatus: remote.status,
      protocolRevision: remote.protocolRevision,
      tasksSchemaRevision: remote.tasksSchemaRevision,
      protocolContract: receipt.protocolContract,
      taskBehavior: receipt.taskBehavior,
      runtimeRevision,
      ...(remote.providerRevision === undefined
        ? {}
        : { providerRevision: remote.providerRevision }),
      ...(remote.ttlMs === null
        ? {}
        : {
            taskTtlMs: remote.ttlMs,
            taskExpiresAt:
              remote.expiresAt ??
              new Date(Date.parse(remote.createdAt) + remote.ttlMs).toISOString(),
          }),
      ...(remote.providerObservation?.substate === undefined
        ? {}
        : { providerSubstate: remote.providerObservation.substate }),
      ...(remote.providerObservation?.remoteRevision === undefined
        ? {}
        : { remoteRevision: remote.providerObservation.remoteRevision }),
      executionContext: { mode: 'live' },
      credentialRevision: receipt.credentialRevision,
      sessionRevision: receipt.sessionRevision,
      lastProviderUpdatedAt: remote.lastUpdatedAt,
      pollIntervalMs: Math.max(100, remote.pollIntervalMs ?? 1_000),
      createdAt: '2026-08-13T01:01:00.000Z',
    });
    expect(admission).toMatchObject({ created: true, pollScheduled: true });
    expect(scheduledPolls).toEqual([
      { bindingId: 'remote-binding-governed-control', expectedVersion: 1 },
    ]);
    const reconciliation = await remoteTasks.recordExternalSnapshot({
      bindingId: admission.binding.bindingId,
      expectedVersion: admission.binding.version,
      snapshot: reconciled,
      observationId: 'observation-governed-reconciliation',
      source: 'reconciliation',
      controlEventId: 'control-event-governed-completed',
      resultHash: governedControlSnapshotHash(reconciled),
      observedAt: '2026-08-13T01:01:01.000Z',
    });
    expect(reconciliation).toMatchObject({
      applied: true,
      binding: {
        localState: 'terminal_event_pending',
        protocolStatus: 'completed',
        resultSnapshot: {
          isError: false,
          structuredContent: {
            resourceId: 'ugv-1',
            status: 'completed',
            finalPosition: { x: 12, y: 8, frame: 'map' },
          },
          evidence: [expect.objectContaining({ evidenceType: 'position.observation' })],
        },
      },
      controlEvent: {
        eventId: 'control-event-governed-completed',
        type: 'task.completed',
        status: 'pending',
      },
    });
    await expect(remoteTasks.listObservations(admission.binding.bindingId)).resolves.toEqual([
      expect.objectContaining({ source: 'admission', accepted: true }),
      expect.objectContaining({ source: 'reconciliation', accepted: true }),
    ]);
    await expect(remoteTasks.listControlEvents(admission.binding.bindingId)).resolves.toEqual([
      expect.objectContaining({
        eventId: 'control-event-governed-completed',
        type: 'task.completed',
        status: 'pending',
      }),
    ]);
    physicalDeviceWrites += 0;
    expect(physicalDeviceWrites).toBe(0);
  }, 30_000);

  it('survives restart, revokes and expires fail closed, and enforces FK/immutability', async () => {
    let physicalDeviceWrites = 0;
    const initial = confirmationService(
      new PostgresGovernedControlAuthorityRepository(pool),
      'confirmation-governed-live',
      '2026-08-13T01:00:00.000Z',
    );
    await expect(
      initial.issue(confirmationInput('2026-08-13T01:05:00.000Z')),
    ).resolves.toMatchObject({
      confirmationId: 'confirmation-governed-live',
      taskId,
      capabilityBindingId: bindingId,
      capabilityId,
      planId,
      planHash,
      skillId,
      actorId: 'human:operator-1',
    });

    const afterIssueRestart = await openRestartedRepository();
    try {
      const snapshot = await afterIssueRestart.repository.load({
        taskId,
        capabilityAttemptId: attemptId,
        providerBindingId,
        serverId,
        toolName,
        argumentsHash,
      });
      expect(snapshot).toMatchObject({
        task: { taskId, phase: 'executing', planId },
        binding: { bindingId, capabilityId, capabilityVersion },
        attempt: {
          attemptId,
          status: 'running',
          providerBindingRefs: [providerBindingId],
        },
        plan: { planId, confirmationStatus: 'confirmed', definitionHash: planHash },
        skill: {
          skillId,
          skillVersion,
          currentVersion: skillVersion,
          status: 'enabled',
        },
        readiness: {
          checkPhase: 'pre_invocation',
          serverId,
          operationName: toolName,
          argumentsHash,
          riskLevel: 'medium',
        },
        confirmation: {
          confirmationId: 'confirmation-governed-live',
          actorKind: 'human',
        },
      });
      expect(snapshot?.confirmation).not.toHaveProperty('revokedAt');
      expect(snapshot?.confirmation).not.toHaveProperty('revokedBy');
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).resolves.toMatchObject({
        confirmationId: 'confirmation-governed-live',
        invocationId: 'invocation-governed-control',
        dispatchHash: `sha256:${'d'.repeat(64)}`,
        consumedAt: '2026-08-13T01:01:00.000Z',
      });
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:01.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:02.000Z').authorizeAndConsume({
          ...invocation(),
          invocationId: 'invocation-governed-other',
          dispatchHash: `sha256:${'e'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
      const invocationAudit = new PostgresMcpRegistryRepository(afterIssueRestart.pool);
      const auditRecord = {
        invocationId: 'invocation-governed-control',
        taskId,
        capabilityAttemptId: attemptId,
        controlConfirmationId: 'confirmation-governed-live',
        controlProviderBindingId: providerBindingId,
        controlArgumentsHash: argumentsHash,
        controlDispatchHash: `sha256:${'d'.repeat(64)}`,
        contextId: 'context-governed-control',
        executionMode: 'live' as const,
        serverId,
        toolName,
        executionSemantics: invocation().executionSemantics,
        arguments: arguments_,
        status: 'failed' as const,
        errorCode: 'TEST_NO_PROVIDER_DISPATCH',
        errorMessage: 'Deterministic audit fixture; no Provider transport was called.',
        startedAt: '2026-08-13T01:01:00.000Z',
        completedAt: '2026-08-13T01:01:00.000Z',
        durationMs: 0,
      };
      await expect(
        invocationAudit.saveInvocation({
          ...auditRecord,
          invocationId: 'invocation-governed-mismatched',
          controlDispatchHash: `sha256:${'e'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: '23503' });
      await invocationAudit.saveInvocation(auditRecord);
      await expect(invocationAudit.listInvocationsByTask(taskId)).resolves.toContainEqual(
        expect.objectContaining({
          invocationId: 'invocation-governed-control',
          controlConfirmationId: 'confirmation-governed-live',
          controlProviderBindingId: providerBindingId,
          controlArgumentsHash: argumentsHash,
          controlDispatchHash: `sha256:${'d'.repeat(64)}`,
        }),
      );
      expect(physicalDeviceWrites).toBe(0);

      const revocable = confirmationService(
        afterIssueRestart.repository,
        'confirmation-governed-revocable',
        '2026-08-13T01:01:10.000Z',
      );
      await revocable.issue(confirmationInput('2026-08-13T01:05:00.000Z'));
      const revocation = new GovernedControlConfirmationService({
        store: afterIssueRestart.repository,
        clock: { now: () => '2026-08-13T01:01:30.000Z' },
        ids: { nextConfirmationId: () => 'unused-confirmation-id' },
      });
      await expect(
        revocation.revoke({
          confirmationId: 'confirmation-governed-revocable',
          actorId: 'human:operator-2',
          actorKind: 'human',
          authenticationMethod: 'oidc-mfa',
          actorRoles: ['physical_control_approver'],
        }),
      ).resolves.toMatchObject({
        revokedAt: '2026-08-13T01:01:30.000Z',
        revokedBy: 'human:operator-2',
      });
    } finally {
      await afterIssueRestart.pool.end();
    }

    const afterRevokeRestart = await openRestartedRepository();
    try {
      await expect(
        authorizer(afterRevokeRestart.repository, '2026-08-13T01:02:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterRevokeRestart.repository.load({
          taskId,
          capabilityAttemptId: attemptId,
          providerBindingId,
          serverId,
          toolName,
          argumentsHash,
        }),
      ).resolves.toMatchObject({
        confirmation: {
          confirmationId: 'confirmation-governed-revocable',
          revokedAt: '2026-08-13T01:01:30.000Z',
          revokedBy: 'human:operator-2',
        },
      });
      expect(physicalDeviceWrites).toBe(0);
    } finally {
      await afterRevokeRestart.pool.end();
    }

    const expiring = confirmationService(
      new PostgresGovernedControlAuthorityRepository(pool),
      'confirmation-governed-expiring',
      '2026-08-13T01:02:30.000Z',
    );
    await expiring.issue(confirmationInput('2026-08-13T01:03:00.000Z'));
    const afterExpiryRestart = await openRestartedRepository();
    try {
      await expect(
        authorizer(afterExpiryRestart.repository, '2026-08-13T01:04:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterExpiryRestart.repository.load({
          taskId,
          capabilityAttemptId: attemptId,
          providerBindingId,
          serverId,
          toolName,
          argumentsHash,
        }),
      ).resolves.toMatchObject({
        confirmation: {
          confirmationId: 'confirmation-governed-expiring',
          expiresAt: '2026-08-13T01:03:00.000Z',
        },
      });
      expect(physicalDeviceWrites).toBe(0);
    } finally {
      await afterExpiryRestart.pool.end();
    }

    await expect(
      pool.query(
        `UPDATE governed_control_confirmation
            SET reason='Attempted scope mutation'
          WHERE confirmation_id='confirmation-governed-expiring'`,
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        `DELETE FROM governed_control_confirmation
          WHERE confirmation_id='confirmation-governed-expiring'`,
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const repository = new PostgresGovernedControlAuthorityRepository(pool);
    await expect(
      repository.saveConfirmation({
        ...confirmationRecord('confirmation-invalid-fk', '2026-08-13T01:05:00.000Z'),
        taskId: 'task-that-does-not-exist',
      }),
    ).rejects.toMatchObject({ code: '23503' });
    physicalDeviceWrites += 0;
    expect(physicalDeviceWrites).toBe(0);
  });
});

function confirmationService(
  store: PostgresGovernedControlAuthorityRepository,
  confirmationId: string,
  now: string,
): GovernedControlConfirmationService {
  return new GovernedControlConfirmationService({
    store,
    clock: { now: () => now },
    ids: { nextConfirmationId: () => confirmationId },
  });
}

function confirmationInput(expiresAt: string) {
  return {
    taskId,
    capabilityBindingId: bindingId,
    capabilityId,
    capabilityVersion,
    capabilityAttemptId: attemptId,
    planId,
    planHash,
    skillId,
    skillVersion,
    providerBindingId,
    serverId,
    toolName,
    argumentsHash,
    actorId: 'human:operator-1',
    actorKind: 'human' as const,
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve one bounded deterministic UGV movement Task.',
    expiresAt,
  };
}

function confirmationRecord(
  confirmationId: string,
  expiresAt: string,
): GovernedControlConfirmation {
  return {
    confirmationId,
    taskId,
    capabilityBindingId: bindingId,
    capabilityId,
    capabilityVersion,
    capabilityAttemptId: attemptId,
    planId,
    planHash,
    skillId,
    skillVersion,
    providerBindingId,
    serverId,
    toolName,
    argumentsHash,
    actorId: 'human:operator-1',
    actorKind: 'human',
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve one bounded deterministic UGV movement Task.',
    confirmedAt: '2026-08-13T01:00:00.000Z',
    expiresAt,
  };
}

function invocation() {
  return {
    invocationId: 'invocation-governed-control',
    dispatchHash: `sha256:${'d'.repeat(64)}`,
    taskId,
    capabilityAttemptId: attemptId,
    providerBindingId,
    serverId,
    toolName,
    arguments: arguments_,
    executionSemantics: controlExecutionSemantics(),
  };
}

function authorizer(store: PostgresGovernedControlAuthorityRepository, now: string) {
  return new GovernedControlInvocationAuthorizer({
    store,
    capabilities: { load: () => Promise.resolve(currentCapability()) },
    clock: { now: () => now },
  });
}

function currentCapability(): CurrentGovernedCapabilityAuthority {
  return {
    definition: {
      capability_id: capabilityId,
      version: capabilityVersion,
      status: 'published',
      risk_level: 'medium',
      supported_modes: ['plan_confirmed', 'remote_task'],
      constraints,
    },
    implementationBindings: [
      {
        capability_id: capabilityId,
        capability_version: capabilityVersion,
        implementation_type: 'skill',
        implementation_id: skillId,
        implementation_version: String(skillVersion),
        role: 'primary',
        status: 'active',
        provider_policy_override: {
          selection: 'required',
          mcpProviderBindingId: providerBindingId,
          localServerId: serverId,
          mcpToolName: toolName,
          allowedResourceIds: ['ugv-1'],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
      },
    ],
  };
}

async function openRestartedRepository(): Promise<{
  pool: Pool;
  repository: PostgresGovernedControlAuthorityRepository;
}> {
  const restartedPool = new Pool({ connectionString: databaseConnection, max: 1 });
  await restartedPool.query('SELECT 1');
  return {
    pool: restartedPool,
    repository: new PostgresGovernedControlAuthorityRepository(restartedPool),
  };
}

async function seedExactAuthority(): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-governed-control','human:operator-1',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,status,created_at,updated_at)
      VALUES('goal-governed-control','context-governed-control',1,
             'Bounded UGV movement','Move one deterministic UGV.','active',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES($1,$2,'2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at)
      VALUES($1,$2,'Governed UGV Movement','Bounded physical UGV movement.',
       'Requires exact Task, Capability, plan, readiness, Provider and human confirmation.',
       $3::jsonb,'Invoke the exact required Tool once.','Return confirmed state evidence.',
       '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,$4::jsonb,$5::jsonb,
       'enabled','admin',true,'2026-08-13T01:00:00.000Z')`,
    [
      skillId,
      skillVersion,
      JSON.stringify([capabilityId]),
      JSON.stringify({
        required: [{ serverId, toolName }],
        optional: [],
        forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
      }),
      JSON.stringify({ autoConfirmPlan: false, maxMcpCalls: 1 }),
    ],
  );
  await pool.query(
    `INSERT INTO runtime_skill_version_governance(
       skill_id,skill_version,lifecycle_status,lock_version,updated_by,reason,created_at,updated_at)
     VALUES($1,$2,'published',1,'human:operator-1','Approved exact bounded fixture.',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_outcome_specification(
       skill_id,skill_version,schema_version,specification_hash,specification_json,created_at)
     VALUES($1,$2,'1.0',$3,$4::jsonb,'2026-08-13T01:00:00.000Z')`,
    [
      skillId,
      skillVersion,
      `sha256:${'1'.repeat(64)}`,
      JSON.stringify({
        schemaVersion: '1.0',
        sideEffectPolicy: {
          sideEffecting: true,
          confirmation: 'required_before_execution',
          autoConfirmPlan: false,
          allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
          realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
          exactResourceRequired: true,
          remoteTaskIdentityRequired: true,
          terminalObservationRequired: true,
          redispatchAfterUncertain: false,
        },
      }),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES($1,'goal-governed-control',1,$2::jsonb,$3::jsonb,
            'confirmed',1,'2026-08-13T01:00:00.000Z')`,
    [
      planId,
      JSON.stringify({
        goalId: 'goal-governed-control',
        version: 1,
        title: 'Bounded UGV movement',
        description: 'Move one deterministic UGV.',
        constraints: [],
        successCriteria: [],
      }),
      JSON.stringify(planDefinition),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(
       plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES($1,1,$2::jsonb,$3::jsonb,'[]'::jsonb,true,'2026-08-13T01:00:00.000Z')`,
    [
      planId,
      JSON.stringify({
        goalId: 'goal-governed-control',
        version: 1,
        title: 'Bounded UGV movement',
        description: 'Move one deterministic UGV.',
        constraints: [],
        successCriteria: [],
      }),
      JSON.stringify(planDefinition),
    ],
  );
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,selected_skill_id,selected_skill_version,created_at,updated_at)
      VALUES($1,'context-governed-control','human:operator-1','Move ugv-1 to the bounded map target.',
            '{}'::jsonb,'executing','Executing governed control.','goal-governed-control',1,
            $2,$3,$4,'2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [taskId, planId, skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES('workflow-instance-governed-control',$1,'workflow-governed-control',1,
            'goal-governed-control',1,'running',$2::jsonb,'{}'::jsonb,
            '2026-08-13T01:00:10.000Z')`,
    [planId, JSON.stringify(arguments_)],
  );
  await pool.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,
       input_snapshot,success_criteria_snapshot,evidence_requirement_snapshot,
       constraint_snapshot,initial_implementation_refs,binding_hash,bound_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,
            '2026-08-13T01:00:00.000Z')`,
    [
      bindingId,
      taskId,
      capabilityId,
      capabilityVersion,
      JSON.stringify(arguments_),
      JSON.stringify([{ type: 'remote_task_terminal', required: true }]),
      JSON.stringify([
        {
          type: 'required_evidence',
          evidenceType: 'position.observation',
          required: true,
          hardGate: true,
        },
      ]),
      JSON.stringify(constraints),
      JSON.stringify([`skill:${skillId}:${String(skillVersion)}`]),
      '2'.repeat(64),
    ],
  );
  await pool.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,skill_version_refs,
       provider_binding_refs,reason,status,started_at)
     VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,'initial','running',
            '2026-08-13T01:00:10.000Z')`,
    [
      attemptId,
      taskId,
      bindingId,
      planId,
      JSON.stringify([`skill:${skillId}:${String(skillVersion)}`]),
      JSON.stringify([providerBindingId]),
    ],
  );
  await pool.query(
    `INSERT INTO task_execution_readiness(
       readiness_id,workflow_plan_id,plan_attempt,check_phase,workflow_instance_id,
       workflow_node_run_id,dsl_hash,disposition,permitted_actions_json,guard_action,
       guard_reason_codes_json,confirmation_required,created_at)
     VALUES('readiness-governed-control',$1,1,'pre_invocation',
            'workflow-instance-governed-control','move-ugv:1',$2,'ready',
            '["execute"]'::jsonb,'proceed','[]'::jsonb,false,
            '2026-08-13T01:00:30.000Z')`,
    [planId, planHash],
  );
  await pool.query(
    `INSERT INTO task_availability_snapshot(
       snapshot_id,readiness_id,node_id,server_id,operation_name,
       arguments_snapshot_json,arguments_hash,result_json,availability,risk_level,
       reservation_mode,valid_until,source_revision,checked_at,normalization_reason_codes_json)
     VALUES('availability-governed-control','readiness-governed-control','move-ugv',
             $1,$2,$3::jsonb,$4,'{"available":true}'::jsonb,'available','medium','none',
            '2026-08-13T01:10:00.000Z','catalog-governed-control-v1',
            '2026-08-13T01:00:30.000Z','[]'::jsonb)`,
    [serverId, toolName, JSON.stringify(arguments_), argumentsHash],
  );
}

function controlConstraints() {
  return [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['ugv-1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      allowedResourceIds: ['ugv-1'],
      executionSemantics: controlExecutionSemantics(),
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    { type: 'exact_skill_version', skillId, skillVersion, taskType: toolName },
    {
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    },
    {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      allowEnvironment: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
      runIdEnvironment: 'REAL_UGV_TEST_RUN_ID',
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
  ];
}

function controlExecutionSemantics() {
  return {
    effect: 'side_effecting' as const,
    execution: 'task_capable' as const,
    cancellation: 'task_cancel' as const,
    idempotency: 'client_request_key' as const,
    replay: 'simulation_only' as const,
    source: 'mcp_declared' as const,
  };
}
