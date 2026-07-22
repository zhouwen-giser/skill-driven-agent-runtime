import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeCapabilitySummarySnapshot,
  createSkillUsageSpecification,
  createSkillVersion,
  type RuntimeCapabilitySummarySnapshot,
  type SkillVersion,
} from '../../domain/src/index.js';
import {
  CapabilityCatalogChangeProjector,
  CapabilityCatalogSnapshotBuilder,
  CapabilityIndexBuilder,
  CapabilitySummaryBuilder,
  CapabilitySummaryService,
  type CapabilitySummaryRepository,
} from '../src/cognitive/index.js';

describe('CapabilitySummaryBuilder', () => {
  it('builds one immutable canonical catalog snapshot from exact Skill versions', () => {
    const builder = new CapabilityCatalogSnapshotBuilder();
    const left = builder.build([skill('skill.move', 3), skill('skill.inspect', 1)]);
    const right = builder.build([skill('skill.inspect', 1), skill('skill.move', 3)]);

    expect(left).toEqual(right);
    expect(left.exactSkillVersionRefs).toEqual(['skill.inspect:1', 'skill.move:3']);
    expect(left.catalogHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.exactSkillVersionRefs)).toBe(true);
  });

  it('produces one catalog hash for every ordering of identical exact Skill declarations', () => {
    const skills = [skill('skill.inspect', 1), skill('skill.move', 3), skill('skill.patrol', 2)];
    const builder = new CapabilitySummaryBuilder();
    const hashes = permutations(skills).map(
      (ordered, index) =>
        builder.build({
          summaryId: `summary.order.${String(index)}`,
          revision: index + 1,
          generationPolicyVersion: 'capability-policy-v1',
          skillVersions: ordered,
          builtAt: '2026-07-23T01:10:00.000Z',
        }).catalogHash,
    );

    expect(new Set(hashes)).toHaveLength(1);
  });

  it('changes the hash for exact version, visibility and Outcome declaration changes', () => {
    const builder = new CapabilitySummaryBuilder();
    const baseline = skill('skill.inspect', 1);
    const hash = (value: SkillVersion) =>
      builder.build({
        summaryId: `summary.${value.skillId}.${String(value.version)}`,
        revision: 1,
        generationPolicyVersion: 'capability-policy-v1',
        skillVersions: [value],
        builtAt: '2026-07-23T01:10:00.000Z',
      }).catalogHash;

    expect(hash(skill('skill.inspect', 2))).not.toBe(hash(baseline));
    expect(
      hash(
        skill('skill.inspect', 1, {
          visibility: { userSelectable: false, composable: true, internalOnly: true },
        }),
      ),
    ).not.toBe(hash(baseline));
    expect(hash(skill('skill.inspect', 1, { effects: ['effect.inspect.changed'] }))).not.toBe(
      hash(baseline),
    );
  });

  it('aggregates declared capability detail and limitations without Provider readiness', () => {
    const summary = new CapabilitySummaryBuilder().build({
      summaryId: 'summary.aggregate',
      revision: 1,
      generationPolicyVersion: 'capability-policy-v1',
      skillVersions: [
        skill('skill.inspect', 1),
        skill('skill.inspect.internal', 2, {
          visibility: { userSelectable: false, composable: false, internalOnly: true },
          requiredConfirmations: ['Confirm the protected inspection.'],
        }),
      ],
      builtAt: '2026-07-23T01:10:00.000Z',
    });

    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toMatchObject({
      capabilityId: 'inspection.device',
      domain: 'inspection',
      effects: ['effect.inspect'],
      evidence: ['evidence.observation'],
      artifacts: ['artifact.report'],
      contexts: ['device-id'],
      modes: ['guidance', 'template'],
      taskTypes: ['device.inspect'],
      public: true,
    });
    expect(summary.items[0]?.limitations.map((item) => item.reasonCode)).toEqual(
      expect.arrayContaining(['internal_only', 'confirmation_required', 'not_composable']),
    );
    expect(JSON.stringify(summary)).not.toMatch(/provider|readiness|deviceStatus|online/iu);
  });

  it('represents an empty enabled catalog as a deterministic limitation', () => {
    const summary = new CapabilitySummaryBuilder().build({
      summaryId: 'summary.empty',
      revision: 1,
      generationPolicyVersion: 'capability-policy-v1',
      skillVersions: [],
      builtAt: '2026-07-23T01:10:00.000Z',
    });

    expect(summary.items).toEqual([
      expect.objectContaining({
        capabilityId: 'runtime.catalog',
        public: false,
        limitations: [expect.objectContaining({ reasonCode: 'no_enabled_skill' })],
      }),
    ]);
  });
});

