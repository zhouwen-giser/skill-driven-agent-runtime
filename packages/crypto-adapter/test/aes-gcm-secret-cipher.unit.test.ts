import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Aes256GcmSecretCipher } from '../src/index.js';

describe('Aes256GcmSecretCipher', () => {
  it('round-trips credentials without storing plaintext and uses a random nonce', () => {
    const cipher = new Aes256GcmSecretCipher(randomBytes(32).toString('base64'));
    const credential = { Authorization: 'Bearer top-secret' };
    const first = cipher.encrypt(credential);
    const second = cipher.encrypt(credential);

    expect(first).not.toContain('top-secret');
    expect(second).not.toBe(first);
    expect(cipher.decrypt(first)).toEqual(credential);
  });

  it('rejects tampering and invalid master key lengths', () => {
    expect(() => new Aes256GcmSecretCipher(randomBytes(31).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'MASTER_KEY_INVALID' }),
    );
    const cipher = new Aes256GcmSecretCipher(randomBytes(32).toString('base64'));
    const envelope = JSON.parse(cipher.encrypt({ token: 'secret' })) as Record<string, unknown>;
    envelope['ciphertext'] = `${String(envelope['ciphertext'])}AA`;
    expect(() => cipher.decrypt(JSON.stringify(envelope))).toThrow(
      expect.objectContaining({ code: 'SECRET_DECRYPT_FAILED' }),
    );
  });
});
