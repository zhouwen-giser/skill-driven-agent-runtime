import type { EvidenceJsonValue } from '../../domain/src/index.js';
import type { RuntimeCoreSourceRow } from './runtime-core-evidence-projector.js';
import type {
  McpCapabilityEvidenceSnapshot,
  McpCapabilityEvidenceSource,
} from './mcp-capability-evidence-projector.js';

export interface CapabilityAuthoritySnapshot {
  readonly definition: RuntimeCoreSourceRow;
  readonly implementationBindings: readonly RuntimeCoreSourceRow[];
}

export interface CapabilityAuthorityReader {
  load(capabilityId: string, version: number): Promise<CapabilityAuthoritySnapshot>;
}

export class ControlEnrichedMcpCapabilityEvidenceSource implements McpCapabilityEvidenceSource {
  readonly #runtime: McpCapabilityEvidenceSource;
  readonly #authority: CapabilityAuthorityReader;

  constructor(
    input: Readonly<{ runtime: McpCapabilityEvidenceSource; authority: CapabilityAuthorityReader }>,
  ) {
    this.#runtime = input.runtime;
    this.#authority = input.authority;
  }

  pendingTaskIds(limit: number): Promise<readonly string[]> {
    return this.#runtime.pendingTaskIds(limit);
  }

  async load(taskId: string): Promise<McpCapabilityEvidenceSnapshot | undefined> {
    const runtime = await this.#runtime.load(taskId);
    if (runtime === undefined) return undefined;
    const requested = uniqueCapabilities(runtime);
    const definitions: RuntimeCoreSourceRow[] = [];
    const implementationBindings: RuntimeCoreSourceRow[] = [];
    for (const capability of requested) {
      const authority = await this.#authority.load(capability.capabilityId, capability.version);
      const revisionRecordId = findRevisionRecordId(
        runtime.existingEvidence,
        capability.capabilityId,
        capability.version,
      );
      definitions.push(
        Object.freeze({
          ...authority.definition,
          ...(revisionRecordId === undefined
            ? {}
            : { node_control_revision_record_id: revisionRecordId }),
        }),
      );
      implementationBindings.push(...authority.implementationBindings);
    }
    return Object.freeze({
      ...runtime,
      definitions: Object.freeze(definitions),
      implementationBindings: Object.freeze(implementationBindings),
    });
  }
}

function uniqueCapabilities(snapshot: McpCapabilityEvidenceSnapshot) {
  const unique = new Map<string, Readonly<{ capabilityId: string; version: number }>>();
  for (const row of snapshot.capabilityBindings) {
    const capabilityId = requiredText(row['requested_capability_id'], 'requested_capability_id');
    const version = positiveInteger(row['capability_version'], 'capability_version');
    unique.set(`${capabilityId}:${String(version)}`, Object.freeze({ capabilityId, version }));
  }
  return [...unique.values()];
}

function findRevisionRecordId(
  evidence: readonly RuntimeCoreSourceRow[],
  capabilityId: string,
  version: number,
): string | undefined {
  const matches = evidence.filter((row) => {
    if (row['record_type'] !== 'node_control.capability_revision') return false;
    const payload = object(row['payload']);
    return payload?.['capabilityId'] === capabilityId && payload['version'] === version;
  });
  return matches.length === 1 ? optionalText(matches[0]?.['record_id']) : undefined;
}

function object(value: EvidenceJsonValue | undefined): RuntimeCoreSourceRow | undefined {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
    ? (value as RuntimeCoreSourceRow)
    : undefined;
}

function requiredText(value: EvidenceJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} invalid.`);
  return value;
}

function optionalText(value: EvidenceJsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function positiveInteger(value: EvidenceJsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${field} invalid.`);
  return value;
}
