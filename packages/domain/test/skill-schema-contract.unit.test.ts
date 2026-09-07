import { describe, expect, it } from 'vitest';
import { skillSchemaContractErrors } from '../src/index.js';

describe('explicit Skill contracts', () => {
  it.each([
    {},
    true,
    { type: 'object' },
    { type: 'object', properties: {} },
    { type: 'object', additionalProperties: {} },
    { type: 'object', properties: { result: {} } },
    { type: 'object', properties: { count: { type: 'integer' } }, required: ['missing'] },
    { type: 'array' },
  ])('rejects open or undeclared contracts %#', (schema) => {
    expect(skillSchemaContractErrors(schema, 'input').length).toBeGreaterThan(0);
  });
  it.each([
    { type: 'object', properties: {}, additionalProperties: false },
    { type: 'object', maxProperties: 0 },
    { type: 'object', additionalProperties: { type: 'number' }, maxProperties: 100 },
    {
      type: 'object',
      patternProperties: { '^[a-z]+$': { type: 'string' } },
      additionalProperties: false,
    },
    { type: 'object', properties: { count: { type: 'integer', minimum: 0 } }, required: ['count'] },
    { type: 'array', items: { type: 'string' } },
    {
      type: 'object',
      properties: { value: { $ref: '#/$defs/count' } },
      $defs: { count: { type: 'integer' } },
    },
  ])('accepts explicit no-parameter inputs and constrained data %#', (schema) => {
    expect(skillSchemaContractErrors(schema, 'input')).toEqual([]);
  });
  it('requires meaningful declared output instead of treating a no-parameter input as output', () => {
    expect(
      skillSchemaContractErrors(
        { type: 'object', properties: {}, additionalProperties: false },
        'output',
      ),
    ).not.toEqual([]);
    expect(
      skillSchemaContractErrors(
        { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] },
        'output',
      ),
    ).toEqual([]);
  });
});
