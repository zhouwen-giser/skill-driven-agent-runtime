import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';

import { Message, SendMessageRequest, Task, TaskState, type StreamResponse } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { UserBuilder, agentCardHandler, restHandler } from '@a2a-js/sdk/server/express';
import express from 'express';

import { buildAgentCard, buildStatusUpdate } from './compatibility.js';

export interface A2aHttpSpikeHandle {
  readonly baseUrl: string;
  readonly client: Client;
  close(): Promise<void>;
}

export interface A2aHttpSpikeOptions {
  readonly completionDelayMs?: number;
}

export async function startA2aHttpSpike(
  options: A2aHttpSpikeOptions = {},
): Promise<A2aHttpSpikeHandle> {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    await closeHttpServer(httpServer);
    throw new Error('A2A_SPIKE_ADDRESS_UNAVAILABLE');
  }

  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const endpoint = `${baseUrl}/a2a`;
  const card = buildAgentCard(
    [
      {
        id: 'skill.echo',
        name: 'Echo',
        description: 'Deterministic A2A protocol compatibility probe.',
        tags: ['test', 'read-only'],
      },
    ],
    endpoint,
  );

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

  const requestHandler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
  app.use('/a2a', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  const client = await new ClientFactory().createFromUrl(baseUrl);
  return {
    baseUrl,
    client,
    async close(): Promise<void> {
      await closeHttpServer(httpServer);
    },
  };
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

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
