import { normalizeInitialTaskAdmissionIdempotencyKey } from './initial-task-admission.js';

export interface NaturalLanguageCapabilityAdmissionRequest {
  readonly exposureId: string;
  readonly exposureVersion: number;
  readonly requestId: string;
}

export interface NaturalLanguageCapabilityAdmission {
  readonly idempotencyKey: string;
  readonly requestedCapability: NaturalLanguageCapabilityAdmissionRequest;
  readonly capabilityInput: unknown;
}

export interface NaturalLanguageCapabilityAdmissionResolver {
  resolve(
    input: Readonly<{
      messageText: string;
      userId: string;
      clientRequestId: string;
      receivedAt: string;
    }>,
  ): Promise<NaturalLanguageCapabilityAdmission | undefined>;
}

export function validateNaturalLanguageCapabilityAdmission(
  value: NaturalLanguageCapabilityAdmission,
): NaturalLanguageCapabilityAdmission {
  const idempotencyKey = normalizeInitialTaskAdmissionIdempotencyKey(value.idempotencyKey);
  if (
    value.requestedCapability.exposureId.trim() === '' ||
    !Number.isSafeInteger(value.requestedCapability.exposureVersion) ||
    value.requestedCapability.exposureVersion < 1 ||
    value.requestedCapability.requestId !== idempotencyKey
  )
    throw new NaturalLanguageCapabilityAdmissionError(
      'NATURAL_LANGUAGE_CAPABILITY_ADMISSION_INVALID',
      'Natural-language Capability admission did not return one exact Exposure and request identity.',
    );
  return Object.freeze({
    idempotencyKey,
    requestedCapability: Object.freeze({
      exposureId: value.requestedCapability.exposureId.trim(),
      exposureVersion: value.requestedCapability.exposureVersion,
      requestId: idempotencyKey,
    }),
    capabilityInput: structuredClone(value.capabilityInput),
  });
}

export class NaturalLanguageCapabilityAdmissionError extends Error {
  constructor(
    readonly code: 'NATURAL_LANGUAGE_CAPABILITY_ADMISSION_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'NaturalLanguageCapabilityAdmissionError';
  }
}
