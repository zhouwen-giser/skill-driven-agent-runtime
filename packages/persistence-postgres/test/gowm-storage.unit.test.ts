import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresGowmDeviceContextReader } from '../src/gowm-device-context.js';
import {
  gowmSharedPoolConfiguration,
  verifyGowmStorageContract,
} from '../src/gowm-storage-contract.js';

describe('GOWM storage boundary', () => {
  it('sets fixed options for every pool connection and rejects URL overrides', () => {
    expect(gowmSharedPoolConfiguration('postgresql://localhost/test').options).toBe(
      '-c search_path=ugv_sdar,public,pg_catalog',
    );
    expect(() =>
      gowmSharedPoolConfiguration('postgresql://localhost/test?options=unsafe'),
    ).toThrow();
  });

  it('rolls back verification when the installer history is absent, without issuing DDL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ installed: null }] });
    const client = { query } as unknown as PoolClient;
    await expect(
      verifyGowmStorageContract(client, 'contracts/gowm-shared-storage/current'),
    ).rejects.toMatchObject({
      code: 'GOWM_STORAGE_CONTRACT_MISMATCH',
    });
    expect(query.mock.calls.map((c) => c[0] as unknown)).toEqual([
      'BEGIN READ ONLY',
      "SELECT to_regclass('ugv_sdar.gowm_install_history')::text AS installed",
      'ROLLBACK',
    ]);
  });

  it('rejects devices outside its scope before accessing the directory', async () => {
    const query = vi.fn();
    const reader = new PostgresGowmDeviceContextReader({ query } as unknown as PoolClient, {
      allowedDeviceIds: [],
      sdarServiceKey: 'sdar',
      includeNonDevice: true,
    });
    await expect(reader.resolve({ deviceId: 'a', dataScopeKey: 's' })).rejects.toMatchObject({
      code: 'DEVICE_SCOPE_DENIED',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not fall back to another device or create a binding when resolution fails', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const reader = new PostgresGowmDeviceContextReader({ query } as unknown as PoolClient, {
      allowedDeviceIds: ['a', 'b'],
      sdarServiceKey: 'sdar',
      includeNonDevice: false,
    });
    await expect(reader.resolve({ deviceId: 'a', dataScopeKey: 's' })).rejects.toMatchObject({
      code: 'DEVICE_BINDING_UNAVAILABLE',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['a', 's', 'sdar', null]);
  });
});
