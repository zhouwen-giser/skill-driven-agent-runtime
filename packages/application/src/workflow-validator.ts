import { z } from 'zod';
import type {
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
const BaseNode = { nodeId: Identifier, name: z.string().min(1) };
const JsonSchemaValue = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const NodeSchema: z.ZodType<WorkflowNode> = z.discriminatedUnion('type', [
  z
    .object({
      ...BaseNode,
      type: z.literal('llm'),
      instruction: z.string().min(1),
      responseSchema: JsonSchemaValue,
    })
    .strict(),
  z
    .object({
      ...BaseNode,
      type: z.literal('mcp_tool'),
      tool: z.object({ serverId: Identifier, toolName: Identifier }).strict(),
      arguments: z.unknown(),
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
    })
    .strict(),
  z
    .object({ ...BaseNode, type: z.literal('skill_call'), skillId: Identifier, input: z.unknown() })
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
  async validate(raw: unknown): Promise<WorkflowValidationResult> {
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
      await this.#validateNode(node, index, errors);
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
    for (const node of definition.nodes) validateNodeReferences(node, ids, errors);
    validateConditionEdges(definition.nodes, definition.edges, errors);
    validateReachability(definition, ids, errors);
    return errors.length === 0 ? { valid: true, errors, definition } : { valid: false, errors };
  }
  async #validateNode(
    node: WorkflowNode,
    index: number,
    errors: { code: string; path: string; message: string }[],
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
        const result = this.#schemas.validate(schema, node.arguments);
        if (!result.valid)
          add(
            errors,
            'WORKFLOW_TOOL_ARGUMENTS_INVALID',
            `nodes.${String(index)}.arguments`,
            result.errors.join('; '),
          );
      }
    } else if (node.type === 'skill_call') {
      const skill = await this.#skills.findCurrentVersion(node.skillId);
      if (skill?.status !== 'enabled')
        add(
          errors,
          'WORKFLOW_SKILL_NOT_ENABLED',
          `nodes.${String(index)}.skillId`,
          'Current enabled Skill was not found.',
        );
      else {
        const result = this.#schemas.validate(skill.inputSchema, node.input);
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

function validateNodeReferences(
  node: WorkflowNode,
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
    if (node.strategy === 'goto' && (node.gotoNodeId === undefined || !ids.has(node.gotoNodeId)))
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
  }
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
