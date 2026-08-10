import { describe, expect, it } from 'vitest';

import type { EvidenceProjectionIssue } from '../../domain/src/index.js';
import {
  CanonicalEvidenceProjectionPipeline,
  EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
  MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
  NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
  NodeControlEvidenceProjectionPipeline,
  RUNTIME_CORE_EVIDENCE_PROJECTOR_VERSION,
  SKILL_EVIDENCE_PROJECTOR_VERSION,
  type EvidenceProjectionIssueWriter,
  type ExperienceReplayArtifactEvidenceSource,
  type ExperienceReplayArtifactProjectionPartition,
  type McpCapabilityEvidenceSource,
  type NodeControlEvidenceProjectionPartition,
  type NodeControlEvidenceSource,
  type RuntimeCoreEvidenceSource,
  type SkillEvidenceSource,
} from '../src/index.js';

const poison = 'a-poison';
const healthy = 'b-healthy';

describe('CanonicalEvidenceProjectionPipeline', () => {
  it('isolates every poisoned task/partition, persists safe required issues, and resolves exact stable issues after repair', async () => {
    const recorded: {
      issue: EvidenceProjectionIssue;
      role: 'required' | 'supporting' | 'diagnostic';
    }[] = [];
    const resolved: string[] = [];
    const projected: string[] = [];
    let repaired = false;
    const writer: EvidenceProjectionIssueWriter = {
      recordProjectionIssue: (issue, role) => {
        recorded.push({ issue, role });
        return Promise.resolve();
      },
      resolveProjectionIssue: (input) => {
        resolved.push(input.issueId);
        return Promise.resolve();
      },
    };
    const pipeline = createPipeline({
      writer,
      projectTask: (family, taskId) => {
        projected.push(`${family}:${taskId}`);
        if (!repaired && taskId === poison) {
          if (family === 'mcp-capability') {
            throw Object.assign(new Error('credential=do-not-persist'), { code: '57P03' });
          }
          throw new Error('token=do-not-persist');
        }
        return Promise.resolve();
      },
      projectPartition: (partition) => {
        projected.push(`experience:${partition.sourceId}`);
        if (!repaired && partition.sourceId === poison) {
          throw new TypeError('authorization=do-not-persist');
        }
        return Promise.resolve();
      },
    });

    const first = await pipeline.drain(10);

    expect(first).toMatchObject({
      attemptedItems: 8,
      projectedItems: 4,
      failedItems: 4,
      sourceListingFailures: 0,
      issuePersistenceFailures: 0,
    });
    expect(projected).toEqual([
      'runtime:a-poison',
      'runtime:b-healthy',
      'skill:a-poison',
      'skill:b-healthy',
      'mcp-capability:a-poison',
      'mcp-capability:b-healthy',
      'experience:a-poison',
      'experience:b-healthy',
    ]);
    expect(recorded).toHaveLength(4);
    expect(
      recorded.map(({ issue, role }) => ({
        role,
        issueCode: issue.issueCode,
        severity: issue.severity,
        sourcePartition: issue.sourcePartition,
        projectorVersion: issue.projectorVersion,
        retryable: issue.retryable,
        detail: issue.detail,
      })),
    ).toEqual([
      {
        role: 'required',
        issueCode: 'projection_bug',
        severity: 'blocking',
        sourcePartition: 'runtime-core:a-poison',
        projectorVersion: RUNTIME_CORE_EVIDENCE_PROJECTOR_VERSION,
        retryable: true,
        detail: {
          failureCode: 'UNCLASSIFIED_ERROR',
          failureStage: 'item_projection',
          sourceFamily: 'runtime',
        },
      },
      {
        role: 'required',
        issueCode: 'projection_bug',
        severity: 'blocking',
        sourcePartition: 'skill:a-poison',
        projectorVersion: SKILL_EVIDENCE_PROJECTOR_VERSION,
        retryable: true,
        detail: {
          failureCode: 'UNCLASSIFIED_ERROR',
          failureStage: 'item_projection',
          sourceFamily: 'skill',
        },
      },
      {
        role: 'required',
        issueCode: 'source_unavailable',
        severity: 'blocking',
        sourcePartition: 'mcp-capability:a-poison',
        projectorVersion: MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
        retryable: true,
        detail: {
          failureCode: 'SOURCE_UNAVAILABLE_PG_RUNTIME',
          failureStage: 'item_projection',
          sourceFamily: 'mcp-capability',
        },
      },
      {
        role: 'required',
        issueCode: 'projection_bug',
        severity: 'blocking',
        sourcePartition: phase8Partition(poison).sourcePartition,
        projectorVersion: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
        retryable: true,
        detail: {
          failureCode: 'TYPE_ERROR',
          failureStage: 'item_projection',
          sourceFamily: 'experience',
        },
      },
    ]);
    const serializedIssues = JSON.stringify(recorded);
    expect(serializedIssues).not.toMatch(
      /do-not-persist|credential|authorization|token|stack|message/iu,
    );

    const failedIssueIds = recorded.map(({ issue }) => issue.issueId);
    repaired = true;
    projected.length = 0;
    const second = await pipeline.drain(10);

    expect(second).toMatchObject({ attemptedItems: 8, projectedItems: 8, failedItems: 0 });
    expect(new Set(resolved)).toEqual(expect.objectContaining(new Set(failedIssueIds)));
    expect(recorded.map(({ issue }) => issue.issueId)).toEqual(failedIssueIds);
  });

  it('finishes the bounded drain before surfacing required issue persistence failure', async () => {
    const projected: string[] = [];
    const pipeline = createPipeline({
      writer: {
        recordProjectionIssue: () => Promise.reject(new Error('PostgreSQL unavailable')),
        resolveProjectionIssue: () => Promise.resolve(),
      },
      projectTask: (family, taskId) => {
        projected.push(`${family}:${taskId}`);
        if (taskId === poison) throw new Error('poison');
        return Promise.resolve();
      },
      projectPartition: (partition) => {
        projected.push(`experience:${partition.sourceId}`);
        if (partition.sourceId === poison) throw new Error('poison');
        return Promise.resolve();
      },
    });

    await expect(pipeline.drain(10)).rejects.toMatchObject({
      code: 'EVIDENCE_PROJECTION_ISSUE_PERSISTENCE_FAILED',
      result: {
        attemptedItems: 8,
        projectedItems: 4,
        failedItems: 4,
        issuePersistenceFailures: 4,
      },
    });
    expect(projected).toHaveLength(8);
    expect(projected).toContain('runtime:b-healthy');
    expect(projected).toContain('experience:b-healthy');
  });

  it('records a source-listing issue and continues every later family', async () => {
    const recorded: EvidenceProjectionIssue[] = [];
    const projected: string[] = [];
    const runtimeSource = runtimeTaskSource([healthy]);
    runtimeSource.pendingTaskIds = () =>
      Promise.reject(Object.assign(new Error('down'), { code: '08006' }));
    const pipeline = createPipeline({
      runtimeSource,
      writer: {
        recordProjectionIssue: (issue) => {
          recorded.push(issue);
          return Promise.resolve();
        },
        resolveProjectionIssue: () => Promise.resolve(),
      },
      projectTask: (family, taskId) => {
        projected.push(`${family}:${taskId}`);
        return Promise.resolve();
      },
      projectPartition: (partition) => {
        projected.push(`experience:${partition.sourceId}`);
        return Promise.resolve();
      },
    });

    const result = await pipeline.drain(10);

    expect(result).toMatchObject({ sourceListingFailures: 1, failedItems: 0, projectedItems: 6 });
    expect(recorded).toEqual([
      expect.objectContaining({
        issueCode: 'source_unavailable',
        severity: 'blocking',
        sourcePartition: 'projection-source:runtime',
        projectorVersion: RUNTIME_CORE_EVIDENCE_PROJECTOR_VERSION,
        retryable: true,
      }),
    ]);
    expect(projected).toEqual([
      'skill:a-poison',
      'skill:b-healthy',
      'mcp-capability:a-poison',
      'mcp-capability:b-healthy',
      'experience:a-poison',
      'experience:b-healthy',
    ]);
  });
});

