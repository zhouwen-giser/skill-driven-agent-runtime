import { describe, expect, it } from 'vitest';

import { resolveUgvProfileProviderSuccessOutputSchema } from '../src/ugv-profile-provider-output-schema.js';

describe('UGV Profile Provider output Schema authority', () => {
  it.each([false, true])(
    'returns the other object branch independent of order (%s)',
    (reversed) => {
      const success = Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: ['resourceId'],
        properties: { resourceId: { const: 'vehicle:ugv1' } },
      });
      const business = businessResultSchema();
      const wrapper = {
        anyOf: reversed ? [business, success] : [success, business],
        type: 'object',
      };

      expect(resolveUgvProfileProviderSuccessOutputSchema(wrapper)).toBe(success);
    },
  );

  it.each([
    ['direct success', { type: 'object', properties: {} }],
    [
      'extra root keyword',
      {
        type: 'object',
        anyOf: [successSchema(), businessResultSchema()],
        additionalProperties: false,
      },
    ],
    ['missing business branch', { type: 'object', anyOf: [successSchema(), successSchema()] }],
    [
      'duplicate business branches',
      { type: 'object', anyOf: [businessResultSchema(), businessResultSchema()] },
    ],
    [
      'third branch',
      { type: 'object', anyOf: [successSchema(), businessResultSchema(), successSchema()] },
    ],
    ['non-object success branch', { type: 'object', anyOf: [{ type: 'string' }, false] }],
    [
      'business Schema drift',
      {
        type: 'object',
        anyOf: [
          successSchema(),
          {
            ...businessResultSchema(),
            additionalProperties: false,
          },
        ],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(resolveUgvProfileProviderSuccessOutputSchema(value)).toBeUndefined();
  });
});

function successSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId'],
    properties: { resourceId: { const: 'vehicle:ugv1' } },
  };
}

function businessResultSchema(): Readonly<Record<string, unknown>> {
  return {
    additionalProperties: true,
    required: ['outcome', 'reasonCode', 'retryable', 'completedAt'],
    properties: {
      completedAt: { format: 'date-time', type: 'string' },
      retryable: { type: 'boolean' },
      reasonCode: { minLength: 1, type: 'string' },
      outcome: { minLength: 1, type: 'string' },
    },
    type: 'object',
  };
}
