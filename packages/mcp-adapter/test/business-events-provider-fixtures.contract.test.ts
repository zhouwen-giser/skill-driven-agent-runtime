import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';

const root = resolve(process.cwd(), 'protocol', 'business-events', 'provider-v1.0');

describe('vendored Provider Business Events fixtures', () => {
  it('accepts all eight frozen valid fixtures', async () => {
    const { validator, schemas } = await validators();
    const files = await fixtureNames('valid');
    expect(files).toHaveLength(8);
    for (const name of files) {
      const fixture = await json(resolve(root, 'fixtures', 'valid', name));
      const schema = schemas.get(String(fixture['schema']));
      expect(schema, name).toBeDefined();
      const result = validator.validate(
        fixtureSchema(schema, fixture['definition']),
        fixture['instance'],
      );
      expect(result.valid, `${name}: ${result.errors.join('; ')}`).toBe(true);
    }
  });

  it('rejects all five frozen invalid fixtures', async () => {
    const { validator, schemas } = await validators();
    const files = await fixtureNames('invalid');
    expect(files).toHaveLength(5);
    for (const name of files) {
      const fixture = await json(resolve(root, 'fixtures', 'invalid', name));
      const schema = schemas.get(String(fixture['schema']));
      expect(schema, name).toBeDefined();
      expect(
        validator.validate(fixtureSchema(schema, fixture['definition']), fixture['instance']).valid,
        name,
      ).toBe(false);
    }
  });
});

async function validators() {
  const schemas = new Map<string, Readonly<Record<string, unknown>>>();
  for (const name of await names(resolve(root, 'schemas'))) {
    const schema = await json(resolve(root, 'schemas', name));
    schemas.set(name, schema);
  }
  return { validator: new AjvJsonSchemaValidator({ strict: false }), schemas };
}

function fixtureSchema(
  schema: Readonly<Record<string, unknown>> | undefined,
  definition: unknown,
): Readonly<Record<string, unknown>> {
  if (schema === undefined) throw new Error('BUSINESS_EVENT_FIXTURE_SCHEMA_MISSING');
  if (typeof definition !== 'string') return schema;
  return {
    ...schema,
    $id: `${String(schema['$id'])}/fixture/${definition}`,
    $ref: `#/$defs/${definition}`,
  };
}

async function fixtureNames(kind: 'valid' | 'invalid'): Promise<readonly string[]> {
  return names(resolve(root, 'fixtures', kind));
}

async function names(path: string): Promise<readonly string[]> {
  return (await readdir(path))
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
}

async function json(path: string): Promise<Readonly<Record<string, unknown>>> {
  return JSON.parse(await readFile(path, 'utf8')) as Readonly<Record<string, unknown>>;
}
