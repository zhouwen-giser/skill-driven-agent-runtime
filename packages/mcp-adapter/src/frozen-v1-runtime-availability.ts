import type { FrozenTaskAvailabilityRuntimePort } from '../../application/src/index.js';
import type {
  FrozenTaskAvailabilityCheckRequest,
  TaskAvailabilityCheckRequest,
} from '../../domain/src/index.js';

import { FrozenTaskAvailabilityClient } from './frozen-v1-availability.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

export class FrozenV1RuntimeAvailabilityAdapter implements FrozenTaskAvailabilityRuntimePort {
  readonly #client: FrozenV1McpClient;

  constructor(client: FrozenV1McpClient = new FrozenV1McpClient()) {
    this.#client = client;
  }

  async check(input: Parameters<FrozenTaskAvailabilityRuntimePort['check']>[0]) {
    const requests = input.requests.map(toFrozenCheck);
    const results = await new FrozenTaskAvailabilityClient({
      client: this.#client,
      endpoint: input.endpoint,
      headers: input.headers,
    }).check(requests);
    const nodeByKey = new Map(
      input.requests.map((request) => [key(request.nodeId, request.operationName), request.nodeId]),
    );
    return {
      kind: 'results' as const,
      protocolRevision: '2026-07-28',
      availabilitySchemaRevision: '1.0',
      results: Object.freeze(
        results.map((result) => ({
          nodeId: nodeByKey.get(key(result.requestId, result.operationName)) ?? result.requestId,
          operationName: result.operationName,
          availability: result.availability,
          riskLevel: result.riskLevel,
          ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
          ...(result.description === undefined ? {} : { description: result.description }),
          ...(result.validUntil === undefined ? {} : { validUntil: result.validUntil }),
          ...(result.earliestStartTime === undefined
            ? {}
            : { earliestStartTime: result.earliestStartTime }),
          nextAvailableWindows: result.nextAvailableWindows,
          ...(result.estimatedDelayMs === undefined
            ? {}
            : { estimatedDelayMs: result.estimatedDelayMs }),
          reservationMode: result.reservationMode,
          ...(result.reservationRef === undefined ? {} : { reservationRef: result.reservationRef }),
          possibleEffects: result.possibleEffects,
        })),
      ),
    };
  }
}

function toFrozenCheck(request: TaskAvailabilityCheckRequest): FrozenTaskAvailabilityCheckRequest {
  return {
    requestId: request.nodeId,
    operationName: request.operationName,
    arguments: !request.arguments.unresolved
      ? { state: 'complete', value: request.arguments.value }
      : {
          state: 'partial',
          knownValue: request.arguments.knownArguments,
          unresolvedPaths: request.arguments.unresolvedPaths.map(jsonPathToPointer),
        },
    timing: request.timing ?? {
      start: { mode: 'immediate', startToleranceMs: 0 },
      maxElapsedMs: null,
    },
  };
}

function jsonPathToPointer(path: string): string {
  if (path === '$') return '';
  if (path.startsWith('$.'))
    return `/${path
      .slice(2)
      .split('.')
      .map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('/')}`;
  return path.startsWith('/') ? path : '';
}

function key(requestId: string, operationName: string): string {
  return `${requestId}\u0000${operationName}`;
}