describe('NodeControlEvidenceProjectionPipeline', () => {
  it('isolates a diagnostic Control poison partition and continues required Runtime telemetry', async () => {
    const health = nodeControlPartition(
      'node_control.health_observation',
      'node-control:health:health-1',
      'health-1',
    );
    const delivery = nodeControlPartition(
      'node_control.telemetry_delivery',
      'node-control:telemetry-delivery:batch-1',
      'batch-1',
    );
    const recorded: {
      readonly issue: EvidenceProjectionIssue;
      readonly role: 'required' | 'supporting' | 'diagnostic';
    }[] = [];
    const projected: string[] = [];
    let repaired = false;
    const source: NodeControlEvidenceSource = {
      pendingPartitions: () => Promise.resolve([health, delivery]),
      pendingPage: () => Promise.resolve({ partitions: [health, delivery] }),
      load: () => Promise.resolve(undefined),
    };
    const pipeline = new NodeControlEvidenceProjectionPipeline({
      source,
      projector: {
        projectPartition: (partition) => {
          projected.push(partition.sourceRecordId);
          if (!repaired && partition.recordType === 'node_control.health_observation') {
            throw new TypeError('credential=must-not-be-persisted');
          }
          return Promise.resolve();
        },
      },
      writer: {
        recordProjectionIssue: (issue, role) => {
          recorded.push({ issue, role });
          return Promise.resolve();
        },
        resolveProjectionIssue: () => Promise.resolve(),
      },
      clock: { now: () => '2026-08-10T08:00:00.000Z' },
    });

    await expect(pipeline.drain(10)).resolves.toMatchObject({
      attemptedItems: 2,
      projectedItems: 1,
      failedItems: 1,
    });
    expect(projected).toEqual(['health-1', 'batch-1']);
    expect(recorded).toEqual([
      {
        role: 'diagnostic',
        issue: expect.objectContaining({
          recordType: 'node_control.health_observation',
          sourceSystem: 'node_control',
          sourceTable: 'sdar_control.node_health_observation',
          sourcePartition: health.sourcePartition,
          projectorVersion: NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
          severity: 'diagnostic',
          retryable: true,
          detail: {
            failureCode: 'TYPE_ERROR',
            failureStage: 'item_projection',
            sourceFamily: 'node_control',
          },
        }),
      },
    ]);
    expect(JSON.stringify(recorded)).not.toMatch(/credential|must-not-be-persisted/iu);

    repaired = true;
    projected.length = 0;
    await expect(pipeline.drain(10)).resolves.toMatchObject({
      attemptedItems: 2,
      projectedItems: 2,
      failedItems: 0,
    });
    expect(projected).toEqual(['health-1', 'batch-1']);
  });
});

