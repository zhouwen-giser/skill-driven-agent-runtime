import { describe, expect, it } from 'vitest';

import {
  getEvidenceCatalogEntry,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  NODE_CONTROL_EVIDENCE_RECORD_TYPES,
  NodeControlEvidenceProjector,
  type NodeControlEvidenceProjectionPartition,
  type NodeControlEvidenceSnapshot,
  type NodeControlEvidenceSource,
  type NodeControlEvidenceSourceRow,
  type NodeControlEvidenceWriter,
} from '../src/node-control-evidence-projector.js';

const now = '2026-08-10T00:00:00.000Z';
const hash = `sha256:${'a'.repeat(64)}`;

describe('NodeControlEvidenceProjector', () => {
  it('projects all 21 Node Control Catalog records with exact deterministic references', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
      clock: { now: () => now },
    });

    for (const [index, recordType] of NODE_CONTROL_EVIDENCE_RECORD_TYPES.entries()) {
      const partition = partitionFor(recordType, index + 1);
      source.snapshot = snapshotFor(partition);
      const result = await projector.projectPartition(partition);
      expect(result).toMatchObject({ recordType, skipped: false });
    }

    expect(writer.envelopes).toHaveLength(21);
    for (const envelope of writer.envelopes) {
      const catalog = getEvidenceCatalogEntry(envelope.recordType);
      expect(envelope.sourceSystem).toBe(catalog.sourceSystem);
      expect(envelope.sourceTable).toBe(catalog.sourceTable);
      expect(envelope.deliveryGuarantee).toBe('durable_projection');
      expect(envelope.evidenceRefs).toHaveLength(catalog.expectedReferences.length);
      expect(new Set(envelope.evidenceRefs).size).toBe(envelope.evidenceRefs.length);
    }
  });

  it('keeps Event identity stable so a changed payload reaches the writer as a conflict', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
      clock: { now: () => now },
    });
    const partition = partitionFor('node_control.node_event', 7);
    source.snapshot = snapshotFor(partition);
    await projector.projectPartition(partition);
    source.snapshot = {
      ...snapshotFor(partition),
      payload: { ...payloadFor(partition.recordType), changedAuthorityFact: true },
    };
    await projector.projectPartition(partition);

    expect(writer.envelopes[0]?.recordId).toBe(writer.envelopes[1]?.recordId);
    expect(writer.envelopes[0]?.payloadHash).not.toBe(writer.envelopes[1]?.payloadHash);
  });

  it('fails closed before append when a required reference is absent', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
    });
    const partition = partitionFor('node_control.capability_readiness', 1);
    source.snapshot = { ...snapshotFor(partition), references: [] };

    await expect(projector.projectPartition(partition)).rejects.toThrow(
      'NODE_CONTROL_EVIDENCE_REFERENCE_REQUIRED',
    );
    expect(writer.envelopes).toHaveLength(0);
  });

  it('does not persist a forward reference before the referenced Evidence exists', async () => {
    const writer = new MemoryWriter();
    writer.recordsPresent = false;
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
    });
    const partition = partitionFor('node_control.configuration_apply_ack', 1);
    source.snapshot = snapshotFor(partition);

    await expect(projector.projectPartition(partition)).rejects.toThrow(
      'NODE_CONTROL_EVIDENCE_REFERENCE_ORPHAN',
    );
    expect(writer.envelopes).toHaveLength(0);
    expect(writer.checkpoints).toHaveLength(0);
  });

  it('projects a rejected immutable ACK audit without inventing an acknowledged sequence', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
      clock: { now: () => now },
    });
    const partition = partitionFor('node_control.telemetry_ack', 1);
    source.snapshot = {
      ...snapshotFor(partition),
      payload: {
        ...payloadFor(partition.recordType),
        acknowledgedSequence: null,
        ackDisposition: 'rejected',
        errorCode: 'ACK_RESPONSE_INVALID',
      },
    };

    await projector.projectPartition(partition);
    expect(writer.envelopes[0]?.payload).toMatchObject({
      acknowledgedSequence: null,
      ackDisposition: 'rejected',
      errorCode: 'ACK_RESPONSE_INVALID',
    });
  });

  it('rejects unknown frozen enums, zero versions and invalid observation generations', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
    });

    const event = partitionFor('node_control.node_event', 1);
    source.snapshot = {
      ...snapshotFor(event),
      payload: { ...payloadFor(event.recordType), eventType: 'node.unknown' },
    };
    await expect(projector.projectPartition(event)).rejects.toThrow(
      'NODE_CONTROL_EVIDENCE_ENUM_INVALID:eventType',
    );

    const profile = partitionFor('node_control.profile_revision', 1);
    source.snapshot = {
      ...snapshotFor(profile),
      payload: { ...payloadFor(profile.recordType), revision: 0 },
    };
    await expect(projector.projectPartition(profile)).rejects.toThrow(
      'NODE_CONTROL_EVIDENCE_POSITIVE_VERSION_INVALID:revision',
    );

    const acknowledgement = partitionFor('node_control.telemetry_ack', 1);
    source.snapshot = {
      ...snapshotFor(acknowledgement),
      observationGeneration: 0,
    };
    await expect(projector.projectPartition(acknowledgement)).rejects.toThrow(
      'NODE_CONTROL_EVIDENCE_OBSERVATION_GENERATION_INVALID',
    );
    expect(writer.envelopes).toHaveLength(0);
  });

  it('skips only an exact checkpoint including payload hash', async () => {
    const writer = new MemoryWriter();
    const source = new SnapshotSource();
    const projector = new NodeControlEvidenceProjector({
      source,
      writer,
      environment: 'test',
      clock: { now: () => now },
    });
    const partition = partitionFor('node_control.profile_revision', 2);
    source.snapshot = snapshotFor(partition);
    await projector.projectPartition(partition);
    const checkpoint = writer.checkpoints[0];
    if (checkpoint === undefined) throw new Error('checkpoint missing');
    source.snapshot = { ...snapshotFor(partition), checkpoint };

    await expect(projector.projectPartition(partition)).resolves.toMatchObject({ skipped: true });
    expect(writer.envelopes).toHaveLength(1);
  });
});

