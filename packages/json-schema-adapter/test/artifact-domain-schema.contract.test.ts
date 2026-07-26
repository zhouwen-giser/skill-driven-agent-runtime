import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ArtifactLineageSchema,
  ArtifactRuntimeBindingSchema,
  CompiledArtifactSchema,
  ConditionExpressionSchema,
} from '../../schemas/src/index.js';
import {
  createCompiledArtifact,
  createConditionExpression,
  type CompiledArtifact,
  type ConditionExpression,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../src/index.js';

interface ArtifactFixture {
  artifacts: Record<string, unknown>[];
  lineage: Record<string, unknown>;
  runtimeBinding: Record<string, unknown>;
}

let schema: unknown;
let fixture: ArtifactFixture;
const validator = new AjvJsonSchemaValidator();

beforeAll(async () => {
  schema = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/artifact-domain.schema.json', import.meta.url),
      'utf8',
    ),
  ) as unknown;
  fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as ArtifactFixture;
});

describe('SDAR v1.3 Runtime Artifact cross-validator contract', () => {
  it('accepts the schema and five-definition golden fixture in AJV and Zod', () => {
    expect(validator.checkSchema(schema)).toEqual({ valid: true, errors: [] });
    expect(validator.validate(schema, fixture)).toEqual({ valid: true, errors: [] });
    expect(fixture.artifacts.map((item) => CompiledArtifactSchema.safeParse(item).success)).toEqual(
      [true, true, true, true, true],
    );
    expect(ArtifactLineageSchema.safeParse(fixture.lineage).success).toBe(true);
    expect(ArtifactRuntimeBindingSchema.safeParse(fixture.runtimeBinding).success).toBe(true);
  });

  it('rejects artifact-type/definition mismatch in both validators', () => {
    const artifacts = structuredClone(fixture.artifacts);
    artifacts[1] = { ...artifacts[1], artifactType: 'intent_route' };
    expect(validator.validate(schema, { ...fixture, artifacts }).valid).toBe(false);
    expect(CompiledArtifactSchema.safeParse(artifacts[1]).success).toBe(false);
  });

  it('rejects unknown fields and omitted frozen dependency fields', () => {
    const unknown = { ...fixture.artifacts[0], onlineExecutor: 'forbidden' };
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: [unknown, ...fixture.artifacts.slice(1)],
      }).valid,
    ).toBe(false);
    expect(CompiledArtifactSchema.safeParse(unknown).success).toBe(false);

    const missingDependency = structuredClone(fixture.artifacts[0]);
    const snapshot = missingDependency?.['dependencySnapshot'] as Record<string, unknown>;
    delete snapshot['requiredSkillVersionRefs'];
    expect(CompiledArtifactSchema.safeParse(missingDependency).success).toBe(false);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: [missingDependency, ...fixture.artifacts.slice(1)],
      }).valid,
    ).toBe(false);
  });

  it('rejects invalid and unconstrained condition shapes', () => {
    const invalid = {
      type: 'atomic',
      field: 'goal.confirmed',
      operator: 'exists',
      value: true,
    };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
    const artifacts = structuredClone(fixture.artifacts);
    const applicability = artifacts[0]?.['applicability'] as Record<string, unknown>;
    applicability['requiredConditions'] = [invalid];
    expect(validator.validate(schema, { ...fixture, artifacts }).valid).toBe(false);
  });

  it('uses the same expression-depth boundary in Domain, Zod and AJV', () => {
    const accepted = nestedCondition(12);
    expect(() =>
      createConditionExpression(accepted as unknown as ConditionExpression),
    ).not.toThrow();
    expect(ConditionExpressionSchema.safeParse(accepted).success).toBe(true);
    const acceptedArtifact = withRequiredCondition(getFixtureArtifact(0), accepted);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: replaceArtifact(fixture.artifacts, 0, acceptedArtifact),
      }).valid,
    ).toBe(true);

    const rejected = nestedCondition(13);
    expect(() => createConditionExpression(rejected as unknown as ConditionExpression)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_CONDITION_INVALID' }),
    );
    expect(ConditionExpressionSchema.safeParse(rejected).success).toBe(false);
    const rejectedArtifact = withRequiredCondition(getFixtureArtifact(0), rejected);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: replaceArtifact(fixture.artifacts, 0, rejectedArtifact),
      }).valid,
    ).toBe(false);
  });

  it('rejects over-depth JSON data consistently in Domain, Zod and AJV', () => {
    const artifact = structuredClone(getFixtureArtifact(1));
    const definition = artifact['definition'] as Record<string, unknown>;
    definition['parameterSchema'] = nestedJsonValue(20);
    expect(CompiledArtifactSchema.safeParse(artifact).success).toBe(false);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: replaceArtifact(fixture.artifacts, 1, artifact),
      }).valid,
    ).toBe(false);
    expect(() => createCompiledArtifact(artifact as unknown as CompiledArtifact)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_JSON_INVALID' }),
    );
  });

  it('rejects duplicate required parameters consistently in Domain, Zod and AJV', () => {
    const artifact = structuredClone(getFixtureArtifact(0));
    const applicability = artifact['applicability'] as Record<string, unknown>;
    applicability['requiredParameters'] = ['deviceId', 'deviceId'];
    expect(CompiledArtifactSchema.safeParse(artifact).success).toBe(false);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: replaceArtifact(fixture.artifacts, 0, artifact),
      }).valid,
    ).toBe(false);
    expect(() => createCompiledArtifact(artifact as unknown as CompiledArtifact)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );
  });

  it('rejects invalid OOD policy and extra applicability fields in every validator', () => {
    const artifact = structuredClone(getFixtureArtifact(0));
    const applicability = artifact['applicability'] as Record<string, unknown>;
    applicability['outOfDistributionPolicy'] = 'permit';
    applicability['onlineExecutor'] = true;
    expect(CompiledArtifactSchema.safeParse(artifact).success).toBe(false);
    expect(
      validator.validate(schema, {
        ...fixture,
        artifacts: replaceArtifact(fixture.artifacts, 0, artifact),
      }).valid,
    ).toBe(false);
    expect(() => createCompiledArtifact(artifact as unknown as CompiledArtifact)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );
  });

  it('rejects duplicate Case fingerprint identifiers in every validator', () => {
    const artifact = structuredClone(getFixtureArtifact(3));
    const definition = artifact['definition'] as Record<string, unknown>;
    const fingerprint = definition['problemFingerprint'] as Record<string, unknown>;
    fingerprint['entityClasses'] = ['device', 'device'];
    expectArtifactRejectedEverywhere(artifact, 3);
  });

  it('rejects both dependency-key and endpoint graph drift in every validator', () => {
    const duplicateKey = structuredClone(getFixtureArtifact(1));
    const duplicateKeyDependencies = planDependencies(duplicateKey);
    const original = duplicateKeyDependencies[0];
    if (original === undefined) throw new Error('Missing original dependency fixture.');
    duplicateKeyDependencies.push({
      dependencyKey: original['dependencyKey'],
      predecessorNodeKey: 'verify',
      successorNodeKey: 'observe',
      predicate: 'required',
    });
    expectArtifactRejectedEverywhere(duplicateKey, 1);

    const duplicateEndpoint = structuredClone(getFixtureArtifact(1));
    planDependencies(duplicateEndpoint).push({
      dependencyKey: 'dependency.observe.verify.duplicate',
      predecessorNodeKey: 'observe',
      successorNodeKey: 'verify',
      predicate: 'optional',
    });
    expectArtifactRejectedEverywhere(duplicateEndpoint, 1);
  });

  it('rejects Plan graph cycles, unknown endpoints and criterion cross-reference drift', () => {
    const cycle = structuredClone(getFixtureArtifact(1));
    planDependencies(cycle).push({
      dependencyKey: 'dependency.verify.observe',
      predecessorNodeKey: 'verify',
      successorNodeKey: 'observe',
      predicate: 'required',
    });
    expectArtifactRejectedEverywhere(cycle, 1);

    const unknownEndpoint = structuredClone(getFixtureArtifact(1));
    planDependencies(unknownEndpoint).push({
      dependencyKey: 'dependency.unknown.verify',
      predecessorNodeKey: 'unknown',
      successorNodeKey: 'verify',
      predicate: 'required',
    });
    expectArtifactRejectedEverywhere(unknownEndpoint, 1);

    const unknownCriterion = structuredClone(getFixtureArtifact(1));
    const definition = unknownCriterion['definition'] as Record<string, unknown>;
    const graph = definition['skillGoalGraph'] as Record<string, unknown>;
    const nodes = graph['nodes'] as Record<string, unknown>[];
    const node = nodes[0];
    if (node === undefined) throw new Error('Missing Plan node fixture.');
    node['coveredCriterionTemplateIds'] = ['criterion.unknown'];
    expectArtifactRejectedEverywhere(unknownCriterion, 1);
  });

  it('rejects non-boolean nested required fields in every validator', () => {
    const artifact = structuredClone(getFixtureArtifact(1));
    const definition = artifact['definition'] as Record<string, unknown>;
    const bindings = definition['parameterBindings'] as Record<string, unknown>[];
    const binding = bindings[0];
    if (binding === undefined) throw new Error('Missing parameter binding fixture.');
    binding['required'] = 'yes';
    expectArtifactRejectedEverywhere(artifact, 1);
  });
});

