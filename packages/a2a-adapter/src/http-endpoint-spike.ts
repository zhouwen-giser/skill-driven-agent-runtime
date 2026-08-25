import { Message, SendMessageRequest, Task, TaskState, type StreamResponse } from '@a2a-js/sdk';
import { type Client } from '@a2a-js/sdk/client';
import {
  AgentEvent,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';

import { buildStatusUpdate } from './compatibility.js';
import { startA2AHttpEndpoint } from './http-endpoint.js';

export interface A2aHttpSpikeHandle {
  readonly baseUrl: string;
  readonly client: Client;
  close(): Promise<void>;
}

export interface A2aHttpSpikeOptions {
  readonly completionDelayMs?: number;
  readonly artifactProjectionProvider?: Parameters<
    typeof startA2AHttpEndpoint
  >[0]['artifactProjectionProvider'];
  readonly agentCardProvider?: Parameters<typeof startA2AHttpEndpoint>[0]['agentCardProvider'];
  readonly naturalLanguageAdmissionContractProvider?: Parameters<
    typeof startA2AHttpEndpoint
  >[0]['naturalLanguageAdmissionContractProvider'];
}

export async function startA2aHttpSpike(
  options: A2aHttpSpikeOptions = {},
): Promise<A2aHttpSpikeHandle> {
  const contextByTask = new Map<string, string>();
  const executor: AgentExecutor = {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
      const timestamp = '2026-07-11T09:00:00.000Z';
      contextByTask.set(requestContext.taskId, requestContext.contextId);
      const task = Task.fromJSON({
        id: requestContext.taskId,
        contextId: requestContext.contextId,
        status: { state: 'TASK_STATE_SUBMITTED', timestamp },
        history: [Message.toJSON(requestContext.userMessage)],
        artifacts: [],
      });
      eventBus.publish(AgentEvent.task(task));
      eventBus.publish(
        AgentEvent.statusUpdate(
          buildStatusUpdate(
            requestContext.taskId,
            requestContext.contextId,
            TaskState.TASK_STATE_WORKING,
            timestamp,
          ),
        ),
      );
      if (options.completionDelayMs !== undefined) {
        await delay(options.completionDelayMs);
      }
      eventBus.publish(
        AgentEvent.statusUpdate(
          buildStatusUpdate(
            requestContext.taskId,
            requestContext.contextId,
            TaskState.TASK_STATE_COMPLETED,
            timestamp,
          ),
        ),
      );
      eventBus.finished();
    },
    cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
      const contextId = contextByTask.get(taskId);
      if (contextId === undefined) throw new Error('A2A_TASK_CONTEXT_NOT_FOUND');
      eventBus.publish(
        AgentEvent.statusUpdate(
          buildStatusUpdate(
            taskId,
            contextId,
            TaskState.TASK_STATE_CANCELED,
            '2026-07-11T09:00:00.000Z',
          ),
        ),
      );
      eventBus.finished();
      return Promise.resolve();
    },
  };

  return startA2AHttpEndpoint({
    executor,
    taskStore: new InMemoryTaskStore(),
    skills: [
      {
        id: 'skill.echo',
        name: 'Echo',
        description: 'Deterministic A2A protocol compatibility probe.',
        tags: ['test', 'read-only'],
      },
    ],
    ...(options.artifactProjectionProvider === undefined
      ? {}
      : { artifactProjectionProvider: options.artifactProjectionProvider }),
    ...(options.agentCardProvider === undefined
      ? {}
      : { agentCardProvider: options.agentCardProvider }),
    ...(options.naturalLanguageAdmissionContractProvider === undefined
      ? {}
      : {
          naturalLanguageAdmissionContractProvider:
            options.naturalLanguageAdmissionContractProvider,
        }),
  });
}

export function createProbeRequest(): SendMessageRequest {
  return SendMessageRequest.fromJSON({
    message: {
      messageId: 'message-probe-1',
      role: 'ROLE_USER',
      parts: [{ text: 'Run protocol compatibility probe.', mediaType: 'text/plain' }],
    },
    configuration: {
      acceptedOutputModes: ['text/plain', 'application/json'],
      returnImmediately: false,
    },
  });
}

export function streamPayloadCase(event: StreamResponse): string | undefined {
  return event.payload?.$case;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
