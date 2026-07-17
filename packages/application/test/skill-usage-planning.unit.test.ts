import { describe, expect, it } from 'vitest';

import {
  createSkillUsageSpecification,
  createSkillVersion,
  snapshotSkillUsageCompositionPlan,
  type SkillModeInterpretation,
  type SkillUsageCandidateSnapshot,
  type WorkflowDefinition,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  checkSkillUsagePlanCompliance,
  prepareSkillUsagePlan,
  WorkflowValidator,
  type SkillRepository,
} from '../src/index.js';

describe('Skill Usage Workflow planning', () => {
  it('prepares bounded guidance without creating executable or Workflow artifacts', () => {
    const prepared = prepareSkillUsagePlan({
      ...planningInput('guidance'),
      interpretation: interpretation('guidance'),
    });

    expect(prepared).not.toHaveProperty('deterministicDefinition');
    expect(JSON.parse(prepared.planningInstruction)).toMatchObject({
      operation: 'plan_with_skill_usage_policy',
      skillUsagePolicy: {
        mode: 'guidance',
        taskOperations: [{ providerId: 'provider.motion', operationName: 'embodied.move' }],
      },
    });
    expect(prepared.planningInstruction).not.toContain('privateReasoning');
  });

  it.each(['template', 'procedure'] as const)(
    'compiles %s IR into the existing Workflow DSL and passes the existing Validator',
    async (mode) => {
      const prepared = prepareSkillUsagePlan({
        ...planningInput(mode),
        interpretation: interpretation(mode),
      });
      const definition = prepared.deterministicDefinition;
      if (definition === undefined) throw new Error('DETERMINISTIC_DEFINITION_EXPECTED');

      expect(checkSkillUsagePlanCompliance(definition, prepared.policy)).toEqual({
        compliant: true,
        errors: [],
      });
      await expect(
        validator().validate(definition, {
          enforceSkillComposition: true,
          allowedChildSkillIds: ['skill.move'],
          skillUsagePolicy: prepared.policy,
        }),
      ).resolves.toMatchObject({ valid: true });
      expect(definition.nodes.map((node) => node.type)).toEqual(
        expect.arrayContaining([
          'human_confirmation',
          'skill_call',
          'error_handler',
          'mcp_tool',
          'condition',
          'result',
        ]),
      );
      expect(definition.nodes.find((node) => node.type === 'skill_call')).toMatchObject({
        input: { resourceId: { op: 'ref', path: ['input', 'resourceId'] } },
      });
    },
  );

  it('rejects provider, confirmation, failure-policy, recursion and evidence violations structurally', () => {
    const prepared = prepareSkillUsagePlan({
      ...planningInput('procedure'),
      interpretation: interpretation('procedure'),
    });
    const definition = prepared.deterministicDefinition;
    if (definition === undefined) throw new Error('DETERMINISTIC_DEFINITION_EXPECTED');
    const unsafe: WorkflowDefinition = {
      ...definition,
      nodes: [
        ...definition.nodes
          .filter((node) => node.type !== 'human_confirmation' && node.type !== 'condition')
          .map((node) =>
            node.type === 'error_handler'
              ? {
                  ...node,
                  name: 'forged explanation',
                  strategy: 'continue' as const,
                  skillFailurePolicy: 'optional' as const,
                }
              : node,
          ),
        {
          nodeId: 'forbidden_tool',
          name: 'Forbidden Provider',
          type: 'mcp_tool',
          tool: { serverId: 'provider.forbidden', toolName: 'embodied.move' },
          arguments: {},
        },
        {
          nodeId: 'extra_child',
          name: 'Budget overflow',
          type: 'skill_call',
          skillId: 'skill.unadmitted',
          input: {},
        },
      ],
    };
    const result = checkSkillUsagePlanCompliance(unsafe, prepared.policy);

    expect(result.compliant).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        'SKILL_USAGE_TASK_OPERATION_FORBIDDEN',
        'SKILL_USAGE_CONFIRMATION_POLICY_MISSING',
        'SKILL_USAGE_FAILURE_POLICY_MISMATCH',
        'SKILL_USAGE_RECURSION_BUDGET_EXCEEDED',
        'SKILL_USAGE_CHILD_FORBIDDEN',
        'SKILL_USAGE_EVIDENCE_HARD_GATE_MISSING',
        'SKILL_USAGE_CONTEXT_GATE_MISSING',
      ]),
    );
  });

  it('fails closed when the selected readiness summary has no admissible Provider identity', () => {
    const input = planningInput('template');
    const candidate: SkillUsageCandidateSnapshot = {
      ...input.candidate,
      applicability: {
        ...input.candidate.applicability,
        readiness: {
          overall: 'unknown',
          bindings: [
            {
              bindingId: 'move',
              taskType: 'embodied.move',
              disposition: 'unknown',
              confirmationRequired: true,
              reasonCodes: ['PROVIDER_UNREACHABLE'],
            },
          ],
        },
      },
    };
    expect(() =>
      prepareSkillUsagePlan({
        ...input,
        candidate,
        interpretation: interpretation('template'),
      }),
    ).toThrow(expect.objectContaining({ code: 'SKILL_USAGE_PLANNING_TASK_UNRESOLVED' }));
  });
});

