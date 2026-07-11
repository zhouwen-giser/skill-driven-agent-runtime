import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TaskService } from '../../application/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresExternalTaskProjectionRepository,
  PostgresMcpRegistryRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresSkillRepository,
} from '../src/index.js';
import { createSkillVersion } from '../../domain/src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar';
const pool = new Pool({ connectionString, max: 4 });

beforeAll(async () => {
  const migration = await readFile(
    new URL('../../../infra/postgres/migrations/0002_protocol_domain.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(migration);
  const projectionMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0003_external_task_projection.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(projectionMigration);
  const taskRequestMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0004_task_request.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskRequestMigration);
  const projectionDecouplingMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0005_projection_decoupling.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(projectionDecouplingMigration);
  const skillDraftMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0006_skill_draft.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillDraftMigration);
  const skillRegistryMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0007_skill_registry.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillRegistryMigration);
  const mcpRegistryMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0008_mcp_registry.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(mcpRegistryMigration);
  const mcpAuditMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0009_mcp_audit.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(mcpAuditMigration);
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE mcp_invocation, mcp_dependency_warning, mcp_tool, mcp_server, skill_version, skill, external_task_projection, runtime_event, agent_task, goal, conversation_context CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL protocol-domain repositories', () => {
  it('stores encrypted MCP credentials and atomically replaces discovered Tool definitions', async () => {
    const repository = new PostgresMcpRegistryRepository(pool);
    const record = {
      server: {
        serverId: 'mcp.devices',
        name: 'Devices',
        endpoint: 'https://mcp.example.test/mcp',
        transport: 'streamable_http' as const,
        status: 'enabled' as const,
        toolRevision: 1,
        createdAt: '2026-07-11T10:00:00.000Z',
        updatedAt: '2026-07-11T10:00:00.000Z',
      },
      encryptedCredential: '{"v":1,"ciphertext":"not-plaintext"}',
    };
    await repository.saveServerAndReplaceTools(record, [
      {
        serverId: 'mcp.devices',
        toolName: 'status',
        inputSchema: { type: 'object' },
        discoveredAt: '2026-07-11T10:00:00.000Z',
      },
    ]);
    const skills = new PostgresSkillRepository(pool);
    const dependentSkill = createSkillVersion({
      skillId: 'skill.mcp-dependent',
      version: 1,
      name: 'MCP dependent',
      summary: 'Uses MCP status.',
      description: 'Uses the registered status Tool.',
      capabilities: ['status'],
      workflowGuidance: 'Call status.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: {
        required: [{ serverId: 'mcp.devices', toolName: 'status' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-11T10:00:30.000Z',
    });
    await skills.saveVersionAndSetCurrent(dependentSkill, dependentSkill.createdAt);
    await repository.saveServerAndReplaceTools(
      {
        ...record,
        server: { ...record.server, toolRevision: 2, updatedAt: '2026-07-11T10:01:00.000Z' },
      },
      [
        {
          serverId: 'mcp.devices',
          toolName: 'inspect',
          inputSchema: { type: 'object' },
          discoveredAt: '2026-07-11T10:01:00.000Z',
        },
      ],
      [{ toolName: 'status', reason: 'removed' }],
    );
    await repository.saveInvocation({
      invocationId: 'invocation-1',
      taskId: 'task-1',
      contextId: 'context-1',
      serverId: 'mcp.devices',
      toolName: 'inspect',
      arguments: { deviceId: 'device-1' },
      result: { status: 'online' },
      status: 'succeeded',
      startedAt: '2026-07-11T10:02:00.000Z',
      completedAt: '2026-07-11T10:02:00.025Z',
      durationMs: 25,
    });
    await repository.updateToolEnhancement('mcp.devices', 'inspect', {
      purpose: 'Inspect device',
      scenarios: ['maintenance'],
      constraints: ['read-only'],
      returnDescription: 'Inspection result',
      commonErrors: ['offline'],
      tags: ['device'],
    });

    await expect(repository.findServer('mcp.devices')).resolves.toMatchObject({
      server: { toolRevision: 2 },
      encryptedCredential: record.encryptedCredential,
    });
    await expect(repository.listTools('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'inspect',
        enhancement: expect.objectContaining({ purpose: 'Inspect device', tags: ['device'] }),
      }),
    ]);
    const raw = await pool.query<{ encrypted_credential: string }>(
      'SELECT encrypted_credential FROM mcp_server WHERE server_id = $1',
      ['mcp.devices'],
    );
    expect(raw.rows[0]?.encrypted_credential).not.toContain('Bearer');
    await expect(repository.listDependencyWarnings('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'status',
        reason: 'removed',
        skillId: 'skill.mcp-dependent',
        skillVersion: 1,
      }),
    ]);
    await expect(repository.listInvocations('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        invocationId: 'invocation-1',
        status: 'succeeded',
        durationMs: 25,
        arguments: { deviceId: 'device-1' },
        result: { status: 'online' },
      }),
    ]);
  });

  it('atomically stores immutable Skill versions and publishes only the enabled current version', async () => {
    const repository = new PostgresSkillRepository(pool);
    const first = createSkillVersion({
      skillId: 'skill.inspect',
      version: 1,
      name: 'Inspect',
      summary: 'Inspect devices.',
      description: 'Inspects a device using registered tools.',
      capabilities: ['inspection'],
      workflowGuidance: 'Inspect safely.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-11T10:00:00.000Z',
    });
    await repository.saveVersionAndSetCurrent(first, first.createdAt);
    const second = createSkillVersion({
      ...first,
      version: 2,
      previousVersion: 1,
      status: 'disabled',
      createdAt: '2026-07-11T10:01:00.000Z',
    });
    await repository.saveVersionAndSetCurrent(second, second.createdAt);

    await expect(repository.findVersion(first.skillId, 1)).resolves.toEqual(first);
    await expect(repository.findCurrentVersion(first.skillId)).resolves.toEqual(second);
    await expect(repository.listEnabledVersions()).resolves.toEqual([]);
  });

  it('persists TaskService context/task/event and reads domain values back', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const events = new PostgresRuntimeEventPublisher(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });

    const submitted = await service.submit({
      userId: 'user-1',
      messageText: 'Inspect device status.',
      metadata: {},
    });
    const storedContext = await contexts.findById(submitted.context.contextId);
    const storedTask = await tasks.findById(submitted.task.taskId);
    const eventResult = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM runtime_event WHERE task_id = $1',
      [submitted.task.taskId],
    );

    expect(storedContext).toEqual(submitted.context);
    expect(storedTask).toEqual(submitted.task);
    expect(eventResult.rows[0]?.count).toBe('1');
  });

  it('updates task state without creating a duplicate system-of-record row', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const events = new PostgresRuntimeEventPublisher(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({ messageText: 'Inspect.', metadata: {} });
    const canceled = await service.cancel(submitted.task.taskId);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM agent_task WHERE task_id = $1',
      [submitted.task.taskId],
    );

    expect(await tasks.findById(canceled.taskId)).toEqual(canceled);
    expect(count.rows[0]?.count).toBe('1');
  });

  it('persists and filters rebuildable external task projections', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events: new PostgresRuntimeEventPublisher(pool),
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({ messageText: 'Project this task.', metadata: {} });
    const projections = new PostgresExternalTaskProjectionRepository(pool);
    await projections.save({
      protocol: 'a2a-v1',
      taskId: submitted.task.taskId,
      contextId: submitted.context.contextId,
      state: 'TASK_STATE_SUBMITTED',
      statusTimestamp: submitted.task.updatedAt,
      document: { id: submitted.task.taskId },
    });

    expect(await projections.find('a2a-v1', submitted.task.taskId)).toMatchObject({
      taskId: submitted.task.taskId,
      state: 'TASK_STATE_SUBMITTED',
    });
    await expect(
      projections.list({
        protocol: 'a2a-v1',
        contextId: submitted.context.contextId,
        state: 'TASK_STATE_SUBMITTED',
        offset: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it('persists Skill requests only as drafts', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const drafts = new PostgresSkillDraftRepository(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events: new PostgresRuntimeEventPublisher(pool),
      skillDrafts: drafts,
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({
      messageText: 'Create a read-only Skill.',
      metadata: {},
      skillDraftIntent: 'create',
    });

    await expect(drafts.listByContextId(submitted.context.contextId)).resolves.toEqual([
      expect.objectContaining({ status: 'draft', intent: 'create' }),
    ]);
  });

  it('applies the migration idempotently', async () => {
    const migration = await readFile(
      new URL('../../../infra/postgres/migrations/0002_protocol_domain.up.sql', import.meta.url),
      'utf8',
    );
    await expect(pool.query(migration)).resolves.toBeDefined();
    const marker = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migration WHERE version = '0002_protocol_domain'",
    );
    expect(marker.rows[0]?.count).toBe('1');
  });
});

function sequenceIds(): Readonly<{ nextId(kind: 'context' | 'task' | 'event'): string }> {
  const counters = { context: 0, task: 0, event: 0 };
  return {
    nextId: (kind) => `${kind}-${String(++counters[kind])}`,
  };
}
