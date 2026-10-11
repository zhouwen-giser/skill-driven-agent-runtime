import { z } from 'zod';
import type { SkillUsageSpecification } from '../../domain/src/index.js';
import { NewEvolutionPolicySchema } from './skill-evolution-authority.js';

export const InductionDecisionSchema = z.object({
  consistent: z.boolean(),
  stable: z.boolean(),
  generalizable: z.boolean(),
  duplicateSkillId: z.string().min(1).optional(),
  duplicateScore: z.number().min(0).max(1),
  evolutionKind: z.enum(['new_skill', 'new_version']),
  targetSkillId: z.string().min(1),
  boundaryDecisionSummary: z.string().min(1),
  decisionSummary: z.string().min(1),
  proposedSkill: z.object({
    skillId: z.string().min(1),
    name: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    workflowGuidance: z.string().min(1),
    outputInstruction: z.string().min(1),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    tools: z.array(z.object({ serverId: z.string().min(1), toolName: z.string().min(1) })).min(1),
    usageSpecification: z
      .unknown()
      .transform((value): SkillUsageSpecification => value as SkillUsageSpecification),
    outcomeSpecification: z.object({
      schemaVersion: z.literal('1.0'),
      skillId: z.string().min(1),
      skillVersion: z.number().int().positive(),
      effects: z.array(z.string().min(1)).min(1),
      evidence: z.array(z.string().min(1)).min(1),
      artifacts: z.array(z.string().min(1)),
      taskGoalPolicy: z.record(z.string(), z.unknown()),
      confidencePolicy: z.record(z.string(), z.unknown()),
      sideEffectPolicy: z.record(z.string(), z.unknown()),
      specificationHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    }),
  }),
  publicationPolicy: NewEvolutionPolicySchema.optional(),
  supplementalCases: z
    .array(
      z.object({
        caseId: z.string().min(1),
        kind: z.enum(['normal', 'boundary', 'exception']),
        input: z.record(z.string(), z.unknown()),
        expectedOutcome: z.enum(['success', 'failure']),
      }),
    )
    .min(3),
});

export const inductionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'consistent',
    'stable',
    'generalizable',
    'duplicateScore',
    'evolutionKind',
    'targetSkillId',
    'boundaryDecisionSummary',
    'decisionSummary',
    'proposedSkill',
    'supplementalCases',
  ],
  properties: {
    consistent: { type: 'boolean' },
    stable: { type: 'boolean' },
    generalizable: { type: 'boolean' },
    duplicateSkillId: { type: 'string', minLength: 1 },
    duplicateScore: { type: 'number', minimum: 0, maximum: 1 },
    evolutionKind: { type: 'string', enum: ['new_skill', 'new_version'] },
    targetSkillId: { type: 'string', minLength: 1 },
    boundaryDecisionSummary: { type: 'string', minLength: 1 },
    decisionSummary: { type: 'string', minLength: 1 },
    proposedSkill: { type: 'object' },
    publicationPolicy: { type: 'object' },
    supplementalCases: { type: 'array', minItems: 3, items: { type: 'object' } },
  },
} as const;
