import type {
  ArtifactApplicability,
  ArtifactDependencySnapshot,
  ArtifactRiskLevel,
  CapabilityRequirement,
  CompiledArtifactDefinition,
  CompiledArtifactType,
  ConditionExpression,
  JsonValue,
  PolicyReference,
} from './contracts.js';
import { ArtifactDomainError } from './errors.js';

export const ARTIFACT_DATA_LIMITS = Object.freeze({
  maxDepth: 12,
  maxArrayItems: 256,
  maxObjectProperties: 128,
  maxStringLength: 65_536,
  maxConditionNodes: 256,
} as const);

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/u;
const hashPattern = /^sha256:[0-9a-f]{64}$/u;

export function assertArtifactIdentifier(value: string, field: string): void {
  if (!identifierPattern.test(value)) {
    invalid('ARTIFACT_INVALID', `${field} must be a stable identifier.`, field);
  }
}

export function assertArtifactText(value: string, field: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > ARTIFACT_DATA_LIMITS.maxStringLength
  ) {
    invalid('ARTIFACT_INVALID', `${field} must be bounded text.`, field);
  }
}

export function assertArtifactVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid('ARTIFACT_INVALID', `${field} must be a positive safe integer.`, field);
  }
}

export function assertArtifactTimestamp(value: string, field: string): void {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalid('ARTIFACT_INVALID', `${field} must be an RFC 3339 timestamp.`, field);
  }
}

export function assertArtifactHash(value: string, field: string): void {
  if (!hashPattern.test(value)) {
    invalid('ARTIFACT_INVALID', `${field} must be a sha256 hash.`, field);
  }
}

export function assertProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid('ARTIFACT_INVALID', `${field} must be between zero and one.`, field);
  }
}

export function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    invalid('ARTIFACT_INVALID', `${field} must be finite and non-negative.`, field);
  }
}

export function assertBoundedJson(value: unknown, field = 'value'): void {
  const ancestors = new Set<object>();
  visit(value, field, 0);

  function visit(current: unknown, path: string, depth: number): void {
    if (depth > ARTIFACT_DATA_LIMITS.maxDepth) {
      invalid('ARTIFACT_JSON_INVALID', `${path} exceeds the JSON depth limit.`, field);
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > ARTIFACT_DATA_LIMITS.maxStringLength) {
        invalid('ARTIFACT_JSON_INVALID', `${path} exceeds the string limit.`, field);
      }
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        invalid('ARTIFACT_JSON_INVALID', `${path} contains a non-finite number.`, field);
      }
      return;
    }
    if (typeof current !== 'object') {
      invalid('ARTIFACT_JSON_INVALID', `${path} is not JSON data.`, field);
    }
    if (ancestors.has(current)) {
      invalid('ARTIFACT_JSON_INVALID', `${path} contains a cycle.`, field);
    }
    ancestors.add(current);
    if (isJsonArray(current)) {
      if (current.length > ARTIFACT_DATA_LIMITS.maxArrayItems) {
        invalid('ARTIFACT_JSON_INVALID', `${path} exceeds the array limit.`, field);
      }
      current.forEach((item, index) => {
        visit(item, `${path}[${String(index)}]`, depth + 1);
      });
    } else {
      const objectValue = current as Readonly<Record<string, unknown>>;
      const prototype = Reflect.getPrototypeOf(objectValue);
      if (prototype !== Object.prototype && prototype !== null) {
        invalid('ARTIFACT_JSON_INVALID', `${path} must be a plain JSON object.`, field);
      }
      const entries = Object.entries(objectValue);
      if (entries.length > ARTIFACT_DATA_LIMITS.maxObjectProperties) {
        invalid('ARTIFACT_JSON_INVALID', `${path} exceeds the object member limit.`, field);
      }
      for (const [key, item] of entries) {
        if (
          key.length === 0 ||
          key.length > 128 ||
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype'
        ) {
          invalid('ARTIFACT_JSON_INVALID', `${path} contains an unsafe key.`, field);
        }
        visit(item, `${path}.${key}`, depth + 1);
      }
    }
    ancestors.delete(current);
  }
}

