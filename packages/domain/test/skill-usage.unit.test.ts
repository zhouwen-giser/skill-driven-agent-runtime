import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SKILL_USAGE_DEPTH,
  DomainError,
  MAX_SKILL_USAGE_DEPTH,
  MAX_SKILL_USAGE_ITEMS,
  SKILL_USAGE_API_VERSION,
  createSkillPatchCandidate,
  createSkillUsageSpecification,
  createSkillVersion,
  snapshotSkillVersion,
  type SkillUsageSpecification,
} from '../src/index.js';

function validUsage(): SkillUsageSpecification {
  return {
    apiVersion: SKILL_USAGE_API_VERSION,
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: ['Never enter a forbidden area.'],
      forbiddenActions: ['Bypass a safety gate.'],
      requiredConfirmations: ['Confirm high-risk motion.'],
      noApplicableSkill: 'reject',
    },
    adaptive: {
      instructions: ['Prefer the shortest safe route.'],
      optimizationHints: ['Minimize unnecessary motion.'],
      allowPreferredProviderFallback: true,
    },
    observedProfile: { sampleCount: 10, successRate: 0.9, notes: ['Local simulation.'] },
    contextRequirements: [
      {
        requirementId: 'current-position',
        description: 'Current authoritative position.',
        required: true,
        sourceOrder: ['authoritative_context', 'read_only_query', 'user_input'],
      },
    ],
    modes: {
      supported: ['guidance', 'template', 'procedure'],
      defaultMode: 'template',
      guidance: { summary: 'Planner guidance.', instructions: ['Plan within policy.'] },
      template: {
        summary: 'Parameterized route skeleton.',
        instructions: ['Bind declared route parameters.'],
        artifactRef: 'modes/template.json',
      },
      procedure: {
        summary: 'Deterministic procedure declaration.',
        instructions: ['Compile into the existing Workflow DSL.'],
        artifactRef: 'modes/procedure.json',
      },
    },
    taskBindings: [
      {
        bindingId: 'move',
        taskType: 'embodied.move',
        providerPolicy: {
          selection: 'preferred',
          preferredProviderIds: ['vehicle-primary'],
          forbiddenProviderIds: ['unsafe-provider'],
          requiredAttributes: ['indoor-certified'],
        },
      },
    ],
    composition: {
      maxDepth: DEFAULT_SKILL_USAGE_DEPTH,
      fixedDependencies: [
        {
          dependencyId: 'localize-first',
          skillId: 'embodied.localize',
          failurePolicy: 'fail_fast',
        },
      ],
      capabilitySlots: [
        {
          slotId: 'route-planner',
          capability: 'safe-route-planning',
          required: true,
          candidateSkillIds: ['embodied.route.basic'],
          failurePolicy: 'recoverable',
        },
      ],
    },
    evidencePolicy: {
      requirements: [
        {
          requirementId: 'final-position',
          evidenceType: 'position.observation',
          required: true,
          hardGate: true,
        },
      ],
      rejectSuccessWithoutRequiredEvidence: true,
    },
  };
}

