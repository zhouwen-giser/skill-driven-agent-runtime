import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  startServerRuntime,
  type ServerRuntimeHandle,
  type ServerRuntimeOptions,
} from '../src/runtime.js';
import type { RegisterSkillVersionInput } from '../../../packages/application/src/index.js';
import {
  confirmA2ATestPlan,
  getA2ATestTask,
  submitA2ATestTask,
} from '../../../packages/a2a-adapter/test-support/client.js';
import { startMcpTasksMockProvider } from '../../../packages/mcp-adapter/src/index.js';
import { obliterateTestQueues } from '../../../packages/runtime-redis/test-support/queue.js';

const adminConnection =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const redis = { host: '127.0.0.1', port: 56379 } as const;
const databaseName = `sdar_v11_restart_${randomUUID().replaceAll('-', '')}`;
const databaseConnection = replaceDatabase(adminConnection, databaseName);
const queueName = `sdar-v11-restart-${randomUUID()}`;
const remoteQueueName = `${queueName}-remote`;
const masterKeyBase64 = randomBytes(32).toString('base64');

let databaseCreated = false;

afterAll(async () => {
  if (!databaseCreated) return;
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
});

describe('production ServerRuntime remote Task restart recovery', () => {
  it('reconciles PostgreSQL waiting_external state without replaying tools/call or an ordinary running Task', async () => {
    await createIsolatedDatabase();
    const provider = await startMcpTasksMockProvider();
    const modelServer = await startRestartModelLoopback();
    const modelAddress = modelServer.address();
    if (modelAddress === null || typeof modelAddress === 'string')
      throw new Error('RESTART_MODEL_ADDRESS_UNAVAILABLE');

    let firstRuntime: ServerRuntimeHandle | undefined;
    let secondRuntime: ServerRuntimeHandle | undefined;
    const database = new Pool({ connectionString: databaseConnection, max: 4 });
    const serverId = `mcp.tasks.restart.${randomUUID()}`;
    const skillId = `skill.tasks.restart.${randomUUID()}`;
    const ordinaryTaskId = `task-ordinary-running-${randomUUID()}`;
    try {
      firstRuntime = await startRuntime({
        applyMigrations: true,
        minimumPollIntervalMs: 2_000,
      });
      await configureModelRuntime(firstRuntime, modelAddress.port);
      await firstRuntime.registerMcpServer({
        serverId,
        name: 'Restart acceptance MCP Tasks Provider',
        endpoint: provider.endpoint.toString(),
        credentialHeaders: {},
      });
      await firstRuntime.registerSkill(restartSkill(skillId, serverId));

      const submitted = await submitA2ATestTask(
        firstRuntime.a2a.client,
        `MCP_TASK_RESTART GLOBAL_SHARED_SKILL:${skillId}`,
      );
      expect(submitted.state).toBe('input_required');

      const confirmed = await confirmA2ATestPlan(
        firstRuntime.a2a.client,
        submitted,
        'Confirm the restart acceptance plan.',
      );
      expect(confirmed.state).toBe('working');

      const beforeRestart = await waitForRow<{
        binding_id: string;
        workflow_instance_id: string;
      }>(database, {
        sql: `SELECT binding_id,workflow_instance_id
                FROM remote_task_binding
                WHERE agent_task_id=$1 AND local_state='polling'`,
        values: [submitted.id],
      });
      const workflowBeforeRestart = await waitForRow<{ status: string; errors_json: unknown }>(
        database,
        {
          sql: "SELECT status,errors_json FROM workflow_instance WHERE instance_id=$1 AND status<>'running'",
          values: [beforeRestart.workflow_instance_id],
        },
      );
      const restartDiagnostics = {
        workflowBeforeRestart,
        workflows: (
          await database.query(
            `SELECT wi.instance_id,wi.status,wi.plan_id
               FROM workflow_instance wi
               JOIN agent_task task ON task.plan_id=wi.plan_id
               WHERE task.task_id=$1`,
            [submitted.id],
          )
        ).rows,
        continuations: (
          await database.query(
            'SELECT workflow_instance_id,lifecycle FROM workflow_continuation_snapshot WHERE agent_task_id=$1',
            [submitted.id],
          )
        ).rows,
      };
      expect(restartDiagnostics.workflowBeforeRestart).toEqual({
        status: 'waiting_external',
        errors_json: {},
      });
      expect(countRequests(provider.requests, 'tools/call')).toBe(1);
      // Admission always performs one authoritative first observation; the long interval keeps
      // the remaining resuming/completed observations for the restarted runtime.
      expect(countRequests(provider.requests, 'tasks/get')).toBe(1);

      await firstRuntime.close();
      firstRuntime = undefined;
      await insertOrdinaryRunningTask(database, ordinaryTaskId);
      const ordinaryBefore = await taskSnapshot(database, ordinaryTaskId);
      expect(ordinaryBefore).toMatchObject({ phase: 'executing', error_code: null });

      // Simulate total loss of the ephemeral runtime queues after the process has stopped.
      await obliterateTestQueues(redis, [
        queueName,
        remoteQueueName,
        `${remoteQueueName}-continuations`,
        `${remoteQueueName}-cancellations`,
      ]);

      secondRuntime = await startRuntime({
        applyMigrations: false,
        minimumPollIntervalMs: 10,
      });
      await waitForRow(database, {
        sql: "SELECT binding_id FROM remote_task_binding WHERE binding_id=$1 AND protocol_status='completed' AND terminal_at IS NOT NULL",
        values: [beforeRestart.binding_id],
        timeoutMs: 10_000,
      });
      const finalTask = await waitForRow<{
        phase: string;
        error_code: string | null;
        phase_message: string;
      }>(database, {
        sql: "SELECT phase,error_code,phase_message FROM agent_task WHERE task_id=$1 AND phase IN ('completed','failed','canceled')",
        values: [submitted.id],
        timeoutMs: 10_000,
      });
      expect(finalTask).toEqual({
        phase: 'completed',
        error_code: null,
        phase_message: 'Task completed.',
      });

      const a2aTask = await getA2ATestTask(secondRuntime.a2a.client, submitted.id);
      expect(a2aTask.state).toBe('completed');
      expect(countRequests(provider.requests, 'tools/call')).toBe(1);
      expect(countRequests(provider.requests, 'tasks/get')).toBeGreaterThanOrEqual(3);
      await expect(taskSnapshot(database, ordinaryTaskId)).resolves.toMatchObject({
        phase: 'failed',
        phase_message: 'Process stopped during execution; V1 does not recover or retry.',
        error_code: 'PROCESS_EXECUTION_LOST',
      });
    } finally {
      await secondRuntime?.close().catch(() => undefined);
      await firstRuntime?.close().catch(() => undefined);
      await database.end();
      await provider.close();
      modelServer.close();
      await once(modelServer, 'close').catch(() => undefined);
    }
  }, 30_000);
});