export function assertConditionExpression(
  expression: ConditionExpression,
  field = 'condition',
): void {
  let nodes = 0;
  visit(expression, 0);

  function visit(current: unknown, depth: number): void {
    nodes += 1;
    if (nodes > ARTIFACT_DATA_LIMITS.maxConditionNodes || depth > ARTIFACT_DATA_LIMITS.maxDepth) {
      conditionInvalid(`${field} exceeds its bounded complexity.`);
    }
    if (!isRecord(current)) {
      conditionInvalid(`${field} must be a plain expression object.`);
    }
    const keys = Object.keys(current);
    const type = current['type'];
    if (type === 'all' || type === 'any') {
      const children = current['children'];
      if (
        keys.some((key) => key !== 'type' && key !== 'children') ||
        !Array.isArray(children) ||
        children.length === 0 ||
        children.length > ARTIFACT_DATA_LIMITS.maxArrayItems
      ) {
        conditionInvalid(`${field}.${type} requires only non-empty children.`);
      }
      children.forEach((child) => {
        visit(child, depth + 1);
      });
      return;
    }
    if (type === 'not') {
      const child = current['child'];
      if (keys.some((key) => key !== 'type' && key !== 'child') || child === undefined) {
        conditionInvalid(`${field}.not requires exactly one child.`);
      }
      visit(child, depth + 1);
      return;
    }
    if (type !== 'atomic') {
      conditionInvalid(`${field} has an unknown expression type.`);
    }
    if (keys.some((key) => !['type', 'field', 'operator', 'value'].includes(key))) {
      conditionInvalid(`${field}.atomic contains an unknown field.`);
    }
    const atomicField = current['field'];
    const operator = current['operator'];
    if (typeof atomicField !== 'string') {
      conditionInvalid(`${field}.atomic requires a string field.`);
    }
    if (
      typeof operator !== 'string' ||
      !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists'].includes(operator)
    ) {
      conditionInvalid(`${field}.atomic has an invalid operator.`);
    }
    assertArtifactIdentifier(atomicField, `${field}.field`);
    if (operator === 'exists') {
      if ('value' in current) conditionInvalid(`${field}.exists cannot carry a value.`);
    } else if (!('value' in current)) {
      conditionInvalid(`${field}.${operator} requires a value.`);
    } else {
      assertBoundedJson(current['value'], `${field}.value`);
    }
  }
}

export function assertArtifactApplicability(value: ArtifactApplicability): void {
  for (const [field, conditions] of [
    ['requiredConditions', value.requiredConditions],
    ['optionalConditions', value.optionalConditions],
    ['forbiddenConditions', value.forbiddenConditions],
  ] as const) {
    assertArrayLimit(conditions, field);
    conditions.forEach((condition) => {
      assertConditionExpression(condition, field);
    });
  }
  for (const [field, values] of [
    ['requiredParameters', value.requiredParameters],
    ['allowedEnvironmentClasses', value.allowedEnvironmentClasses],
    ['excludedEnvironmentClasses', value.excludedEnvironmentClasses],
  ] as const) {
    assertUniqueIdentifiers(values, field);
  }
  const overlap = value.allowedEnvironmentClasses.find((item) =>
    value.excludedEnvironmentClasses.includes(item),
  );
  if (overlap !== undefined) {
    invalid(
      'ARTIFACT_INVALID',
      'Allowed and excluded environment classes must be disjoint.',
      'applicability',
    );
  }
  assertProbability(value.minimumIntentScore, 'minimumIntentScore');
  assertProbability(value.minimumConditionScore, 'minimumConditionScore');
  assertProbability(value.maximumUncertainty, 'maximumUncertainty');
  if (
    !['fallback_reasoning', 'require_confirmation', 'deny'].includes(value.outOfDistributionPolicy)
  ) {
    invalid('ARTIFACT_INVALID', 'outOfDistributionPolicy is invalid.', 'outOfDistributionPolicy');
  }
}

