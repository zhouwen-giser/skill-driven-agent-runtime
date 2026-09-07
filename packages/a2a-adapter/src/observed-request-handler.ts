import type { SendMessageRequest, StreamResponse } from '@a2a-js/sdk';
import {
  Artifact,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
  TaskStatus,
  type Message,
  type SubscribeToTaskRequest,
} from '@a2a-js/sdk';
import { DefaultRequestHandler, type ServerCallContext } from '@a2a-js/sdk/server';
import type { TaskProjectionReader, TaskStateNotifier } from '../../application/src/index.js';
import { toA2ATask } from './task-mapping.js';

export interface TaskObservationOptions {
  readonly reader: TaskProjectionReader;
  readonly notifier: TaskStateNotifier;
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}
/** Official SDK admission, validation and storage; observation never publishes into its write bus. */
export class ObservedRequestHandler extends DefaultRequestHandler {
  #closed = false;
  constructor(
    args: ConstructorParameters<typeof DefaultRequestHandler>,
    private readonly observation: TaskObservationOptions,
  ) {
    super(...args);
  }
  override async sendMessage(
    params: SendMessageRequest,
    context: ServerCallContext,
  ): Promise<Message | Task> {
    const initial = await super.sendMessage(immediate(params), context);
    if (!('id' in initial) || params.configuration?.returnImmediately === true) return initial;
    let current = initial;
    for await (const response of this.observe(
      initial,
      Date.now() + (this.observation.waitTimeoutMs ?? 30_000),
    )) {
      if (response.payload?.$case === 'task') current = response.payload.value;
    }
    return current;
  }
  override async *sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const initial = await super.sendMessage(immediate(params), context);
    if (!('id' in initial)) {
      yield { payload: { $case: 'message', value: initial } };
      return;
    }
    yield* this.observe(initial);
  }
  override async *resubscribe(
    params: SubscribeToTaskRequest,
    context: ServerCallContext,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const initial = await super.getTask(
      { id: params.id, historyLength: undefined, tenant: params.tenant },
      context,
    );
    yield* this.observe(initial);
  }
  closeObservation(): void {
    this.#closed = true;
  }
  private async *observe(
    initial: Task,
    deadline?: number,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    let current: Task;
    yield { payload: { $case: 'task', value: initial } };
    let identity = '';
    let artifactHash = JSON.stringify(
      initial.artifacts.map((artifact) => Artifact.toJSON(artifact)),
    );
    while (!this.#closed) {
      const projection = await this.observation.reader.read(initial.id);
      if (projection === undefined) return;
      const key = [projection.revision, projection.interactionVersion, projection.resultHash].join(
        ':',
      );
      current = { ...toA2ATask(projection.task, projection.interaction), history: initial.history };
      if (key !== identity) {
        const nextArtifacts = JSON.stringify(
          current.artifacts.map((artifact) => Artifact.toJSON(artifact)),
        );
        if (deadline !== undefined) {
          yield { payload: { $case: 'task', value: current } };
        } else {
          if (nextArtifacts !== artifactHash)
            for (const artifact of current.artifacts)
              yield {
                payload: {
                  $case: 'artifactUpdate',
                  value: TaskArtifactUpdateEvent.fromJSON({
                    taskId: current.id,
                    contextId: current.contextId,
                    artifact: Artifact.toJSON(artifact),
                    append: false,
                    lastChunk: true,
                  }),
                },
              };
          if (
            identity !== '' ||
            JSON.stringify(Task.toJSON(initial)) !== JSON.stringify(Task.toJSON(current))
          )
            yield {
              payload: {
                $case: 'statusUpdate',
                value: TaskStatusUpdateEvent.fromJSON({
                  taskId: current.id,
                  contextId: current.contextId,
                  status:
                    current.status === undefined ? undefined : TaskStatus.toJSON(current.status),
                  metadata: current.metadata,
                }),
              },
            };
        }
        identity = key;
        artifactHash = nextArtifacts;
      }
      if (boundary(current) || (deadline !== undefined && Date.now() >= deadline)) return;
      await this.observation.notifier.waitForChange(
        initial.id,
        projection.task.updatedAt,
        Math.min(
          this.observation.pollIntervalMs ?? 1000,
          deadline === undefined ? Infinity : Math.max(1, deadline - Date.now()),
        ),
      );
    }
  }
}
function immediate(params: SendMessageRequest): SendMessageRequest {
  return {
    ...params,
    configuration: {
      ...params.configuration,
      returnImmediately: true,
      acceptedOutputModes: params.configuration?.acceptedOutputModes ?? [],
      historyLength: params.configuration?.historyLength,
      taskPushNotificationConfig: params.configuration?.taskPushNotificationConfig,
    },
  };
}
function boundary(task: Task): boolean {
  return [
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_CANCELED,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_REJECTED,
  ].includes(task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED);
}