async function createIsolatedDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: databaseConnection });
  try {
    const bootstrap = await readFile(
      new URL('../../../infra/postgres/init/0001_sdar_bootstrap.up.sql', import.meta.url),
      'utf8',
    );
    await pool.query(bootstrap);
  } finally {
    await pool.end();
  }
}

function startRuntime(
  input: Readonly<{ applyMigrations: boolean; minimumPollIntervalMs: number }>,
): Promise<ServerRuntimeHandle> {
  const options: ServerRuntimeOptions = {
    postgresUrl: databaseConnection,
    redis,
    masterKeyBase64,
    queueName,
    applyMigrations: input.applyMigrations,
    a2aWaitTimeoutMs: 250,
    a2aSafetyPollIntervalMs: 250,
    v11McpTasks: {
      isolationAcknowledged: true,
      queueName: remoteQueueName,
      reconcileIntervalMs: 25,
      polling: {
        minimumPollIntervalMs: input.minimumPollIntervalMs,
        maximumPollIntervalMs: Math.max(input.minimumPollIntervalMs, 30_000),
        providerFailureBackoffBaseMs: 10,
        providerFailureBackoffMaximumMs: 50,
      },
    },
    skillSelection: {
      embeddings: {
        embed: () => Promise.resolve({ providerId: 'embedding.restart.v1', vector: [1, 0, 0] }),
      },
    },
  };
  return startServerRuntime(options);
}