class SnapshotSource implements NodeControlEvidenceSource {
  snapshot: NodeControlEvidenceSnapshot | undefined;

  pendingPartitions() {
    return Promise.resolve(this.snapshot === undefined ? [] : [this.snapshot.partition]);
  }

  async pendingPage() {
    const partitions = await this.pendingPartitions();
    return { partitions };
  }

  load() {
    return Promise.resolve(this.snapshot);
  }
}

class MemoryWriter implements NodeControlEvidenceWriter {
  readonly envelopes: CanonicalEvidenceEnvelope[] = [];
  readonly checkpoints: EvidenceSourceCheckpoint[] = [];
  recordsPresent = true;

  hasRecord() {
    return Promise.resolve(this.recordsPresent);
  }

  append(envelope: CanonicalEvidenceEnvelope) {
    this.envelopes.push(envelope);
    return Promise.resolve(String(this.envelopes.length));
  }

  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint) {
    this.checkpoints.push(checkpoint);
    return Promise.resolve();
  }
}

function partitionFor(
  recordType: (typeof NODE_CONTROL_EVIDENCE_RECORD_TYPES)[number],
  sourceRevision: number,
): NodeControlEvidenceProjectionPartition {
  return {
    recordType,
    sourcePartition: `node-control:${recordType}:source-1`,
    sourceRecordId: `${recordType}:source-1`,
    sourceRevision,
    observationSequence: String(sourceRevision),
  };
}

