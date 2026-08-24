import { isDeepStrictEqual } from 'node:util';

import { ListTasksResponse, Message, Task, TaskState, type ListTasksRequest } from '@a2a-js/sdk';
import type { ServerCallContext, TaskStore } from '@a2a-js/sdk/server';
import { z } from 'zod';

import type {
  AgentTaskRepository,
  ExternalTaskProjectionRepository,
} from '../../application/src/index.js';
import { toA2ATask } from './task-mapping.js';

const StoredDocumentSchema = z.record(z.string(), z.unknown());

/** SDK-facing projection store. Domain task state remains authoritative in agent_task. */
export class A2AProjectionTaskStore implements TaskStore {
  readonly #projections: ExternalTaskProjectionRepository;
  readonly #tasks: Pick<AgentTaskRepository, 'findById'> | undefined;
  readonly #onCanceled: ((taskId: string) => Promise<void>) | undefined;
  readonly #interaction:
    ((taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>) | undefined;
  readonly #writeTails = new Map<string, Promise<void>>();

  constructor(
    projections: ExternalTaskProjectionRepository,
    tasks?: Pick<AgentTaskRepository, 'findById'>,
    onCanceled?: (taskId: string) => Promise<void>,
    interaction?: (taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>,
  ) {
    this.#projections = projections;
    this.#tasks = tasks;
    this.#onCanceled = onCanceled;
    this.#interaction = interaction;
  }

  async save(task: Task, _context: ServerCallContext): Promise<void> {
    void _context;
    await this.saveCanonical(task);
  }

  /** Shares the canonical projection write coordinator with adapter-owned repair jobs. */
  async saveCanonical(task: Task): Promise<void> {
    await this.#serializeProjectionWrite(task.id, () => this.#saveSerialized(task));
  }

  async #saveSerialized(task: Task): Promise<void> {
    if (task.status === undefined) throw new Error('A2A_TASK_STATUS_REQUIRED');
    if (task.status.state === TaskState.TASK_STATE_CANCELED) {
      await this.#onCanceled?.(task.id);
    }
    const persistedProjection = await this.#projections.find('a2a-v1', task.id);
    const persisted =
      persistedProjection === undefined ? undefined : parseStoredTask(persistedProjection.document);
    const authoritative = await this.#tasks?.findById(task.id);
    const canonicalTaskId = authoritative?.taskId ?? task.id;
    const canonicalContextId = authoritative?.contextId ?? task.contextId;
    if (
      persisted !== undefined &&
      (persisted.id !== canonicalTaskId || persisted.contextId !== canonicalContextId)
    )
      throw new A2AProjectionTaskStoreError(
        'A2A_TASK_PROJECTION_IDENTITY_CONFLICT',
        'The stored A2A projection does not match its authoritative Task identity.',
      );
    const history = mergeCanonicalHistory(
      persisted?.history ?? [],
      task.history,
      canonicalTaskId,
      canonicalContextId,
    );
    const canonical =
      authoritative === undefined
        ? Task.fromJSON({
            ...StoredDocumentSchema.parse(Task.toJSON(task)),
            history: history.map((message) => Message.toJSON(message)),
          })
        : Task.fromJSON({
            ...StoredDocumentSchema.parse(
              Task.toJSON(toA2ATask(authoritative, await this.#interaction?.(task.id))),
            ),
            history: history.map((message) => Message.toJSON(message)),
          });
    if (canonical.status === undefined) throw new Error('A2A_TASK_STATUS_REQUIRED');
    const rawDocument: unknown = Task.toJSON(canonical);
    const document = StoredDocumentSchema.parse(rawDocument);
    await this.#projections.save({
      protocol: 'a2a-v1',
      taskId: canonical.id,
      contextId: canonical.contextId,
      state: TaskState[canonical.status.state],
      ...(canonical.status.timestamp === undefined
        ? {}
        : { statusTimestamp: canonical.status.timestamp }),
      document,
    });
  }

  async #serializeProjectionWrite<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(taskId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.#writeTails.set(taskId, tail);
    try {
      return await current;
    } finally {
      if (this.#writeTails.get(taskId) === tail) this.#writeTails.delete(taskId);
    }
  }

  async load(taskId: string, _context: ServerCallContext): Promise<Task | undefined> {
    void _context;
    const projection = await this.#projections.find('a2a-v1', taskId);
    const stored =
      projection === undefined
        ? undefined
        : Task.fromJSON(StoredDocumentSchema.parse(projection.document));
    const authoritative = await this.#tasks?.findById(taskId);
    if (authoritative === undefined) return stored;
    const current = toA2ATask(authoritative, await this.#interaction?.(taskId));
    return Task.fromJSON({
      ...StoredDocumentSchema.parse(Task.toJSON(current)),
      history: (stored?.history ?? []).map((message) => Message.toJSON(message)),
    });
  }

  async list(params: ListTasksRequest, _context: ServerCallContext): Promise<ListTasksResponse> {
    void _context;
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    const offset = parsePageToken(params.pageToken);
    const state =
      params.status === TaskState.TASK_STATE_UNSPECIFIED ? undefined : TaskState[params.status];
    const result = await this.#projections.list({
      protocol: 'a2a-v1',
      ...(params.contextId === '' ? {} : { contextId: params.contextId }),
      ...(state === undefined ? {} : { state }),
      ...(params.statusTimestampAfter === undefined
        ? {}
        : { statusTimestampAfter: params.statusTimestampAfter }),
      offset,
      limit: pageSize,
    });
    const tasks = result.items.map((item) => {
      const task = Task.fromJSON(StoredDocumentSchema.parse(item.document));
      return {
        ...task,
        history:
          params.historyLength === undefined
            ? task.history
            : task.history.slice(-params.historyLength),
        artifacts: params.includeArtifacts === true ? task.artifacts : [],
      };
    });
    const nextOffset = offset + tasks.length;
    return ListTasksResponse.fromJSON({
      tasks: tasks.map((task) => Task.toJSON(task)),
      nextPageToken: nextOffset < result.total ? String(nextOffset) : '',
      pageSize,
      totalSize: result.total,
    });
  }
}