async function configureModelRuntime(runtime: ServerRuntimeHandle, port: number): Promise<void> {
  const providerResponse = await fetch(
    `${runtime.management.baseUrl}/api/v1/models/providers/provider.restart`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Restart acceptance model',
        kind: 'openai_compatible',
        apiStyle: 'openai_chat_completions',
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        model: 'model-restart',
        enabled: true,
        timeoutMs: 2_000,
        credentialHeaders: { Authorization: 'Bearer restart-test-only' },
      }),
    },
  );
  if (providerResponse.status !== 204)
    throw new Error(`RESTART_MODEL_PROVIDER_SETUP_FAILED:${await providerResponse.text()}`);

  for (const stage of [
    'intent',
    'goal',
    'tool_enhancement',
    'skill_selection',
    'skill_input_resolution',
    'workflow_planning',
    'execution_decision',
    'result_processing',
    'goal_evaluation',
    'evaluation',
  ] as const) {
    const route = await fetch(`${runtime.management.baseUrl}/api/v1/models/routes/${stage}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider.restart' }),
    });
    if (route.status !== 204)
      throw new Error(`RESTART_MODEL_ROUTE_SETUP_FAILED:${stage}:${await route.text()}`);
    const prompt = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptId: `prompt.${stage}.restart`,
        stage,
        content: `Restart acceptance ${stage}. {{instruction}}`,
        source: 'admin',
        publish: true,
      }),
    });
    if (prompt.status !== 201)
      throw new Error(`RESTART_MODEL_PROMPT_SETUP_FAILED:${stage}:${await prompt.text()}`);
  }
}

function restartSkill(skillId: string, serverId: string): RegisterSkillVersionInput {
  return {
    skillId,
    name: 'Zebra remote Task restart acceptance',
    summary: 'Exercises durable remote Task observation across a ServerRuntime restart.',
    description: 'Calls one deterministic remote MCP Task and returns its result.',
    capabilities: ['restart-acceptance'],
    workflowGuidance: 'Call the required Tool exactly once.',
    outputInstruction: 'Return the structured remote Task result.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string' } },
    },
    toolPolicy: {
      required: [{ serverId, toolName: 'task_pause_resume_observation' }],
      optional: [],
      forbidden: [],
    },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
  };
}

async function startRestartModelLoopback(): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          model?: string;
          messages?: { content?: string }[];
        };
        const content = body.messages?.map((message) => message.content ?? '').join('\n') ?? '';
        response.setHeader('content-type', 'application/json');
        if (request.url?.endsWith('/chat/completions') !== true) {
          response.end(
            JSON.stringify({
              model: 'model-restart',
              data: [{ embedding: [1, 0, 0] }],
              usage: { prompt_tokens: 1 },
            }),
          );
          return;
        }
        if (content.includes('decide_task_intent')) {
          respondStructured(response, {
            intent: 'execute',
            summary: 'Execute the restart acceptance Task.',
          });
          return;
        }
        if (content.includes('formulate_goal')) {
          const data = operationPayload(content, 'formulate_goal') as { requestText: string };
          respondStructured(response, {
            title: 'Recover one remote MCP Task',
            description: data.requestText,
            constraints: ['Call the side-effecting Tool exactly once.'],
            successCriteria: ['The persisted remote result is returned after restart.'],
            requiresInput: false,
          });
          return;
        }
        if (content.includes('select_skill')) {
          const data = operationPayload(content, 'select_skill') as {
            goalContract: { description: string };
            candidates: { skillId: string }[];
          };
          const requested = /GLOBAL_SHARED_SKILL:([A-Za-z0-9._-]+)/u.exec(
            data.goalContract.description,
          )?.[1];
          const selected = data.candidates.find((candidate) => candidate.skillId === requested);
          if (selected === undefined) throw new Error('RESTART_SKILL_CANDIDATE_MISSING');
          respondStructured(response, {
            selectedSkillId: selected.skillId,
            decisionSummary: 'Selected the explicit restart acceptance Skill.',
          });
          return;
        }
        if (content.includes('resolve_top_level_skill_input')) {
          respondStructured(response, {
            structuredInput: {},
            unresolvedFields: [],
            sourceRefs: ['restart:request'],
            decisionSummary: 'The Skill has no required input fields.',
          });
          return;
        }
        if (content.includes('task_initial_plan')) {
          const data = operationPayload(content, 'task_initial_plan') as {
            workflowIdentity: {
              workflowDefinitionId: string;
              version: number;
              goalId: string;
              goalVersion: number;
            };
            selectedSkill: {
              toolPolicy: { required: { serverId: string; toolName: string }[] };
            };
          };
          const tool = data.selectedSkill.toolPolicy.required[0];
          if (tool === undefined) throw new Error('RESTART_REQUIRED_TOOL_MISSING');
          respondStructured(response, {
            ...data.workflowIdentity,
            entryNodeId: 'tool',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'tool',
                name: 'Start durable remote Task',
                type: 'mcp_tool',
                tool,
                arguments: {},
              },
              {
                nodeId: 'result',
                name: 'Return recovered result',
                type: 'result',
                value: { op: 'ref', path: ['nodes', 'tool'] },
              },
            ],
            edges: [{ sourceNodeId: 'tool', targetNodeId: 'result' }],
          });
          return;
        }
        if (content.includes('mcp_task_availability_risk_decision')) {
          respondStructured(response, {
            action: 'proceed',
            acceptedRiskNodeIds: [],
            summary: 'The available low-risk Task may proceed after confirmation.',
          });
          return;
        }
        if (content.includes('process_workflow_result')) {
          respondStructured(response, {
            text: 'Remote Task recovered and completed.',
            structured: { status: 'online' },
            keyFacts: [{ name: 'status', value: 'online', confidence: 1 }],
            valueAssessment: { valuable: true, summary: 'The recovered result is usable.' },
            memoryCandidates: [],
          });
          return;
        }
        if (content.includes('evaluate_task_component')) {
          const data = operationPayload(content, 'evaluate_task_component') as {
            component: string;
          };
          respondStructured(response, {
            score: 1,
            summary: `${data.component} survived restart without duplicate execution.`,
            findings: ['PostgreSQL recovery evidence is consistent.'],
            evidenceRefs: [`restart:${data.component}`],
          });
          return;
        }
        if (content.includes('refine_memory')) {
          const data = operationPayload(content, 'refine_memory') as {
            candidate: {
              type: string;
              content: Record<string, unknown>;
              summary: string;
              confidence: number;
              authorityHint: string;
            };
          };
          respondStructured(response, {
            type: data.candidate.type,
            content: data.candidate.content,
            summary: data.candidate.summary,
            confidence: data.candidate.confidence,
            durability: 'durable',
            authority: data.candidate.authorityHint,
            durabilityReason: 'The acceptance evidence is a stable execution experience.',
          });
          return;
        }
        if (content.includes('enhance_mcp_tool_metadata')) {
          respondStructured(response, {
            purpose: 'Exercise a deterministic MCP Tasks acceptance scenario.',
            scenarios: ['restart acceptance'],
            constraints: ['Use only in tests.'],
            returnDescription: 'A deterministic protocol result.',
            commonErrors: ['Injected protocol failure'],
            tags: ['mcp-task', 'restart'],
          });
          return;
        }
        if (content.includes('decide_execution_exception')) {
          respondStructured(response, {
            strategy: 'terminate',
            summary: 'Unexpected execution failures terminate this acceptance Task.',
          });
          return;
        }
        if (content.includes('"workflow":{"instanceId"')) {
          respondStructured(response, {
            decision: 'achieved',
            summary: 'The recovered Workflow result satisfies the Goal.',
          });
          return;
        }
        throw new Error(`RESTART_MODEL_OPERATION_UNHANDLED:${content.slice(0, 200)}`);
      } catch (error: unknown) {
        response.statusCode = 500;
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function operationPayload(content: string, operation: string): unknown {
  const marker = `{"operation":"${operation}"`;
  const start = content.indexOf(marker);
  if (start < 0) throw new Error(`RESTART_MODEL_OPERATION_MISSING:${operation}`);
  return JSON.parse(content.slice(start)) as unknown;
}

function respondStructured(response: ServerResponse, value: unknown): void {
  response.end(
    JSON.stringify({
      id: 'restart-structured-response',
      model: 'model-restart',
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    }),
  );
}

async function insertOrdinaryRunningTask(pool: Pool, taskId: string): Promise<void> {
  const contextId = `context-ordinary-${randomUUID()}`;
  const timestamp = '2026-07-17T00:00:00.000Z';
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES($1,'restart-acceptance',$2,$2)`,
    [contextId, timestamp],
  );
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,created_at,updated_at
     ) VALUES($1,$2,'restart-acceptance','ordinary running Task must not be replayed','{}'::jsonb,
       'executing','Intentionally left running before restart',$3,$3)`,
    [taskId, contextId, timestamp],
  );
}

async function taskSnapshot(
  pool: Pool,
  taskId: string,
): Promise<
  Readonly<{ phase: string; phase_message: string; error_code: string | null; updated_at: string }>
> {
  const result = await pool.query<{
    phase: string;
    phase_message: string;
    error_code: string | null;
    updated_at: Date;
  }>('SELECT phase,phase_message,error_code,updated_at FROM agent_task WHERE task_id=$1', [taskId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`RESTART_TASK_MISSING:${taskId}`);
  return {
    phase: row.phase,
    phase_message: row.phase_message,
    error_code: row.error_code,
    updated_at: row.updated_at.toISOString(),
  };
}

async function waitForRow<T extends Record<string, unknown>>(
  pool: Pool,
  query: Readonly<{ sql: string; values: readonly unknown[]; timeoutMs?: number }>,
): Promise<T> {
  const deadline = Date.now() + (query.timeoutMs ?? 5_000);
  do {
    const result = await pool.query<T>(query.sql, [...query.values]);
    const row = result.rows[0];
    if (row !== undefined) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(`RESTART_ROW_TIMEOUT:${query.sql.replaceAll(/\s+/gu, ' ').trim()}`);
}

function countRequests(requests: readonly Readonly<{ method: string }>[], method: string): number {
  return requests.filter((request) => request.method === method).length;
}

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
