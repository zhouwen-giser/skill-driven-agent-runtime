import type {
  JSONRPCMessage,
  MessageExtraInfo,
  StreamableHTTPClientTransport,
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/client';

import { MCP_TASKS_WIRE_METHODS, assertValidRemoteTaskId } from './mcp-tasks-contract.js';

/**
 * Temporary beta.4 compatibility bridge approved by ADR-081.
 *
 * The official Client sees private aliases so its pre-SEP-2663 era registry
 * cannot reject the extension. The official transport sees only the exact
 * standard method names. Raw Task results are preserved inside a nonce-marked
 * in-process envelope long enough for the frozen extension Schema to validate
 * them; no bridge field is transmitted over HTTP.
 */
export class McpTasksTransportBridge implements Transport {
  readonly #transport: StreamableHTTPClientTransport;
  readonly #bridgeNonce: string;
  #protocolVersion: string | undefined;

  onclose: (() => void) | undefined;
  onerror: ((error: Error) => void) | undefined;
  onmessage: ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined;

  constructor(transport: StreamableHTTPClientTransport, bridgeNonce: string) {
    this.#transport = transport;
    this.#bridgeNonce = bridgeNonce;
    transport.onclose = () => this.onclose?.();
    transport.onerror = (error) => this.onerror?.(error);
    transport.onmessage = (message) => this.onmessage?.(this.#mapIncoming(message));
  }

  get hasPerRequestStream(): boolean {
    return this.#transport.hasPerRequestStream;
  }

  get sessionId(): string | undefined {
    return this.#transport.sessionId;
  }

  get protocolVersion(): string | undefined {
    return this.#protocolVersion;
  }

  start(): Promise<void> {
    return this.#transport.start();
  }

  close(): Promise<void> {
    return this.#transport.close();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const concreteOptions =
      options === undefined
        ? undefined
        : {
            ...(options.resumptionToken === undefined
              ? {}
              : { resumptionToken: options.resumptionToken }),
            ...(options.onresumptiontoken === undefined
              ? {}
              : { onresumptiontoken: options.onresumptiontoken }),
            ...(options.requestSignal === undefined
              ? {}
              : { requestSignal: options.requestSignal }),
            ...(options.onRequestStreamEnd === undefined
              ? {}
              : { onRequestStreamEnd: options.onRequestStreamEnd }),
            ...(options.headers === undefined ? {} : { headers: options.headers }),
          };
    return this.#transport.send(this.#mapOutgoing(message), concreteOptions);
  }

  setProtocolVersion(version: string): void {
    this.#protocolVersion = version;
    this.#transport.setProtocolVersion(version);
  }

  #mapOutgoing(message: JSONRPCMessage): JSONRPCMessage {
    if (!isRecord(message)) return message;
    const record = message as unknown as Readonly<Record<string, unknown>>;
    if (typeof record['method'] !== 'string') return message;
    const method = (MCP_TASKS_WIRE_METHODS as Readonly<Record<string, string>>)[record['method']];
    if (method === undefined) return message;
    return { ...message, method };
  }

  #mapIncoming(message: JSONRPCMessage): JSONRPCMessage {
    if (!isRecord(message)) return message;
    const record = message as unknown as Readonly<Record<string, unknown>>;
    if (!isRecord(record['result'])) return message;
    const result = record['result'];
    if (result['resultType'] !== 'task') return message;
    const bridgeResult = {
      ...(this.#protocolVersion === undefined || this.#protocolVersion.startsWith('2026-')
        ? { resultType: 'complete' }
        : {}),
      __sdarBridgeNonce: this.#bridgeNonce,
      __sdarExtensionTask: result,
    };
    return { ...message, result: bridgeResult };
  }
}

export function createMcpTasksRoutingFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const method = methodFromRequestBody(init?.body);
    if (method === 'io.sdar/tasks/checkAvailability') {
      const headers = new Headers(init?.headers);
      headers.delete('Mcp-Name');
      headers.delete('Mcp-Method');
      return baseFetch(input, { ...init, headers });
    }
    const taskId = taskIdFromRequestBody(init?.body);
    if (taskId === undefined) return baseFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('Mcp-Name', taskId);
    return baseFetch(input, { ...init, headers });
  };
}

function methodFromRequestBody(body: RequestInit['body']): string | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const message = JSON.parse(body) as unknown;
    return isRecord(message) && typeof message['method'] === 'string'
      ? message['method']
      : undefined;
  } catch {
    return undefined;
  }
}

function taskIdFromRequestBody(body: RequestInit['body']): string | undefined {
  if (typeof body !== 'string') return undefined;
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(message) || !isTaskOperation(message['method'])) return undefined;
  const params = message['params'];
  if (!isRecord(params) || typeof params['taskId'] !== 'string') return undefined;
  return assertValidRemoteTaskId(params['taskId']);
}

function isTaskOperation(value: unknown): value is 'tasks/get' | 'tasks/update' | 'tasks/cancel' {
  return value === 'tasks/get' || value === 'tasks/update' || value === 'tasks/cancel';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
