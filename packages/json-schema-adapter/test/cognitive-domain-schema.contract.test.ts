import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { AjvJsonSchemaValidator } from '../src/index.js';

describe('SDAR v1.2.3 cognitive Domain JSON Schema', () => {
  it('accepts the golden fixture and rejects candidate-to-active schema drift', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL('../../../schemas/v1.2.3/cognitive-domain.schema.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    const fixture = JSON.parse(
      await readFile(
        new URL('../../../schemas/v1.2.3/fixtures/cognitive-domain.golden.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const validator = new AjvJsonSchemaValidator();
    expect(validator.checkSchema(schema)).toEqual({ valid: true, errors: [] });
    expect(validator.validate(schema, fixture)).toEqual({ valid: true, errors: [] });
    expect(
      validator.validate(schema, {
        ...fixture,
        knowledgeCandidate: {
          ...(fixture['knowledgeCandidate'] as Record<string, unknown>),
          status: 'active',
        },
      }).valid,
    ).toBe(false);
  });
});
