import {
  createSkillVersion,
  type ProposedEvolutionSkill,
  type SkillVersion,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { freezeEvolutionSkill, type NewEvolutionPolicy } from '../src/skill-evolution-authority.js';

export const timestamp = '2026-10-11T00:00:00.000Z';
export const tool = { serverId: 'local-recording', toolName: 'read' };
export const budgetCeiling = {
  maxReplans: 1,
  maxDurationSeconds: 30,
  maxLlmCalls: 4,
  maxMcpCalls: 5,
  maxCost: 10,
};
export const schemas = new AjvJsonSchemaValidator();
export const newPolicy: NewEvolutionPolicy = {
  toolPolicy: { required: [tool], optional: [], forbidden: [] },
  runtimePolicy: { ...budgetCeiling, autoConfirmPlan: false, cancelStrategy: 'wait_current' },
};

export function evolutionAuthorityFixture(): {
  proposed: ProposedEvolutionSkill;
  base: SkillVersion;
} {
  const proposed: ProposedEvolutionSkill = {
    skillId: 'read-status',
    name: 'Read status',
    summary: 'Read recorded status',
    description: 'Read status using the admitted Tool.',
    capabilities: ['read-status'],
    workflowGuidance: 'Use the Tool and return its status.',
    outputInstruction: 'Return the status object.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    },
    tools: [tool],
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Use the admitted provider'],
        forbiddenActions: ['write'],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Return status'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Read status', instructions: ['Call read'] },
      },
      taskBindings: [],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    },
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId: 'read-status',
      skillVersion: 1,
      effects: ['status_returned'],
      evidence: ['recorded_provider_result'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: { readOnly: true },
      specificationHash: `sha256:${'0'.repeat(64)}`,
    },
  };
  const draft = freezeEvolutionSkill({
    proposed,
    newPolicy,
    sourceTools: [tool],
    budgetCeiling,
    schemas,
    timestamp,
  });
  return {
    proposed,
    base: createSkillVersion({
      ...draft,
      status: 'enabled',
      validationPassed: true,
      sourceKind: 'admin',
    }),
  };
}
