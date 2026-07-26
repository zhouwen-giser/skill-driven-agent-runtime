import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createCapabilityPatternDefinitionSnapshot,
  createCapabilityPatternInductionExample,
  createCognitiveSourceRef,
  createSkillUsageSpecification,
  createSkillVersion,
  type CapabilityGapCandidateSnapshot,
  type CapabilityPatternDefinitionSnapshot,
  type SkillVersion,
} from '../../domain/src/index.js';
import {
  CapabilityGapService,
  CapabilityPatternInductionService,
  CapabilityPatternInvalidator,
  CapabilitySkillMapper,
} from '../src/cognitive/index.js';
import type {
  CapabilityPatternRepository,
  CognitiveStructuredModelStageInvoker,
} from '../src/cognitive/ports.js';

describe('G11 Capability Pattern induction and Gap Candidates', () => {
  it('keeps declared, observed and validated evidence separate without mutating Skill declarations', async () => {
    const currentSkill = skill('skill.inspect', 2, 'inspection.device');
    const before = JSON.stringify(currentSkill);
    const repository = new FakeCapabilityPatterns();
    const result = await service(repository, [currentSkill]).induce({
      examples: [
        example('episode-observed', 'observed'),
        example('episode-validated', 'validated'),
      ],
    });

    expect(JSON.stringify(currentSkill)).toBe(before);
    expect(result.patterns[0]?.evidenceByLevel).toMatchObject({
      declared: [{ level: 'declared', exactSkillVersionRef: 'skill.inspect:2' }],
      observed: [{ level: 'observed', episodeId: 'episode-observed' }],
      validated: [{ level: 'validated', episodeId: 'episode-validated' }],
    });
    expect(result.patterns[0]?.exactSkillVersionMappings).toEqual([
      {
        exactSkillVersionRef: 'skill.inspect:2',
        mappingBasis: 'declared_capability',
        requiresCurrentReadiness: true,
        compatibilityStatus: 'requires_current_check',
      },
    ]);
  });

  it('persists the complete applicability/effect/evidence/artifact/prerequisite/dependency/failure/limitation shape', async () => {
    const repository = new FakeCapabilityPatterns();
    const result = await service(repository, [
      skill('skill.inspect', 3, 'inspection.device'),
    ]).induce({
      examples: [example('episode-1', 'observed'), example('episode-2', 'validated')],
    });

    expect(result.patterns[0]).toMatchObject({
      revision: 1,
      status: 'candidate',
      capabilityId: 'inspection.device',
      applicableConditions: ['device identity is known'],
      effects: ['device state is inspected'],
      evidenceRequirements: ['structured observation is captured'],
      artifacts: ['inspection report'],
      prerequisites: ['device is reachable'],
      dependencies: ['evidence.capture'],
      failures: ['device is unavailable'],
      limitations: ['current provider readiness is not asserted'],
      requiresCurrentReadiness: true,
      modelInvocationId: 'model-invocation-capability-pattern-1',
    });
    expect(repository.patterns).toHaveLength(1);
    expect(result.gaps).toEqual([]);
  });

  it('creates an auditable non-executable Gap and manual-only authoring proposal when no current Skill maps', async () => {
    const repository = new FakeCapabilityPatterns();
    const result = await service(repository, []).induce({
      examples: [example('episode-gap-1', 'observed'), example('episode-gap-2', 'validated')],
    });

    expect(result.patterns[0]?.exactSkillVersionMappings).toEqual([]);
    expect(result.gaps).toEqual([
      expect.objectContaining({
        status: 'candidate',
        capabilityId: 'inspection.device',
        exactSkillVersionRefs: [],
        executable: false,
        authoringProposal: expect.objectContaining({
          reviewMode: 'manual',
          publishAllowed: false,
          status: 'proposed',
        }),
      }),
    ]);
    expect(repository.gaps).toHaveLength(1);
    const afterRestart = new CapabilityGapService({
      repository,
      clock: { now: () => '2026-07-27T05:00:00.000Z' },
      nextGapId: () => 'gap-after-restart',
      nextProposalId: () => 'proposal-after-restart',
    });
    const pattern = result.patterns[0];
    if (pattern === undefined) throw new Error('CAPABILITY_PATTERN_TEST_FIXTURE_MISSING');
    await expect(afterRestart.createCandidate(pattern)).resolves.toEqual(result.gaps[0]);
    expect(repository.gaps).toHaveLength(1);
  });

  it('never treats observed success as readiness or compatibility authority', async () => {
    const mapper = new CapabilitySkillMapper({
      catalog: {
        listEnabledSkillVersions: () =>
          Promise.resolve([skill('skill.inspect', 4, 'inspection.device')]),
      },
    });

    const mapping = await mapper.mapCurrentVersions('inspection.device');

    expect(mapping.exactSkillVersionMappings[0]).toMatchObject({
      exactSkillVersionRef: 'skill.inspect:4',
      requiresCurrentReadiness: true,
      compatibilityStatus: 'requires_current_check',
    });
    expect(JSON.stringify(mapping)).not.toMatch(/ready|compatible|providerId/iu);
  });

  it('moves affected Active patterns to validating when catalog hash or policy changes', async () => {
    const repository = new FakeCapabilityPatterns();
    repository.patterns.push(activePattern());
    const invalidator = new CapabilityPatternInvalidator({
      repository,
      clock: { now: () => '2026-07-26T06:00:00.000Z' },
    });

    await expect(
      invalidator.invalidateByCatalog({
        catalogHash: `sha256:${'c'.repeat(64)}`,
        policyVersion: 'capability-pattern-policy-v2',
      }),
    ).resolves.toBe(1);
    expect(repository.patterns[0]).toMatchObject({
      status: 'validating',
      catalogHash: `sha256:${'a'.repeat(64)}`,
      policyVersion: 'capability-pattern-policy-v1',
    });
  });

  it('rejects ungrounded model output without persisting a Pattern or Gap', async () => {
    const repository = new FakeCapabilityPatterns();
    const model = new CapabilityPatternModel();
    model.output = { ...model.output, effects: ['invented physical side effect'] };

    await expect(
      service(repository, [skill('skill.inspect', 2, 'inspection.device')], model).induce({
        examples: [example('episode-1', 'observed'), example('episode-2', 'validated')],
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_PATTERN_MODEL_OUTPUT_UNGROUNDED' });
    expect(repository.patterns).toEqual([]);
    expect(repository.gaps).toEqual([]);
  });
});

function service(
  repository: FakeCapabilityPatterns,
  skills: readonly SkillVersion[],
  model = new CapabilityPatternModel(),
) {
  const mapper = new CapabilitySkillMapper({
    catalog: { listEnabledSkillVersions: () => Promise.resolve(skills) },
  });
  return new CapabilityPatternInductionService({
    repository,
    mapper,
    gaps: new CapabilityGapService({
      repository,
      clock: { now: () => '2026-07-26T05:00:00.000Z' },
      nextGapId: (fingerprint) => `gap-${fingerprint.slice(-16)}`,
      nextProposalId: (fingerprint) => `proposal-${fingerprint.slice(-16)}`,
    }),
    model,
    policyVersion: 'capability-pattern-policy-v1',
    clock: { now: () => '2026-07-26T05:00:00.000Z' },
    nextPatternId: (capabilityId) => `pattern-${capabilityId}`,
  });
}

function example(episodeId: string, evidenceLevel: 'observed' | 'validated') {
  return createCapabilityPatternInductionExample({
    schemaVersion: '1.0',
    episodeId,
    goalId: `goal-${episodeId}`,
    goalVersion: 1,
    capabilityId: 'inspection.device',
    evidenceLevel,
    signals: {
      skillOutcomes: ['inspection outcome achieved'],
      attempts: ['inspection attempt succeeded'],
      evidence: ['structured observation is captured'],
      artifacts: ['inspection report'],
      corrections: ['include cited observations'],
      recoveries: ['retry after device reconnect'],
      eventImpacts: ['device inspection event recorded'],
      applicableConditions: ['device identity is known'],
      effects: ['device state is inspected'],
      prerequisites: ['device is reachable'],
      dependencies: ['evidence.capture'],
      failures: ['device is unavailable'],
      limitations: ['current provider readiness is not asserted'],
    },
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: '1.0',
        sourceRefId: `source-${episodeId}`,
        sourceKind: 'goal_experience_episode',
        sourceId: episodeId,
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: '2026-07-26T04:00:00.000Z',
      }),
    ],
    createdAt: '2026-07-26T04:00:00.000Z',
  });
}

