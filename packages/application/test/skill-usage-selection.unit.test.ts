import { describe, expect, it } from 'vitest';

import {
  createSkillVersion,
  type SkillContextObservation,
  type SkillContextSource,
  type SkillTaskReadinessSummary,
  type SkillUsageSelectionContext,
  type SkillVersion,
} from '../../domain/src/index.js';
import {
  SkillApplicabilityAssessor,
  SkillContextRequirementResolver,
  SkillModeSelector,
  SkillUsageCandidateAssessor,
} from '../src/index.js';

describe('Skill usage applicability, context and mode decisions', () => {
  it('resolves evidence in declared source order and never prefers lower-authority input', () => {
    const resolver = new SkillContextRequirementResolver();
    const summary = resolver.resolve(
      [requirement('position', ['authoritative_context', 'read_only_query', 'user_input'])],
      [
        observation('position', 'user_input', 'user:position'),
        observation('position', 'authoritative_context', 'state:position:7'),
      ],
    );

    expect(summary).toMatchObject({ complete: true, satisfied: 1, total: 1 });
    expect(summary.requirements[0]).toEqual({
      requirementId: 'position',
      required: true,
      status: 'satisfied',
      source: 'authoritative_context',
      evidenceRef: 'state:position:7',
      attemptedSources: ['authoritative_context'],
    });
  });

  it('requires evidence references, rejects undeclared observations and requests user input explicitly', () => {
    const resolver = new SkillContextRequirementResolver();
    expect(() =>
      resolver.resolve(
        [requirement('position', ['authoritative_context'])],
        [{ requirementId: 'position', source: 'authoritative_context', status: 'available' }],
      ),
    ).toThrow(expect.objectContaining({ code: 'SKILL_CONTEXT_EVIDENCE_INVALID' }));
    expect(() =>
      resolver.resolve(
        [requirement('position', ['authoritative_context'])],
        [observation('permission', 'authoritative_context', 'permission:1')],
      ),
    ).toThrow(expect.objectContaining({ code: 'SKILL_CONTEXT_EVIDENCE_INVALID' }));

    expect(
      resolver.resolve([requirement('permission', ['authoritative_context', 'user_input'])], []),
    ).toMatchObject({
      complete: false,
      inputRequiredIds: ['permission'],
      requirements: [{ status: 'input_required' }],
    });
  });

  it('rejects Skill declarations that reorder or omit the fixed context authority chain', () => {
    expect(() => usageSkill(['user_input', 'authoritative_context'])).toThrow(
      expect.objectContaining({ code: 'SKILL_USAGE_SPEC_INVALID' }),
    );
    expect(() => usageSkill([])).toThrow(
      expect.objectContaining({ code: 'SKILL_USAGE_SPEC_INVALID' }),
    );
  });

  it.each([
    ['satisfied', [observation('position', 'authoritative_context', 'position:1')], ready('ready')],
    ['partial', [], ready('ready')],
    [
      'unsatisfied',
      [{ requirementId: 'position', source: 'authoritative_context', status: 'absent' }],
      ready('unavailable'),
    ],
    ['unknown', [], ready('unknown')],
  ] as const)(
    'produces %s applicability without promoting missing or Provider-unknown evidence',
    async (expected, observations, readiness) => {
      const skill = usageSkill(
        expected === 'unsatisfied'
          ? ['authoritative_context']
          : ['authoritative_context', 'user_input'],
      );
      const assessor = new SkillApplicabilityAssessor({
        contexts: new SkillContextRequirementResolver(),
        readiness: { inspect: () => Promise.resolve(readiness) },
      });

      await expect(assessor.assess(skill, observations)).resolves.toMatchObject({
        status: expected,
      });
    },
  );

  it('rejects mismatched aggregate readiness instead of trusting a forged overall status', async () => {
    const assessor = new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness: {
        inspect: () =>
          Promise.resolve({
            overall: 'ready',
            bindings: [bindingReadiness('unavailable')],
          }),
      },
    });

    await expect(
      assessor.assess(usageSkill(), [
        observation('position', 'authoritative_context', 'position:1'),
      ]),
    ).rejects.toMatchObject({ code: 'SKILL_TASK_READINESS_INVALID' });
  });

  it('selects only structured policy-admitted modes for complete, partial and declined decisions', async () => {
    const skill = usageSkill();
    const assessor = new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness: { inspect: () => Promise.resolve(ready('restricted')) },
    });
    const complete = await assessor.assess(skill, [
      observation('position', 'authoritative_context', 'position:1'),
    ]);
    const modes = new SkillModeSelector();
    expect(modes.select(skill, complete, selectionContext('high'))).toEqual({
      decision: 'selected',
      mode: 'procedure',
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['elevated_policy_mode', 'human_confirmation_pending'],
    });

    const partial = await new SkillApplicabilityAssessor({
      contexts: new SkillContextRequirementResolver(),
      readiness: { inspect: () => Promise.resolve(ready('ready')) },
    }).assess(skill, []);
    expect(modes.select(skill, partial, selectionContext('low'))).toMatchObject({
      decision: 'selected',
      mode: 'guidance',
    });
    expect(
      modes.select(skill, complete, { ...selectionContext('low'), humanConfirmation: 'declined' }),
    ).toEqual({ decision: 'blocked', reasonCodes: ['human_confirmation_declined'] });
    expect(() =>
      modes.select(skill, complete, {
        ...selectionContext('low'),
        systemPolicy: {
          ...selectionContext('low').systemPolicy,
          allowedModes: ['invented'],
        },
      } as unknown as SkillUsageSelectionContext),
    ).toThrow(expect.objectContaining({ code: 'SKILL_MODE_POLICY_INVALID' }));
  });

  it('builds one immutable exact-version usage candidate decision', async () => {
    const skill = usageSkill();
    const service = new SkillUsageCandidateAssessor({
      applicability: new SkillApplicabilityAssessor({
        contexts: new SkillContextRequirementResolver(),
        readiness: { inspect: () => Promise.resolve(ready('ready')) },
      }),
      modes: new SkillModeSelector(),
    });
    const result = await service.assess(skill, {
      ...selectionContext('low'),
      observations: [observation('position', 'authoritative_context', 'position:1')],
    });

    expect(result).toMatchObject({
      skillId: skill.skillId,
      skillVersion: 1,
      applicability: { status: 'satisfied' },
      modeDecision: { decision: 'selected', mode: 'template' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.applicability.context.requirements)).toBe(true);
  });
});

