import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../../../apps/server/test-support/postgres.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  GovernedControlConfirmationService,
  TaskBusinessCommandService,
  RemoteTaskCancellationService,
} from '../../application/src/index.js';
import { TaskBusinessError } from '../../domain/src/task-business.js';
import { taskBusinessIntentContentHash } from '../../domain/src/task-business-command.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  PostgresTaskBusinessCommandRepository,
  PostgresGovernedControlAuthorityRepository,
  PostgresGovernedControlManagementAuthorityReader,
  PostgresRemoteTaskCancellationRepository,
} from '../src/index.js';
import { taskBusinessControlFixture } from './task-business-control-fixture.js';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import { PostgresTaskInputRepository } from '../src/index.js';
import { TaskBusinessSyncService } from '../../application/src/task-business-sync.js';
import { PostgresRuntimeSourceArtifactResolver } from '../../runtime-control-persistence-postgres/src/source-artifact-ref-resolver.js';
import { taskBusinessContentDigest } from '../../domain/src/task-business.js';

const databaseName = `sdar_smpp_commands_${randomUUID().replaceAll('-', '')}`;
const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseUrl = isolatedDatabaseUrl(adminUrl, databaseName);
let pool: Pool;
beforeAll(async () => {
  await createIsolatedRuntimeDatabase(adminUrl, databaseName);
  pool = new Pool({ connectionString: databaseUrl, max: 8 });
  await applyRuntimeMigrations(pool);
});
afterAll(async () => {
  await pool.end();
  await dropIsolatedRuntimeDatabase(adminUrl, databaseName);
});
const principal = {
  actorId: 'human:smpp-local-operator',
  kind: 'human' as const,
  authenticationMethod: 'trusted_intranet',
  permissions: new Set<'physical_control.confirm'>(['physical_control.confirm']),
  requestId: 'business-test',
};

async function fixture(tag: string, dispatchLeaseMs = 30_000) {
  const original = await taskBusinessControlFixture(pool, tag);
  const repository = new PostgresTaskBusinessCommandRepository(pool, undefined, {
    dispatchLeaseMs,
  });
  const authority = {
    load: (taskId: string) => repository.loadAuthority(taskId),
    async assertCurrent() {
      const native = await original.remote.findById(original.remoteBindingId);
      if (native?.authoritySnapshot?.providerBinding?.bindingId !== original.providerBindingId)
        throw new TaskBusinessError('TASK_BUSINESS_CONTROL_SCOPE_INVALID');
    },
  };
  const wires: string[] = [];
  let beforeClaim: (() => Promise<void>) | undefined;
  let afterClaim: (() => Promise<void>) | undefined;
  let lostAck = false;
  const service = new TaskBusinessCommandService({
    repository,
    business: original.business,
    sync: original.sync,
    reader: original.reader,
    authority,
    confirmations: new GovernedControlConfirmationService({
      store: new PostgresGovernedControlAuthorityRepository(pool),
      clock: { now: () => new Date().toISOString() },
      ids: { nextConfirmationId: () => `business-confirmation-${randomUUID()}` },
    }),
    revocations: new PostgresGovernedControlManagementAuthorityReader(pool),
    schemas: new AjvJsonSchemaValidator(),
    clock: { now: () => new Date().toISOString() },
    transport: {
      async dispatchBusinessMutation(input) {
        await beforeClaim?.();
        if (
          !(await input.authorize({
            taskId: original.identity.taskId,
            executionId: original.identity.executionId,
            operation: input.request.operation,
          }))
        )
          throw new TaskBusinessError('TASK_BUSINESS_SEND_NOT_CLAIMED');
        await afterClaim?.();
        wires.push(input.request.operation);
        if (lostAck) throw new TaskBusinessError('TEST_LOST_ACK');
        return {
          commandId:
            input.request.operation === 'navigation_adjust_plan'
              ? input.request.commandId
              : 'provider-input-command',
          durablyAccepted: true,
          businessApplied: false,
        };
      },
    },
  });
  const prepare = () =>
    service.prepareNavigation({
      taskId: original.taskId,
      idempotencyKey: 'original-navigation',
      waypoints: [{ longitude: 106.81, latitude: 29.71 }],
      density: 'normal',
    });
  const confirm = async () => {
    const prepared = await prepare();
    return service.confirm(
      original.taskId,
      prepared.intent.intentId,
      principal,
      'Approve displayed original navigation adjustment.',
    );
  };
  return {
    ...original,
    get view() {
      return original.view;
    },
    set view(value: typeof original.view) {
      original.view = value;
    },
    repository,
    authority,
    service,
    wires,
    prepare,
    confirm,
    set beforeClaim(value: (() => Promise<void>) | undefined) {
      beforeClaim = value;
    },
    get beforeClaim() {
      return beforeClaim;
    },
    set afterClaim(value: (() => Promise<void>) | undefined) {
      afterClaim = value;
    },
    get afterClaim() {
      return afterClaim;
    },
    set lostAck(value: boolean) {
      lostAck = value;
    },
    get lostAck() {
      return lostAck;
    },
  };
}

