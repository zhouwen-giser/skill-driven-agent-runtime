import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
} from '../../../apps/server/test-support/postgres.js';
import {
  ActiveKnowledgeProjector,
  CapabilityPatternPromotionTarget,
  ConfiguredTaskTypeImportService,
  DuplicateCandidateDetector,
  EvidenceThresholdEvaluator,
  GenericCapabilityAdmissionResolver,
  KnowledgePromotionService,
  OnlineTaskTypeIndexSource,
  PlanningHeuristicPromotionTarget,
  RuntimeTaskCapabilityService,
  TaskService,
  TaskTypePromotionTarget,
  type RuntimeCapabilityResolution,
} from '../../application/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { createTaskExecutionAttempt } from '../../domain/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresKnowledgePromotionRepository,
  PostgresKnowledgeSearchRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresTaskCapabilityRepository,
  PostgresTaskInputRepository,
  PostgresTaskTypeRepository,
} from '../src/index.js';
const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const database = 'sdar_runtime_admission_integration';
let pool: Pool;
const timestamp = '2026-09-07T09:00:00.000Z';
beforeAll(async () => {
  pool = new Pool({ connectionString: await createIsolatedRuntimeDatabase(adminUrl, database) });
  await applyRuntimeMigrations(pool);
  await applyRuntimeMigrations(pool);
}, 60_000);
afterAll(async () => {
  await pool.end();
  await dropIsolatedRuntimeDatabase(adminUrl, database);
});
function configured() {
  const repository = new PostgresKnowledgePromotionRepository(pool);
  const replay = vi.fn(() => Promise.reject(new Error('CONFIGURATION_MUST_NOT_FAKE_REPLAY')));
  const governance = new KnowledgePromotionService({
    repository,
    evaluator: new EvidenceThresholdEvaluator(),
    replay: { run: replay },
    shadow: { find: () => Promise.resolve(undefined) },
    duplicates: new DuplicateCandidateDetector(repository),
    projector: new ActiveKnowledgeProjector({
      repository: {
        upsert: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        prune: () => Promise.resolve(0),
      },
      clock: { now: () => timestamp },
    }),
    targets: [
      new PlanningHeuristicPromotionTarget(),
      new TaskTypePromotionTarget(),
      new CapabilityPatternPromotionTarget(),
    ],
    policyVersion: 'knowledge-promotion-v1',
    clock: { now: () => timestamp },
    nextEvaluationId: () => randomUUID(),
    nextTransitionId: () => randomUUID(),
  });
  const importer = new ConfiguredTaskTypeImportService({
    repository: new PostgresTaskTypeRepository(pool),
    governance,
    hash: (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`,
    now: () => timestamp,
  });
  return { repository, replay, governance, importer };
}
const exposure: RuntimeCapabilityResolution = {
  exposureId: 'documents.summary',
  exposureVersion: 1,
  requestedCapabilityId: 'documents.summarize',
  capabilityVersion: 1,
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: { documentId: { type: 'string' } },
  },
  successCriteria: [{ type: 'field_exists', field: 'summary' }],
  requiredEvidence: [],
  constraints: [],
  implementationRefs: ['skill:documents.summary:1'],
  providerBindingRefs: [],
};
function runtime() {
  const store = new PostgresTaskCapabilityRepository(pool);
  const tasks = new PostgresAgentTaskRepository(pool);
  const queued: string[] = [];
  const authority = new RuntimeTaskCapabilityService({
    store: {
      describeExposure: () => Promise.resolve(exposure),
      resolveExposure: () => Promise.resolve(exposure),
      accept: (input) => store.accept(input),
      findBinding: (id) => store.findBinding(id),
      listAttempts: (id) => store.listAttempts(id),
      appendAttempt: (input) => store.appendAttempt(input),
      updateLatestAttempt: (...args) => store.updateLatestAttempt(...args),
      reconcileCanceledAttempts: () => store.reconcileCanceledAttempts(),
      reconcileFailedAttempts: () => store.reconcileFailedAttempts(),
    },
    schemas: new AjvJsonSchemaValidator(),
  });
  const resolver = new GenericCapabilityAdmissionResolver({
    listCurrentExposures: () => Promise.resolve([exposure]),
    schemas: new AjvJsonSchemaValidator(),
    model: {
      generate: (input) => {
        const request = JSON.parse(input.instruction) as { userAnswer: unknown };
        const answered =
          typeof request.userAnswer === 'object' &&
          request.userAnswer !== null &&
          'documentId' in request.userAnswer;
        return Promise.resolve({
          invocationId: randomUUID(),
          structuredResult: {
            status: answered ? 'resolved' : 'clarification',
            exposures: [{ exposureId: exposure.exposureId, exposureVersion: 1 }],
            input: answered ? request.userAnswer : {},
            question: 'Which document?',
            missingFields: answered ? [] : ['documentId'],
            reason: '',
          },
        });
      },
    },
  });
  const service = new TaskService({
    contexts: new PostgresConversationContextRepository(pool),
    tasks,
    taskInputs: new PostgresTaskInputRepository(pool),
    events: new PostgresRuntimeEventPublisher(pool),
    skillDrafts: new PostgresSkillDraftRepository(pool),
    taskCapabilities: authority,
    initialAdmissions: store,
    admissionReceipts: store,
    genericCapabilityAdmissions: resolver,
    queue: {
      enqueue: (input) => {
        queued.push(input.taskId);
        return Promise.resolve();
      },
    },
    clock: { now: () => timestamp },
    ids: { nextId: (kind) => `${kind}-${randomUUID()}` },
  });
  return { store, tasks, queued, authority, service };
}
describe('Online types and durable capability clarification (isolated models/catalog)', () => {
  it('activates a truthful configured non-device type and revokes online recall without restart', async () => {
    const g = configured();
    const pagedList = vi.spyOn(g.governance, 'list').mockResolvedValue([]);
    const definition = {
      taskTypeId: 'documents.summarize',
      version: 1,
      title: 'Document summary',
      recognitionHints: ['summarize'],
      requiredDimensions: ['artifact'] as const,
      capabilityRequirements: [],
      risks: [],
    };
    const index = new OnlineTaskTypeIndexSource(new PostgresKnowledgeSearchRepository(pool), {
      embed: () => Promise.resolve({ providerId: 'isolated-fixture', vector: [1, 0, 0] }),
    });
    expect(
      await g.importer.import(definition, {
        actorId: 'config.operator',
        humanApproved: false,
        policyAllowed: true,
      }),
    ).toMatchObject({ status: 'candidate', origin: 'configured', exemplars: [] });
    expect(await index.search({ requestText: '把这份材料压缩成三句话', limit: 8 })).toEqual([]);
    expect(
      await g.importer.import(definition, {
        actorId: 'config.operator',
        humanApproved: true,
        policyAllowed: true,
      }),
    ).toMatchObject({
      status: 'active',
      origin: 'configured',
      sourceHash: expect.stringMatching(/^sha256:/),
    });
    const candidates = await index.search({ requestText: '把这份材料压缩成三句话', limit: 8 });
    expect(candidates).toMatchObject([{ taskTypeId: definition.taskTypeId, version: 1 }]);
    expect(g.replay).not.toHaveBeenCalled();
    expect(pagedList).not.toHaveBeenCalled();
    const record = await g.repository.find('task_type', definition.taskTypeId);
    await g.governance.deprecate({
      kind: 'task_type',
      knowledgeId: definition.taskTypeId,
      expectedVersion: requiredFixture(record).record.version,
      actorId: 'config.operator',
    });
    expect(await index.search({ requestText: 'Please condense this report', limit: 8 })).toEqual(
      [],
    );
    expect(
      await g.importer.import(definition, {
        actorId: 'config.operator',
        humanApproved: true,
        policyAllowed: true,
      }),
    ).toMatchObject({ status: 'deprecated' });
    await guardedDown('0182_v14_configured_task_type', 'CONFIGURED_TASK_TYPE_DOWNGRADE_REFERENCES');
  });
  it('retains the same Task across process replacement and binds one exact authority after parameters arrive', async () => {
    const first = runtime();
    const command = {
      messageText: 'Give me the gist of my report.',
      metadata: {},
      clientRequestId: randomUUID(),
    };
    const submitted = await first.service.submit(command);
    expect(submitted.task.phase).toBe('awaiting_user_input');
    expect(first.queued).toHaveLength(0);
    expect(await first.store.findBinding(submitted.task.taskId)).toBeUndefined();
    expect((await first.service.submit(command)).task.taskId).toBe(submitted.task.taskId);
    const restarted = runtime();
    const receipt = requiredFixture(
      await restarted.store.findAdmissionReceipt(submitted.task.taskId),
    );
    await expect(
      restarted.service.followUp({
        taskId: submitted.task.taskId,
        action: 'provide_input',
        inputRequestId: 'expired-version',
        messageText: 'report-a',
        inputContent: { documentId: 'report-a' },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_CLARIFICATION_STALE' });
    const follow = {
      taskId: submitted.task.taskId,
      action: 'provide_input' as const,
      inputRequestId: `capability:${submitted.task.taskId}:${String(receipt.version)}`,
      messageText: 'report-a',
      inputContent: { documentId: 'report-a' },
    };
    expect(await restarted.service.followUp(follow)).toMatchObject({
      taskId: submitted.task.taskId,
      phase: 'queued',
    });
    await restarted.service.followUp(follow);
    expect(restarted.queued).toEqual([submitted.task.taskId]);
    expect(await restarted.store.findBinding(submitted.task.taskId)).toMatchObject({
      inputSnapshot: { documentId: 'report-a' },
      exposureId: 'documents.summary',
    });
    expect(await restarted.store.listAttempts(submitted.task.taskId)).toHaveLength(1);
    await guardedDown(
      '0183_v14_capability_admission_receipt',
      'CAPABILITY_ADMISSION_RECEIPT_DOWNGRADE_REFERENCES',
    );
  });
  it('rolls back receipt, Task phase and binding together if admission persistence fails', async () => {
    const r = runtime();
    const submitted = await r.service.submit({
      messageText: 'Summarize another report.',
      metadata: {},
      clientRequestId: randomUUID(),
    });
    const task = submitted.task;
    const duplicateEvent = requiredFixture(
      (
        await pool.query<{ event_id: string }>(
          'SELECT event_id FROM runtime_event WHERE task_id=$1',
          [task.taskId],
        )
      ).rows[0],
    ).event_id;
    const inputAttempt = createTaskExecutionAttempt({
      attemptId: randomUUID(),
      taskId: task.taskId,
      contextId: task.contextId,
      reason: 'initial',
      createdAt: timestamp,
    });
    const acceptance = requiredFixture(
      await r.authority.prepareAcceptance({
        task: { ...task, phase: 'queued' },
        metadata: {},
        requestedCapability: {
          exposureId: exposure.exposureId,
          exposureVersion: 1,
          requestId: randomUUID(),
        },
        capabilityInput: { documentId: 'b' },
        inputAttempt,
        bindingId: randomUUID(),
        capabilityAttemptId: randomUUID(),
        event: {
          eventId: duplicateEvent,
          taskId: task.taskId,
          contextId: task.contextId,
          eventType: 'task.created',
          timestamp,
          summary: 'duplicate-event',
        },
      }),
    );
    await expect(r.store.acceptClarified(acceptance, 1)).rejects.toThrow();
    expect(await r.tasks.findById(task.taskId)).toMatchObject({ phase: 'awaiting_user_input' });
    expect(await r.store.findBinding(task.taskId)).toBeUndefined();
    expect(await r.store.findAdmissionReceipt(task.taskId)).toMatchObject({ version: 1 });
    expect((await r.store.findAdmissionReceipt(task.taskId))?.boundAt).toBeUndefined();
  });
});
async function guardedDown(version: string, message: string) {
  const client = await pool.connect();
  try {
    await expect(
      client.query(
        await readFile(
          new URL(`../../../infra/postgres/migrations/${version}.down.sql`, import.meta.url),
          'utf8',
        ),
      ),
    ).rejects.toThrow(message);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

function requiredFixture<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('REQUIRED_TEST_FIXTURE_MISSING');
  return value;
}
