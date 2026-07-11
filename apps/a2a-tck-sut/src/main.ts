import process from 'node:process';

import { Artifact, Message, Task, TaskState } from '@a2a-js/sdk';
import {
  AgentEvent,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';

import { startA2AHttpEndpoint } from '../../../packages/a2a-adapter/src/http-endpoint.js';

/** Protocol-only TCK SUT. It is never used by the SDAR production composition root. */
const executor: AgentExecutor = {
  execute(request: RequestContext, bus: ExecutionEventBus): Promise<void> {
    if (request.userMessage.messageId.includes('message-response')) {
      bus.publish(
        AgentEvent.message(
          Message.fromJSON({
            messageId: `${request.taskId}:direct-response`,
            contextId: request.contextId,
            role: 'ROLE_AGENT',
            parts: [{ text: 'Direct message response', mediaType: 'text/plain' }],
          }),
        ),
      );
      bus.finished();
      return Promise.resolve();
    }
    const artifact = buildArtifact(request.userMessage.messageId, request.taskId);
    bus.publish(
      AgentEvent.task(
        Task.fromJSON({
          id: request.taskId,
          contextId: request.contextId,
          status: {
            state: 'TASK_STATE_COMPLETED',
            timestamp: new Date().toISOString(),
          },
          artifacts: [Artifact.toJSON(artifact)],
          history: [Message.toJSON(request.userMessage)],
        }),
      ),
    );
    bus.finished();
    return Promise.resolve();
  },
  cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    bus.publish(
      AgentEvent.task(
        Task.fromJSON({
          id: taskId,
          contextId: `context-${taskId}`,
          status: { state: TaskState.TASK_STATE_CANCELED, timestamp: new Date().toISOString() },
          artifacts: [],
          history: [],
        }),
      ),
    );
    bus.finished();
    return Promise.resolve();
  },
};

const endpoint = await startA2AHttpEndpoint({
  executor,
  taskStore: new InMemoryTaskStore(),
  host: '127.0.0.1',
  port: Number(process.env['SDAR_A2A_PORT'] ?? 9999),
  skills: [
    {
      id: 'tck.protocol-fixture',
      name: 'A2A TCK protocol fixture',
      description: 'Protocol-only fixture for official compatibility tests.',
      tags: ['test-only'],
    },
  ],
});

process.stdout.write(`${JSON.stringify({ event: 'tck-sut.ready', a2aUrl: endpoint.baseUrl })}\n`);
process.once('SIGINT', () => void endpoint.close());
process.once('SIGTERM', () => void endpoint.close());

function buildArtifact(messageId: string, taskId: string): Artifact {
  let part: Readonly<Record<string, unknown>>;
  if (messageId.includes('artifact-file-url')) {
    part = {
      url: 'https://example.com/output.txt',
      filename: 'output.txt',
      mediaType: 'text/plain',
    };
  } else if (messageId.includes('artifact-file')) {
    part = {
      raw: Buffer.from('Generated file content').toString('base64'),
      filename: 'output.txt',
      mediaType: 'text/plain',
    };
  } else if (messageId.includes('artifact-data')) {
    part = { data: { key: 'value', count: 42 }, mediaType: 'application/json' };
  } else {
    part = { text: 'Generated text content', mediaType: 'text/plain' };
  }
  return Artifact.fromJSON({
    artifactId: `${taskId}:artifact`,
    name: 'TCK protocol artifact',
    parts: [part],
  });
}