export function assertDependencySnapshot(value: ArtifactDependencySnapshot): void {
  assertArtifactHash(value.capabilityCatalogHash, 'capabilityCatalogHash');
  assertUniqueIdentifiers(value.policyVersionRefs, 'policyVersionRefs');
  assertUniqueIdentifiers(value.taskTypeVersionRefs, 'taskTypeVersionRefs');
  assertUniqueIdentifiers(value.schemaVersionRefs, 'schemaVersionRefs');
  assertUniqueIdentifiers(value.requiredSkillVersionRefs, 'requiredSkillVersionRefs');
  assertArtifactIdentifier(value.compilerVersion, 'compilerVersion');
}

export function assertCapabilityRequirements(
  requirements: readonly CapabilityRequirement[],
  field: string,
): void {
  assertArrayLimit(requirements, field);
  const identifiers = requirements.map((item) => item.capabilityId);
  assertUniqueIdentifiers(identifiers, field);
  requirements.forEach((item) => {
    assertRecordKeys(item, ['capabilityId', 'minimumVersion'], ['minimumVersion'], `${field}.item`);
    if (item.minimumVersion !== undefined) {
      assertArtifactIdentifier(item.minimumVersion, `${field}.minimumVersion`);
    }
  });
}

export function assertPolicyReferences(policies: readonly PolicyReference[], field: string): void {
  assertArrayLimit(policies, field);
  const identifiers = policies.map((item) => `${item.policyId}@${item.version}`);
  assertUniqueIdentifiers(identifiers, field);
  policies.forEach((item) => {
    assertRecordKeys(item, ['policyId', 'version'], [], `${field}.item`);
    assertArtifactIdentifier(item.policyId, `${field}.policyId`);
    assertArtifactIdentifier(item.version, `${field}.version`);
  });
}

export function assertDefinitionMatchesType(
  artifactType: CompiledArtifactType,
  definition: CompiledArtifactDefinition,
): void {
  const signature: Record<CompiledArtifactType, string> = {
    intent_route: 'taskTypeId',
    plan_template: 'goalPattern',
    decision_rule: 'category',
    case_template: 'problemFingerprint',
    model_route: 'route',
  };
  const matching = Object.entries(signature)
    .filter(([, property]) => property in definition)
    .map(([type]) => type);
  if (matching.length !== 1 || matching[0] !== artifactType) {
    throw new ArtifactDomainError(
      'ARTIFACT_DEFINITION_MISMATCH',
      'Artifact type must match exactly one definition variant.',
      { artifactType, matching: matching.join(',') },
    );
  }
}

export function assertArtifactRiskLevel(value: ArtifactRiskLevel): void {
  if (!['low', 'medium', 'high', 'critical'].includes(value)) {
    invalid('ARTIFACT_INVALID', 'riskLevel is invalid.', 'riskLevel');
  }
}

export function assertArrayLimit(value: readonly unknown[], field: string, minimum = 0): void {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > ARTIFACT_DATA_LIMITS.maxArrayItems
  ) {
    invalid('ARTIFACT_INVALID', `${field} exceeds its array bounds.`, field);
  }
}

export function assertUniqueIdentifiers(values: readonly string[], field: string): void {
  assertArrayLimit(values, field);
  values.forEach((value) => {
    assertArtifactIdentifier(value, field);
  });
  if (new Set(values).size !== values.length) {
    invalid('ARTIFACT_INVALID', `${field} must not contain duplicates.`, field);
  }
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function canonicalizeArtifactData(value: JsonValue): string {
  assertBoundedJson(value);
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map((item) => serialize(item)).join(',')}]`;
  const objectValue = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => {
      const child = objectValue[key];
      if (child === undefined) {
        invalid('ARTIFACT_JSON_INVALID', 'Canonical JSON cannot contain undefined.', key);
      }
      return `${JSON.stringify(key)}:${serialize(child)}`;
    })
    .join(',')}}`;
}

function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecordKeys(
  value: object,
  allowed: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  const keys = Object.keys(value);
  const required = allowed.filter((key) => !optional.includes(key));
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    invalid('ARTIFACT_INVALID', `${field} fields do not match the contract.`, field);
  }
}

function conditionInvalid(message: string): never {
  throw new ArtifactDomainError('ARTIFACT_CONDITION_INVALID', message);
}

function invalid(
  code: 'ARTIFACT_INVALID' | 'ARTIFACT_JSON_INVALID',
  message: string,
  field: string,
): never {
  throw new ArtifactDomainError(code, message, { field });
}
