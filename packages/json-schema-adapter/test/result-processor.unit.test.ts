import { describe, expect, it } from 'vitest';

import { ResultProcessor } from '../../application/src/index.js';
import { AjvJsonSchemaValidator } from '../src/index.js';

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['online', 'offline'] } },
};

describe('ResultProcessor with Ajv boundary', () => {
  const processor = new ResultProcessor(new AjvJsonSchemaValidator());

  it('supports the MCP SDK draft-07 dialect without removing its schema identifier', () => {
    const validator = new AjvJsonSchemaValidator();
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string', minLength: 1 } },
    };
    expect(validator.checkSchema(schema)).toEqual({ valid: true, errors: [] });
    expect(validator.validate(schema, { deviceId: '' }).valid).toBe(false);
  });

  it('accepts natural-language and schema-conforming structured output', () => {
    expect(
      processor.process({
        text: ' Device is online. ',
        structured: { status: 'online' },
        outputSchema,
      }),
    ).toEqual({ text: 'Device is online.', structured: { status: 'online' } });
  });

  it('rejects structured output that violates the Skill schema', () => {
    expect(() =>
      processor.process({
        text: 'Unknown.',
        structured: { status: 'unknown' },
        outputSchema,
      }),
    ).toThrow(expect.objectContaining({ code: 'RESULT_SCHEMA_MISMATCH' }));
  });

  it('rejects invalid schemas and empty natural-language output with stable codes', () => {
    expect(() =>
      processor.process({ text: 'Result.', structured: {}, outputSchema: { type: 'not-a-type' } }),
    ).toThrow(expect.objectContaining({ code: 'RESULT_SCHEMA_INVALID' }));
    expect(() =>
      processor.process({ text: ' ', structured: { status: 'online' }, outputSchema }),
    ).toThrow(expect.objectContaining({ code: 'RESULT_TEXT_REQUIRED' }));
  });
});
