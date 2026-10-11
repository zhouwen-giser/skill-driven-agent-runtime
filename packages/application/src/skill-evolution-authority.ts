import { z } from 'zod';
import {
  createSkillVersion,
  skillSchemaContractErrors,
  type ProposedEvolutionSkill,
  type SkillVersion,
  type ToolReference,
  type WorkflowBudgetLimits,
} from '../../domain/src/index.js';
import type { JsonSchemaValidator } from './ports.js';
import { canonicalHash } from './mcp-task-readiness.js';

const Tool = z.object({ serverId: z.string().min(1), toolName: z.string().min(1) }).strict();

/** Induction may propose a narrower policy; the server's existing limits remain authoritative. */
export const NewEvolutionPolicySchema = z
  .object({
    toolPolicy: z
      .object({ required: z.array(Tool), optional: z.array(Tool), forbidden: z.array(Tool) })
      .strict(),
    runtimePolicy: z
      .object({
        autoConfirmPlan: z.literal(false),
        maxReplans: z.number().int().nonnegative(),
        maxDurationSeconds: z.number().int().positive(),
        maxLlmCalls: z.number().int().nonnegative(),
        maxMcpCalls: z.number().int().nonnegative(),
        maxCost: z.number().nonnegative(),
        cancelStrategy: z.literal('wait_current'),
      })
      .strict(),
  })
  .strict();

export type NewEvolutionPolicy = z.infer<typeof NewEvolutionPolicySchema>;

export class SkillEvolutionValidationError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'SkillEvolutionValidationError';
  }
}

export function freezeEvolutionSkill(
  input: Readonly<{
    proposed: ProposedEvolutionSkill;
    base?: SkillVersion;
    newPolicy?: NewEvolutionPolicy;
    sourceTools: readonly ToolReference[];
    budgetCeiling: WorkflowBudgetLimits;
    schemas: JsonSchemaValidator;
    timestamp: string;
  }>,
): SkillVersion {
  const { proposed, base } = input;
  for (const label of ['input', 'output'] as const) {
    const schema = label === 'input' ? proposed.inputSchema : proposed.outputSchema;
    const errors = [
      ...input.schemas.checkSchema(schema).errors,
      ...skillSchemaContractErrors(schema, label),
    ];
    if (errors.length > 0)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_SCHEMA_INVALID', errors.join('; '));
  }
  if (proposed.usageSpecification === undefined || proposed.outcomeSpecification === undefined)
    throw new SkillEvolutionValidationError('SKILL_EVOLUTION_EXPLICIT_CONTRACTS_REQUIRED');
  if (base !== undefined) {
    if (base.status !== 'enabled' || base.skillId !== proposed.skillId)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_BASE_UNAVAILABLE');
    const unchanged = {
      capabilities: base.capabilities,
      inputSchema: base.inputSchema,
      outputSchema: base.outputSchema,
      usage: normativeUsage(base.usageSpecification),
      outcome: outcomeContent(base.outcomeSpecification),
    };
    const declared = {
      capabilities: proposed.capabilities,
      inputSchema: proposed.inputSchema,
      outputSchema: proposed.outputSchema,
      usage: normativeUsage(proposed.usageSpecification),
      outcome: outcomeContent(proposed.outcomeSpecification),
    };
    if (canonicalHash(unchanged) !== canonicalHash(declared))
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_NORMATIVE_CHANGE_REQUIRES_REVIEW');
  }
  const policy = base ?? input.newPolicy;
  if (policy === undefined)
    throw new SkillEvolutionValidationError('SKILL_EVOLUTION_POLICY_AUTHORITY_REQUIRED');
  const allowed = [...policy.toolPolicy.required, ...policy.toolPolicy.optional];
  if (toolKeys(allowed) !== toolKeys(proposed.tools))
    throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TOOL_POLICY_MISMATCH');
  if (base === undefined) {
    const sources = new Set(input.sourceTools.map(toolKey));
    if (allowed.some((tool) => !sources.has(toolKey(tool))))
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TOOL_AUTHORITY_MISSING');
    const runtime = NewEvolutionPolicySchema.parse(input.newPolicy).runtimePolicy;
    for (const name of [
      'maxReplans',
      'maxDurationSeconds',
      'maxLlmCalls',
      'maxMcpCalls',
      'maxCost',
    ] as const)
      if (runtime[name] > input.budgetCeiling[name])
        throw new SkillEvolutionValidationError('SKILL_EVOLUTION_BUDGET_AUTHORITY_EXCEEDED');
  }
  const version = (base?.version ?? 0) + 1;
  const declaredOutcome = proposed.outcomeSpecification;
  const content = {
    schemaVersion: '1.0' as const,
    skillId: proposed.skillId,
    skillVersion: version,
    effects: declaredOutcome.effects,
    evidence: declaredOutcome.evidence,
    artifacts: declaredOutcome.artifacts,
    taskGoalPolicy: declaredOutcome.taskGoalPolicy,
    confidencePolicy: declaredOutcome.confidencePolicy,
    sideEffectPolicy: declaredOutcome.sideEffectPolicy,
  };
  return createSkillVersion({
    ...(base ?? {}),
    skillId: proposed.skillId,
    version,
    name: proposed.name,
    summary: proposed.summary,
    description: proposed.description,
    capabilities: proposed.capabilities,
    workflowGuidance: proposed.workflowGuidance,
    outputInstruction: proposed.outputInstruction,
    inputSchema: proposed.inputSchema,
    outputSchema: proposed.outputSchema,
    toolPolicy: policy.toolPolicy,
    runtimePolicy: policy.runtimePolicy,
    usageSpecification: proposed.usageSpecification,
    outcomeSpecification: { ...content, specificationHash: `sha256:${canonicalHash(content)}` },
    status: 'draft',
    sourceKind: 'experience_evolution',
    validationPassed: false,
    ...(base === undefined ? {} : { previousVersion: base.version }),
    createdAt: input.timestamp,
  });
}

function toolKey(tool: ToolReference): string {
  return `${tool.serverId}\u0000${tool.toolName}`;
}
function toolKeys(tools: readonly ToolReference[]): string {
  return [...new Set(tools.map(toolKey))].sort().join('\n');
}

function outcomeContent(outcome: SkillVersion['outcomeSpecification']): unknown {
  if (outcome === undefined) return null;
  return Object.fromEntries(
    Object.entries(outcome).filter(
      ([key]) => !['skillId', 'skillVersion', 'specificationHash'].includes(key),
    ),
  );
}

function normativeUsage(usage: SkillVersion['usageSpecification']): unknown {
  if (usage === undefined) return null;
  return {
    ...usage,
    adaptive: { ...usage.adaptive, instructions: [], optimizationHints: [] },
    modes: Object.fromEntries(
      Object.entries(usage.modes).map(([key, value]) =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? [key, { ...value, summary: '', instructions: [] }]
          : [key, value],
      ),
    ),
  };
}
