import { describe, expect, it } from 'vitest';
import { explicitProviderJsonDictionaries } from '../src/provider-json-schema.js';
import { skillSchemaContractErrors } from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';

describe('Provider JSON dictionary publication', () => {
  it('preserves arbitrary JSON dictionaries, named required fields and rejected scalar values', () => {
    const original = {
      type: 'object',
      required: ['status', 'facts'],
      additionalProperties: false,
      properties: {
        status: { const: 'completed' },
        facts: { type: 'object', additionalProperties: true },
      },
    };
    const normalized = explicitProviderJsonDictionaries(original);
    const validator = new AjvJsonSchemaValidator();
    expect(skillSchemaContractErrors(original, 'output')).not.toEqual([]);
    expect(skillSchemaContractErrors(normalized, 'output')).toEqual([]);
    for (const facts of [
      {},
      { nested: [null, false, 4, 'value', { extra: true }] },
      null,
      [],
      'wrong',
    ]) {
      const value = { status: 'completed', facts };
      expect(validator.validate(normalized, value).valid).toBe(
        validator.validate(original, value).valid,
      );
    }
    for (const value of [
      { facts: {} },
      { status: 'wrong', facts: {} },
      { status: 'completed', facts: {}, extra: true },
    ])
      expect(validator.validate(normalized, value).valid).toBe(false);
    expect(original.properties.facts.additionalProperties).toBe(true);
  });
  it('does not alter already explicit contracts or overwrite Provider definitions', () => {
    const source = { type: 'object', properties: { status: { type: 'string' } } };
    expect(explicitProviderJsonDictionaries(source)).toEqual(source);
    expect(() =>
      explicitProviderJsonDictionaries({
        type: 'object',
        $defs: { sdarProviderJsonValue: { type: 'string' } },
      }),
    ).toThrow('PROVIDER_JSON_DEFINITION_CONFLICT');
  });
});
