import type { TaskOutput } from '../../domain/src/index.js';

import type { JsonSchemaValidator } from './ports.js';

export interface ResultCandidate {
  readonly text: string;
  readonly structured: unknown;
  readonly outputSchema: unknown;
}

export class ResultProcessor {
  readonly #validator: JsonSchemaValidator;

  constructor(validator: JsonSchemaValidator) {
    this.#validator = validator;
  }

  process(candidate: ResultCandidate): TaskOutput {
    const text = candidate.text.trim();
    if (text === '') {
      throw new ResultProcessingError(
        'RESULT_TEXT_REQUIRED',
        'Natural-language result is required.',
      );
    }
    const validation = this.#validator.validate(candidate.outputSchema, candidate.structured);
    if (!validation.valid) {
      throw new ResultProcessingError(
        'RESULT_SCHEMA_MISMATCH',
        'Structured result does not conform to the Skill output schema.',
        validation.errors,
      );
    }
    return { text, structured: candidate.structured };
  }
}

export type ResultProcessingErrorCode =
  'RESULT_SCHEMA_INVALID' | 'RESULT_SCHEMA_MISMATCH' | 'RESULT_TEXT_REQUIRED';

export class ResultProcessingError extends Error {
  readonly code: ResultProcessingErrorCode;
  readonly details: readonly string[];

  constructor(code: ResultProcessingErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'ResultProcessingError';
    this.code = code;
    this.details = details;
  }
}
