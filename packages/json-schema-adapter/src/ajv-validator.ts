import { Ajv } from 'ajv/dist/ajv.js';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { z } from 'zod';

import {
  ResultProcessingError,
  type JsonSchemaValidationResult,
  type JsonSchemaValidator,
} from '../../application/src/index.js';

const JsonSchemaInput = z.union([z.boolean(), z.record(z.string(), z.unknown())]);

export class AjvJsonSchemaValidator implements JsonSchemaValidator {
  readonly #ajv2020: Ajv2020;
  readonly #ajvDraft7: Ajv;

  constructor(options: Readonly<{ strict?: boolean }> = {}) {
    const strict = options.strict ?? true;
    this.#ajv2020 = new Ajv2020({
      strict,
      allowUnionTypes: true,
      allErrors: true,
      validateSchema: true,
    });
    this.#ajvDraft7 = new Ajv({
      strict,
      allowUnionTypes: true,
      allErrors: true,
      validateSchema: true,
    });
    for (const ajv of [this.#ajv2020, this.#ajvDraft7]) {
      ajv.addKeyword({
        keyword: 'x-sdar-max-depth',
        schemaType: 'number',
        errors: false,
        validate: validateMaximumDepth,
      });
      ajv.addKeyword({
        keyword: 'x-sdar-max-condition-depth',
        schemaType: 'number',
        errors: false,
        validate: validateMaximumConditionDepth,
      });
      ajv.addKeyword({
        keyword: 'x-sdar-max-condition-nodes',
        schemaType: 'number',
        errors: false,
        validate: validateMaximumConditionNodes,
      });
      ajv.addKeyword({
        keyword: 'x-sdar-unique-key',
        schemaType: 'string',
        type: 'array',
        errors: false,
        validate: validateUniqueKey,
      });
      ajv.addKeyword({
        keyword: 'x-sdar-valid-plan-template',
        schemaType: 'boolean',
        type: 'object',
        errors: false,
        validate: validatePlanTemplate,
      });
      ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
      ajv.addFormat(
        'date-time',
        (value: string) =>
          /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) && Number.isFinite(Date.parse(value)),
      );
    }
  }

  checkSchema(schema: unknown): JsonSchemaValidationResult {
    try {
      this.#compile(schema);
      return { valid: true, errors: [] };
    } catch (error: unknown) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown schema compilation error.'],
      };
    }
  }

  validate(schema: unknown, value: unknown): JsonSchemaValidationResult {
    const validate = this.#compile(schema);
    const valid = validate(value);
    return { valid, errors: valid ? [] : summarizeErrors(validate.errors ?? []) };
  }

  #compile(schema: unknown): ValidateFunction {
    const parsedSchema = JsonSchemaInput.safeParse(schema);
    if (!parsedSchema.success) {
      throw new ResultProcessingError(
        'RESULT_SCHEMA_INVALID',
        'Skill output schema must be a JSON object or boolean schema.',
      );
    }
    try {
      const dialect = schemaDialect(parsedSchema.data);
      if (dialect === 'unsupported') throw new Error('Unsupported JSON Schema dialect.');
      const ajv = dialect === 'draft7' ? this.#ajvDraft7 : this.#ajv2020;
      const identifier =
        typeof parsedSchema.data === 'boolean' ? undefined : parsedSchema.data['$id'];
      const cached = typeof identifier === 'string' ? ajv.getSchema(identifier) : undefined;
      return cached ?? ajv.compile(parsedSchema.data);
    } catch (error: unknown) {
      throw new ResultProcessingError('RESULT_SCHEMA_INVALID', 'Skill output schema is invalid.', [
        error instanceof Error ? error.message : 'Unknown schema compilation error.',
      ]);
    }
  }
}

function schemaDialect(
  schema: boolean | Record<string, unknown>,
): 'draft7' | 'default' | 'unsupported' {
  if (typeof schema === 'boolean') return 'default';
  const identifier = schema['$schema'];
  if (identifier === undefined) return 'default';
  if (identifier === 'http://json-schema.org/draft-07/schema#') return 'draft7';
  if (identifier === 'https://json-schema.org/draft/2020-12/schema') return 'default';
  return 'unsupported';
}

