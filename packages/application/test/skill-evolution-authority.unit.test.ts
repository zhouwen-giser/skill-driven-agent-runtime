import { describe, expect, it } from 'vitest';
import { createSkillVersion } from '../../domain/src/index.js';
import { freezeEvolutionSkill } from '../src/skill-evolution-authority.js';
import {
  timestamp,
  tool,
  budgetCeiling,
  schemas,
  newPolicy,
  evolutionAuthorityFixture,
} from './skill-evolution-fixture.js';

describe('evolution candidate authority', () => {
  it('retains all base policies and creates a detached draft, without enabling it', () => {
    const { proposed, base } = evolutionAuthorityFixture();
    const original = createSkillVersion({
      ...base,
      toolPolicy: { ...base.toolPolicy, forbidden: [{ serverId: 'other', toolName: 'write' }] },
      runtimePolicy: {
        ...base.runtimePolicy,
        pauseReplanThresholdSeconds: 7,
        compensationGuidance: 'Retain cleanup policy',
        cancelStrategy: 'cleanup_workflow',
      },
    });
    const result = freezeEvolutionSkill({
      proposed: { ...proposed, workflowGuidance: 'Read twice and compare.' },
      base: original,
      sourceTools: [],
      budgetCeiling,
      schemas,
      timestamp,
    });
    expect(result).toMatchObject({
      status: 'draft',
      validationPassed: false,
      version: 2,
      previousVersion: 1,
    });
    expect(result.toolPolicy).toEqual(original.toolPolicy);
    expect(result.runtimePolicy).toEqual(original.runtimePolicy);
    expect(result.outcomeSpecification?.evidence).toEqual(original.outcomeSpecification?.evidence);
    expect(Object.isFrozen(result.runtimePolicy)).toBe(true);
    expect(original.version).toBe(1);
  });

  it.each(['schema', 'normative', 'evidence', 'fallback', 'capability'] as const)(
    'refuses a %s authority change',
    (change) => {
      const { proposed, base } = evolutionAuthorityFixture();
      const usage = proposed.usageSpecification;
      if (usage === undefined) throw new Error('Fixture needs explicit usage');
      const modified = {
        ...proposed,
        ...(change === 'schema' ? { outputSchema: { type: 'string' } } : {}),
        ...(change === 'capability' ? { capabilities: ['write'] } : {}),
        usageSpecification: {
          ...usage,
          ...(change === 'normative'
            ? { normative: { ...usage.normative, forbiddenActions: [] } }
            : {}),
          ...(change === 'evidence'
            ? {
                evidencePolicy: {
                  ...usage.evidencePolicy,
                  rejectSuccessWithoutRequiredEvidence: true,
                },
              }
            : {}),
          ...(change === 'fallback'
            ? { adaptive: { ...usage.adaptive, allowPreferredProviderFallback: true } }
            : {}),
        },
      };
      expect(() =>
        freezeEvolutionSkill({
          proposed: modified,
          base,
          sourceTools: [],
          budgetCeiling,
          schemas,
          timestamp,
        }),
      ).toThrow('SKILL_EVOLUTION_NORMATIVE_CHANGE_REQUIRES_REVIEW');
    },
  );

  it('requires explicit new-Skill policy and bounds both Tools and budgets by existing authority', () => {
    const { proposed } = evolutionAuthorityFixture();
    const common = { proposed, sourceTools: [tool], budgetCeiling, schemas, timestamp };
    expect(() => freezeEvolutionSkill(common)).toThrow('SKILL_EVOLUTION_POLICY_AUTHORITY_REQUIRED');
    expect(() => freezeEvolutionSkill({ ...common, sourceTools: [], newPolicy })).toThrow(
      'SKILL_EVOLUTION_TOOL_AUTHORITY_MISSING',
    );
    expect(() =>
      freezeEvolutionSkill({
        ...common,
        newPolicy: {
          ...newPolicy,
          runtimePolicy: { ...newPolicy.runtimePolicy, maxMcpCalls: 1000 },
        },
      }),
    ).toThrow('SKILL_EVOLUTION_BUDGET_AUTHORITY_EXCEEDED');
  });

  it('rejects disabled bases and unconstrained schemas before any candidate runtime is reachable', () => {
    const { proposed, base } = evolutionAuthorityFixture();
    const common = { proposed, sourceTools: [tool], budgetCeiling, schemas, timestamp };
    expect(() =>
      freezeEvolutionSkill({ ...common, base: { ...base, status: 'disabled' } }),
    ).toThrow('SKILL_EVOLUTION_BASE_UNAVAILABLE');
    expect(() =>
      freezeEvolutionSkill({
        ...common,
        newPolicy,
        proposed: { ...proposed, outputSchema: { type: 'object' } },
      }),
    ).toThrow();
  });
});
