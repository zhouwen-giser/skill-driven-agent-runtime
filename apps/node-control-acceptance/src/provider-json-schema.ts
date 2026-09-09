import type { JsonObject } from '../../../packages/node-control-domain/src/index.js';

/** Preserve Provider JSON dictionaries without inventing keys or weakening validation. */
export function explicitProviderJsonDictionaries(schema: JsonObject): JsonObject {
  const result: Record<string, unknown> = structuredClone(schema);
  const changed: Record<string, unknown>[] = [];
  const definition = 'sdarProviderJsonValue';
  const ref = { $ref: `#/$defs/${definition}` };
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const visit = (value: unknown): void => {
    if (!isRecord(value)) return;
    if (
      value['type'] === 'object' &&
      !Object.hasOwn(value, 'properties') &&
      !Object.hasOwn(value, 'patternProperties') &&
      (value['additionalProperties'] === true || value['additionalProperties'] === undefined) &&
      (!Array.isArray(value['required']) || value['required'].length === 0)
    ) {
      value['additionalProperties'] = structuredClone(ref);
      changed.push(value);
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'definitions']) {
      const entries = value[key];
      if (isRecord(entries)) Object.values(entries).forEach(visit);
    }
    for (const key of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else'])
      visit(value[key]);
    for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
      const entries = value[key];
      if (Array.isArray(entries)) entries.forEach(visit);
    }
  };
  visit(result);
  if (changed.length > 0) {
    const definitions = isRecord(result['$defs']) ? result['$defs'] : {};
    if (Object.hasOwn(definitions, definition))
      throw new Error('PROVIDER_JSON_DEFINITION_CONFLICT');
    result['$defs'] = {
      ...definitions,
      [definition]: {
        anyOf: [
          { type: 'null' },
          { type: 'boolean' },
          { type: 'number' },
          { type: 'string' },
          { type: 'array', items: ref },
          { type: 'object', additionalProperties: ref },
        ],
      },
    };
  }
  // The input is validated JSON; every inserted value above is a JSON Schema literal.
  return result as JsonObject;
}
