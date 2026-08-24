import { describe, expect, it } from 'vitest';

import {
  initialTaskAdmissionRequestHash,
  normalizeInitialTaskAdmissionIdempotencyKey,
} from '../src/initial-task-admission.js';

describe('initial Task admission identity', () => {
  it('canonicalizes JSON object key order while preserving request semantics', () => {
    const left = initialTaskAdmissionRequestHash({
      messageText: 'Inspect alpha.',
      userId: 'operator-1',
      metadata: { 设备: 'alpha', b: 2, a: { z: true, y: false }, ä: 3 },
      capabilityInput: { resourceId: 'alpha', options: { b: 2, a: 1 } },
    });
    const right = initialTaskAdmissionRequestHash({
      messageText: 'Inspect alpha.',
      userId: 'operator-1',
      metadata: { ä: 3, a: { y: false, z: true }, b: 2, 设备: 'alpha' },
      capabilityInput: { options: { a: 1, b: 2 }, resourceId: 'alpha' },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('is independent of locale-specific insertion order for non-ASCII keys', () => {
    const entries = [
      ['ä', 1],
      ['z', 2],
      ['设备', 3],
      ['a', 4],
    ] as const;
    const metadataFor = (locale: string) =>
      Object.fromEntries(
        [...entries].sort(([left], [right]) => new Intl.Collator(locale).compare(left, right)),
      );
    const hashFor = (locale: string) =>
      initialTaskAdmissionRequestHash({
        messageText: 'Inspect alpha.',
        userId: 'operator-1',
        metadata: metadataFor(locale),
        capabilityInput: { resourceId: 'alpha' },
      });

    expect(hashFor('en')).toBe(hashFor('sv'));
    expect(hashFor('sv')).toBe(hashFor('zh'));
  });

  it('changes when protocol-neutral request content changes', () => {
    const base = {
      messageText: 'Inspect alpha.',
      userId: 'operator-1',
      metadata: { idempotency_key: 'request-1' },
      capabilityInput: { resourceId: 'alpha' },
    } as const;

    expect(initialTaskAdmissionRequestHash(base)).not.toBe(
      initialTaskAdmissionRequestHash({ ...base, messageText: 'Inspect beta.' }),
    );
  });

  it('accepts bounded stable tokens and rejects whitespace, empty and overlong keys', () => {
    expect(normalizeInitialTaskAdmissionIdempotencyKey('run-1:move_to.retry_2')).toBe(
      'run-1:move_to.retry_2',
    );
    for (const invalid of ['', ' key', 'key ', 'key/value', 'x'.repeat(257)])
      expect(() => normalizeInitialTaskAdmissionIdempotencyKey(invalid)).toThrow(
        expect.objectContaining({ code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_KEY_INVALID' }),
      );
  });
});
