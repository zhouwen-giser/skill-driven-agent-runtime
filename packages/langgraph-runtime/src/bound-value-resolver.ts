import type { WorkflowBoundObject, WorkflowBoundValue } from '../../domain/src/index.js';

const MAX_WORKFLOW_BINDING_DEPTH = 64;

export interface WorkflowBindingContext {
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
  readonly loopCounts: Readonly<Record<string, number>>;
}

export function resolveWorkflowBoundValue(
  template: WorkflowBoundValue,
  context: WorkflowBindingContext,
): WorkflowBoundValue {
  return deepFreeze(resolveTemplate(template, context));
}

function resolveTemplate(
  template: WorkflowBoundValue,
  context: WorkflowBindingContext,
  depth = 0,
): WorkflowBoundValue {
  assertBindingDepth(depth);
  if (isReference(template)) return cloneJsonValue(resolveReference(template.path, context), depth);
  if (isBoundArray(template))
    return template.map((item) => resolveTemplate(item, context, depth + 1));
  if (isBoundObject(template))
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        resolveTemplate(value, context, depth + 1),
      ]),
    );
  return requireJsonScalar(template);
}

function resolveReference(path: readonly string[], context: WorkflowBindingContext): unknown {
  const input = isUnknownRecord(context.input) ? context.input : undefined;
  const roots: Record<string, unknown> = {
    input: context.input,
    nodes: context.outputs,
    outputs: context.outputs,
    errors: context.errors,
    loopCounts: context.loopCounts,
    ...(isUnknownRecord(input?.['context']) ? { context: input['context'] } : {}),
    evidence: mergedEvidence(input, context.outputs),
  };
  if (context.result !== undefined) roots['result'] = context.result;
  let current: unknown = roots;
  for (const [index, segment] of path.entries()) {
    if (isUnknownArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(segment) || Number(segment) >= current.length)
        throw missingReference(path, segment, index);
      current = current[Number(segment)];
      continue;
    }
    if (!isUnknownRecord(current) || !Object.hasOwn(current, segment))
      throw missingReference(path, segment, index);
    current = current[segment];
  }
  return current;
}

function mergedEvidence(
  input: Readonly<Record<string, unknown>> | undefined,
  outputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = isUnknownRecord(input?.['evidence'])
    ? { ...input['evidence'] }
    : {};
  for (const output of Object.values(outputs)) {
    const structured = structuredContent(output);
    if (isUnknownRecord(structured?.['evidence'])) Object.assign(merged, structured['evidence']);
    const metadata = resultMetadata(output);
    if (isUnknownRecord(metadata?.['io.sdar/evidence']))
      Object.assign(merged, metadata['io.sdar/evidence']);
  }
  return Object.freeze(merged);
}

function resultMetadata(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isUnknownRecord(value)) return undefined;
  if (isUnknownRecord(value['metadata'])) return value['metadata'];
  const data = value['data'];
  return isUnknownRecord(data) && isUnknownRecord(data['metadata']) ? data['metadata'] : undefined;
}

function structuredContent(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isUnknownRecord(value)) return undefined;
  if (isUnknownRecord(value['structuredContent'])) return value['structuredContent'];
  const data = value['data'];
  return isUnknownRecord(data) && isUnknownRecord(data['structuredContent'])
    ? data['structuredContent']
    : undefined;
}

function cloneJsonValue(value: unknown, depth: number): WorkflowBoundValue {
  assertBindingDepth(depth);
  if (isUnknownArray(value)) return value.map((item) => cloneJsonValue(item, depth + 1));
  if (isUnknownRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, depth + 1)]),
    );
  return requireJsonScalar(value);
}

function requireJsonScalar(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  throw new WorkflowBindingError(
    'WORKFLOW_BINDING_VALUE_INVALID',
    'Workflow binding resolved to a value that is not finite JSON data.',
  );
}

function isReference(value: WorkflowBoundValue): value is Readonly<{
  op: 'ref';
  path: readonly string[];
}> {
  if (!isUnknownRecord(value)) return false;
  const path = value.path;
  return (
    Object.keys(value).length === 2 &&
    value.op === 'ref' &&
    isStringArray(path) &&
    path.length > 0 &&
    path.every((segment) => /^[A-Za-z0-9_.-]+$/u.test(segment))
  );
}

function isBoundArray(value: WorkflowBoundValue): value is readonly WorkflowBoundValue[] {
  return Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function isBoundObject(value: WorkflowBoundValue): value is WorkflowBoundObject {
  return isUnknownRecord(value);
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function missingReference(
  path: readonly string[],
  segment: string,
  index: number,
): WorkflowBindingError {
  return new WorkflowBindingError(
    'WORKFLOW_BINDING_REFERENCE_MISSING',
    `Workflow binding reference ${path.join('.')} (${JSON.stringify(path)}) does not exist at segment ${String(index)} (${JSON.stringify(segment)}).`,
  );
}

function assertBindingDepth(depth: number): void {
  if (depth <= MAX_WORKFLOW_BINDING_DEPTH) return;
  throw new WorkflowBindingError(
    'WORKFLOW_BINDING_DEPTH_EXCEEDED',
    `Workflow binding exceeds the maximum depth of ${String(MAX_WORKFLOW_BINDING_DEPTH)}.`,
  );
}

function deepFreeze<T extends WorkflowBoundValue>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (isBoundArray(value)) {
      for (const item of value) deepFreeze(item);
    } else {
      for (const item of Object.values(value)) deepFreeze(item);
    }
  }
  return value;
}

export type WorkflowBindingErrorCode =
  | 'WORKFLOW_BINDING_REFERENCE_MISSING'
  | 'WORKFLOW_BINDING_VALUE_INVALID'
  | 'WORKFLOW_BINDING_DEPTH_EXCEEDED';

export class WorkflowBindingError extends Error {
  readonly code: WorkflowBindingErrorCode;

  constructor(code: WorkflowBindingErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowBindingError';
    this.code = code;
  }
}
