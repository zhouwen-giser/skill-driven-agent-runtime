import { describe, expect, it, vi } from 'vitest';

import { createGowmTaskOwnershipResolver } from '../src/gowm-task-ownership.js';

const configuration = {
  databaseUrl: 'postgresql://localhost/test',
  serviceKey: 'sdar',
  allowedDeviceIds: ['a', 'b'],
  dataScopeKey: 'scope',
  includeNonDevice: false,
  contractDirectory: 'contracts',
};
const context = {
  deviceId: 'a',
  dataScopeKey: 'scope',
  bindingId: 'binding-a',
  sdarServiceKey: 'sdar',
  smppServiceKey: 'smpp',
  providerId: 'provider',
  resourceId: 'resource',
  sdarMcpServerId: 'server',
};

describe('normal Server GOWM Task ownership resolution', () => {
  it('does not choose the first allowed device in a multi-device process', async () => {
    const resolve = vi.fn();
    const resolver = createGowmTaskOwnershipResolver(configuration, { resolve });
    await expect(resolver({ messageText: 'read', metadata: {} })).rejects.toThrow(
      'DEVICE_CONTEXT_REQUIRED',
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves a selector against the configured directory scope, not metadata-supplied binding authority', async () => {
    const resolve = vi.fn().mockResolvedValue(context);
    const resolver = createGowmTaskOwnershipResolver(configuration, { resolve });
    await expect(
      resolver({
        messageText: 'read',
        metadata: { 'io.sdar/deviceId': 'a', bindingId: 'forged', dataScopeKey: 'other' },
      }),
    ).resolves.toEqual({ deviceId: 'a', bindingId: 'binding-a', sdarServiceKey: 'sdar' });
    expect(resolve).toHaveBeenCalledWith({ deviceId: 'a', dataScopeKey: 'scope' });
  });

  it('restores an internal child ownership with the frozen binding instead of current selection', async () => {
    const resolve = vi.fn().mockResolvedValue(context);
    const resolver = createGowmTaskOwnershipResolver(configuration, { resolve });
    await resolver({
      messageText: 'child',
      metadata: {},
      deviceOwnership: { deviceId: 'a', bindingId: 'binding-a', sdarServiceKey: 'sdar' },
    });
    expect(resolve).toHaveBeenCalledWith({
      deviceId: 'a',
      dataScopeKey: 'scope',
      bindingId: 'binding-a',
    });
  });

  it('requires an explicit non-device channel and its configured permission', async () => {
    const resolve = vi.fn();
    const command = { messageText: 'document', metadata: { 'io.sdar/nonDevice': true } };
    await expect(
      createGowmTaskOwnershipResolver(configuration, { resolve })(command),
    ).rejects.toThrow('DEVICE_SCOPE_DENIED');
    await expect(
      createGowmTaskOwnershipResolver(
        { ...configuration, includeNonDevice: true },
        { resolve },
      )(command),
    ).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
});
