import type { McpProviderProtocolMode } from '../../domain/src/index.js';
import type { StreamableHttpMcpAdapter } from './streamable-http-adapter.js';
import type { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

export class McpTransportRouter {
  readonly #legacy: StreamableHttpMcpAdapter;
  readonly #frozen: FrozenV1McpClient;

  constructor(input: Readonly<{ legacy: StreamableHttpMcpAdapter; frozen: FrozenV1McpClient }>) {
    this.#legacy = input.legacy;
    this.#frozen = input.frozen;
  }

  route(mode: 'legacy_v11'): StreamableHttpMcpAdapter;
  route(mode: 'frozen_v1'): FrozenV1McpClient;
  route(mode: McpProviderProtocolMode): StreamableHttpMcpAdapter | FrozenV1McpClient {
    return mode === 'frozen_v1' ? this.#frozen : this.#legacy;
  }
}