function snapshotFor(
  partition: NodeControlEvidenceProjectionPartition,
): NodeControlEvidenceSnapshot {
  const catalog = getEvidenceCatalogEntry(partition.recordType);
  const payload = payloadFor(partition.recordType);
  const tenantId = typeof payload['tenantId'] === 'string' ? payload['tenantId'] : undefined;
  const projectId = typeof payload['projectId'] === 'string' ? payload['projectId'] : undefined;
  return {
    partition,
    occurredAt: now,
    payload,
    references: catalog.expectedReferences.map((recordType, index) => ({
      recordType,
      sourceRecordId: `${recordType}:reference-${String(index + 1)}`,
      sourceRevision: 1,
    })),
    scope: {
      correlationId: 'organization:org-1',
      nodeId: 'node-1',
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(projectId === undefined ? {} : { projectId }),
    },
    observationGeneration:
      partition.recordType === 'node_control.telemetry_delivery' ||
      partition.recordType === 'node_control.telemetry_ack'
        ? 1
        : 0,
  };
}

function payloadFor(
  recordType: (typeof NODE_CONTROL_EVIDENCE_RECORD_TYPES)[number],
): NodeControlEvidenceSourceRow {
  const catalog = getEvidenceCatalogEntry(recordType);
  const payload: Record<string, EvidenceJsonValue> = {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  };
  for (const field of catalog.requiredPayloadFields) payload[field] = fieldValue(field);
  Object.assign(payload, overrides(recordType));
  return payload;
}

function fieldValue(field: string): EvidenceJsonValue {
  if (/(?:revision|version|generation)$/iu.test(field)) return 1;
  if (/(?:hash|checksum)$/iu.test(field)) return hash;
  if (field === 'components') return [];
  if (field === 'activeTasks') return 0;
  if (field === 'observedAt') return now;
  if (field.toLowerCase().endsWith('sequence')) return '1';
  return `${field}-value`;
}

function overrides(
  recordType: (typeof NODE_CONTROL_EVIDENCE_RECORD_TYPES)[number],
): NodeControlEvidenceSourceRow {
  switch (recordType) {
    case 'node_control.profile_revision':
      return { status: 'active' };
    case 'node_control.health_observation':
      return {
        observationId: 'health-1',
        nodeId: 'node-1',
        healthStatus: 'healthy',
        components: [],
        activeTasks: 0,
        observedAt: now,
      };
    case 'node_control.configuration_revision':
      return { status: 'published', targetType: 'node', applyMode: 'hot_reload' };
    case 'node_control.configuration_apply_ack':
      return { status: 'applied' };
    case 'node_control.configuration_lkg_transition':
      return { targetType: 'node', convergenceStatus: 'converged' };
    case 'node_control.llm_provider_revision':
      return { status: 'active', providerType: 'openai_compatible', secretStatus: 'available' };
    case 'node_control.model_route_revision':
      return { status: 'active', stage: 'planning', scopeType: 'stage' };
    case 'node_control.smpp_source_revision':
      return { status: 'active', syncMode: 'poll', lkgPolicy: 'allow_unexpired' };
    case 'node_control.mcp_provider_binding_revision':
      return { status: 'active', originType: 'direct', availabilityStatus: 'available' };
    case 'node_control.capability_revision':
      return { status: 'published', riskLevel: 'low' };
    case 'node_control.capability_readiness':
      return { readinessStatus: 'available', snapshotVersion: 1 };
    case 'node_control.a2a_exposure':
      return {
        status: 'published',
        visibility: 'organization',
        readinessPublicationPolicy: 'publish_when_available',
      };
    case 'node_control.agent_card_revision':
      return { status: 'active' };
    case 'node_control.management_operation':
      return { status: 'succeeded' };
    case 'node_control.node_event':
      return {
        eventType: 'node.profile.changed',
        aggregateRevision: 1,
        dataClassification: 'internal',
      };
    case 'node_control.telemetry_configuration':
      return { status: 'published', applyMode: 'hot_reload' };
    case 'node_control.telemetry_delivery':
      return {
        exportId: 'export-1',
        batchId: 'batch-1',
        batchHash: hash,
        firstSequence: '1',
        lastSequence: '2',
        recordCount: 2,
        attemptNo: 1,
        deliveryStatus: 'attempted',
      };
    case 'node_control.telemetry_ack':
      return {
        exportId: 'export-1',
        batchId: 'batch-1',
        batchHash: hash,
        acknowledgedSequence: '2',
        ackDisposition: 'accepted',
        errorCode: null,
      };
    default:
      return {};
  }
}
