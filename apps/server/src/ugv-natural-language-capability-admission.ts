import { createHash } from 'node:crypto';

import type {
  NaturalLanguageCapabilityAdmission,
  NaturalLanguageCapabilityAdmissionResolver,
} from '../../../packages/application/src/index.js';

import { UGV_AGENT_PROFILE_EXPOSURE_ID } from './ugv-agent-profile.js';
import { adaptUgvMoveInput, UGV_MOVE_RESOURCE_ID } from './ugv-move-input-adapter.js';

const NUMBER = '[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:e[+-]?[0-9]+)?';
const LONGITUDE = new RegExp(
  `(?<![A-Za-z])(?:longitude|lon|lng|经度)\\s*(?:[:=：])?\\s*(${NUMBER})`,
  'giu',
);
const LATITUDE = new RegExp(
  `(?<![A-Za-z])(?:latitude|lat|纬度)\\s*(?:[:=：])?\\s*(${NUMBER})`,
  'giu',
);
const MOVE_INTENT = /(?:move|navigate|go\s+to|drive\s+to|移动|前往|导航|驶向|开到)/iu;
const UGV_SUBJECT = /(?:\bugv\b|\bvehicle\b|无人车|车辆)/iu;

/**
 * Profile-only deterministic bridge for metadata-free A2A natural-language requests.
 * The returned input remains a candidate until RuntimeTaskCapabilityService re-resolves
 * and persists the current Exposure/readiness/Provider authority.
 */
export class UgvNaturalLanguageCapabilityAdmissionResolver implements NaturalLanguageCapabilityAdmissionResolver {
  readonly #exposures: Readonly<{
    findCurrent(
      exposureId: string,
    ): Promise<Readonly<{ exposureId: string; exposureVersion: number }> | undefined>;
  }>;

  constructor(dependencies: {
    exposures: Readonly<{
      findCurrent(
        exposureId: string,
      ): Promise<Readonly<{ exposureId: string; exposureVersion: number }> | undefined>;
    }>;
  }) {
    this.#exposures = dependencies.exposures;
  }

  async resolve(
    input: Readonly<{
      messageText: string;
      userId: string;
      clientRequestId: string;
      receivedAt: string;
    }>,
  ): Promise<NaturalLanguageCapabilityAdmission | undefined> {
    void input.userId;
    void input.receivedAt;
    if (!MOVE_INTENT.test(input.messageText) || !UGV_SUBJECT.test(input.messageText))
      return undefined;
    const currentExposure = await this.#exposures.findCurrent(UGV_AGENT_PROFILE_EXPOSURE_ID);
    if (
      currentExposure?.exposureId !== UGV_AGENT_PROFILE_EXPOSURE_ID ||
      !Number.isSafeInteger(currentExposure.exposureVersion) ||
      currentExposure.exposureVersion < 1
    )
      return undefined;
    const longitude = exactlyOneCoordinate(input.messageText, LONGITUDE, 'longitude');
    const latitude = exactlyOneCoordinate(input.messageText, LATITUDE, 'latitude');
    const clientRequestId = input.clientRequestId.trim();
    if (clientRequestId === '' || clientRequestId.length > 1_024)
      throw new UgvNaturalLanguageCapabilityAdmissionError(
        'UGV_NATURAL_LANGUAGE_REQUEST_ID_INVALID',
        'Natural-language UGV admission requires one bounded stable client request identity.',
      );
    const capabilityInput = Object.freeze({
      resourceId: UGV_MOVE_RESOURCE_ID,
      target: Object.freeze({ x: longitude, y: latitude, frame: 'WGS84' as const }),
    });
    adaptUgvMoveInput(capabilityInput);
    const idempotencyKey = `nlcap-${createHash('sha256')
      .update(`ugv-agent-profile:${clientRequestId}`)
      .digest('hex')}`;
    return Object.freeze({
      idempotencyKey,
      requestedCapability: Object.freeze({
        exposureId: currentExposure.exposureId,
        exposureVersion: currentExposure.exposureVersion,
        requestId: idempotencyKey,
      }),
      capabilityInput,
    });
  }
}

export type UgvNaturalLanguageCapabilityAdmissionErrorCode =
  | 'UGV_NATURAL_LANGUAGE_TARGET_AMBIGUOUS'
  | 'UGV_NATURAL_LANGUAGE_TARGET_REQUIRED'
  | 'UGV_NATURAL_LANGUAGE_REQUEST_ID_INVALID';

export class UgvNaturalLanguageCapabilityAdmissionError extends Error {
  constructor(
    readonly code: UgvNaturalLanguageCapabilityAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvNaturalLanguageCapabilityAdmissionError';
  }
}

function exactlyOneCoordinate(
  text: string,
  pattern: RegExp,
  axis: 'longitude' | 'latitude',
): number {
  const values = [...text.matchAll(pattern)].map((match) => Number(match[1]));
  if (values.length === 0)
    throw new UgvNaturalLanguageCapabilityAdmissionError(
      'UGV_NATURAL_LANGUAGE_TARGET_REQUIRED',
      `Natural-language UGV admission requires one explicitly labelled ${axis}.`,
    );
  const value = values[0];
  if (values.length !== 1 || value === undefined || !Number.isFinite(value))
    throw new UgvNaturalLanguageCapabilityAdmissionError(
      'UGV_NATURAL_LANGUAGE_TARGET_AMBIGUOUS',
      `Natural-language UGV admission requires exactly one finite ${axis}.`,
    );
  return value;
}
