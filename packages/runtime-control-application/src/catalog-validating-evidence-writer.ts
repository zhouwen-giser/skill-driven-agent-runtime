import { getEvidenceRecordSchema, type CanonicalEvidenceEnvelope } from '../../domain/src/index.js';

const MAX_SCHEMA_ERRORS = 16;
const MAX_SCHEMA_ERROR_LENGTH = 256;

export interface CanonicalEvidenceAppendDelegate {
  append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string>;
}

export interface EvidenceEnvelopeSchemaValidator {
  validate(
    schema: unknown,
    value: unknown,
  ): Readonly<{ valid: boolean; errors: readonly string[] }>;
}

export class CatalogEvidenceSchemaValidationError extends Error {
  readonly code = 'schema_invalid' as const;
  readonly detail: Readonly<{ errors: readonly string[] }>;

  constructor(errors: readonly string[]) {
    super('Canonical Evidence envelope did not satisfy its catalog schema.');
    this.name = 'CatalogEvidenceSchemaValidationError';
    this.detail = Object.freeze({ errors: boundedSchemaErrors(errors) });
  }
}

/**
 * Production append gate for every Canonical Evidence projector. The delegate intentionally owns
 * only append; issue and checkpoint authority remain explicit ports on the composing projector.
 */
export class CatalogValidatingEvidenceWriter implements CanonicalEvidenceAppendDelegate {
  readonly #delegate: CanonicalEvidenceAppendDelegate;
  readonly #validator: EvidenceEnvelopeSchemaValidator;
  readonly #observationScope: Readonly<{ tenantId: string; projectId: string }> | undefined;

  constructor(
    input: Readonly<{
      delegate: CanonicalEvidenceAppendDelegate;
      validator: EvidenceEnvelopeSchemaValidator;
      observationScope?: Readonly<{ tenantId: string; projectId: string }>;
    }>,
  ) {
    this.#delegate = input.delegate;
    this.#validator = input.validator;
    this.#observationScope = input.observationScope;
    if (
      input.observationScope !== undefined &&
      Object.values(input.observationScope).some(
        (value) => value.trim() === '' || value.length > 256,
      )
    ) {
      throw new CatalogEvidenceSchemaValidationError(['invalid observation scope']);
    }
  }

  async append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string> {
    // Metadata is applied before the first durable append. Payload/record identities are not
    // rewritten; PostgreSQL's first-writer path retains any existing historical envelope.
    if (this.#observationScope !== undefined) {
      if (
        (envelope.tenantId !== undefined &&
          envelope.tenantId !== this.#observationScope.tenantId) ||
        (envelope.projectId !== undefined &&
          envelope.projectId !== this.#observationScope.projectId)
      ) {
        throw new CatalogEvidenceSchemaValidationError(['observation scope conflicts with source']);
      }
      envelope = { ...envelope, ...this.#observationScope };
    }
    let validation: Readonly<{ valid: boolean; errors: readonly string[] }>;
    try {
      validation = this.#validator.validate(getEvidenceRecordSchema(envelope.recordType), envelope);
    } catch {
      throw new CatalogEvidenceSchemaValidationError(['schema validation could not be completed']);
    }
    if (!validation.valid) {
      throw new CatalogEvidenceSchemaValidationError(validation.errors);
    }
    return this.#delegate.append(envelope, capturedAt, sourcePartition);
  }
}

function boundedSchemaErrors(errors: readonly string[]): readonly string[] {
  const bounded = errors
    .slice(0, MAX_SCHEMA_ERRORS)
    .map((error) =>
      Array.from(error, (character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
          ? ' '
          : character;
      })
        .join('')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, MAX_SCHEMA_ERROR_LENGTH),
    )
    .filter((error) => error !== '');
  return Object.freeze(
    bounded.length === 0 ? ['canonical evidence schema validation failed'] : bounded,
  );
}
