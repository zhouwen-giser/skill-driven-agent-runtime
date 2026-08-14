import { Message, Task, TaskState } from '@a2a-js/sdk';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import type {
  AgentTaskRepository,
  ExternalTaskProjection,
  ExternalTaskProjectionRepository,
} from '../../application/src/index.js';
import { isTerminalTaskPhase } from '../../domain/src/index.js';
import { toA2ATask } from './task-mapping.js';

const StoredDocumentSchema = z.record(z.string(), z.unknown());

export const DEFAULT_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS = 30_000;
export const MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS = 1_000;
export const MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS = 300_000;
export const A2A_TERMINAL_RECONCILIATION_PAGE_SIZE = 100;

export interface A2ATerminalProjectionReconciliationResult {
  readonly scanned: number;
  readonly reconciled: number;
  readonly alreadyConverged: number;
  readonly nonTerminal: number;
  readonly missingAuthoritativeTask: number;
}

/**
 * Repairs rebuildable A2A projections from Runtime-owned AgentTask rows.
 *
 * Only Tasks that already have an a2a-v1 projection are considered. This keeps
 * protocol admission with the A2A adapter while making restart recovery
 * independent of another client request.
 */
export class A2ATerminalProjectionReconciler {
  readonly #projections: ExternalTaskProjectionRepository;
  readonly #tasks: Pick<AgentTaskRepository, 'findById'>;
  readonly #interaction:
    ((taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>) | undefined;

  constructor(options: {
    projections: ExternalTaskProjectionRepository;
    tasks: Pick<AgentTaskRepository, 'findById'>;
    interaction?: (taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>;
  }) {
    this.#projections = options.projections;
    this.#tasks = options.tasks;
    this.#interaction = options.interaction;
  }

  async reconcile(): Promise<A2ATerminalProjectionReconciliationResult> {
    let taskIdAfter = '';
    let scanned = 0;
    let reconciled = 0;
    let alreadyConverged = 0;
    let nonTerminal = 0;
    let missingAuthoritativeTask = 0;

    for (;;) {
      const page = await this.#projections.list({
        protocol: 'a2a-v1',
        taskIdAfter,
        offset: 0,
        limit: A2A_TERMINAL_RECONCILIATION_PAGE_SIZE,
      });
      if (page.items.length === 0) break;

      for (const projection of page.items) {
        scanned += 1;
        const authoritative = await this.#tasks.findById(projection.taskId);
        if (authoritative === undefined) {
          missingAuthoritativeTask += 1;
          continue;
        }
        if (!isTerminalTaskPhase(authoritative.phase)) {
          nonTerminal += 1;
          continue;
        }

        const task = toA2ATask(authoritative, await this.#interaction?.(projection.taskId));
        const converged = projectionFromTask(task, projection);
        if (projectionEqual(projection, converged)) {
          alreadyConverged += 1;
          continue;
        }
        await this.#projections.save(converged);
        reconciled += 1;
      }
      const lastTaskId = page.items.at(-1)?.taskId;
      if (lastTaskId === undefined) break;
      taskIdAfter = lastTaskId;
    }

    return {
      scanned,
      reconciled,
      alreadyConverged,
      nonTerminal,
      missingAuthoritativeTask,
    };
  }
}

export function resolveA2ATerminalReconciliationIntervalMs(value: number | undefined): number {
  const interval = value ?? DEFAULT_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS;
  if (
    !Number.isInteger(interval) ||
    interval < MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS ||
    interval > MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS
  ) {
    throw new Error('A2A_TERMINAL_RECONCILIATION_INTERVAL_INVALID');
  }
  return interval;
}

function projectionFromTask(task: Task, existing: ExternalTaskProjection): ExternalTaskProjection {
  if (task.status === undefined) throw new Error('A2A_TASK_STATUS_REQUIRED');
  const storedDocument = StoredDocumentSchema.safeParse(existing.document);
  const history = storedDocument.success
    ? Task.fromJSON(storedDocument.data).history.map((message) => Message.toJSON(message))
    : [];
  const document = StoredDocumentSchema.parse(
    Task.toJSON({
      ...task,
      history: history.map((message) => Message.fromJSON(message)),
    }),
  );
  return {
    protocol: 'a2a-v1',
    taskId: task.id,
    contextId: task.contextId,
    state: TaskState[task.status.state],
    ...(task.status.timestamp === undefined ? {} : { statusTimestamp: task.status.timestamp }),
    document,
  };
}

function projectionEqual(left: ExternalTaskProjection, right: ExternalTaskProjection): boolean {
  return (
    left.taskId === right.taskId &&
    left.contextId === right.contextId &&
    left.state === right.state &&
    left.statusTimestamp === right.statusTimestamp &&
    isDeepStrictEqual(left.document, right.document)
  );
}
