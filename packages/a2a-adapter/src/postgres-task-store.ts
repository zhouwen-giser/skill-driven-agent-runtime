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
    if (task.status === undefined) throw new Error('A2A_TASK_STATUS_REQUIRED');
    if (task.status.state === TaskState.TASK_STATE_CANCELED) {
      await this.#onCanceled?.(task.id);
    }
    const authoritative = await this.#tasks?.findById(task.id);
    const canonical =
      authoritative === undefined
        ? task
        : Task.fromJSON({
            ...StoredDocumentSchema.parse(
              Task.toJSON(toA2ATask(authoritative, await this.#interaction?.(task.id))),
            ),
            history: task.history.map((message) => Message.toJSON(message)),
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

function parsePageToken(token: string): number {
  if (token === '') return 0;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error('A2A_PAGE_TOKEN_INVALID');
  return Number(token);
}