const composition = snapshotSkillUsageCompositionPlan({
  root: { skillId: 'skill.root', skillVersion: 1 },
  expandedSkills: [
    { skillId: 'skill.root', skillVersion: 1 },
    { skillId: 'skill.move', skillVersion: 1 },
  ],
  edges: [
    {
      edgeId: 'root-move',
      kind: 'fixed_dependency',
      declarationId: 'move',
      parent: { skillId: 'skill.root', skillVersion: 1 },
      child: { skillId: 'skill.move', skillVersion: 1 },
      candidateSet: [{ skillId: 'skill.move', skillVersion: 1 }],
      failurePolicy: 'recoverable',
      inputMappings: [{ sourcePath: 'resourceId', targetPath: 'resourceId' }],
      outputMappings: [{ sourcePath: 'finalPosition', targetPath: 'evidence.position' }],
      depth: 1,
    },
  ],
  maxDepth: 3,
  consumedDepth: 1,
  consumedSkills: 2,
  consumedNodes: 1,
});

const usage = createSkillUsageSpecification({
  apiVersion: 'sdar.io/v1alpha1',
  visibility: { userSelectable: true, composable: true, internalOnly: false },
  normative: {
    constraints: ['Remain inside the authorized area.'],
    forbiddenActions: ['Do not bypass permission checks.'],
    requiredConfirmations: ['confirm-movement'],
    noApplicableSkill: 'reject',
  },
  adaptive: {
    instructions: ['Prefer the shortest safe route.'],
    optimizationHints: [],
    allowPreferredProviderFallback: false,
  },
  contextRequirements: [
    {
      requirementId: 'permission',
      description: 'Authoritative movement permission.',
      required: true,
      sourceOrder: ['authoritative_context'],
    },
  ],
  modes: {
    supported: ['guidance', 'template', 'procedure'],
    defaultMode: 'template',
    guidance: { summary: 'Guide.', instructions: ['Guide safely.'] },
    template: { summary: 'Template.', instructions: ['Bind deterministic slots.'] },
    procedure: { summary: 'Procedure.', instructions: ['Compile closed steps.'] },
  },
  taskBindings: [
    {
      bindingId: 'move',
      taskType: 'embodied.move',
      providerPolicy: {
        selection: 'required',
        preferredProviderIds: [],
        requiredProviderId: 'provider.motion',
        forbiddenProviderIds: [],
        requiredAttributes: [],
      },
    },
  ],
  composition: { maxDepth: 3, fixedDependencies: [], capabilitySlots: [] },
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
});

