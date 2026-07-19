import { describe, expect, it } from 'vitest';

import {
  parseFrozenProviderEvidence,
  resolveJsonPointer,
  validateFrozenToolOutput,
} from '../src/index.js';
import type { FrozenEvidenceError } from '../src/index.js';

const observedAt = '2026-07-19T01:02:03.000Z';

describe('Frozen V1 evidence profile', () => {
  it('validates outputSchema and parses objective Provider evidence', () => {
    const result = validateFrozenToolOutput(
      toolResult({
        profileVersion: '1.0',
        items: [
          item('position-1', 'position.observation', {
            kind: 'structured_content',
            jsonPointer: '/result/final~1position',
          }),
          item('photo-1', 'image.capture', {
            kind: 'uri',
            uri: 's3://evidence/photo.jpg',
            sha256: 'a'.repeat(64),
          }),
        ],
      }),
      {
        outputSchema: { type: 'object' },
        validator: { validate: () => ({ valid: true, errors: [] }) },
      },
    );

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence?.[0]).toMatchObject({
      evidenceId: 'position-1',
      evidenceType: 'position.observation',
    });
    expect(resolveJsonPointer(result.structuredContent, '/result/final~1position')).toEqual({
      x: 1,
      y: 2,
    });
  });

  it.each([
    [
      'forbidden local requirement ID',
      { ...item('e-1', 'type-1', pointer()), requirementId: 'r-1' },
    ],
    ['unsupported URI scheme', item('e-1', 'type-1', { kind: 'uri', uri: 'file:///tmp/x' })],
    ['invalid timestamp', { ...item('e-1', 'type-1', pointer()), observedAt: 'yesterday' }],
  ])('rejects %s', (_label, invalidItem) => {
    expect(() =>
      parseFrozenProviderEvidence(toolResult({ profileVersion: '1.0', items: [invalidItem] })),
    ).toThrow(
      expect.objectContaining<Partial<FrozenEvidenceError>>({
        code: 'FROZEN_PROVIDER_EVIDENCE_INVALID',
      }),
    );
  });

  it('rejects duplicate IDs, missing pointers, excessive depth, and schema mismatch', () => {
    expect(() =>
      parseFrozenProviderEvidence(
        toolResult({
          profileVersion: '1.0',
          items: [item('same', 'one', pointer()), item('same', 'two', pointer())],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_PROVIDER_EVIDENCE_DUPLICATE_ID' }));
    expect(() =>
      parseFrozenProviderEvidence(
        toolResult({
          profileVersion: '1.0',
          items: [item('missing', 'one', { kind: 'structured_content', jsonPointer: '/absent' })],
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_PROVIDER_EVIDENCE_POINTER_MISSING' }));
    let deep: unknown = 'value';
    for (let depth = 0; depth < 34; depth += 1) deep = { nested: deep };
    expect(() =>
      parseFrozenProviderEvidence(
        toolResult({ profileVersion: '1.0', items: [item('deep', 'one', pointer())], deep }),
      ),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_PROVIDER_EVIDENCE_TOO_DEEP' }));
    expect(() =>
      parseFrozenProviderEvidence(
        toolResult({
          profileVersion: '1.0',
          items: [item('large', 'one', pointer())],
          padding: 'x'.repeat(1_048_576),
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_PROVIDER_EVIDENCE_TOO_LARGE' }));
    expect(() =>
      validateFrozenToolOutput(toolResult(undefined), {
        outputSchema: { type: 'object' },
        validator: { validate: () => ({ valid: false, errors: ['/ required'] }) },
      }),
    ).toThrow(expect.objectContaining({ code: 'FROZEN_OUTPUT_SCHEMA_MISMATCH' }));
  });
});

function toolResult(evidence: unknown) {
  return {
    content: [],
    structuredContent: { result: { 'final/position': { x: 1, y: 2 } } },
    isError: false,
    ...(evidence === undefined ? {} : { metadata: { 'io.sdar/evidence': evidence } }),
  };
}

function item(evidenceId: string, evidenceType: string, payloadRef: unknown) {
  return { evidenceId, evidenceType, observedAt, payloadRef };
}

function pointer() {
  return { kind: 'structured_content', jsonPointer: '/result' };
}
