import type { AgentTask } from '../../domain/src/index.js';

export interface TaskProjection {
  readonly task: AgentTask;
  readonly revision: string;
  readonly interaction?: Readonly<Record<string, unknown>>;
  readonly interactionVersion: string;
  readonly resultHash: string;
}
/** Read capability only: no planning handoff, reconciliation or command ports. */
export interface TaskProjectionReader {
  read(taskId: string): Promise<TaskProjection | undefined>;
}
export class ReadOnlyTaskProjectionService implements TaskProjectionReader {
  constructor(
    private readonly dependencies: Readonly<{
      readState(
        taskId: string,
      ): Promise<Readonly<{ task: AgentTask; revision: string }> | undefined>;
      readInteraction(taskId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
      hash(value: unknown): string;
    }>,
  ) {}
  async read(taskId: string): Promise<TaskProjection | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.dependencies.readState(taskId);
      if (before === undefined) return undefined;
      const interaction = await this.dependencies.readInteraction(taskId);
      const after = await this.dependencies.readState(taskId);
      if (after === undefined) return undefined;
      if (before.revision !== after.revision) continue;
      return {
        ...after,
        ...(interaction === undefined ? {} : { interaction }),
        interactionVersion: this.dependencies.hash(interaction ?? null),
        resultHash: this.dependencies.hash(after.task.output ?? null),
      };
    }
    throw Object.assign(new Error('Task changed while reading its projection; retry the read.'), {
      code: 'TASK_PROJECTION_CHANGED_DURING_READ',
    });
  }
}
