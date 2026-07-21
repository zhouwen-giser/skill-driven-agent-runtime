import type { WorkflowExpression } from '../../domain/src/index.js';

export interface WorkflowExpressionContext {
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly loopCounts: Readonly<Record<string, number>>;
}

export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionContext,
): unknown {
  switch (expression.op) {
    case 'literal':
      return expression.value;
    case 'ref':
      return resolveReference(expression.path, context);
    case 'exists':
      return referenceExists(expression.path, context);
    case 'not':
      return !requireBoolean(evaluateWorkflowExpression(expression.operand, context));
    case 'and':
      return (
        requireBoolean(evaluateWorkflowExpression(expression.left, context)) &&
        requireBoolean(evaluateWorkflowExpression(expression.right, context))
      );
    case 'or':
      return (
        requireBoolean(evaluateWorkflowExpression(expression.left, context)) ||
        requireBoolean(evaluateWorkflowExpression(expression.right, context))
      );
    case 'eq':
      return (
        scalar(evaluateWorkflowExpression(expression.left, context)) ===
        scalar(evaluateWorkflowExpression(expression.right, context))
      );
    case 'ne':
      return (
        scalar(evaluateWorkflowExpression(expression.left, context)) !==
        scalar(evaluateWorkflowExpression(expression.right, context))
      );
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return compare(
        expression.op,
        scalar(evaluateWorkflowExpression(expression.left, context)),
        scalar(evaluateWorkflowExpression(expression.right, context)),
      );
  }
}

function referenceExists(path: readonly string[], context: WorkflowExpressionContext): boolean {
  const input = isRecord(context.input) ? context.input : undefined;
  let current: unknown = {
    ...context,
    nodes: context.outputs,
    ...(isRecord(input?.['context']) ? { context: input['context'] } : {}),
    evidence: mergedEvidence(input, context.outputs),
  };
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

function resolveReference(path: readonly string[], context: WorkflowExpressionContext): unknown {
  const input = isRecord(context.input) ? context.input : undefined;
  let current: unknown = {
    ...context,
    nodes: context.outputs,
    ...(isRecord(input?.['context']) ? { context: input['context'] } : {}),
    evidence: mergedEvidence(input, context.outputs),
  };
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      throw new WorkflowExpressionError(
        'WORKFLOW_EXPRESSION_REFERENCE_MISSING',
        `Expression reference ${path.join('.')} does not exist.`,
      );
    }
    current = current[segment];
  }
  return current;
}

function mergedEvidence(
  input: Readonly<Record<string, unknown>> | undefined,
  outputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = isRecord(input?.['evidence'])
    ? { ...input['evidence'] }
    : {};
  for (const output of Object.values(outputs)) {
    if (isRecord(output) && isRecord(output['evidence'])) Object.assign(merged, output['evidence']);
    if (isRecord(output) && Array.isArray(output['evidence']))
      projectEvidenceItems(merged, output['evidence']);
    const structured = structuredContent(output);
    if (isRecord(structured?.['evidence'])) Object.assign(merged, structured['evidence']);
    const metadata = resultMetadata(output);
    if (isRecord(metadata?.['io.sdar/evidence'])) {
      Object.assign(merged, metadata['io.sdar/evidence']);
      const items = metadata['io.sdar/evidence']['items'];
      if (Array.isArray(items)) projectEvidenceItems(merged, items);
    }
  }
  return Object.freeze(merged);
}

function projectEvidenceItems(target: Record<string, unknown>, items: readonly unknown[]): void {
  for (const item of items) {
    if (!isRecord(item) || typeof item['evidenceType'] !== 'string') continue;
    target[item['evidenceType']] = item;
    if (typeof item['evidenceId'] === 'string') target[item['evidenceId']] = true;
  }
}

function resultMetadata(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value['metadata'])) return value['metadata'];
  const data = value['data'];
  return isRecord(data) && isRecord(data['metadata']) ? data['metadata'] : undefined;
}

function structuredContent(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value['structuredContent'])) return value['structuredContent'];
  const data = value['data'];
  return isRecord(data) && isRecord(data['structuredContent'])
    ? data['structuredContent']
    : undefined;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new WorkflowExpressionError(
      'WORKFLOW_EXPRESSION_BOOLEAN_REQUIRED',
      'Boolean expression operand must evaluate to a boolean.',
    );
  return value;
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return value as string | number | boolean | null;
  throw new WorkflowExpressionError(
    'WORKFLOW_EXPRESSION_SCALAR_REQUIRED',
    'Comparison operand must evaluate to a scalar.',
  );
}

function compare(
  operator: 'lt' | 'lte' | 'gt' | 'gte',
  left: string | number | boolean | null,
  right: string | number | boolean | null,
): boolean {
  if ((typeof left !== 'string' && typeof left !== 'number') || typeof left !== typeof right)
    throw new WorkflowExpressionError(
      'WORKFLOW_EXPRESSION_COMPARISON_TYPE_INVALID',
      'Ordered comparison operands must be strings or numbers of the same type.',
    );
  const rightComparable = right as string | number;
  if (operator === 'lt') return left < rightComparable;
  if (operator === 'lte') return left <= rightComparable;
  if (operator === 'gt') return left > rightComparable;
  return left >= rightComparable;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type WorkflowExpressionErrorCode =
  | 'WORKFLOW_EXPRESSION_BOOLEAN_REQUIRED'
  | 'WORKFLOW_EXPRESSION_COMPARISON_TYPE_INVALID'
  | 'WORKFLOW_EXPRESSION_REFERENCE_MISSING'
  | 'WORKFLOW_EXPRESSION_SCALAR_REQUIRED';

export class WorkflowExpressionError extends Error {
  readonly code: WorkflowExpressionErrorCode;
  constructor(code: WorkflowExpressionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExpressionError';
    this.code = code;
  }
}