function summarizeErrors(errors: readonly ErrorObject[]): readonly string[] {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

function validateMaximumDepth(limit: number, value: unknown): boolean {
  return treeDepth(value) <= limit;
}

function validateMaximumConditionNodes(limit: number, value: unknown): boolean {
  return conditionNodeCount(value) <= limit;
}

function validateMaximumConditionDepth(limit: number, value: unknown): boolean {
  return conditionDepth(value) <= limit;
}

function validateUniqueKey(key: string, value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  const keys = value.map((item) =>
    isRecord(item) && typeof item[key] === 'string' ? item[key] : undefined,
  );
  return keys.every((item) => item !== undefined) && new Set(keys).size === keys.length;
}

function validatePlanTemplate(enabled: boolean, value: unknown): boolean {
  if (!enabled) return true;
  if (!isRecord(value)) return false;
  const goalPattern = value['goalPattern'];
  const completion = value['completionContractTemplate'];
  const graph = value['skillGoalGraph'];
  if (!isRecord(goalPattern) || !isRecord(completion) || !isRecord(graph)) return false;
  const criterionIds = objectStringFieldValues(
    goalPattern['criterionTemplates'],
    'criterionTemplateId',
  );
  const completionCriterionIds = objectStringFieldValues(
    completion['criteria'],
    'criterionTemplateId',
  );
  const nodes = graph['nodes'];
  const dependencies = graph['dependencies'];
  if (
    criterionIds === undefined ||
    completionCriterionIds === undefined ||
    !Array.isArray(nodes) ||
    !Array.isArray(dependencies)
  ) {
    return false;
  }
  const criterionSet = new Set(criterionIds);
  if (completionCriterionIds.some((criterionId) => !criterionSet.has(criterionId))) return false;

  const nodeKeys = objectStringFieldValues(nodes, 'nodeKey');
  if (!hasUniqueValues(nodeKeys)) return false;
  const nodeKeySet = new Set(nodeKeys);
  for (const node of nodes as unknown[]) {
    if (!isRecord(node) || !isStringArray(node['coveredCriterionTemplateIds'])) return false;
    if (node['coveredCriterionTemplateIds'].some((criterionId) => !criterionSet.has(criterionId))) {
      return false;
    }
  }

  const dependencyKeys = objectStringFieldValues(dependencies, 'dependencyKey');
  if (!hasUniqueValues(dependencyKeys)) return false;
  const endpointPairs = new Set<string>();
  const outgoing = new Map(nodeKeys.map((nodeKey) => [nodeKey, [] as string[]]));
  for (const dependency of dependencies as unknown[]) {
    if (!isRecord(dependency)) return false;
    const predecessor = dependency['predecessorNodeKey'];
    const successor = dependency['successorNodeKey'];
    if (
      typeof predecessor !== 'string' ||
      typeof successor !== 'string' ||
      predecessor === successor ||
      !nodeKeySet.has(predecessor) ||
      !nodeKeySet.has(successor)
    ) {
      return false;
    }
    const endpointPair = `${predecessor}->${successor}`;
    if (endpointPairs.has(endpointPair)) return false;
    endpointPairs.add(endpointPair);
    outgoing.get(predecessor)?.push(successor);
  }
  return isDirectedAcyclicGraph(nodeKeys, outgoing);
}

function treeDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(treeDepth));
}

function conditionNodeCount(value: unknown): number {
  if (!isRecord(value)) return 0;
  if (value['type'] === 'all' || value['type'] === 'any') {
    const children = value['children'];
    if (!Array.isArray(children)) return 1;
    let count = 1;
    for (const child of children as unknown[]) count += conditionNodeCount(child);
    return count;
  }
  if (value['type'] === 'not') return 1 + conditionNodeCount(value['child']);
  return value['type'] === 'atomic' ? 1 : 0;
}

function conditionDepth(value: unknown): number {
  if (!isRecord(value)) return 0;
  if (value['type'] === 'all' || value['type'] === 'any') {
    const children = value['children'];
    return Array.isArray(children) && children.length > 0
      ? 1 + Math.max(...(children as unknown[]).map(conditionDepth))
      : 0;
  }
  return value['type'] === 'not' ? 1 + conditionDepth(value['child']) : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectStringFieldValues(value: unknown, field: string): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item) || typeof item[field] !== 'string') return undefined;
    result.push(item[field]);
  }
  return result;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && (value as unknown[]).every((item) => typeof item === 'string');
}

function hasUniqueValues(values: string[] | undefined): values is string[] {
  return values?.length === new Set(values ?? []).size;
}

function isDirectedAcyclicGraph(
  nodeKeys: readonly string[],
  outgoing: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeKey: string): boolean => {
    if (visiting.has(nodeKey)) return false;
    if (visited.has(nodeKey)) return true;
    visiting.add(nodeKey);
    for (const successor of outgoing.get(nodeKey) ?? []) {
      if (!visit(successor)) return false;
    }
    visiting.delete(nodeKey);
    visited.add(nodeKey);
    return true;
  };
  return nodeKeys.every(visit);
}