describe('CapabilityIndexBuilder', () => {
  it('builds Level-0 entries within explicit entry and character budgets', () => {
    const summary = new CapabilitySummaryBuilder().build({
      summaryId: 'summary.index',
      revision: 1,
      generationPolicyVersion: 'capability-policy-v1',
      skillVersions: [skill('skill.inspect', 1), skill('skill.move', 1, { capability: 'motion' })],
      builtAt: '2026-07-23T01:10:00.000Z',
    });

    const index = new CapabilityIndexBuilder().build(summary, {
      maxEntries: 1,
      maxCharacters: 2_048,
    });

    expect(index.entries).toHaveLength(1);
    expect(index.truncated).toBe(true);
    expect(index.characterCount).toBeLessThanOrEqual(2_048);
    expect(index.entries[0]?.detailRef).toContain(summary.summaryId);
  });
});

describe('CapabilitySummaryService', () => {
  it('serves only a hash-matched active snapshot and invalidates stale catalog state', async () => {
    const catalog: SkillVersion[] = [skill('skill.inspect', 1)];
    const repository = new InMemoryCapabilitySummaryRepository();
    const service = capabilityService(catalog, repository);

    const first = await service.rebuild();
    expect((await service.getSummary())?.summary.summaryId).toBe(first.summary.summaryId);
    await expect(service.getDetail('inspection.device')).resolves.toMatchObject({
      exactSkillVersionRefs: ['skill.inspect:1'],
    });

    catalog.push(skill('skill.move', 1, { capability: 'motion' }));
    expect(await service.getSummary()).toBeUndefined();

    const rebuilt = await service.rebuild();
    expect(rebuilt.summary.catalogHash).not.toBe(first.summary.catalogHash);
    expect((await service.getSummary())?.summary.summaryId).toBe(rebuilt.summary.summaryId);
  });

  it('keeps cached Level-0 reads below the required 50 ms P95 budget', async () => {
    const catalog = [skill('skill.inspect', 1)];
    const service = capabilityService(catalog, new InMemoryCapabilitySummaryRepository());
    await service.rebuild();
    const durations: number[] = [];

    for (let index = 0; index < 200; index += 1) {
      const startedAt = performance.now();
      expect(await service.getSummary()).toBeDefined();
      durations.push(performance.now() - startedAt);
    }

    durations.sort((left, right) => left - right);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(50);
  });

  it('rebuilds after catalog-change events and acknowledges them only after success', async () => {
    const catalog: SkillVersion[] = [skill('skill.inspect', 1)];
    const repository = new InMemoryCapabilitySummaryRepository();
    const service = capabilityService(catalog, repository);
    await service.rebuild();
    catalog.push(skill('skill.move', 1, { capability: 'motion' }));
    const acknowledged: string[] = [];
    const projector = new CapabilityCatalogChangeProjector({
      changes: {
        listPendingCatalogChangeEventIds() {
          return Promise.resolve(['event.catalog.1']);
        },
        markCatalogChangeEventsPublished(eventIds) {
          acknowledged.push(...eventIds);
          return Promise.resolve();
        },
      },
      summaries: service,
      clock: { now: () => '2026-07-23T01:20:00.000Z' },
    });

    expect(await projector.drain()).toBe(1);
    expect(acknowledged).toEqual(['event.catalog.1']);
    expect((await service.getSummary())?.summary.items.map((item) => item.capabilityId)).toEqual([
      'inspection.device',
      'motion',
    ]);
  });

  it('keeps catalog-change events pending when the dependent Card publication fails', async () => {
    const acknowledged: string[] = [];
    const projector = new CapabilityCatalogChangeProjector({
      changes: {
        listPendingCatalogChangeEventIds: () => Promise.resolve(['event.catalog.retry']),
        markCatalogChangeEventsPublished(eventIds) {
          acknowledged.push(...eventIds);
          return Promise.resolve();
        },
      },
      summaries: capabilityService(
        [skill('skill.inspect', 1)],
        new InMemoryCapabilitySummaryRepository(),
      ),
      clock: { now: () => '2026-07-23T01:20:00.000Z' },
      afterRebuild: () => Promise.reject(new Error('CARD_PUBLICATION_FAILED')),
    });

    await expect(projector.drain()).rejects.toThrow('CARD_PUBLICATION_FAILED');
    expect(acknowledged).toEqual([]);
  });
});

