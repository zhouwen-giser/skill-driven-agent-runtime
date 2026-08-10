import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  RUNTIME_SOURCE_ARTIFACT_MAX_BYTES,
  RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH,
  SourceArtifactRefError,
  buildRuntimeSourceArtifact,
  canonicalizeSourceArtifactJson,
  parseRuntimeSourceArtifactUri,
  validateRuntimeSourceArtifactRef,
} from '../src/index.js';

describe('Runtime source ArtifactRef', () => {
  it('derives canonical bytes, SHA-256 and byte size from the same byte domain', () => {
    const first = buildRuntimeSourceArtifact({
      sourceTable: 'compiled_artifact',
      sourceRecordId: 'artifact-汉字',
      sourceVersion: 12,
      value: { z: '汉字', a: { second: 2, first: 1 } },
    });
    const second = buildRuntimeSourceArtifact({
      sourceTable: 'compiled_artifact',
      sourceRecordId: 'artifact-汉字',
      sourceVersion: 12,
      value: { a: { first: 1, second: 2 }, z: '汉字' },
    });

    expect(first.canonicalJson).toBe('{"a":{"first":1,"second":2},"z":"汉字"}');
    expect(Buffer.from(first.canonicalBytes).toString('utf8')).toBe(first.canonicalJson);
    expect(first.artifactRef.byteSize).toBe(first.canonicalBytes.byteLength);
    expect(first.artifactRef.sha256).toBe(
      `sha256:${createHash('sha256').update(first.canonicalBytes).digest('hex')}`,
    );
    expect(second.artifactRef).toEqual(first.artifactRef);
    expect(first.artifactRef.uri).toBe(
      'artifact://runtime/v1/compiled_artifact/artifact-%E6%B1%89%E5%AD%97/12/definition/artifact/definition',
    );
  });

  it.each([
    {
      sourceTable: 'compiled_artifact' as const,
      sourceRecordId: 'artifact-a',
      sourceVersion: 3,
      fieldPath: 'definition.artifact.definition',
      uri: 'artifact://runtime/v1/compiled_artifact/artifact-a/3/definition/artifact/definition',
    },
    {
      sourceTable: 'replay_dataset_manifest' as const,
      sourceRecordId: 'dataset-a',
      sourceVersion: 7,
      fieldPath: 'content',
      uri: 'artifact://runtime/v1/replay_dataset_manifest/dataset-a/7/content',
    },
    {
      sourceTable: 'artifact_replay_case' as const,
      sourceRecordId: 'case-a',
      sourceVersion: 1,
      fieldPath: 'content',
      uri: 'artifact://runtime/v1/artifact_replay_case/case-a/1/content',
    },
    {
      sourceTable: 'pattern_candidate' as const,
      sourceRecordId: 'pattern-a',
      sourceVersion: 1,
      fieldPath: 'definition',
      uri: 'artifact://runtime/v1/pattern_candidate/pattern-a/1/definition',
    },
  ])('round-trips the exact $sourceTable field route', (fixture) => {
    const built = buildRuntimeSourceArtifact({
      sourceTable: fixture.sourceTable,
      sourceRecordId: fixture.sourceRecordId,
      sourceVersion: fixture.sourceVersion,
      value: { payload: true },
    });

    expect(built.artifactRef.uri).toBe(fixture.uri);
    expect(parseRuntimeSourceArtifactUri(fixture.uri)).toEqual({
      authority: 'runtime',
      sourceTable: fixture.sourceTable,
      sourceRecordId: fixture.sourceRecordId,
      sourceVersion: fixture.sourceVersion,
      fieldPath: fixture.fieldPath,
    });
    expect(validateRuntimeSourceArtifactRef(built.artifactRef)).toEqual(built.address);
  });

  it.each([
    'artifact://node_control/v1/compiled_artifact/a/1/definition/artifact/definition',
    'artifact://runtime/v1/unknown_table/a/1/content',
    'artifact://runtime/v1/compiled_artifact/../1/definition/artifact/definition',
    'artifact://runtime/v1/compiled_artifact/%2E%2E/1/definition/artifact/definition',
    'artifact://runtime/v1/compiled_artifact/a%2Fb/1/definition/artifact/definition',
    'artifact://runtime/v1/compiled_artifact/a/1/definition/other/definition',
    'artifact://runtime/v1/replay_dataset_manifest/a/0/content',
    'artifact://runtime/v1/replay_dataset_manifest/a/01/content',
    'artifact://runtime/v1/replay_dataset_manifest/a/2147483648/content',
    'artifact://runtime/v1/artifact_replay_case/a/2/content',
    'artifact://runtime/v1/artifact_replay_case/a/1/content?field=other',
    'artifact://runtime/v1/pattern_candidate/a/2/definition',
    'artifact://runtime/v1/pattern_candidate/%2E%2E/1/definition',
    'artifact://runtime/v1/pattern_candidate/a%2Fb/1/definition',
    'artifact://runtime/v1/pattern_candidate/a/1/content',
    'artifact://runtime/v1/pattern_candidate/a/1/definition/child',
    'artifact://runtime/v1/pattern_candidate/a/1/definition?pointer=%2Fvariants',
  ])('rejects non-authoritative, traversing, unknown or non-canonical URI %s', (uri) => {
    expect(() => parseRuntimeSourceArtifactUri(uri)).toThrow(
      expect.objectContaining({ code: 'SOURCE_ARTIFACT_URI_INVALID' }),
    );
  });

  it('rejects oversized URIs and invalid or oversized ArtifactRef metadata', () => {
    expect(() =>
      parseRuntimeSourceArtifactUri(`artifact://runtime/v1/${'x'.repeat(4096)}`),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_ARTIFACT_URI_INVALID' }));
    const built = buildRuntimeSourceArtifact({
      sourceTable: 'replay_dataset_manifest',
      sourceRecordId: 'dataset-a',
      sourceVersion: 1,
      value: { cases: [] },
    });
    expect(() =>
      validateRuntimeSourceArtifactRef({
        ...built.artifactRef,
        byteSize: RUNTIME_SOURCE_ARTIFACT_MAX_BYTES + 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_ARTIFACT_ADDRESS_INVALID' }));
    expect(() =>
      validateRuntimeSourceArtifactRef({
        ...built.artifactRef,
        sha256: `sha256:${'A'.repeat(64)}`,
      }),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_ARTIFACT_ADDRESS_INVALID' }));
    expect(built.artifactRef.uri.length).toBeLessThanOrEqual(
      RUNTIME_SOURCE_ARTIFACT_MAX_URI_LENGTH,
    );
  });

  it('rejects values that are not strict finite, acyclic JSON', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const sparse = Array.from({ length: 2 });
    sparse[1] = 'present';

    for (const value of [cyclic, sparse, { number: Number.NaN }]) {
      expect(() => canonicalizeSourceArtifactJson(value as never)).toThrow(SourceArtifactRefError);
    }
  });
});
