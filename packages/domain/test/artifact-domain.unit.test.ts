import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ARTIFACT_CONTRACT_SCHEMA_HASHES,
  ARTIFACT_STATUS_TRANSITIONS,
  COMPILED_ARTIFACT_STATUSES,
  COMPILED_ARTIFACT_TYPES,
  canonicalizeArtifactData,
  createArtifactLineage,
  createArtifactRuntimeBinding,
  createCompiledArtifact,
  createConditionExpression,
  transitionCompiledArtifact,
  type ArtifactLineage,
  type ArtifactRuntimeBinding,
  type CompiledArtifact,
  type CompiledArtifactStatus,
} from '../src/index.js';

interface ArtifactFixture {
  artifacts: CompiledArtifact[];
  lineage: ArtifactLineage;
  runtimeBinding: ArtifactRuntimeBinding;
}

let fixture: ArtifactFixture;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as ArtifactFixture;
});

describe('SDAR v1.3 Runtime Artifact Domain', () => {
  it('freezes the complete type/status vocabularies and registry hashes', () => {
    expect(COMPILED_ARTIFACT_TYPES).toEqual([
      'intent_route',
      'plan_template',
      'decision_rule',
      'case_template',
      'model_route',
    ]);
    expect(COMPILED_ARTIFACT_STATUSES).toEqual([
      'discovered',
      'candidate',
      'validating',
      'awaiting_approval',
      'active',
      'revalidating',
      'deprecated',
      'archived',
      'rejected',
    ]);
    expect(Object.keys(ARTIFACT_CONTRACT_SCHEMA_HASHES)).toHaveLength(15);
    expect(ARTIFACT_CONTRACT_SCHEMA_HASHES.CompiledArtifact).toBe(
      '8afcafacad1085eb35d7b3fb0dd7715b05e7ff279f0d78b529a4b64fbe39bdcf',
    );
  });

  it('constructs all five exact definition variants as deeply immutable data', () => {
    const artifacts = fixture.artifacts.map((item) =>
      createCompiledArtifact(structuredClone(item)),
    );
    expect(artifacts.map((item) => item.artifactType)).toEqual(COMPILED_ARTIFACT_TYPES);
    for (const artifact of artifacts) {
      expect(Object.isFrozen(artifact)).toBe(true);
      expect(Object.isFrozen(artifact.definition)).toBe(true);
      expect(Object.isFrozen(artifact.applicability.requiredConditions)).toBe(true);
      expect(Object.isFrozen(artifact.dependencySnapshot)).toBe(true);
    }
  });

  it('rejects definition drift, unknown fields and unbounded executable-like data', () => {
    const plan = structuredClone(getFixtureArtifact(1));
    expect(() => createCompiledArtifact({ ...plan, artifactType: 'intent_route' })).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_DEFINITION_MISMATCH' }),
    );
    expect(() => createCompiledArtifact({ ...plan, runtime: 'second-runtime' } as never)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );
    expect(() =>
      createCompiledArtifact({
        ...plan,
        definition: {
          ...(plan.definition as unknown as Record<string, unknown>),
          parameterSchema: { transform: () => 'not data' },
        },
      } as never),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_JSON_INVALID' }));
  });

  it('validates bounded deterministic condition expressions and canonical JSON', () => {
    expect(
      createConditionExpression({
        type: 'all',
        children: [
          { type: 'atomic', field: 'goal.confirmed', operator: 'eq', value: true },
          {
            type: 'not',
            child: { type: 'atomic', field: 'risk.blocked', operator: 'exists' },
          },
        ],
      }),
    ).toEqual(expect.objectContaining({ type: 'all' }));
    expect(() =>
      createConditionExpression({
        type: 'atomic',
        field: 'goal.confirmed',
        operator: 'exists',
        value: true,
      } as never),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_CONDITION_INVALID' }));
    expect(canonicalizeArtifactData({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(canonicalizeArtifactData({ a: 1, b: 2 })).toBe(canonicalizeArtifactData({ b: 2, a: 1 }));
  });

  it('enforces immutable lifecycle transitions and activation evidence', () => {
    expect(Object.keys(ARTIFACT_STATUS_TRANSITIONS)).toEqual(COMPILED_ARTIFACT_STATUSES);
    const awaiting = createCompiledArtifact(structuredClone(getFixtureArtifact(1)));
    expect(() => createCompiledArtifact({ ...awaiting, status: 'active' })).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ACTIVATION_EVIDENCE_REQUIRED' }),
    );
    expect(() => transitionCompiledArtifact(awaiting, 'active')).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ACTIVATION_EVIDENCE_REQUIRED' }),
    );
    const active = transitionCompiledArtifact(awaiting, 'active', {
      validationPassed: true,
      approvalRecorded: true,
    });
    expect(active.status).toBe('active');
    expect(awaiting.status).toBe('awaiting_approval');
    expect(Object.isFrozen(active)).toBe(true);
    expect(() => transitionCompiledArtifact(active, 'candidate')).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_LIFECYCLE_TRANSITION_INVALID' }),
    );
    const revalidating = transitionCompiledArtifact(active, 'revalidating');
    expect(
      transitionCompiledArtifact(revalidating, 'active', {
        validationPassed: true,
        approvalRecorded: true,
      }).status,
    ).toBe('active');
  });

  it('accepts every declared transition and rejects every undeclared transition', () => {
    for (const fromStatus of COMPILED_ARTIFACT_STATUSES) {
      const artifact = artifactAtStatus(fromStatus);
      for (const toStatus of COMPILED_ARTIFACT_STATUSES) {
        if (ARTIFACT_STATUS_TRANSITIONS[fromStatus].includes(toStatus)) {
          const transitioned = transitionCompiledArtifact(
            artifact,
            toStatus,
            toStatus === 'active' ? { validationPassed: true, approvalRecorded: true } : undefined,
          );
          expect(transitioned.status).toBe(toStatus);
          expect(artifact.status).toBe(fromStatus);
        } else {
          expect(() => transitionCompiledArtifact(artifact, toStatus)).toThrow(
            expect.objectContaining({ code: 'ARTIFACT_LIFECYCLE_TRANSITION_INVALID' }),
          );
        }
      }
    }
  });

  it('rejects invalid nested enum values at direct domain construction boundaries', () => {
    const plan = structuredClone(getFixtureArtifact(1));
    const planDefinition = plan.definition as unknown as Record<string, unknown>;
    const graph = planDefinition['skillGoalGraph'] as {
      nodes: Record<string, unknown>[];
    };
    graph.nodes[0] = { ...graph.nodes[0], nodeType: 'online_executor' };
    expect(() => createCompiledArtifact(plan)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );

    const decision = structuredClone(getFixtureArtifact(2));
    const decisionDefinition = decision.definition as unknown as Record<string, unknown>;
    decisionDefinition['decision'] = {
      ...(decisionDefinition['decision'] as Record<string, unknown>),
      decisionType: 'execute_source',
    };
    expect(() => createCompiledArtifact(decision)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );

    const route = structuredClone(getFixtureArtifact(4));
    (route.definition as unknown as Record<string, unknown>)['route'] = 'second_runtime';
    expect(() => createCompiledArtifact(route)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_INVALID' }),
    );

    expect(() =>
      createArtifactLineage({
        ...structuredClone(fixture.lineage),
        generationMethods: ['runtime_code_generation'],
      } as never),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_INVALID' }));
  });

  it('keeps lineage authoritative and runtime binding rebuildable and immutable', () => {
    const lineage = createArtifactLineage(structuredClone(fixture.lineage));
    const binding = createArtifactRuntimeBinding(structuredClone(fixture.runtimeBinding));
    expect(lineage.artifactId).toBe(binding.artifactId);
    expect(lineage.artifactVersion).toBe(binding.artifactVersion);
    expect(Object.isFrozen(lineage.sourceEpisodeRefs)).toBe(true);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(() =>
      createArtifactRuntimeBinding({
        ...binding,
        compiledPayloadHash: 'not-a-hash',
      }),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_INVALID' }));
  });
});

function getFixtureArtifact(index: number): CompiledArtifact {
  const artifact = fixture.artifacts[index];
  if (artifact === undefined)
    throw new Error(`Missing artifact fixture at index ${String(index)}.`);
  return artifact;
}

function artifactAtStatus(status: CompiledArtifactStatus): CompiledArtifact {
  const input = {
    ...structuredClone(getFixtureArtifact(1)),
    status,
  };
  return createCompiledArtifact(
    input,
    status === 'active' ? { validationPassed: true, approvalRecorded: true } : undefined,
  );
}