function activePattern(): CapabilityPatternDefinitionSnapshot {
  return createCapabilityPatternDefinitionSnapshot({
    schemaVersion: '1.0',
    patternId: 'pattern-inspection.device',
    revision: 1,
    version: 1,
    status: 'active',
    fingerprint: `sha256:${'b'.repeat(64)}`,
    catalogHash: `sha256:${'a'.repeat(64)}`,
    policyVersion: 'capability-pattern-policy-v1',
    capabilityId: 'inspection.device',
    title: 'Inspect devices',
    summary: 'Inspect a known device and return evidence.',
    applicableConditions: ['device identity is known'],
    effects: ['device state is inspected'],
    evidenceRequirements: ['structured observation is captured'],
    artifacts: ['inspection report'],
    prerequisites: ['device is reachable'],
    dependencies: ['evidence.capture'],
    failures: ['device is unavailable'],
    limitations: ['current provider readiness is not asserted'],
    evidenceByLevel: { declared: [], observed: [], validated: [] },
    exactSkillVersionMappings: [],
    requiresCurrentReadiness: true,
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: '1.0',
        sourceRefId: 'source-active-pattern',
        sourceKind: 'knowledge_revision',
        sourceId: 'pattern-inspection.device',
        sourceRevision: 1,
        authority: 'promoted_knowledge',
        dataClassification: 'internal',
        capturedAt: '2026-07-26T03:00:00.000Z',
      }),
    ],
    modelInvocationId: 'model-invocation-capability-pattern-active',
    createdAt: '2026-07-26T03:00:00.000Z',
  });
}

