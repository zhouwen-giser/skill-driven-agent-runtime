import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_MAX_CANONICAL_BYTES,
  EVIDENCE_RECORD_CATALOG,
  EvidenceContractError,
  assertEvidencePayloadIdentity,
  canonicalizeEvidenceJson,
  createCanonicalEvidenceEnvelope,
  createEvidenceRecordId,
  getEvidenceCatalogEntry,
  hashCanonicalEvidenceJson,
  isEvidenceRecordId,
  isEvidenceSha256,
} from '../src/index.js';

const identity = {
  sourceSystem: 'runtime' as const,
  sourceTable: 'goal',
  sourceRecordId: 'goal-1:1',
  sourceRevision: '1:sha256:source',
  schemaName: 'sdar.evidence.runtime.goal',
  schemaVersion: 1,
};

function envelope(payload: Readonly<Record<string, string>> = { goalId: 'goal-1' }) {
  return createCanonicalEvidenceEnvelope({
    ...identity,
    recordFamily: 'runtime',
    recordType: 'runtime.goal',
    environment: 'test',
    correlationId: 'correlation-1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    recordedAt: '2026-08-04T00:00:01.000Z',
    deliveryGuarantee: 'transactional',
    evaluationRole: 'required',
    evidenceRefs: ['runtime.episode:evidence_1'],
    artifactRefs: [],
    payload,
  });
}

describe('canonical evidence Domain', () => {
  it('freezes exactly 100 typed catalog entries with real schema hashes', () => {
    expect(EVIDENCE_RECORD_CATALOG).toHaveLength(100);
    expect(new Set(EVIDENCE_RECORD_CATALOG.map((entry) => entry.recordType)).size).toBe(100);
    expect(EVIDENCE_RECORD_CATALOG.every((entry) => isEvidenceSha256(entry.schemaHash))).toBe(true);
    expect(EVIDENCE_RECORD_CATALOG.every((entry) => entry.requiredPayloadFields.length >= 2)).toBe(
      true,
    );
    expect(getEvidenceCatalogEntry('runtime.goal').sourceTable).toBe('goal');
    expect(() => getEvidenceCatalogEntry('unknown.record')).toThrow('EVIDENCE_RECORD_TYPE_UNKNOWN');
  });

  it('canonicalizes object keys and hashes deterministically', () => {
    const first = { z: [3, 2, 1], a: { y: true, x: 'value' } };
    const second = { a: { x: 'value', y: true }, z: [3, 2, 1] };
    expect(canonicalizeEvidenceJson(first)).toBe(canonicalizeEvidenceJson(second));
    expect(hashCanonicalEvidenceJson(first)).toBe(hashCanonicalEvidenceJson(second));
    expect(hashCanonicalEvidenceJson(first)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('derives stable record identity only from source and schema identity', () => {
    const first = createEvidenceRecordId(identity);
    const second = createEvidenceRecordId({ ...identity });
    expect(first).toBe(second);
    expect(isEvidenceRecordId(first)).toBe(true);
    expect(createEvidenceRecordId({ ...identity, sourceRevision: '2:sha256:source' })).not.toBe(
      first,
    );
  });

  it('builds a frozen envelope and detects same-ID payload conflicts', () => {
    const first = envelope({ goalId: 'goal-1', status: 'active' });
    const replay = envelope({ status: 'active', goalId: 'goal-1' });
    const conflict = envelope({ goalId: 'goal-1', status: 'achieved' });
    expect(first).toEqual(replay);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      assertEvidencePayloadIdentity(first, replay);
    }).not.toThrow();
    expect(() => {
      assertEvidencePayloadIdentity(first, conflict);
    }).toThrow(expect.objectContaining({ code: 'EVIDENCE_PAYLOAD_CONFLICT' }));
  });

  it.each([
    [{ credentialValue: 'inline-value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ access_token: 'inline-value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ Authorization: 'Bearer value' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ chainOfThought: 'private' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ private_reasoning: 'private' }, 'EVIDENCE_FORBIDDEN_FIELD'],
    [{ score: Number.NaN }, 'EVIDENCE_JSON_VALUE_INVALID'],
    [{ score: Number.POSITIVE_INFINITY }, 'EVIDENCE_JSON_VALUE_INVALID'],
  ])('rejects unsafe payload %#', (payload, code) => {
    expect(() => canonicalizeEvidenceJson(payload)).toThrow(expect.objectContaining({ code }));
  });

  it('permits opaque credential references while rejecting inline credential material', () => {
    expect(() =>
      canonicalizeEvidenceJson({ credentialRef: 'secret://evidence-sink' }),
    ).not.toThrow();
    expect(() =>
      canonicalizeEvidenceJson({ sinkSecretRef: 'secret://evidence-sink' }),
    ).not.toThrow();
  });

  it('rejects cycles, excessive depth, excessive bytes and duplicate references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalizeEvidenceJson(cyclic)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_CYCLE' }),
    );

    let deep: unknown = 'leaf';
    for (let index = 0; index < 34; index += 1) deep = { child: deep };
    expect(() => canonicalizeEvidenceJson(deep)).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_DEPTH_EXCEEDED' }),
    );
    expect(() => canonicalizeEvidenceJson('x'.repeat(EVIDENCE_MAX_CANONICAL_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_JSON_SIZE_EXCEEDED' }),
    );
    expect(() =>
      createCanonicalEvidenceEnvelope({
        ...identity,
        recordFamily: 'runtime',
        recordType: 'runtime.goal',
        environment: 'test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T00:00:00Z',
        recordedAt: '2026-08-04T00:00:01Z',
        deliveryGuarantee: 'transactional',
        evaluationRole: 'required',
        evidenceRefs: ['same', 'same'],
        payload: { goalId: 'goal-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'EVIDENCE_REFERENCE_INVALID' }));
  });

  it('requires an explicit source revision and UTC RFC 3339 timestamps', () => {
    expect(() => createEvidenceRecordId({ ...identity, sourceRevision: '' })).toThrow(
      expect.objectContaining({ code: 'EVIDENCE_IDENTITY_INVALID' }),
    );
    expect(() =>
      createCanonicalEvidenceEnvelope({
        ...identity,
        recordFamily: 'runtime',
        recordType: 'runtime.goal',
        environment: 'test',
        correlationId: 'correlation-1',
        occurredAt: '2026-08-04T08:00:00+08:00',
        recordedAt: '2026-08-04T00:00:01Z',
        deliveryGuarantee: 'transactional',
        evaluationRole: 'required',
        payload: { goalId: 'goal-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'EVIDENCE_TIMESTAMP_INVALID' }));
  });

  it('uses a typed contract error', () => {
    try {
      canonicalizeEvidenceJson({ secret: 'no' });
      expect.unreachable('unsafe evidence should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceContractError);
    }
  });
});
