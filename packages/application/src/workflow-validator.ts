import { z } from 'zod';
import type {
  WorkflowBoundValue,
  WorkflowDefinition,
  WorkflowExpression,
  WorkflowNode,
} from '../../domain/src/index.js';
import type { JsonSchemaValidator, McpToolCatalog, SkillRepository } from './ports.js';

const Identifier = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/u);
const ExpressionSchema: z.ZodType<WorkflowExpression> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z
      .object({
        op: z.literal('literal'),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .strict(),
    z.object({ op: z.literal('ref'), path: z.array(Identifier).min(1) }).strict(),
    z.object({ op: z.literal('not'), operand: ExpressionSchema }).strict(),
    ...(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'and', 'or'] as const).map((op) =>
      z.object({ op: z.literal(op), left: ExpressionSchema, right: ExpressionSchema }).strict(),
    ),
  ]),
);
const BoundScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const BoundReferenceSchema = z
  .object({ op: z.literal('ref'), path: z.array(Identifier).min(1) })
  .strict();
const BoundValueSchema: z.ZodType<WorkflowBoundValue> = z.lazy(() =>
  z.union([
    BoundScalarSchema,
    z.array(BoundValueSchema),
    BoundReferenceSchema,
    z
      .record(z.string(), BoundValueSchema)
      .refine(
        (value) => value['op'] !== 'ref' || !Array.isArray(value['path']),
        'The object shape { op: "ref", path: [...] } is reserved for an exact Workflow binding reference.',
      ),
  ]),
);
const BaseNode = { nodeId: Identifier, name: z.string().min(1) };
const JsonSchemaValue = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const NodeSchema: z.ZodType<WorkflowNode> = z.discriminatedUnion('type', [
  z
    .object({
      ...BaseNode,
      type: z.literal('llm'),
      instruction: z.string().min(1),
      context: BoundValueSchema.optional(),
      responseSchema: JsonSchemaValue,
    })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('mcp_tool'),
      tool: z.object({ serverId: Identifier, toolName: Identifier }).strict(),
      arguments: BoundValueSchema,
    })
    .strict(),
  z.object({ ...BaseNode, type: z.literal('result'), value: ExpressionSchema }).strict(),
  z.object({ ...BaseNode, type: z.literal('condition'), expression: ExpressionSchema }).strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('parallel'),
      branchEntryNodeIds: z.array(Identifier).min(2),
    })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('loop'),
      condition: ExpressionSchema,
      bodyEntryNodeId: Identifier,
      maxIterations: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('subworkflow'),
      workflowDefinitionId: Identifier,
      workflowVersion: z.number().int().positive(),
      input: BoundValueSchema,
    })
    .strict(),
  z
    .object({ ...BaseNode, type: z.literal('human_confirmation'), prompt: z.string().min(1) })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('error_handler'),
      handledNodeId: Identifier,
      strategy: z.enum(['terminate', 'continue', 'goto']),
      gotoNodeId: Identifier.optional(),
      recoveryOptions: z
        .array(
          z
            .object({
              action: z.enum(['retry', 'change_arguments', 'alternative_tool', 'invoke_skill']),
              targetNodeId: Identifier,
              description: z.string().min(1),
              maxAttempts: z.number().int().min(1).max(10),
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('skill_call'),
      skillId: Identifier,
      input: BoundValueSchema,
    })
    .strict(),
]);
const WorkflowSchema: z.ZodType<WorkflowDefinition> = z
  .object({
    workflowDefinitionId: Identifier,
    version: z.number().int().positive(),
    goalId: Identifier,
    goalVersion: z.number().int().positive(),
    entryNodeId: Identifier,
    exitNodeIds: z.array(Identifier).min(1),
    nodes: z.array(NodeSchema).min(1),
    edges: z.array(
      z
        .object({
          sourceNodeId: Identifier,
          targetNodeId: Identifier,
          outcome: z
            .enum(['default', 'true', 'false', 'success', 'failure', 'loop', 'done'])
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export interface WorkflowValidationResult {
  readonly valid: boolean;
  readonly errors: readonly Readonly<{ code: string; path: string; message: string }>[];
  readonly definition?: WorkflowDefinition;
}

export interface WorkflowValidationContext {
  readonly enforceSkillComposition?: boolean;
  readonly allowedChildSkillIds?: readonly string[];
  readonly capabilityGapSkillIds?: readonly string[];
}

export class WorkflowValidator {
  readonly #tools: McpToolCatalog;
  readonly #skills: SkillRepository;
  readonly #schemas: JsonSchemaValidator;
  constructor(
    dependencies: Readonly<{
      tools: McpToolCatalog;
      skills: SkillRepository;
      schemas: JsonSchemaValidator;
    }>,
  ) {
    this.#tools = dependencies.tools;
    this.#skills = dependencies.skills;
    this.#schemas = dependencies.schemas;
  }
  async validate(
    raw: unknown,
    context: WorkflowValidationContext = {},
  ): Promise<WorkflowValidationResult> {
    const parsed = WorkflowSchema.safeParse(raw);
    if (!parsed.success)
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => ({
          code: 'WORKFLOW_SCHEMA_INVALID',
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    const errors: { code: string; path: string; message: string }[] = [];
    const definition = parsed.data;
    const ids = new Set<string>();
    for (const [index, node] of definition.nodes.entries()) {
      if (ids.has(node.nodeId))
        add(
          errors,
          'WORKFLOW_NODE_DUPLICATE',
          `nodes.${String(index)}.nodeId`,
          'Node IDs must be unique.',
        );
      ids.add(node.nodeId);
      await this.#validateNode(node, index, errors, context);
    }
    if (!ids.has(definition.entryNodeId))
      add(errors, 'WORKFLOW_ENTRY_INVALID', 'entryNodeId', 'Entry node does not exist.');
    for (const [index, id] of definition.exitNodeIds.entries())
      if (!ids.has(id))
        add(
          errors,
          'WORKFLOW_EXIT_INVALID',
          `exitNodeIds.${String(index)}`,
          'Exit node does not exist.',
        );
    for (const [index, edge] of definition.edges.entries()) {
      if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId))
        add(
          errors,
          'WORKFLOW_EDGE_REFERENCE_INVALID',
          `edges.${String(index)}`,
          'Edge endpoint does not exist.',
        );
    }
    for (const node of definition.nodes)
      validateNodeReferences(node, definition.nodes, ids, errors);
    validateConditionEdges(definition.nodes, definition.edges, errors);
    validateReachability(definition, ids, errors);
    return errors.length === 0 ? { valid: true, errors, definition } : { valid: false, errors };
  }
  async #validateNode(
    node: WorkflowNode,
    index: number,
    errors: { code: string; path: string; message: string }[],
    context: WorkflowValidationContext,
  ) {
    if (node.type === 'llm') {
      const result = this.#schemas.checkSchema(node.responseSchema);
      if (!result.valid)
        add(
          errors,
          'WORKFLOW_LLM_SCHEMA_INVALID',
          `nodes.${String(index)}.responseSchema`,
          result.errors.join('; '),
        );
    } else if (node.type === 'mcp_tool') {
      const schema = await this.#tools.getInputSchema(node.tool);
      if (schema === undefined)
        add(
          errors,
          'WORKFLOW_TOOL_NOT_FOUND',
          `nodes.${String(index)}.tool`,
          'Registered MCP Tool was not found.',
        );
      else {
        const result = containsWorkflowBindingReference(node.arguments)
          ? { valid: true, errors: [] }
          : this.#schemas.validate(schema, node.arguments);
        if (!result.valid)
          add(
            errors,
            'WORKFLOW_TOOL_ARGUMENTS_INVALID',
            `nodes.${String(index)}.arguments`,
            result.errors.join('; '),
          );
      }
    } else if (node.type === 'skill_call') {
      if (
        context.enforceSkillComposition === true &&
        !context.allowedChildSkillIds?.includes(node.skillId) &&
        !context.capabilityGapSkillIds?.includes(node.skillId)
      )
        add(
          errors,
          'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION',
          `nodes.${String(index)}.skillId`,
          'Skill call is not admitted by the persisted composition or capability-gap context.',
        );
      const skill = await this.#skills.findCurrentVersion(node.skillId);
      if (skill?.status !== 'enabled')
        add(
          errors,
          'WORKFLOW_SKILL_NOT_ENABLED',
          `nodes.${String(index)}.skillId`,
          'Current enabled Skill was not found.',
        );
      else {
        const result = containsWorkflowBindingReference(node.input)
          ? { valid: true, errors: [] }
          : this.#schemas.validate(skill.inputSchema, node.input);
        if (!result.valid)
          add(
            errors,
            'WORKFLOW_SKILL_INPUT_INVALID',
            `nodes.${String(index)}.input`,
            result.errors.join('; '),
          );
      }
    }
  }
}

function containsWorkflowBindingReference(value: WorkflowBoundValue): boolean {
  if (Array.isArray(value)) return value.some(containsWorkflowBindingReference);
  if (value === null || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, WorkflowBoundValue>>;
  if (record['op'] === 'ref' && Array.isArray(record['path'])) return true;
  return Object.values(record).some(containsWorkflowBindingReference);
}

function validateNodeReferences(
  node: WorkflowNode,
  nodes: readonly WorkflowNode[],
  ids: Set<string>,
  errors: { code: string; path: string; message: string }[],
) {
  if (node.type === 'parallel')
    for (const id of node.branchEntryNodeIds)
      if (!ids.has(id))
        add(
          errors,
          'WORKFLOW_NODE_REFERENCE_INVALID',
          `nodes.${node.nodeId}.branchEntryNodeIds`,
          'Parallel branch does not exist.',
        );
  if (node.type === 'loop' && !ids.has(node.bodyEntryNodeId))
    add(
      errors,
      'WORKFLOW_NODE_REFERENCE_INVALID',
      `nodes.${node.nodeId}.bodyEntryNodeId`,
      'Loop body does not exist.',
    );
  if (node.type === 'error_handler') {
    if (!ids.has(node.handledNodeId))
      add(
        errors,
        'WORKFLOW_NODE_REFERENCE_INVALID',
        `nodes.${node.nodeId}.handledNodeId`,
        'Handled node does not exist.',
      );
    if (
      node.strategy === 'goto' &&
      node.recoveryOptions === undefined &&
      (node.gotoNodeId === undefined || !ids.has(node.gotoNodeId))
    )
      add(
        errors,
        'WORKFLOW_NODE_REFERENCE_INVALID',
        `nodes.${node.nodeId}.gotoNodeId`,
        'Goto target does not exist.',
      );
    if (node.strategy !== 'goto' && node.gotoNodeId !== undefined)
      add(
        errors,
        'WORKFLOW_HANDLER_INVALID',
        `nodes.${node.nodeId}.gotoNodeId`,
        'gotoNodeId is allowed only for goto strategy.',
      );
    if (node.recoveryOptions !== undefined) {
      if (node.strategy !== 'goto' || node.gotoNodeId !== undefined)
        add(
          errors,
          'WORKFLOW_HANDLER_INVALID',
          `nodes.${node.nodeId}.recoveryOptions`,
          'Recovery options require goto strategy and replace the singular gotoNodeId.',
        );
      const handled = nodes.find((candidate) => candidate.nodeId === node.handledNodeId);
      if (handled?.type !== 'mcp_tool')
        add(
          errors,
          'WORKFLOW_RECOVERY_ACTION_INVALID',
          `nodes.${node.nodeId}.handledNodeId`,
          'MCP recovery options require an mcp_tool handled node.',
        );
      const keys = new Set<string>();
      for (const option of node.recoveryOptions) {
        const path = `nodes.${node.nodeId}.recoveryOptions.${option.action}`;
        const key = `${option.action}:${option.targetNodeId}`;
        if (keys.has(key))
          add(errors, 'WORKFLOW_RECOVERY_ACTION_INVALID', path, 'Recovery option is duplicated.');
        keys.add(key);
        const target = nodes.find((candidate) => candidate.nodeId === option.targetNodeId);
        if (target === undefined) {
          add(errors, 'WORKFLOW_NODE_REFERENCE_INVALID', path, 'Recovery target does not exist.');
          continue;
        }
        if (option.action === 'retry' && target.nodeId !== node.handledNodeId)
          add(
            errors,
            'WORKFLOW_RECOVERY_ACTION_INVALID',
            path,
            'Retry must target the handled node.',
          );
        if (option.action === 'change_arguments') {
          if (
            handled?.type !== 'mcp_tool' ||
            target.type !== 'mcp_tool' ||
            target.tool.serverId !== handled.tool.serverId ||
            target.tool.toolName !== handled.tool.toolName ||
            stableStringify(target.arguments) === stableStringify(handled.arguments)
          )
            add(
              errors,
              'WORKFLOW_RECOVERY_ACTION_INVALID',
              path,
              'Argument change must target the same Tool with different prevalidated arguments.',
            );
        }
        if (
          option.action === 'alternative_tool' &&
          (handled?.type !== 'mcp_tool' ||
            target.type !== 'mcp_tool' ||
            (target.tool.serverId === handled.tool.serverId &&
              target.tool.toolName === handled.tool.toolName))
        )
          add(
            errors,
            'WORKFLOW_RECOVERY_ACTION_INVALID',
            path,
            'Alternative Tool must target a different registered mcp_tool node.',
          );
        if (option.action === 'invoke_skill' && target.type !== 'skill_call')
          add(
            errors,
            'WORKFLOW_RECOVERY_ACTION_INVALID',
            path,
            'Skill recovery must target a skill_call node.',
          );
      }
    }
  }
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function validateConditionEdges(
  nodes: readonly WorkflowNode[],
  edges: WorkflowDefinition['edges'],
  errors: { code: string; path: string; message: string }[],
) {
  for (const node of nodes.filter((item) => item.type === 'condition')) {
    const outcomes = new Set(
      edges.filter((edge) => edge.sourceNodeId === node.nodeId).map((edge) => edge.outcome),
    );
    if (!outcomes.has('true') || !outcomes.has('false'))
      add(
        errors,
        'WORKFLOW_CONDITION_EDGES_INVALID',
        `nodes.${node.nodeId}`,
        'Condition requires true and false edges.',
      );
  }
}
function validateReachability(
  definition: WorkflowDefinition,
  ids: Set<string>,
  errors: { code: string; path: string; message: string }[],
) {
  if (!ids.has(definition.entryNodeId)) return;
  const reached = new Set([definition.entryNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes)
      if (
        node.type === 'error_handler' &&
        reached.has(node.handledNodeId) &&
        !reached.has(node.nodeId)
      ) {
        reached.add(node.nodeId);
        changed = true;
      }
    for (const node of definition.nodes)
      if (node.type === 'error_handler' && reached.has(node.nodeId))
        for (const option of node.recoveryOptions ?? [])
          if (!reached.has(option.targetNodeId)) {
            reached.add(option.targetNodeId);
            changed = true;
          }
    for (const edge of definition.edges)
      if (reached.has(edge.sourceNodeId) && !reached.has(edge.targetNodeId)) {
        reached.add(edge.targetNodeId);
        changed = true;
      }
  }
  for (const id of ids)
    if (!reached.has(id))
      add(errors, 'WORKFLOW_NODE_UNREACHABLE', `nodes.${id}`, 'Node is unreachable from entry.');
  for (const exit of definition.exitNodeIds)
    if (definition.edges.some((edge) => edge.sourceNodeId === exit))
      add(
        errors,
        'WORKFLOW_EXIT_HAS_OUTGOING_EDGE',
        `exitNodeIds.${exit}`,
        'Exit node cannot have outgoing edges.',
      );
}
function add(
  errors: { code: string; path: string; message: string }[],
  code: string,
  path: string,
  message: string,
) {
  errors.push({ code, path, message });
}