class FakeCapabilityPatterns implements CapabilityPatternRepository {
  readonly patterns: CapabilityPatternDefinitionSnapshot[] = [];
  readonly gaps: CapabilityGapCandidateSnapshot[] = [];

  findLatest(capabilityId: string) {
    return Promise.resolve(
      [...this.patterns].reverse().find((pattern) => pattern.capabilityId === capabilityId),
    );
  }

  list(limit = 100) {
    return Promise.resolve(this.patterns.slice(0, limit));
  }

  saveCandidate(pattern: CapabilityPatternDefinitionSnapshot) {
    this.patterns.push(pattern);
    return Promise.resolve(true);
  }

  listGaps(limit = 100) {
    return Promise.resolve(this.gaps.slice(0, limit));
  }

  findGapByFingerprint(fingerprint: string) {
    return Promise.resolve(this.gaps.find((gap) => gap.fingerprint === fingerprint));
  }

  saveGapCandidate(gap: CapabilityGapCandidateSnapshot) {
    this.gaps.push(gap);
    return Promise.resolve(true);
  }

  invalidateByCatalog(input: { catalogHash: string; policyVersion: string; occurredAt: string }) {
    let count = 0;
    for (const [index, pattern] of this.patterns.entries()) {
      if (
        pattern.status === 'active' &&
        (pattern.catalogHash !== input.catalogHash || pattern.policyVersion !== input.policyVersion)
      ) {
        this.patterns[index] = createCapabilityPatternDefinitionSnapshot({
          ...pattern,
          status: 'validating',
          version: pattern.version + 1,
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

class CapabilityPatternModel implements CognitiveStructuredModelStageInvoker {
  output: Readonly<Record<string, unknown>> = {
    title: 'Inspect devices with evidence',
    summary: 'Inspect a known device and return structured evidence.',
    applicableConditions: ['device identity is known'],
    effects: ['device state is inspected'],
    evidenceRequirements: ['structured observation is captured'],
    artifacts: ['inspection report'],
    prerequisites: ['device is reachable'],
    dependencies: ['evidence.capture'],
    failures: ['device is unavailable'],
    limitations: ['current provider readiness is not asserted'],
  };

  generate() {
    return Promise.resolve({
      invocationId: 'model-invocation-capability-pattern-1',
      structuredResult: this.output,
    });
  }
}

function skill(skillId: string, version: number, capabilityId: string): SkillVersion {
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId,
    skillVersion: version,
    effects: ['device state is inspected'],
    evidence: ['structured observation is captured'],
    artifacts: ['inspection report'],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: { classification: 'read_only' },
  };
  return createSkillVersion({
    skillId,
    version,
    name: `Skill ${skillId}`,
    summary: `Summary ${skillId}`,
    description: `Description ${skillId}`,
    capabilities: [capabilityId],
    workflowGuidance: 'Use declared inputs only.',
    outputInstruction: 'Return declared evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-26T03:00:00.000Z',
    usageSpecification: createSkillUsageSpecification({
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Use current readiness.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Guidance', instructions: ['Guide.'] },
      },
      taskBindings: [],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    }),
    outcomeSpecification: {
      ...outcome,
      specificationHash: `sha256:${createHash('sha256').update(JSON.stringify(outcome)).digest('hex')}`,
    },
  });
}