function createPipeline(input: {
  readonly writer: EvidenceProjectionIssueWriter;
  readonly runtimeSource?: RuntimeCoreEvidenceSource;
  readonly projectTask: (family: string, taskId: string) => Promise<void>;
  readonly projectPartition: (
    partition: ExperienceReplayArtifactProjectionPartition,
  ) => Promise<void>;
}) {
  return new CanonicalEvidenceProjectionPipeline({
    writer: input.writer,
    runtimeCore: {
      source: input.runtimeSource ?? runtimeTaskSource([poison, healthy]),
      projector: { projectTask: (taskId) => input.projectTask('runtime', taskId) },
    },
    skill: {
      source: skillTaskSource([poison, healthy]),
      projector: { projectTask: (taskId) => input.projectTask('skill', taskId) },
    },
    mcpCapability: {
      source: mcpCapabilityTaskSource([poison, healthy]),
      projector: { projectTask: (taskId) => input.projectTask('mcp-capability', taskId) },
    },
    experienceReplayArtifact: {
      source: phase8Source(),
      projector: { projectPartition: input.projectPartition },
    },
    clock: { now: () => '2026-08-09T08:00:00.000Z' },
  });
}

function runtimeTaskSource(taskIds: readonly string[]): RuntimeCoreEvidenceSource {
  return {
    pendingTaskIds: () => Promise.resolve(taskIds),
    load: () => Promise.resolve(undefined),
  };
}

function skillTaskSource(taskIds: readonly string[]): SkillEvidenceSource {
  return {
    pendingTaskIds: () => Promise.resolve(taskIds),
    load: () => Promise.resolve(undefined),
  };
}

function mcpCapabilityTaskSource(taskIds: readonly string[]): McpCapabilityEvidenceSource {
  return {
    pendingTaskIds: () => Promise.resolve(taskIds),
    load: () => Promise.resolve(undefined),
  };
}

function phase8Source(): ExperienceReplayArtifactEvidenceSource {
  return {
    pendingPartitions: () => Promise.resolve([phase8Partition(poison), phase8Partition(healthy)]),
    load: () => Promise.resolve(undefined),
  };
}

function phase8Partition(sourceId: string): ExperienceReplayArtifactProjectionPartition {
  return Object.freeze({
    kind: 'experience_pattern',
    sourceFamily: 'experience',
    sourcePartition: `v141:experience_pattern:${String(sourceId.length)}:${sourceId}`,
    sourceId,
  });
}

function nodeControlPartition(
  recordType: NodeControlEvidenceProjectionPartition['recordType'],
  sourcePartition: string,
  sourceRecordId: string,
): NodeControlEvidenceProjectionPartition {
  return Object.freeze({
    recordType,
    sourcePartition,
    sourceRecordId,
    sourceRevision: 1,
    observationSequence: '1',
  });
}
