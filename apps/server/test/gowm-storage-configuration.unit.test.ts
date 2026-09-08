import { describe, expect, it } from 'vitest';

import { assertDeviceWorkScope } from '../../../packages/domain/src/device-task-context.js';
import { parseGowmStorageConfiguration } from '../src/gowm-storage-configuration.js';

const config = {
  SDAR_STORAGE_MODE: 'gowm-shared',
  GOWM_DATABASE_URL: 'postgresql://test:private@localhost/test',
  SDAR_SERVICE_KEY: 'sdar-test',
  SDAR_ALLOWED_DEVICE_IDS: '["device-a","device-b"]',
  SDAR_DATA_SCOPE_KEY: 'test',
};

describe('GOWM shared storage configuration and scope', () => {
  it('keeps standalone explicit and gives shared mode one business URL', () => {
    expect(parseGowmStorageConfiguration({})).toBeUndefined();
    expect(parseGowmStorageConfiguration({ ...config, SDAR_POSTGRES_URL: 'old' })).toMatchObject({
      databaseUrl: config.GOWM_DATABASE_URL,
      allowedDeviceIds: ['device-a', 'device-b'],
      includeNonDevice: false,
    });
  });

  it.each([
    { SDAR_ALLOWED_DEVICE_IDS: 'device-a' },
    { SDAR_ALLOWED_DEVICE_IDS: '["device-a","device-a"]' },
    { SDAR_DEVICE_ID: 'outside' },
    { SDAR_DATA_SCOPE_KEY: '' },
    { GOWM_DATABASE_URL: 'postgresql://test:private@localhost/test?options=-csearch_path=public' },
    { SDAR_INCLUDE_NON_DEVICE_TASKS: 'yes' },
  ])('rejects invalid shared configuration without exposing credentials: %j', (patch) => {
    expect(() => parseGowmStorageConfiguration({ ...config, ...patch })).toThrow(
      'GOWM_STORAGE_CONFIGURATION_INVALID',
    );
  });

  it('never infers a default device from a nonempty allowed list', () => {
    expect(parseGowmStorageConfiguration(config)?.deviceId).toBeUndefined();
  });

  it('treats an empty device set and non-device channel independently', () => {
    const scope = { allowedDeviceIds: [], sdarServiceKey: 's', includeNonDevice: false };
    expect(() => {
      assertDeviceWorkScope(scope, { deviceId: 'a', sdarServiceKey: 's' });
    }).toThrow();
    expect(() => {
      assertDeviceWorkScope(scope, undefined);
    }).toThrow();
    expect(() => {
      assertDeviceWorkScope({ ...scope, includeNonDevice: true }, undefined);
    }).not.toThrow();
  });

  it('rejects the same device owned by a different service', () => {
    const scope = { allowedDeviceIds: ['a'], sdarServiceKey: 's', includeNonDevice: false };
    expect(() => {
      assertDeviceWorkScope(scope, { deviceId: 'a', sdarServiceKey: 'other' });
    }).toThrow();
    expect(() => {
      assertDeviceWorkScope(scope, { deviceId: 'a', sdarServiceKey: 's' });
    }).not.toThrow();
  });
});