function capabilityService(
  catalog: readonly SkillVersion[],
  repository: CapabilitySummaryRepository,
): CapabilitySummaryService {
  let sequence = 0;
  return new CapabilitySummaryService({
    catalog: { listEnabledSkillVersions: () => Promise.resolve(catalog) },
    repository,
    generationPolicyVersion: 'capability-policy-v1',
    clock: { now: () => '2026-07-23T01:10:00.000Z' },
    nextSummaryId: () => `summary.service.${String(++sequence)}`,
  });
}

class InMemoryCapabilitySummaryRepository implements CapabilitySummaryRepository {
  #active: RuntimeCapabilitySummarySnapshot | undefined;

  findActive(): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return Promise.resolve(this.#active);
  }

  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return Promise.resolve(
      this.#active?.catalogHash === catalogHash &&
        this.#active.generationPolicyVersion === generationPolicyVersion
        ? this.#active
        : undefined,
    );
  }

  saveAndActivate(
    snapshot: RuntimeCapabilitySummarySnapshot,
    expectedActiveRevision?: number,
  ): Promise<RuntimeCapabilitySummarySnapshot> {
    if (expectedActiveRevision !== undefined && expectedActiveRevision !== this.#active?.revision) {
      throw new Error('CAPABILITY_SUMMARY_ACTIVE_REVISION_CONFLICT');
    }
    this.#active = createRuntimeCapabilitySummarySnapshot({ ...snapshot, status: 'active' });
    return Promise.resolve(this.#active);
  }
}

function skill(
  skillId: string,
  version: number,
  overrides: Readonly<{
    capability?: string;
    effects?: readonly string[];
    requiredConfirmations?: readonly string[];
    visibility?: Readonly<{
      userSelectable: boolean;
      composable: boolean;
      internalOnly: boolean;
    }>;
  }> = {},
): SkillVersion {
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId,
    skillVersion: version,
    effects: [...(overrides.effects ?? ['effect.inspect'])],
    evidence: ['evidence.observation'],
    artifacts: ['artifact.report'],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: { classification: 'read_only' },
  };
  return createSkillVersion({
    skillId,
    version,
    name: `Skill ${skillId}`,
    summary: `Deterministic summary for ${skillId}`,
    description: `Deterministic description for ${skillId}`,
    capabilities: [overrides.capability ?? 'inspection.device'],
    workflowGuidance: 'Use declared inputs only.',
    outputInstruction: 'Return declared evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-23T01:00:00.000Z',
    usageSpecification: createSkillUsageSpecification({
      apiVersion: 'sdar.io/v1alpha1',
      visibility: overrides.visibility ?? {
        userSelectable: true,
        composable: true,
        internalOnly: false,
      },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [...(overrides.requiredConfirmations ?? [])],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Use the deterministic declaration.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [
        {
          requirementId: 'device-id',
          description: 'Exact device identity.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
      ],
      modes: {
        supported: ['guidance', 'template'],
        defaultMode: 'guidance',
        guidance: { summary: 'Guidance', instructions: ['Guide.'] },
        template: { summary: 'Template', instructions: ['Render.'] },
      },
      taskBindings: [
        {
          bindingId: 'binding.inspect',
          taskType: 'device.inspect',
          providerPolicy: {
            selection: 'dynamic',
            preferredProviderIds: [],
            forbiddenProviderIds: [],
            requiredAttributes: [],
          },
        },
      ],
      composition: {
        maxDepth: 3,
        fixedDependencies: [],
        capabilitySlots: [],
      },
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    }),
    outcomeSpecification: {
      ...outcome,
      specificationHash: `sha256:${createHash('sha256').update(JSON.stringify(outcome)).digest('hex')}`,
    },
  });
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [
      value,
      ...rest,
    ]),
  );
}
