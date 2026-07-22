import { z } from 'zod';

import {
  createProviderEvidenceItem,
  type InternalToolResult,
  type ProviderEvidenceItem,
} from '../../domain/src/index.js';

const MAX_EVIDENCE_ITEMS = 64;
const MAX_EVIDENCE_BYTES = 1_048_576;
const MAX_EVIDENCE_DEPTH = 32;
const pointerSchema = z
  .string()
  .max(512)
  .refine((value) => value === '' || /^(?:\/(?:[^~/]|~0|~1)*)+$/u.test(value));
const payloadRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('structured_content'), jsonPointer: pointerSchema }).strict(),
  z
    .object({
      kind: z.literal('uri'),
      uri: z
        .string()
        .max(2048)
        .regex(/^(?:https|s3|gs|azblob|urn):/u),
      mediaType: z.string().min(1).max(256).optional(),
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/u)
        .optional(),
    })
    .strict(),
]);
const evidenceItemSchema = z
  .object({
    evidenceId: z.string().min(1).max(128),
    evidenceType: z.string().min(1).max(128),
    observedAt: z.iso.datetime({ offset: true }),
    subjectRef: z.string().min(1).max(512).optional(),
    producer: z.array(z.string().min(1).max(512)).max(16).optional(),
    payloadRef: payloadRefSchema,
  })
  .strict();
const profileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    items: z.array(evidenceItemSchema).max(MAX_EVIDENCE_ITEMS),
  })
  .strict();

export interface FrozenOutputSchemaValidator {
  validate(
    schema: unknown,
    value: unknown,
  ): Readonly<{ valid: boolean; errors: readonly string[] }>;
}

export function validateFrozenToolOutput(
  result: InternalToolResult,
  input: Readonly<{
    outputSchema?: unknown;
    validator?: FrozenOutputSchemaValidator;
  }> = {},
): InternalToolResult {
  if ((input.outputSchema === undefined) !== (input.validator === undefined))
    throw evidenceError(
      'FROZEN_OUTPUT_SCHEMA_VALIDATOR_REQUIRED',
      'Frozen outputSchema and validator must be supplied together.',
    );
  if (input.outputSchema !== undefined && input.validator !== undefined) {
    const validation = input.validator.validate(input.outputSchema, result.structuredContent);
    if (!validation.valid)
      throw evidenceError(
        'FROZEN_OUTPUT_SCHEMA_MISMATCH',
        `Frozen structuredContent violates Tool outputSchema: ${validation.errors.join('; ')}`,
      );
  }
  const evidence = parseFrozenProviderEvidence(result);
  return Object.freeze({ ...result, evidence });
}

export function parseFrozenProviderEvidence(
  result: Pick<InternalToolResult, 'metadata' | 'structuredContent'>,
): readonly ProviderEvidenceItem[] {
  const raw = result.metadata?.['io.sdar/evidence'];
  if (raw === undefined) return Object.freeze([]);
  assertBounded(raw);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success)
    throw evidenceError(
      'FROZEN_PROVIDER_EVIDENCE_INVALID',
      'Provider evidence violates profile 1.0 or contains forbidden fields.',
    );
  const ids = new Set<string>();
  const items = parsed.data.items.map((item) => {
    if (ids.has(item.evidenceId))
      throw evidenceError(
        'FROZEN_PROVIDER_EVIDENCE_DUPLICATE_ID',
        'Provider evidence IDs must be unique within a Result.',
      );
    ids.add(item.evidenceId);
    if (item.payloadRef.kind === 'structured_content')
      resolveJsonPointer(result.structuredContent, item.payloadRef.jsonPointer);
    return createProviderEvidenceItem({
      evidenceId: item.evidenceId,
      evidenceType: item.evidenceType,
      observedAt: item.observedAt,
      ...(item.subjectRef === undefined ? {} : { subjectRef: item.subjectRef }),
      ...(item.producer === undefined ? {} : { producer: item.producer }),
      payloadRef:
        item.payloadRef.kind === 'structured_content'
          ? item.payloadRef
          : {
              kind: 'uri',
              uri: item.payloadRef.uri,
              ...(item.payloadRef.mediaType === undefined
                ? {}
                : { mediaType: item.payloadRef.mediaType }),
              ...(item.payloadRef.sha256 === undefined ? {} : { sha256: item.payloadRef.sha256 }),
            },
    });
  });
  return Object.freeze(items);
}

export function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') {
    if (document === undefined)
      throw evidenceError(
        'FROZEN_PROVIDER_EVIDENCE_POINTER_MISSING',
        'Evidence JSON Pointer does not resolve in structuredContent.',
      );
    return document;
  }
  let current = document;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment) || Number(segment) >= current.length)
        return pointerMissing();
      current = current[Number(segment)];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) current = current[segment];
    else return pointerMissing();
  }
  return current;
}

function assertBounded(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_EVIDENCE_BYTES)
    throw evidenceError('FROZEN_PROVIDER_EVIDENCE_TOO_LARGE', 'Provider evidence exceeds one MiB.');
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > MAX_EVIDENCE_DEPTH)
      throw evidenceError(
        'FROZEN_PROVIDER_EVIDENCE_TOO_DEEP',
        'Provider evidence exceeds the nesting limit.',
      );
    if (Array.isArray(current.value))
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
    else if (isRecord(current.value))
      for (const item of Object.values(current.value))
        pending.push({ value: item, depth: current.depth + 1 });
  }
}

function pointerMissing(): never {
  throw evidenceError(
    'FROZEN_PROVIDER_EVIDENCE_POINTER_MISSING',
    'Evidence JSON Pointer does not resolve in structuredContent.',
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type FrozenEvidenceErrorCode =
  | 'FROZEN_OUTPUT_SCHEMA_VALIDATOR_REQUIRED'
  | 'FROZEN_OUTPUT_SCHEMA_MISMATCH'
  | 'FROZEN_PROVIDER_EVIDENCE_INVALID'
  | 'FROZEN_PROVIDER_EVIDENCE_DUPLICATE_ID'
  | 'FROZEN_PROVIDER_EVIDENCE_POINTER_MISSING'
  | 'FROZEN_PROVIDER_EVIDENCE_TOO_LARGE'
  | 'FROZEN_PROVIDER_EVIDENCE_TOO_DEEP';

export class FrozenEvidenceError extends Error {
  readonly code: FrozenEvidenceErrorCode;
  constructor(code: FrozenEvidenceErrorCode, message: string) {
    super(message);
    this.name = 'FrozenEvidenceError';
    this.code = code;
  }
}

function evidenceError(code: FrozenEvidenceErrorCode, message: string): FrozenEvidenceError {
  return new FrozenEvidenceError(code, message);
}
