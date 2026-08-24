import { hashCanonicalEvidenceJson } from '../../../packages/domain/src/index.js';

export const UGV_MOVE_RESOURCE_ID = 'vehicle:ugv1' as const;

export interface AdaptedUgvMoveInput {
  readonly resourceId: typeof UGV_MOVE_RESOURCE_ID;
  readonly target: Readonly<{
    longitude: number;
    latitude: number;
    frame: 'EPSG:4326' | 'WGS84';
  }>;
  readonly providerArguments: Readonly<{
    resourceId: typeof UGV_MOVE_RESOURCE_ID;
    mission: Readonly<{
      type: 'point';
      target: Readonly<{ longitude: number; latitude: number }>;
    }>;
    stopOnObstacle: true;
  }>;
  readonly argumentsHash: `sha256:${string}`;
}

/** Deterministic pre-dispatch adaptation. It never swaps axes or invents route/speed parameters. */
export function adaptUgvMoveInput(value: unknown): AdaptedUgvMoveInput {
  const input = record(value);
  if (
    input === undefined ||
    Object.keys(input).some((key) => key !== 'resourceId' && key !== 'target')
  )
    fail('UGV_PROFILE_RESOURCE_NOT_ALLOWED', 'UGV move input violates the exact profile shape.');
  if (input['resourceId'] !== UGV_MOVE_RESOURCE_ID)
    fail('UGV_PROFILE_RESOURCE_NOT_ALLOWED', 'UGV move requires the exact profile resource.');
  const target = record(input['target']);
  if (
    target === undefined ||
    Object.keys(target).some((key) => key !== 'x' && key !== 'y' && key !== 'frame')
  )
    fail('UGV_PROFILE_CRS_UNSUPPORTED', 'UGV move target violates the exact coordinate shape.');
  const frame = target['frame'];
  if (frame !== 'EPSG:4326' && frame !== 'WGS84')
    fail('UGV_PROFILE_CRS_UNSUPPORTED', 'UGV move supports only explicit EPSG:4326 or WGS84.');
  const longitude = coordinate(target['x'], -180, 180, 'UGV_PROFILE_LONGITUDE_INVALID');
  const latitude = coordinate(target['y'], -90, 90, 'UGV_PROFILE_LATITUDE_INVALID');
  const providerArguments = Object.freeze({
    resourceId: UGV_MOVE_RESOURCE_ID,
    mission: Object.freeze({
      type: 'point' as const,
      target: Object.freeze({ longitude, latitude }),
    }),
    stopOnObstacle: true as const,
  });
  return Object.freeze({
    resourceId: UGV_MOVE_RESOURCE_ID,
    target: Object.freeze({ longitude, latitude, frame }),
    providerArguments,
    argumentsHash: hashCanonicalEvidenceJson(providerArguments),
  });
}

export type UgvMoveInputAdapterErrorCode =
  | 'UGV_PROFILE_RESOURCE_NOT_ALLOWED'
  | 'UGV_PROFILE_CRS_UNSUPPORTED'
  | 'UGV_PROFILE_LONGITUDE_INVALID'
  | 'UGV_PROFILE_LATITUDE_INVALID';

export class UgvMoveInputAdapterError extends Error {
  constructor(
    readonly code: UgvMoveInputAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveInputAdapterError';
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function coordinate(
  value: unknown,
  minimum: number,
  maximum: number,
  code: UgvMoveInputAdapterErrorCode,
) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    return fail(code, 'UGV move coordinate is outside its declared WGS84 axis range.');
  return value;
}

function fail(code: UgvMoveInputAdapterErrorCode, message: string): never {
  throw new UgvMoveInputAdapterError(code, message);
}
