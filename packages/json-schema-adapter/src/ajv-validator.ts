import { Ajv } from 'ajv/dist/ajv.js';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { z } from 'zod';

import {
  ResultProcessingError,
  type JsonSchemaValidationResult,
  type JsonSchemaValidator,
} from '../../application/src/index.js';

const JsonSchemaInput = z.union([z.boolean(), z.record(z.string(), z.unknown())]);

export class AjvJsonSchemaValidator implements JsonSchemaValidator {
  readonly #ajv2020 = new Ajv2020({
    strict: true,
    allErrors: true,
    validateSchema: true,
  });
  readonly #ajvDraft7 = new Ajv({
    strict: true,
    allErrors: true,
    validateSchema: true,
  });

  checkSchema(schema: unknown): JsonSchemaValidationResult {
    try {
      this.#compile(schema);
      return { valid: true, errors: [] };
    } catch (error: unknown) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown schema compilation error.'],
      };
    }
  }

  validate(schema: unknown, value: unknown): JsonSchemaValidationResult {
    const validate = this.#compile(schema);
    const valid = validate(value);
    return { valid, errors: valid ? [] : summarizeErrors(validate.errors ?? []) };
  }

  #compile(schema: unknown): ValidateFunction {
    const parsedSchema = JsonSchemaInput.safeParse(schema);
    if (!parsedSchema.success) {
      throw new ResultProcessingError(
        'RESULT_SCHEMA_INVALID',
        'Skill output schema must be a JSON object or boolean schema.',
      );
    }
    try {
      const dialect = schemaDialect(parsedSchema.data);
      if (dialect === 'unsupported') throw new Error('Unsupported JSON Schema dialect.');
      const ajv = dialect === 'draft7' ? this.#ajvDraft7 : this.#ajv2020;
      const identifier =
        typeof parsedSchema.data === 'boolean' ? undefined : parsedSchema.data['$id'];
      const cached = typeof identifier === 'string' ? ajv.getSchema(identifier) : undefined;
      return cached ?? ajv.compile(parsedSchema.data);
    } catch (error: unknown) {
      throw new ResultProcessingError('RESULT_SCHEMA_INVALID', 'Skill output schema is invalid.', [
        error instanceof Error ? error.message : 'Unknown schema compilation error.',
      ]);
    }
  }
}

function schemaDialect(
  schema: boolean | Record<string, unknown>,
): 'draft7' | 'default' | 'unsupported' {
  if (typeof schema === 'boolean') return 'default';
  const identifier = schema['$schema'];
  if (identifier === undefined) return 'default';
  if (identifier === 'http://json-schema.org/draft-07/schema#') return 'draft7';
  if (identifier === 'https://json-schema.org/draft/2020-12/schema') return 'default';
  return 'unsupported';
}

function summarizeErrors(errors: readonly ErrorObject[]): readonly string[] {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}
