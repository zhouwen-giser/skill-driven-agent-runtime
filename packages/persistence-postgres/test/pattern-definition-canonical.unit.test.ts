import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeSourceArtifactJson,
  createCohortDefinition,
  createDiscoveredProcessPattern,
  createProcessVariant,
  createWorkflowPattern,
  type EvidenceJsonValue,
} from '../../domain/src/index.js';
import { encodePatternDefinition } from '../src/compiler/experience-compilation-repositories.js';

describe('P03 Pattern definition canonical producer', () => {
  it('uses the shared source-Artifact byte domain for adversarial Unicode condition keys', async () => {
    const patternId = 'pattern-unicode-canonical';
    const traceId = 'trace-unicode-canonical';
    const quality = Object.freeze({
      supportCount: 1,
      totalTraceCount: 1,
      supportRate: 1,
      successRate: 1,
      traceCoverage: 1,
      fitness: 1,
      precisionProxy: 1,
      environmentCoverage: 1,
      contradictionRate: 0,
      generalization: 1,
      mandatoryThreshold: 1,
    });
    const cohort = createCohortDefinition({
      tenantId: 'tenant-unicode',
      taskTypeId: 'task-type-unicode',
      minimumCompleteness: 1,
    });
    const variant = createProcessVariant({
      variantId: 'variant-unicode',
      activitySequence: ['activity-unicode'],
      activityKindSequence: ['skill_goal'],
      concurrencyGroups: [],
      branchSequence: [],
      occurrenceCount: 1,
      traceRefs: [traceId],
      successCount: 1,
      failureCount: 0,
    });
    const discoveredPattern = createDiscoveredProcessPattern({
      patternId,
      cohortFingerprint: `sha256:${'1'.repeat(64)}`,
      algorithmVersion: 'sdar-deterministic-process-miner/1.2',
      mandatoryActivities: ['activity-unicode'],
      optionalActivities: [],
      orderingConstraints: [],
      parallelCandidates: [],
      recoveryBranches: [],
      failureVariants: [],
      supportRefs: [traceId],
      contradictionRefs: [],
      environmentCoverage: ['integration'],
      quality,
    });
    const workflowPattern = createWorkflowPattern({
      workflowPatternId: 'workflow-unicode-canonical',
      taskTypeId: 'task-type-unicode',
      activityPatterns: [
        {
          activityKey: 'activity-unicode',
          activityKind: 'skill_goal',
          objectiveSummary: 'Exercise deterministic Unicode key ordering.',
          required: true,
          supportCount: 1,
          supportRate: 1,
          capabilityRefs: ['capability-unicode'],
          effectRefs: ['effect-unicode'],
          lifecycleEventTypes: ['skill_attempt_completed'],
        },
      ],
      dependencyPatterns: [
        {
          predecessorActivityKey: 'activity-unicode',
          successorActivityKey: 'activity-unicode',
          relation: 'conditional',
          condition: {
            type: 'atomic',
            field: 'context.rule',
            operator: 'eq',
            value: { '😀': 'emoji', 中: 'han', é: 'accent', A: 'ascii' },
          },
          supportRefs: [traceId],
          contradictionRefs: [],
        },
      ],
      recoveryPatterns: [],
      sourcePatternRef: patternId,
      sourceTraceRefs: [traceId],
      quality,
    });
    const definition = {
      schemaVersion: '1.2',
      cohort,
      variants: [variant],
      discoveredPattern,
      workflowPattern,
    } as const;

    const envelope = await encodePatternDefinition(definition, workflowPattern);
    const decompressed = brotliDecompressSync(Buffer.from(envelope.payload, 'base64'));
    const serialized = decompressed.toString('utf8');
    const canonical = canonicalizeSourceArtifactJson(definition as unknown as EvidenceJsonValue);

    expect(serialized).toBe(canonical);
    expect(serialized).toContain('"value":{"A":"ascii","é":"accent","中":"han","😀":"emoji"}');
    expect(envelope.uncompressedBytes).toBe(Buffer.byteLength(canonical));
    expect(envelope.contentHash).toBe(
      `sha256:${createHash('sha256').update(decompressed).digest('hex')}`,
    );
  });
});
