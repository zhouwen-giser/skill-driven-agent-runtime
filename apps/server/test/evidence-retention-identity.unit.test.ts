import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evidenceRetentionIdentity } from '../src/evidence-retention-identity.js';

describe('scheduled Evidence retention identity', () => {
  it('separates worker authority while preserving equivalent device sets and standalone history', () => {
    const scope = { allowedDeviceIds: ['a', 'b'], sdarServiceKey: 'sdar', includeNonDevice: false };
    const key = (value = scope) => evidenceRetentionIdentity('export', 2, '2026-09-08', value);
    expect(key()).toBe(key({ ...scope, allowedDeviceIds: ['b', 'a', 'a'] }));
    for (const changed of [
      { ...scope, allowedDeviceIds: ['a'] },
      { ...scope, sdarServiceKey: 'other' },
      { ...scope, includeNonDevice: true },
    ])
      expect(key(changed)).not.toBe(key());
    const old = createHash('sha256').update('export:2:2026-09-08').digest('hex');
    expect(evidenceRetentionIdentity('export', 2, '2026-09-08')).toBe(old);
    expect(key()).not.toBe(old);
    expect(evidenceRetentionIdentity('export', 2, '2026-09-09', scope)).not.toBe(key());
    expect(evidenceRetentionIdentity('export', 3, '2026-09-08', scope)).not.toBe(key());
  });
});
