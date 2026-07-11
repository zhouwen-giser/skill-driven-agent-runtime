import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { SecretCipher } from '../../application/src/index.js';

interface Envelope {
  readonly v: 1;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class Aes256GcmSecretCipher implements SecretCipher {
  readonly #key: Buffer;

  constructor(masterKeyBase64: string) {
    this.#key = Buffer.from(masterKeyBase64, 'base64');
    if (this.#key.byteLength !== 32) {
      throw new SecretCipherError(
        'MASTER_KEY_INVALID',
        'Master key must be exactly 32 base64-decoded bytes.',
      );
    }
  }

  encrypt(secret: Readonly<Record<string, string>>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), 'utf8'),
      cipher.final(),
    ]);
    const envelope: Envelope = {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return JSON.stringify(envelope);
  }

  decrypt(encrypted: string): Readonly<Record<string, string>> {
    let envelope: Envelope;
    try {
      envelope = parseEnvelope(JSON.parse(encrypted) as unknown);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.#key,
        Buffer.from(envelope.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return parseStringRecord(JSON.parse(plaintext) as unknown);
    } catch (error: unknown) {
      if (error instanceof SecretCipherError) throw error;
      throw new SecretCipherError(
        'SECRET_DECRYPT_FAILED',
        'Encrypted credential could not be authenticated.',
      );
    }
  }
}

function parseEnvelope(value: unknown): Envelope {
  if (typeof value !== 'object' || value === null)
    throw new SecretCipherError('SECRET_ENVELOPE_INVALID', 'Secret envelope is invalid.');
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record['v'] !== 1 ||
    typeof record['iv'] !== 'string' ||
    typeof record['tag'] !== 'string' ||
    typeof record['ciphertext'] !== 'string'
  ) {
    throw new SecretCipherError('SECRET_ENVELOPE_INVALID', 'Secret envelope is invalid.');
  }
  return { v: 1, iv: record['iv'], tag: record['tag'], ciphertext: record['ciphertext'] };
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SecretCipherError('SECRET_PAYLOAD_INVALID', 'Secret payload is invalid.');
  const entries = Object.entries(value);
  if (entries.some((entry) => typeof entry[1] !== 'string'))
    throw new SecretCipherError('SECRET_PAYLOAD_INVALID', 'Secret payload is invalid.');
  return Object.fromEntries(entries);
}

export type SecretCipherErrorCode =
  | 'MASTER_KEY_INVALID'
  | 'SECRET_DECRYPT_FAILED'
  | 'SECRET_ENVELOPE_INVALID'
  | 'SECRET_PAYLOAD_INVALID';

export class SecretCipherError extends Error {
  readonly code: SecretCipherErrorCode;
  constructor(code: SecretCipherErrorCode, message: string) {
    super(message);
    this.name = 'SecretCipherError';
    this.code = code;
  }
}