async function inputFixture(tag: string) {
  const f = await fixture(tag);
  const inputRequestId = `${tag}-native-input`;
  const object = taskBusinessFixture(f.identity).objects.find(
    (item) => item.kind === 'input_request',
  );
  if (object === undefined) throw new Error('INPUT_FIXTURE_REQUIRED');
  const request = {
    ...object.value,
    requestId: String(object.value['requestId']),
    requestKey: String(object.value['requestKey']),
    deadlineAt: new Date(Date.now() + 300_000).toISOString(),
    inputSchema: {
      type: 'object',
      required: ['decision'],
      additionalProperties: false,
      properties: { decision: { enum: ['continue_observation'] } },
    },
  };
  const ref = { kind: 'input_request' as const, id: request.requestId, revision: 1 };
  f.view = {
    ...f.view,
    context: {
      ...f.view.context,
      contextRevision: f.view.context.contextRevision + 1,
      requiredInputRefs: [ref],
      activeRefs: { ...f.view.context.activeRefs, 'input:visualLock': ref },
    },
    objects: [...f.view.objects, { kind: 'input_request', value: request }],
  };
  const requests = {
    [request.requestKey]: {
      method: 'elicitation/create',
      params: {
        message: 'Confirm continued observation of original visual lock.',
        requestedSchema: request.inputSchema,
      },
    },
  };
  await pool.query(`UPDATE agent_task SET phase='awaiting_user_input' WHERE task_id=$1`, [
    f.taskId,
  ]);
  await pool.query(
    `INSERT INTO remote_task_control_event(event_id,binding_id,event_type,remote_revision,result_hash,payload_json,status,created_at,claimed_at,processed_at)
    VALUES($1,$2,'task.input_required','input-v1',$3,$4::jsonb,'processed',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    [
      `${tag}-input-control`,
      f.remoteBindingId,
      'a'.repeat(64),
      JSON.stringify({ inputRequests: requests }),
    ],
  );
  await pool.query(
    `INSERT INTO task_input_request(input_request_id,task_id,context_id,source,question,status,created_at)
    VALUES($1,$2,$3,'remote_task','Continue original observation?','waiting',clock_timestamp())`,
    [inputRequestId, f.taskId, `${tag}-context`],
  );
  await pool.query(
    `INSERT INTO remote_task_input_link(input_request_id,control_event_id,binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id,remote_revision,result_hash,input_requests_json,status,created_at,updated_at)
    SELECT $1,$2,binding_id,remote_task_id,workflow_instance_id,workflow_node_id,workflow_node_run_id,'input-v1',$4,$5::jsonb,'waiting',clock_timestamp(),clock_timestamp()
    FROM remote_task_binding WHERE binding_id=$3`,
    [
      inputRequestId,
      `${tag}-input-control`,
      f.remoteBindingId,
      'a'.repeat(64),
      JSON.stringify(requests),
    ],
  );
  await f.sync.refresh(f.remoteBindingId);
  const responses = (action: 'accept' | 'decline' | 'cancel') => ({
    [request.requestKey]:
      action === 'accept' ? { action, content: { decision: 'continue_observation' } } : { action },
  });
  const answer = async (content: unknown) => {
    const now = new Date().toISOString();
    await new PostgresTaskInputRepository(pool).answerAndCreateAttempt({
      inputRequestId,
      taskId: f.taskId,
      answeredAt: now,
      continuationPhase: 'executing',
      phaseMessage: 'Resume original remote input.',
      response: {
        inputResponseId: `${tag}-response`,
        inputRequestId,
        taskId: f.taskId,
        content,
        createdAt: now,
      },
      attempt: {
        attemptId: `${tag}-input-attempt`,
        taskId: f.taskId,
        contextId: `${tag}-context`,
        reason: 'input_response',
        status: 'queued',
        inputRequestId,
        createdAt: now,
      },
    });
  };
  return {
    ...f,
    get view() {
      return f.view;
    },
    set view(value: typeof f.view) {
      f.view = value;
    },
    get lostAck() {
      return f.lostAck;
    },
    set lostAck(value: boolean) {
      f.lostAck = value;
    },
    inputRequestId,
    responses,
    answer,
  };
}

describe('Task business native PostgreSQL command ledger', () => {
  it('AC-039/040 two real processes contend for one consumed confirmation; SIGKILL after the send seam expires its lease and recovery never resends', async () => {
    const f = await fixture('two-process-crash');
    const confirmed = await f.confirm();
    const directory = await mkdtemp('/tmp/sdar-smpp-two-process-');
    const path = `${directory}/sent.jsonl`;
    const children: ChildProcess[] = [];
    const start = () =>
      new Promise<Readonly<{ state: string }>>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', 'packages/persistence-postgres/test/task-business-claim-worker.ts'],
          {
            env: {
              PATH: process.env['PATH'],
              SDAR_TEST_POSTGRES_URL: databaseUrl,
              SDAR_TEST_SEND_JOURNAL: path,
              SDAR_TEST_COMMAND_RECORD: JSON.stringify(confirmed),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        children.push(child);
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
          if (output.includes('\n'))
            resolve(JSON.parse(output.slice(0, output.indexOf('\n'))) as { state: string });
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (!output.includes('\n'))
            reject(new Error(`ISOLATED_WORKER_NO_RESULT:${String(code)}`));
        });
      });
    try {
      const states = await Promise.all([start(), start()]);
      expect(states.map((state) => state.state).sort()).toEqual(['claimed', 'not_claimed']);
      for (const child of children) child.kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const journal = await readFile(path, 'utf8');
      expect(journal.trim().split('\n')).toHaveLength(1);
      expect((await f.repository.find(f.taskId, confirmed.intent.intentId))?.state).toBe(
        'dispatching',
      );
      await f.service.recover();
      expect((await f.repository.find(f.taskId, confirmed.intent.intentId))?.state).toBe(
        'uncertain',
      );
      await f.service.dispatch(f.taskId, confirmed.intent.intentId);
      expect(await readFile(path, 'utf8')).toBe(journal);
      expect(f.wires).toEqual([]);
      const original = await pool.query(
        'SELECT consumed_invocation_id,consumed_dispatch_hash FROM governed_control_confirmation WHERE confirmation_id=$1',
        [confirmed.confirmationId],
      );
      expect(original.rows).toEqual([
        {
          consumed_invocation_id: `task-business:${confirmed.intent.intentId}`,
          consumed_dispatch_hash: confirmed.intent.contentHash,
        },
      ]);
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('AC-033/038 persists and resolves complete large trajectory bytes through original Task and canonical artifacts, with corruption detected', async () => {
    const f = await fixture('large-evidence');
    const bytes = Buffer.from(
      JSON.stringify({
        crs: 'OGC:CRS84',
        geometry: {
          type: 'LineString',
          coordinates: Array.from({ length: 100_000 }, (_, index) => [106 + index / 1_000_000, 29]),
        },
      }),
    );
    const route = f.view.objects.find((object) => object.kind === 'artifact');
    if (route === undefined) throw new Error('ROUTE_FIXTURE_REQUIRED');
    const metadata = {
      ...route.value,
      artifactId: 'large-trajectory',
      artifactType: 'navigation.trajectory',
      properties: { sampleCount: 100_000 },
      semantics: 'observed',
      content: {
        kind: 'content_ref',
        artifactId: 'large-trajectory',
        revision: 1,
        readMethod: 'business_artifact_content',
        handle: 'large-trajectory_1',
        mediaType: 'application/geo+json',
        sha256: taskBusinessContentDigest(bytes),
        sizeBytes: bytes.length,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    };
    f.view = {
      ...f.view,
      context: {
        ...f.view.context,
        contextRevision: f.view.context.contextRevision + 1,
        artifactRefs: [
          ...f.view.context.artifactRefs,
          { kind: 'artifact', id: 'large-trajectory', revision: 1 },
        ],
      },
      objects: [...f.view.objects, { kind: 'artifact', value: metadata }],
    };
    const sync = new TaskBusinessSyncService({
      repository: f.business,
      reader: {
        ...f.reader,
        readRemoteTaskBusinessArtifactContent: (input) =>
          input.artifactId === 'large-trajectory'
            ? Promise.resolve(bytes)
            : f.reader.readRemoteTaskBusinessArtifactContent(),
      },
      clock: { now: () => new Date().toISOString() },
    });
    expect(await sync.refresh(f.remoteBindingId)).toBe('applied');
    const projection = await f.business.find(f.remoteBindingId);
    const object = projection?.objects.find((item) => item.ref.id === 'large-trajectory');
    expect(object?.artifactRef).toBeDefined();
    if (object?.artifactRef === undefined) throw new Error('FORMAL_REF_REQUIRED');
    expect(
      await f.business.readContent(f.remoteBindingId, taskBusinessContentDigest(bytes)),
    ).toEqual(bytes);
    const resolver = new PostgresRuntimeSourceArtifactResolver(pool);
    const resolved = await resolver.resolve(object.artifactRef);
    const value = resolved.value as { bytes: string; rawSha256: string };
    expect(Buffer.from(value.bytes, 'base64').equals(bytes)).toBe(true);
    expect(value.rawSha256).toBe(`sha256:${taskBusinessContentDigest(bytes)}`);
    expect(projection?.geometry?.find((item) => item.ref.id === 'large-trajectory')).toMatchObject({
      retainedCoordinateCount: 100_000,
      perSampleSourceTimeComplete: false,
    });
    const artifacts = await f.business.exportTaskArtifacts(f.taskId);
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'task_business.projection',
          data: expect.objectContaining({ completeRecordAvailableByReference: true }),
        }),
      ]),
    );
    expect(await f.business.exportTaskArtifacts('unrelated-task')).toEqual([]);
    for (const artifact of artifacts) {
      const reference = artifact.data['completeEvidenceRef'];
      expect(reference).toBeDefined();
      if (typeof reference !== 'object' || reference === null)
        throw new Error('REFERENCE_REQUIRED');
      expect(
        (await resolver.resolve(reference as Parameters<typeof resolver.resolve>[0])).artifactRef,
      ).toEqual(reference);
    }
    await expect(
      resolver.resolve({ ...object.artifactRef, sha256: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'SOURCE_ARTIFACT_INTEGRITY_MISMATCH' });
    await pool.query(
      `DELETE FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.content' AND payload_json->>'digest'=$2 AND payload_json->>'offset'='0'`,
      [f.remoteBindingId, taskBusinessContentDigest(bytes)],
    );
    await expect(resolver.resolve(object.artifactRef)).rejects.toMatchObject({
      code: 'TASK_BUSINESS_CONTENT_INVALID',
    });
  });
  it('AC-038 exports the real original confirmation and consumed dispatch claim without raw human identity', async () => {
    const f = await fixture('confirmation-chain');
    const confirmed = await f.confirm();
    expect(confirmed.confirmationFact).toMatchObject({
      confirmationId: confirmed.confirmationId,
      contentHash: confirmed.intent.contentHash,
      actorHash: expect.stringMatching(/^sha256:/u),
    });
    const sent = await f.service.dispatch(f.taskId, confirmed.intent.intentId);
    expect(sent.dispatchClaim).toMatchObject({
      confirmationId: confirmed.confirmationId,
      invocationId: `task-business:${confirmed.intent.intentId}`,
      dispatchHash: confirmed.intent.contentHash,
    });
    const artifacts = await f.business.exportTaskArtifacts(f.taskId);
    const command = artifacts.find((artifact) => artifact.name === 'task_business.command');
    if (command === undefined) throw new Error('COMMAND_ARTIFACT_REQUIRED');
    const resolver = new PostgresRuntimeSourceArtifactResolver(pool);
    const evidence = await resolver.resolve(
      command.data['completeEvidenceRef'] as Parameters<typeof resolver.resolve>[0],
    );
    expect(evidence.canonicalJson).toContain(confirmed.confirmationId);
    expect(evidence.canonicalJson).not.toContain(principal.actorId);
    expect(f.wires).toHaveLength(1);
  });
  it('AC-039/041 recovery retires expired prepared intents and retains late terminal business facts without reviving Task or dispatching', async () => {
    const f = await fixture('recovery-terminal');
    const prepared = await f.prepare();
    await f.repository.prepare({
      ...prepared.intent,
      intentId: 'prepared-expiring',
      createdAt: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 100).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await f.service.recover();
    expect((await f.repository.find(f.taskId, 'prepared-expiring'))?.state).toBe('obsolete');
    await pool.query(`UPDATE agent_task SET phase='canceled' WHERE task_id=$1`, [f.taskId]);
    f.view = {
      ...f.view,
      context: { ...f.view.context, contextRevision: f.view.context.contextRevision + 1 },
    };
    await f.sync.refresh(f.remoteBindingId);
    expect((await f.business.find(f.remoteBindingId))?.status).toBe('history');
    expect((await f.business.find(f.remoteBindingId))?.allowedInterventions).toEqual([]);
    expect(
      (await pool.query('SELECT phase FROM agent_task WHERE task_id=$1', [f.taskId])).rows,
    ).toEqual([{ phase: 'canceled' }]);
    expect(f.wires).toEqual([]);
  });
  it('keeps the frozen baseline and old workflow inputs readable while refusing destructive rollback of retained remote inputs', async () => {
    const f = await inputFixture('business-input-migration');
    const baseline = await readFile(
      'infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql',
      'utf8',
    );
    expect(baseline).toContain("'goal_evaluation'::text, 'workflow'::text]");
    const client = await pool.connect();
    try {
      await expect(
        client.query(
          await readFile(
            'infra/postgres/migrations/0184_v14_task_business_input_source.down.sql',
            'utf8',
          ),
        ),
      ).rejects.toMatchObject({
        message: 'TASK_BUSINESS_INPUT_ROLLBACK_REQUIRES_RETAINED_REMOTE_TASK_SOURCE',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await new PostgresTaskInputRepository(pool).findRequest(f.inputRequestId)).toMatchObject(
      { taskId: f.taskId, status: 'waiting', source: 'remote_task' },
    );
    expect(
      (
        await pool.query(
          "SELECT version FROM schema_migration WHERE version='0184_v14_task_business_input_source'",
        )
      ).rows,
    ).toEqual([{ version: '0184_v14_task_business_input_source' }]);
    const native = new PostgresTaskInputRepository(pool);
    await native.createRequest({
      inputRequestId: 'old-workflow-input',
      taskId: f.taskId,
      contextId: 'business-input-migration-context',
      source: 'workflow',
      question: 'Original workflow question',
      status: 'canceled',
      createdAt: new Date().toISOString(),
    });
    expect(await native.findRequest('old-workflow-input')).toMatchObject({
      source: 'workflow',
      question: 'Original workflow question',
    });
  });
  it('confirms original RequiredInput through native answer continuation and treats prompt cancel independently from Task cancel', async () => {
    const f = await inputFixture('business-input-cancel');
    const content = f.responses('cancel');
    await expect(f.service.authorizeInput(f.inputRequestId, content, principal)).resolves.toBe(
      true,
    );
    const prepared = await f.repository.findByInput(f.inputRequestId);
    expect(prepared).toMatchObject({ state: 'prepared', confirmationId: expect.any(String) });
    expect(f.wires).toEqual([]);
    await f.answer(content);
    await expect(f.service.dispatchInput(f.inputRequestId, content)).resolves.toMatchObject({
      handled: true,
      acknowledged: true,
    });
    expect(f.wires).toEqual(['input_response']);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int count FROM remote_task_cancel_request WHERE binding_id=$1',
          [f.remoteBindingId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (await pool.query('SELECT phase FROM agent_task WHERE task_id=$1', [f.taskId])).rows,
    ).toEqual([{ phase: 'executing' }]);
    f.view = {
      ...f.view,
      context: {
        ...f.view.context,
        contextRevision: f.view.context.contextRevision + 1,
        requiredInputRefs: [],
        activeRefs: Object.fromEntries(
          Object.entries(f.view.context.activeRefs).filter(([key]) => key !== 'input:visualLock'),
        ),
      },
      objects: f.view.objects.map((item) =>
        item.kind === 'input_request'
          ? {
              ...item,
              value: {
                ...item.value,
                revision: 2,
                state: 'cancelled',
                responseCommandId: 'provider-input-command',
                response: { action: 'cancel' },
              },
            }
          : item,
      ),
    };
    await expect(
      f.service.reconcile(f.taskId, String(prepared?.intent.intentId)),
    ).resolves.toMatchObject({
      state: 'confirmed',
      evidence: {
        originalRequestFulfilled: true,
        causalQuality: 'request_response_match',
        gaps: ['required_input_has_no_client_command_id_wire_correlation'],
      },
    });
    await f.service.dispatchInput(f.inputRequestId, content);
    expect(f.wires).toEqual(['input_response']);
  });
  it('rejects expired, superseded and different-content RequiredInput with zero extra sends', async () => {
    for (const reason of ['expired', 'superseded', 'content'] as const) {
      const f = await inputFixture(`business-input-${reason}`);
      const content = f.responses('accept');
      await f.service.authorizeInput(f.inputRequestId, content, principal);
      await f.answer(content);
      if (reason === 'content') {
        await expect(
          f.service.dispatchInput(f.inputRequestId, f.responses('decline')),
        ).rejects.toMatchObject({ code: 'TASK_BUSINESS_COMMAND_CONTENT_CONFLICT' });
      } else {
        f.view = {
          ...f.view,
          context: {
            ...f.view.context,
            contextRevision: f.view.context.contextRevision + 1,
            requiredInputRefs: f.view.context.requiredInputRefs.map((ref) => ({
              ...ref,
              revision: 2,
            })),
            activeRefs: {
              ...f.view.context.activeRefs,
              'input:visualLock': { kind: 'input_request', id: 'input-1', revision: 2 },
            },
          },
          objects: f.view.objects.map((item) =>
            item.kind === 'input_request'
              ? {
                  ...item,
                  value: {
                    ...item.value,
                    revision: 2,
                    ...(reason === 'expired'
                      ? { state: 'expired' }
                      : {
                          revision: 2,
                          subjectBinding: {
                            ...(item.value['subjectBinding'] as Record<string, unknown>),
                            targetId: 'replacement-target',
                          },
                        }),
                  },
                }
              : item,
          ),
        };
        await f.sync.refresh(f.remoteBindingId);
        await expect(f.service.dispatchInput(f.inputRequestId, content)).resolves.toMatchObject({
          acknowledged: false,
        });
        expect(await f.repository.findByInput(f.inputRequestId)).toMatchObject({
          state: 'obsolete',
          errorCode: 'TASK_BUSINESS_INPUT_NOT_CURRENT',
        });
      }
      expect(f.wires).toEqual([]);
    }
  });
  it('retains RequiredInput lost-ack uncertainty even when its original request is fulfilled', async () => {
    const f = await inputFixture('business-input-lost-ack');
    const content = f.responses('accept');
    await f.service.authorizeInput(f.inputRequestId, content, principal);
    await f.answer(content);
    f.lostAck = true;
    await expect(f.service.dispatchInput(f.inputRequestId, content)).resolves.toMatchObject({
      handled: true,
      acknowledged: false,
    });
    const original = await f.repository.findByInput(f.inputRequestId);
    f.view = {
      ...f.view,
      context: {
        ...f.view.context,
        contextRevision: f.view.context.contextRevision + 1,
        requiredInputRefs: [],
        activeRefs: Object.fromEntries(
          Object.entries(f.view.context.activeRefs).filter(([key]) => key !== 'input:visualLock'),
        ),
      },
      objects: f.view.objects.map((item) =>
        item.kind === 'input_request'
          ? {
              ...item,
              value: {
                ...item.value,
                revision: 2,
                state: 'answered',
                responseCommandId: 'provider-input-command',
                response: { action: 'accept', value: { decision: 'continue_observation' } },
              },
            }
          : item,
      ),
    };
    await expect(
      f.service.reconcile(f.taskId, String(original?.intent.intentId)),
    ).resolves.toMatchObject({
      state: 'uncertain',
      evidence: {
        originalRequestFulfilled: true,
        causalQuality: 'request_response_match',
        gaps: ['required_input_has_no_client_command_id_wire_correlation'],
      },
    });
    await f.service.dispatchInput(f.inputRequestId, content);
    expect(f.wires).toEqual(['input_response']);
  });
  it('rejects absent policy and an untrusted actor before any wire, retaining the original Task/Workflow', async () => {
    const f = await fixture('business-denied');
    const prepared = await f.prepare();
    await expect(
      f.service.confirm(
        f.taskId,
        prepared.intent.intentId,
        { ...principal, kind: 'service', actorId: 'agent:planner' },
        'no',
      ),
    ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_PERMISSION_DENIED' });
    await expect(f.service.dispatch(f.taskId, prepared.intent.intentId)).rejects.toMatchObject({
      code: 'TASK_BUSINESS_TRUSTED_CONFIRMATION_REQUIRED',
    });
    await pool.query(
      `UPDATE skill_version SET runtime_policy_json=runtime_policy_json-'taskBusinessMutationPolicy' WHERE skill_id=$1 AND version=1`,
      [f.skillId],
    );
    await expect(
      f.service.prepareNavigation({
        taskId: f.taskId,
        idempotencyKey: 'other',
        waypoints: [{ longitude: 106.8, latitude: 29.7 }],
        density: 'normal',
      }),
    ).rejects.toMatchObject({ code: 'TASK_BUSINESS_MUTATION_POLICY_DENIED' });
    expect(f.wires).toEqual([]);
    expect(
      (await pool.query('SELECT phase,plan_id FROM agent_task WHERE task_id=$1', [f.taskId])).rows,
    ).toEqual([{ phase: 'executing', plan_id: f.planId }]);
  });
  it('uses one durable sender across repositories, rejects same-ID different-content and never takes over an expired send', async () => {
    const f = await fixture('business-senders', 100);
    const confirmed = await f.confirm();
    const secondPool = new Pool({ connectionString: databaseUrl, max: 2 });
    try {
      const second = new PostgresTaskBusinessCommandRepository(secondPool, undefined, {
        dispatchLeaseMs: 100,
      });
      const results = await Promise.all([
        f.repository.claim(confirmed, confirmed.intent.authority),
        second.claim(confirmed, confirmed.intent.authority),
      ]);
      expect(results.filter((value) => value !== undefined)).toHaveLength(1);
      const winner = results.find((value) => value !== undefined);
      if (winner === undefined) throw new Error('DISPATCH_WINNER_MISSING');
      expect(
        (
          await pool.query(
            'SELECT consumed_invocation_id FROM governed_control_confirmation WHERE confirmation_id=$1',
            [confirmed.confirmationId],
          )
        ).rows,
      ).toEqual([{ consumed_invocation_id: `task-business:${confirmed.intent.intentId}` }]);
      await new Promise((resolve) => setTimeout(resolve, 130));
      await expect(second.claim(confirmed, confirmed.intent.authority)).resolves.toBeUndefined();
      await expect(
        f.repository.recordDispatch(winner, { state: 'accepted' }),
      ).rejects.toMatchObject({ code: 'TASK_BUSINESS_DISPATCH_LEASE_LOST' });
      const request = confirmed.intent.request;
      if (request.operation !== 'navigation_adjust_plan')
        throw new Error('NAVIGATION_INTENT_REQUIRED');
      const base = { ...confirmed.intent, request: { ...request, density: 'fine' } };
      await expect(
        second.prepare({ ...base, contentHash: taskBusinessIntentContentHash(base) }),
      ).rejects.toMatchObject({ code: 'TASK_BUSINESS_COMMAND_CONTENT_CONFLICT' });
      const recovered = await second.claimReconciliation(f.taskId, confirmed.intent.intentId);
      expect(recovered).toMatchObject({ state: 'uncertain', readAttempts: 1 });
      expect((await second.rollbackPreflight()).writeTakeoverAllowed).toBe(false);
      expect(f.wires).toEqual([]);
    } finally {
      await secondPool.end();
    }
  });
  it('separates acceptance from exact own-command adoption and leaves Workflow definition immutable', async () => {
    const f = await fixture('business-adoption');
    const confirmed = await f.confirm();
    const before = (
      await pool.query('SELECT definition_json FROM workflow_plan WHERE plan_id=$1', [f.planId])
    ).rows;
    await expect(f.service.dispatch(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
      state: 'accepted',
    });
    await expect(f.service.reconcile(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
      state: 'accepted',
    });
    const routeRef = { kind: 'artifact' as const, id: 'route-line', revision: 1 };
    f.view = {
      ...f.view,
      context: {
        ...f.view.context,
        contextRevision: f.view.context.contextRevision + 1,
        effectivePlanRevision: 5,
        interventionRefs: [{ kind: 'intervention', id: 'intervention-1', revision: 2 }],
        activeRefs: { route: routeRef },
        summary: {
          ...f.view.context.summary,
          properties: {
            effectiveNavigation: {
              commandId: confirmed.intent.intentId,
              planRevision: 5,
              routeRef,
            },
          },
        },
      },
      objects: f.view.objects.map((object) =>
        object.kind === 'intervention'
          ? {
              ...object,
              value: {
                ...object.value,
                revision: 2,
                state: 'applied',
                acceptedCommandId: confirmed.intent.intentId,
                resultRefs: [routeRef],
              },
            }
          : object,
      ),
    };
    await expect(f.service.reconcile(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
      state: 'confirmed',
      evidence: { ownCommandApplied: true, adoptedRouteRef: routeRef },
    });
    await expect(f.service.dispatch(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
      state: 'confirmed',
    });
    expect(f.wires).toEqual(['navigation_adjust_plan']);
    expect(
      (await pool.query('SELECT definition_json FROM workflow_plan WHERE plan_id=$1', [f.planId]))
        .rows,
    ).toEqual(before);
    expect(
      (
        await pool.query('SELECT count(*)::int count FROM mcp_invocation WHERE task_id=$1', [
          f.taskId,
        ])
      ).rows,
    ).toEqual([{ count: 1 }]);
  });
  it('lets a native cancellation win before the final claim and records already claimed work as in flight', async () => {
    for (const boundary of ['before', 'after'] as const) {
      const f = await fixture(`business-cancel-${boundary}`);
      const confirmed = await f.confirm();
      const cancel = () =>
        new RemoteTaskCancellationService({
          remoteTasks: f.remote,
          cancellations: new PostgresRemoteTaskCancellationRepository(pool),
          queue: { enqueue: () => Promise.resolve(), state: () => Promise.resolve('missing') },
          clock: { now: () => new Date().toISOString() },
          ids: {
            nextRequestId: () => `cancel-${boundary}`,
            nextAttemptId: () => `cancel-attempt-${boundary}`,
            nextClaimToken: () => `cancel-claim-${boundary}`,
          },
        })
          .request({
            bindingId: f.remoteBindingId,
            idempotencyKey: `cancel-${boundary}`,
            source: 'management',
            reasonCode: 'TEST_CANCEL',
            summary: 'Cancel at the native send boundary.',
          })
          .then(() => undefined);
      if (boundary === 'before') f.beforeClaim = cancel;
      else f.afterClaim = cancel;
      await expect(f.service.dispatch(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
        state: boundary === 'before' ? 'obsolete' : 'accepted',
      });
      expect(f.wires).toEqual(boundary === 'before' ? [] : ['navigation_adjust_plan']);
      expect((await f.remote.findById(f.remoteBindingId))?.localState).toBe('cancel_observing');
      const accepted = (
        await pool.query(
          `SELECT accepted FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.command' ORDER BY sequence DESC LIMIT 1`,
          [f.remoteBindingId],
        )
      ).rows;
      expect(accepted).toEqual([{ accepted: false }]);
    }
  });
  it('performs finite read-only reconciliation after a lost ack and fences rollback while uncertain', async () => {
    const f = await fixture('business-uncertain');
    const confirmed = await f.confirm();
    f.lostAck = true;
    await expect(f.service.dispatch(f.taskId, confirmed.intent.intentId)).resolves.toMatchObject({
      state: 'uncertain',
      errorCode: 'TEST_LOST_ACK',
    });
    for (let index = 0; index < 8; index++) {
      await f.service.reconcile(f.taskId, confirmed.intent.intentId);
      await f.service.dispatch(f.taskId, confirmed.intent.intentId);
    }
    expect(await f.repository.find(f.taskId, confirmed.intent.intentId)).toMatchObject({
      state: 'uncertain',
      readAttempts: 5,
      errorCode: 'TASK_BUSINESS_RECONCILIATION_EXHAUSTED',
    });
    expect(f.wires).toEqual(['navigation_adjust_plan']);
    expect(await f.repository.rollbackPreflight()).toMatchObject({
      writeTakeoverAllowed: false,
      pendingIntentIds: expect.arrayContaining([confirmed.intent.intentId]),
    });
  });
});