function usageSkill(
  sources: readonly SkillContextSource[] = ['authoritative_context', 'user_input'],
): SkillVersion {
  return createSkillVersion({
    skillId: 'embodied.move_to',
    version: 1,
    name: 'Move To',
    summary: 'Move safely.',
    description: 'Move to a target.',
    capabilities: ['embodied.move'],
    workflowGuidance: 'Move safely.',
    outputInstruction: 'Return position.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      specificationHash: `sha256:${'c'.repeat(64)}`,
      effects: ['effect.test'],
      evidence: ['evidence.test'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: {},
    },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-17T00:00:00.000Z',
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Stay safe.'],
        forbiddenActions: [],
        requiredConfirmations: ['Confirm movement.'],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Prefer a safe route.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [requirement('position', sources)],
      modes: {
        supported: ['guidance', 'template', 'procedure'],
        defaultMode: 'template',
        guidance: { summary: 'Guide.', instructions: ['Guide.'] },
        template: { summary: 'Template.', instructions: ['Bind.'] },
        procedure: { summary: 'Procedure.', instructions: ['Compile.'] },
      },
      taskBindings: [
        {
          bindingId: 'move',
          taskType: 'embodied.move',
          providerPolicy: {
            selection: 'dynamic',
            preferredProviderIds: [],
            forbiddenProviderIds: [],
            requiredAttributes: [],
          },
        },
      ],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    },
  });
}

function requirement(requirementId: string, sourceOrder: readonly SkillContextSource[]) {
  return {
    requirementId,
    description: `${requirementId} evidence.`,
    required: true,
    sourceOrder,
  } as const;
}

function observation(
  requirementId: string,
  source: SkillContextSource,
  evidenceRef: string,
): SkillContextObservation {
  return { requirementId, source, status: 'available', evidenceRef };
}

function bindingReadiness(
  disposition: SkillTaskReadinessSummary['overall'],
): SkillTaskReadinessSummary['bindings'][number] {
  return {
    bindingId: 'move',
    taskType: 'embodied.move',
    disposition,
    confirmationRequired: disposition === 'restricted',
    reasonCodes: [`provider_${disposition}`],
  };
}

function ready(disposition: SkillTaskReadinessSummary['overall']): SkillTaskReadinessSummary {
  return { overall: disposition, bindings: [bindingReadiness(disposition)] };
}

function selectionContext(risk: SkillUsageSelectionContext['risk']): SkillUsageSelectionContext {
  return {
    observations: [],
    risk,
    humanConfirmation: 'pending',
    systemPolicy: {
      allowedModes: ['guidance', 'template', 'procedure'],
      preferredMode: 'template',
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: true,
    },
  };
}
