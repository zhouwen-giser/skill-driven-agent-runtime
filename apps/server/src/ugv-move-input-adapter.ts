import { hashCanonicalEvidenceJson } from '../../../packages/domain/src/index.js';

/** Resource identity comes from governance, never a deployment-specific code constant. */
export function requireUgvResourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^vehicle:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
    fail(
      'UGV_PROFILE_RESOURCE_NOT_ALLOWED',
      'UGV move requires a bounded vehicle resource identity.',
    );
  return value;
}

export function ugvResourceIdFromSchema(value: unknown): string {
  return requireUgvResourceId(
    record(record(record(value)?.['properties'])?.['resourceId'])?.['const'],
  );
}

/** Called only on the durable, hash-validated Task Capability authority. */
export function ugvResourceIdFromBinding(
  binding: Readonly<{
    inputSnapshot: unknown;
    constraintSnapshot: readonly Readonly<Record<string, unknown>>[];
  }>,
): string {
  const resourceId = requireUgvResourceId(record(binding.inputSnapshot)?.['resourceId']);
  const policies = binding.constraintSnapshot.filter((item) => item['type'] === 'resource_policy');
  const policy = policies[0];
  const allowed = policy?.['allowedResourceIds'];
  if (
    policies.length !== 1 ||
    policy?.['selection'] !== 'exact_value' ||
    policy['downstreamResourceBinding'] !== 'forbidden' ||
    !Array.isArray(allowed) ||
    allowed.length !== 1 ||
    allowed[0] !== resourceId
  )
    fail(
      'UGV_PROFILE_RESOURCE_NOT_ALLOWED',
      'UGV input does not match the frozen resource authority.',
    );
  return resourceId;
}

export interface AdaptedUgvMoveInput {
  readonly resourceId: string;
  readonly target: Readonly<{
    longitude: number;
    latitude: number;
    frame: 'EPSG:4326' | 'WGS84';
  }>;
  readonly providerArguments: Readonly<{
    resourceId: string;
    mission: Readonly<{
      type: 'point';
      target: Readonly<{ longitude: number; latitude: number }>;
    }>;
    stopOnObstacle: true;
  }>;
  readonly argumentsHash: `sha256:${string}`;
}

/** Deterministic pre-dispatch adaptation. It never swaps axes or invents route/speed parameters. */
export function adaptUgvMoveInput(value: unknown, expectedResourceId: string): AdaptedUgvMoveInput {
  const resourceId = requireUgvResourceId(expectedResourceId);
  const input = record(value);
  if (
    input === undefined ||
    Object.keys(input).some((key) => key !== 'resourceId' && key !== 'target')
  )
    fail('UGV_PROFILE_RESOURCE_NOT_ALLOWED', 'UGV move input violates the exact profile shape.');
  if (input['resourceId'] !== resourceId)
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
    resourceId: resourceId,
    mission: Object.freeze({
      type: 'point' as const,
      target: Object.freeze({ longitude, latitude }),
    }),
    stopOnObstacle: true as const,
  });
  return Object.freeze({
    resourceId: resourceId,
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