function parseStoredTask(value: unknown): Task | undefined {
  const document = StoredDocumentSchema.safeParse(value);
  if (!document.success) return undefined;
  try {
    return Task.fromJSON(document.data);
  } catch {
    return undefined;
  }
}

function mergeCanonicalHistory(
  persisted: readonly Message[],
  incoming: readonly Message[],
  taskId: string,
  contextId: string,
): readonly Message[] {
  const byMessageId = new Map<string, Message>();
  const merged: Message[] = [];
  for (const message of [...persisted, ...incoming]) {
    const canonical = canonicalHistoryMessage(message, taskId, contextId);
    const existing = byMessageId.get(canonical.messageId);
    if (existing === undefined) {
      byMessageId.set(canonical.messageId, canonical);
      merged.push(canonical);
      continue;
    }
    if (!isDeepStrictEqual(Message.toJSON(existing), Message.toJSON(canonical)))
      throw new A2AProjectionTaskStoreError(
        'A2A_TASK_HISTORY_MESSAGE_ID_CONFLICT',
        `A2A history messageId ${canonical.messageId} is already bound to different content.`,
      );
  }
  return merged;
}

function canonicalHistoryMessage(message: Message, taskId: string, contextId: string): Message {
  return Message.fromJSON({
    ...StoredDocumentSchema.parse(Message.toJSON(message)),
    taskId,
    contextId,
    metadata: {},
  });
}

export type A2AProjectionTaskStoreErrorCode =
  'A2A_TASK_HISTORY_MESSAGE_ID_CONFLICT' | 'A2A_TASK_PROJECTION_IDENTITY_CONFLICT';

export class A2AProjectionTaskStoreError extends Error {
  readonly code: A2AProjectionTaskStoreErrorCode;

  constructor(code: A2AProjectionTaskStoreErrorCode, message: string) {
    super(message);
    this.name = 'A2AProjectionTaskStoreError';
    this.code = code;
  }
}

function parsePageToken(token: string): number {
  if (token === '') return 0;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error('A2A_PAGE_TOKEN_INVALID');
  return Number(token);
}
