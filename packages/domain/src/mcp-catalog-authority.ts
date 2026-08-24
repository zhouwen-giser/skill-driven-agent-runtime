import { createHash } from 'node:crypto';

import type { McpTool } from './mcp.js';
import type { McpProtocolDiscoverySnapshot } from './mcp-frozen-protocol.js';

export interface FrozenMcpCatalogAuthority {
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly operationCount: number;
}

/** Canonical frozen Catalog identity shared by Node Control discovery and Runtime admission. */
export function deriveFrozenMcpCatalogAuthority(
  snapshot: Pick<
    McpProtocolDiscoverySnapshot,
    'protocolVersion' | 'serverInfo' | 'providerCatalog'
  >,
  tools: readonly McpTool[],
  bindingRevision: number,
): FrozenMcpCatalogAuthority {
  const serverVersion = snapshot.serverInfo['version'];
  return Object.freeze({
    catalogRevision: `${typeof serverVersion === 'string' ? serverVersion : 'unknown'}:${String(bindingRevision)}`,
    catalogChecksum: createHash('sha256')
      .update(frozenMcpCatalogCanonicalJson(snapshot, tools))
      .digest('hex'),
    operationCount: tools.length,
  });
}

export function frozenMcpCatalogCanonicalJson(
  snapshot: Pick<
    McpProtocolDiscoverySnapshot,
    'protocolVersion' | 'serverInfo' | 'providerCatalog'
  >,
  tools: readonly McpTool[],
): string {
  return canonicalJson(frozenMcpCatalogDocument(snapshot, tools));
}

export function frozenMcpCatalogDocument(
  snapshot: Pick<
    McpProtocolDiscoverySnapshot,
    'protocolVersion' | 'serverInfo' | 'providerCatalog'
  >,
  tools: readonly McpTool[],
): unknown {
  return JSON.parse(
    JSON.stringify({
      protocolVersion: snapshot.protocolVersion,
      serverInfo: snapshot.serverInfo,
      ...(snapshot.providerCatalog === undefined
        ? {}
        : { providerCatalog: snapshot.providerCatalog }),
      tools: [...tools]
        .sort((left, right) => compareToolName(left.toolName, right.toolName))
        .map((tool) => ({
          name: tool.toolName,
          title: tool.title ?? null,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema ?? null,
          protocolMode: tool.protocolMode ?? null,
          executionSemantics: tool.executionSemantics,
          taskExecutionProfile: tool.taskExecutionProfile ?? null,
        })),
    }),
  ) as unknown;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

/** ECMAScript string relational order is an explicit, locale-independent UTF-16 code-unit order. */
function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareToolName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