describe('Skill Usage domain contract', () => {
  it('creates a deeply immutable finite snapshot without mutating the input', () => {
    const input = validUsage();
    const snapshot = createSkillUsageSpecification(input);

    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.normative.constraints)).toBe(true);
    expect(Object.isFrozen(snapshot.taskBindings[0]?.providerPolicy)).toBe(true);
    expect(Object.isFrozen(snapshot.composition?.capabilitySlots[0])).toBe(true);
    expect(() => (snapshot.normative.constraints as string[]).push('Injected constraint.')).toThrow(
      TypeError,
    );
  });

  it('adds an immutable native usage snapshot to SkillVersion', () => {
    const base = {
      skillId: 'embodied.move-to',
      version: 1,
      name: 'Move to',
      summary: 'Move safely.',
      description: 'Move a resource to a target.',
      capabilities: ['move'],
      workflowGuidance: 'Use the registered motion tool.',
      outputInstruction: 'Return final position.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      outcomeSpecification: {
        schemaVersion: '1.0' as const,
        skillId: 'embodied.move-to',
        skillVersion: 1,
        specificationHash: `sha256:${'e'.repeat(64)}`,
        effects: ['effect.test'],
        evidence: ['evidence.test'],
        artifacts: [],
        taskGoalPolicy: {},
        confidencePolicy: {},
        sideEffectPolicy: {},
      },
      status: 'enabled' as const,
      sourceKind: 'admin' as const,
      validationPassed: true,
      createdAt: '2026-07-17T00:00:00.000Z',
    };
    const native = createSkillVersion({ ...base, usageSpecification: validUsage() });
    const graphSnapshot = snapshotSkillVersion(native);

    expect(native.usageSpecification?.apiVersion).toBe(SKILL_USAGE_API_VERSION);
    expect(Object.isFrozen(native.usageSpecification)).toBe(true);
    expect(graphSnapshot.usageSpecification).toEqual(native.usageSpecification);
    expect(Object.isFrozen(graphSnapshot.usageSpecification)).toBe(true);
  });

  it.each([
    ['unknown apiVersion', (value: SkillUsageSpecification) => ({ ...value, apiVersion: 'v2' })],
    [
      'internal-only/user-selectable contradiction',
      (value: SkillUsageSpecification) => ({
        ...value,
        visibility: { userSelectable: true, composable: true, internalOnly: true },
      }),
    ],
    [
      'unsupported mode',
      (value: SkillUsageSpecification) => ({
        ...value,
        modes: { ...value.modes, supported: ['guidance', 'invented'] },
      }),
    ],
    [
      'default mode not supported',
      (value: SkillUsageSpecification) => ({
        ...value,
        modes: {
          supported: ['guidance'],
          defaultMode: 'procedure',
          guidance: value.modes.guidance,
        },
      }),
    ],
    [
      'required and forbidden Provider',
      (value: SkillUsageSpecification) => ({
        ...value,
        taskBindings: [
          {
            bindingId: 'move',
            taskType: 'embodied.move',
            providerPolicy: {
              selection: 'required',
              preferredProviderIds: [],
              requiredProviderId: 'provider-a',
              forbiddenProviderIds: ['provider-a'],
              requiredAttributes: [],
            },
          },
        ],
      }),
    ],
    [
      'usage depth above hard maximum',
      (value: SkillUsageSpecification) => ({
        ...value,
        composition: {
          maxDepth: MAX_SKILL_USAGE_DEPTH + 1,
          fixedDependencies: value.composition?.fixedDependencies ?? [],
          capabilitySlots: value.composition?.capabilitySlots ?? [],
        },
      }),
    ],
    [
      'hard gate without required evidence',
      (value: SkillUsageSpecification) => ({
        ...value,
        evidencePolicy: {
          rejectSuccessWithoutRequiredEvidence: true,
          requirements: [
            {
              requirementId: 'position',
              evidenceType: 'position.observation',
              required: false,
              hardGate: true,
            },
          ],
        },
      }),
    ],
  ])('fails closed for %s', (_label, mutate) => {
    expect(() =>
      createSkillUsageSpecification(mutate(validUsage()) as SkillUsageSpecification),
    ).toThrow(DomainError);
  });

  it('rejects duplicate IDs, oversized arrays, executable artifact references and private reasoning', () => {
    const duplicate = validUsage();
    expect(() =>
      createSkillUsageSpecification({
        ...duplicate,
        taskBindings: [...duplicate.taskBindings, ...duplicate.taskBindings],
      }),
    ).toThrow(/IDs must be unique/u);

    expect(() =>
      createSkillUsageSpecification({
        ...validUsage(),
        adaptive: {
          ...validUsage().adaptive,
          instructions: Array.from(
            { length: MAX_SKILL_USAGE_ITEMS + 1 },
            (_, index) => `i-${String(index)}`,
          ),
        },
      }),
    ).toThrow(/maximum item count/u);

    expect(() =>
      createSkillUsageSpecification({
        ...validUsage(),
        modes: {
          ...validUsage().modes,
          procedure: {
            summary: 'Unsafe source.',
            instructions: ['Do not run this.'],
            artifactRef: 'modes/procedure.ts',
          },
        },
      }),
    ).toThrow(/executable source/u);

    expect(() =>
      createSkillUsageSpecification({
        ...validUsage(),
        observedProfile: {
          sampleCount: 1,
          notes: [],
          private_reasoning: 'secret',
        } as never,
      }),
    ).toThrow(/Private reasoning/u);
  });

  it('rejects cyclic or non-finite patch data and freezes candidate-only patches', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() =>
      createSkillPatchCandidate({
        candidateId: 'candidate-1',
        skillId: 'embodied.move-to',
        baseVersion: 1,
        proposedAdaptivePatch: cyclic,
        evidenceRefs: [],
        status: 'candidate',
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow(/cyclic/u);

    const candidate = createSkillPatchCandidate({
      candidateId: 'candidate-1',
      skillId: 'embodied.move-to',
      baseVersion: 1,
      proposedAdaptivePatch: { optimizationHints: ['Prefer a safer route.'] },
      evidenceRefs: ['evidence-1'],
      status: 'candidate',
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    expect(candidate.status).toBe('candidate');
    expect(Object.isFrozen(candidate.proposedAdaptivePatch)).toBe(true);
    expect(() =>
      createSkillPatchCandidate({ ...candidate, proposedAdaptivePatch: { score: Number.NaN } }),
    ).toThrow(/finite/u);
  });
});
