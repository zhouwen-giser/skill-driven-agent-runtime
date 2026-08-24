import { describe, expect, it } from 'vitest';

import { hashCanonicalEvidenceJson } from '../../../packages/domain/src/index.js';
import {
  UGV_MOVE_RESOURCE_ID,
  UgvMoveInputAdapterError,
  adaptUgvMoveInput,
  type UgvMoveInputAdapterErrorCode,
} from '../src/ugv-move-input-adapter.js';

describe('UGV move profile input adapter', () => {
  it('maps x to longitude and y to latitude without leaking or guessing provider fields', () => {
    const adapted = adaptUgvMoveInput({
      resourceId: UGV_MOVE_RESOURCE_ID,
      target: { x: 121.4737, y: 31.2304, frame: 'EPSG:4326' },
    });

    expect(adapted).toEqual({
      resourceId: 'vehicle:ugv1',
      target: {
        longitude: 121.4737,
        latitude: 31.2304,
        frame: 'EPSG:4326',
      },
      providerArguments: {
        resourceId: 'vehicle:ugv1',
        mission: {
          type: 'point',
          target: { longitude: 121.4737, latitude: 31.2304 },
        },
        stopOnObstacle: true,
      },
      argumentsHash: hashCanonicalEvidenceJson({
        resourceId: 'vehicle:ugv1',
        mission: {
          type: 'point',
          target: { longitude: 121.4737, latitude: 31.2304 },
        },
        stopOnObstacle: true,
      }),
    });
    expect(Object.keys(adapted.providerArguments).sort()).toEqual([
      'mission',
      'resourceId',
      'stopOnObstacle',
    ]);
    expect(adapted.providerArguments).not.toHaveProperty('speed');
    expect(adapted.providerArguments).not.toHaveProperty('route');
    expect(adapted.providerArguments.mission.target).not.toHaveProperty('x');
    expect(adapted.providerArguments.mission.target).not.toHaveProperty('y');
  });

  it('preserves the declared WGS84 axes and computes a deterministic canonical hash', () => {
    const first = adaptUgvMoveInput({
      target: { frame: 'WGS84', y: -89.5, x: 179.5 },
      resourceId: UGV_MOVE_RESOURCE_ID,
    });
    const second = adaptUgvMoveInput({
      resourceId: UGV_MOVE_RESOURCE_ID,
      target: { x: 179.5, y: -89.5, frame: 'WGS84' },
    });

    expect(first.target).toEqual({ longitude: 179.5, latitude: -89.5, frame: 'WGS84' });
    expect(first.providerArguments.mission.target).toEqual({
      longitude: 179.5,
      latitude: -89.5,
    });
    expect(first.argumentsHash).toBe(second.argumentsHash);
    expect(first.argumentsHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it.each([
    [-180, -90],
    [-180, 90],
    [180, -90],
    [180, 90],
  ] as const)('accepts the exact frozen longitude/latitude boundary (%s, %s)', (x, y) => {
    expect(
      adaptUgvMoveInput({
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x, y, frame: 'EPSG:4326' },
      }).providerArguments.mission.target,
    ).toEqual({ longitude: x, latitude: y });
  });

  it.each([
    {
      label: 'a different resource',
      input: {
        resourceId: 'vehicle:ugv2',
        target: { x: 121, y: 31, frame: 'EPSG:4326' },
      },
      code: 'UGV_PROFILE_RESOURCE_NOT_ALLOWED',
    },
    {
      label: 'an undeclared top-level field',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: 31, frame: 'EPSG:4326' },
        speed: 1,
      },
      code: 'UGV_PROFILE_RESOURCE_NOT_ALLOWED',
    },
    {
      label: 'a missing CRS',
      input: { resourceId: UGV_MOVE_RESOURCE_ID, target: { x: 121, y: 31 } },
      code: 'UGV_PROFILE_CRS_UNSUPPORTED',
    },
    {
      label: 'an undeclared CRS transformation',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: 31, frame: 'EPSG:3857' },
      },
      code: 'UGV_PROFILE_CRS_UNSUPPORTED',
    },
    {
      label: 'an undeclared target field',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: 31, frame: 'WGS84', altitude: 10 },
      },
      code: 'UGV_PROFILE_CRS_UNSUPPORTED',
    },
    {
      label: 'a longitude outside the frozen range',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 180.000_001, y: 31, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LONGITUDE_INVALID',
    },
    {
      label: 'a longitude below the frozen range',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: -180.000_001, y: 31, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LONGITUDE_INVALID',
    },
    {
      label: 'a non-finite longitude',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: Number.NaN, y: 31, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LONGITUDE_INVALID',
    },
    {
      label: 'an infinite longitude',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: Number.POSITIVE_INFINITY, y: 31, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LONGITUDE_INVALID',
    },
    {
      label: 'a latitude outside the frozen range',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: -90.000_001, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LATITUDE_INVALID',
    },
    {
      label: 'a latitude above the frozen range',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: 90.000_001, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LATITUDE_INVALID',
    },
    {
      label: 'an infinite latitude',
      input: {
        resourceId: UGV_MOVE_RESOURCE_ID,
        target: { x: 121, y: Number.NEGATIVE_INFINITY, frame: 'WGS84' },
      },
      code: 'UGV_PROFILE_LATITUDE_INVALID',
    },
  ] as const)('rejects $label with the frozen $code code', ({ input, code }) => {
    expectAdapterError(input, code);
  });
});

function expectAdapterError(input: unknown, code: UgvMoveInputAdapterErrorCode): void {
  try {
    adaptUgvMoveInput(input);
    expect.unreachable('expected the UGV profile input to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(UgvMoveInputAdapterError);
    expect(error).toMatchObject({ code });
  }
}
