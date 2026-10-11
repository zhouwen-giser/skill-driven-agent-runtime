import type {
  FrozenTaskBusinessMutationRuntimePort,
  FrozenTaskBusinessReadRuntimePort,
} from '../../application/src/mcp-registry.js';
import type { FrozenV1McpClient } from './frozen-v1-mcp-client.js';
import { SmppTaskBusinessClient } from './smpp-task-business-client.js';

/** Frozen SMPP transport adaptation only; Task lifecycle and authorization stay in the kernel. */
export function createSmppTaskBusinessTransport(
  dependencies: Readonly<{ client: FrozenV1McpClient; now(): string }>,
): Readonly<{
  read: FrozenTaskBusinessReadRuntimePort;
  mutation: FrozenTaskBusinessMutationRuntimePort;
}> {
  const frozenMcpClient = dependencies.client;
  const clock = { now: dependencies.now };
  return {
    read: {
      getContext: (input) =>
        new SmppTaskBusinessClient({
          client: frozenMcpClient,
          endpoint: input.endpoint,
          headers: input.headers,
          now: clock.now,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          expectedProviderId: input.expectedProviderId,
          expectedResourceId: input.expectedResourceId,
          ...(input.expectedExecutionId === undefined
            ? {}
            : { expectedExecutionId: input.expectedExecutionId }),
          ...(input.expectedOperationName === undefined
            ? {}
            : { expectedOperationName: input.expectedOperationName }),
        }).getContext({ taskId: input.taskId }),
      getArtifact: (input) =>
        new SmppTaskBusinessClient({
          client: frozenMcpClient,
          endpoint: input.endpoint,
          headers: input.headers,
          now: clock.now,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          expectedProviderId: input.expectedProviderId,
          expectedResourceId: input.expectedResourceId,
          ...(input.expectedExecutionId === undefined
            ? {}
            : { expectedExecutionId: input.expectedExecutionId }),
          ...(input.expectedOperationName === undefined
            ? {}
            : { expectedOperationName: input.expectedOperationName }),
        }).getArtifact({
          taskId: input.taskId,
          artifactId: input.artifactId,
          revision: input.revision,
        }),
      getArtifactContent: (input) =>
        new SmppTaskBusinessClient({
          client: frozenMcpClient,
          endpoint: input.endpoint,
          headers: input.headers,
          now: clock.now,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          expectedProviderId: input.expectedProviderId,
          expectedResourceId: input.expectedResourceId,
          ...(input.expectedExecutionId === undefined
            ? {}
            : { expectedExecutionId: input.expectedExecutionId }),
          ...(input.expectedOperationName === undefined
            ? {}
            : { expectedOperationName: input.expectedOperationName }),
        }).readArtifactContent({
          taskId: input.taskId,
          artifactId: input.artifactId,
          revision: input.revision,
        }),
    },
    mutation: {
      async dispatch(input) {
        const client = new SmppTaskBusinessClient({
          client: frozenMcpClient,
          endpoint: input.endpoint,
          headers: input.headers,
          now: clock.now,
          expectedProviderId: input.expectedProviderId,
          expectedResourceId: input.expectedResourceId,
          expectedExecutionId: input.expectedExecutionId,
          expectedOperationName: input.expectedOperationName,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          mutationAuthority: { authorize: input.authorize },
        });
        const request = input.request;
        if (request.operation === 'input_response')
          return client.respondToRequiredInput({
            taskId: input.taskId,
            executionId: input.expectedExecutionId,
            requestId: request.requestId,
            requestKey: request.requestKey,
            expectedRequestRevision: request.expectedRequestRevision,
            expectedSubjectBinding: request.expectedSubjectBinding,
            action: request.response.action,
            ...(request.response.action === 'accept' ? { content: request.response.content } : {}),
          });
        return client.applyNavigationAdjustment({
          taskId: input.taskId,
          executionId: input.expectedExecutionId,
          interventionId: request.interventionId,
          expectedInterventionRevision: request.expectedInterventionRevision,
          expectedEffectivePlanRevision: request.expectedEffectivePlanRevision,
          commandId: request.commandId,
          waypoints: request.waypoints,
          density: request.density,
        });
      },
    },
  };
}