function nestedJsonValue(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

function nestedCondition(depth: number): Record<string, unknown> {
  let condition: Record<string, unknown> = {
    type: 'atomic',
    field: 'goal.confirmed',
    operator: 'exists',
  };
  for (let index = 0; index < depth; index += 1) condition = { type: 'not', child: condition };
  return condition;
}

function withRequiredCondition(
  source: Record<string, unknown>,
  condition: Record<string, unknown>,
): Record<string, unknown> {
  const artifact = structuredClone(source);
  const applicability = artifact['applicability'] as Record<string, unknown>;
  applicability['requiredConditions'] = [condition];
  return artifact;
}

function replaceArtifact(
  artifacts: readonly Record<string, unknown>[],
  index: number,
  replacement: Record<string, unknown>,
): Record<string, unknown>[] {
  return artifacts.map((artifact, artifactIndex) =>
    artifactIndex === index ? replacement : artifact,
  );
}

function getFixtureArtifact(index: number): Record<string, unknown> {
  const artifact = fixture.artifacts[index];
  if (artifact === undefined) throw new Error(`Missing fixture artifact ${String(index)}.`);
  return artifact;
}

function planDependencies(artifact: Record<string, unknown>): Record<string, unknown>[] {
  const definition = artifact['definition'] as Record<string, unknown>;
  const graph = definition['skillGoalGraph'] as Record<string, unknown>;
  return graph['dependencies'] as Record<string, unknown>[];
}

function expectArtifactRejectedEverywhere(artifact: Record<string, unknown>, index: number): void {
  expect(CompiledArtifactSchema.safeParse(artifact).success).toBe(false);
  expect(
    validator.validate(schema, {
      ...fixture,
      artifacts: replaceArtifact(fixture.artifacts, index, artifact),
    }).valid,
  ).toBe(false);
  expect(() => createCompiledArtifact(artifact as unknown as CompiledArtifact)).toThrow();
}