const skill = createSkillVersion({
  skillId: 'skill.root',
  version: 1,
  name: 'Root',
  summary: 'Root',
  description: 'Root',
  capabilities: ['embodied.move'],
  workflowGuidance: 'Move safely.',
  outputInstruction: 'Return evidence.',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  toolPolicy: { required: [], optional: [], forbidden: [] },
  runtimePolicy: { autoConfirmPlan: false },
  status: 'enabled',
  sourceKind: 'admin',
  validationPassed: true,
  createdAt: '2026-07-17T00:00:00.000Z',
  usageSpecification: usage,
});

function planningInput(mode: 'guidance' | 'template' | 'procedure') {
  return {
    skill,
    candidate: candidate(mode),
    goalContract: {
      goalId: 'goal.move',
      version: 1,
      title: 'Move',
      description: 'Move safely.',
      constraints: ['authorized only'],
      successCriteria: ['evidence exists'],
    },
    workflowDefinitionId: `workflow.${mode}`,
    workflowVersion: 1,
  } as const;
}

function candidate(mode: 'guidance' | 'template' | 'procedure'): SkillUsageCandidateSnapshot {
  return {
    skillId: skill.skillId,
    skillVersion: skill.version,
    applicability: {
      skillId: skill.skillId,
      skillVersion: skill.version,
      status: 'satisfied',
      reasonCodes: [],
      context: {
        requirements: [
          {
            requirementId: 'permission',
            required: true,
            status: 'satisfied',
            source: 'authoritative_context',
            evidenceRef: 'context:permission',
            attemptedSources: ['authoritative_context'],
          },
        ],
        satisfied: 1,
        total: 1,
        complete: true,
        inputRequiredIds: [],
        unsatisfiedIds: [],
        unknownIds: [],
      },
      readiness: {
        overall: 'ready',
        bindings: [
          {
            bindingId: 'move',
            taskType: 'embodied.move',
            disposition: 'ready',
            confirmationRequired: false,
            reasonCodes: [],
            selectedProviderId: 'provider.motion',
            selectedOperationName: 'embodied.move',
          },
        ],
      },
    },
    modeDecision: {
      decision: 'selected',
      mode,
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['confirmation_pending'],
    },
  };
}

function interpretation(mode: 'guidance' | 'template' | 'procedure'): SkillModeInterpretation {
  const common = { skill: { skillId: skill.skillId, skillVersion: skill.version }, composition };
  if (mode === 'guidance')
    return {
      ...common,
      kind: 'guidance',
      constraints: usage.normative.constraints,
      forbiddenActions: usage.normative.forbiddenActions,
      instructions: usage.modes.guidance?.instructions ?? [],
      requiredEvidenceTypes: ['position.observation'],
    };
  if (mode === 'template')
    return {
      ...common,
      kind: 'template',
      templateId: 'skill.root@1:template',
      instructions: usage.modes.template?.instructions ?? [],
      parameterMappings: [],
      outputMappings: [],
    };
  return {
    ...common,
    kind: 'procedure',
    apiVersion: 'sdar.io/v1alpha1',
    instructions: usage.modes.procedure?.instructions ?? [],
    steps: [],
  };
}

function validator() {
  const child = createSkillVersion({
    ...skill,
    skillId: 'skill.move',
    name: 'Move',
    capabilities: ['move'],
    usageSpecification: usage,
  });
  const skills: SkillRepository = {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: (skillId) => Promise.resolve(skillId === child.skillId ? child : undefined),
    findVersion: () => Promise.resolve(undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([child]),
    listCurrentVersions: () => Promise.resolve([child]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
  return new WorkflowValidator({
    tools: {
      exists: () => Promise.resolve(true),
      getInputSchema: () => Promise.resolve({ type: 'object' }),
    },
    skills,
    schemas: new AjvJsonSchemaValidator(),
  });
}
