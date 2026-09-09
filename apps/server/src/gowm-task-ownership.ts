import type { SubmitTaskCommand } from '../../../packages/application/src/task-service.js';
import {
  assertDeviceWorkScope,
  DeviceScopeError,
  type DeviceTaskContext,
  type DeviceTaskOwnership,
} from '../../../packages/domain/src/device-task-context.js';
import type { GowmSharedStorageConfiguration } from './gowm-storage-configuration.js';

export function createGowmTaskOwnershipResolver(
  configuration: GowmSharedStorageConfiguration,
  directory: {
    resolve(input: {
      deviceId: string;
      dataScopeKey: string;
      bindingId?: string;
    }): Promise<DeviceTaskContext>;
  },
): (command: SubmitTaskCommand) => Promise<DeviceTaskOwnership | undefined> {
  return async (command) => {
    const scope = {
      allowedDeviceIds: configuration.allowedDeviceIds,
      sdarServiceKey: configuration.serviceKey,
      includeNonDevice: configuration.includeNonDevice,
    };
    if (command.deviceOwnership !== undefined) {
      assertDeviceWorkScope(scope, command.deviceOwnership);
      const context = await directory.resolve({
        deviceId: command.deviceOwnership.deviceId,
        bindingId: command.deviceOwnership.bindingId,
        dataScopeKey: configuration.dataScopeKey,
      });
      return {
        deviceId: context.deviceId,
        bindingId: context.bindingId,
        sdarServiceKey: context.sdarServiceKey,
      };
    }
    // Metadata carries only a selector; the validated directory remains authority.
    const requested = command.metadata['io.sdar/deviceId'];
    const nonDevice = command.metadata['io.sdar/nonDevice'] === true;
    if (nonDevice) {
      if (requested !== undefined) throw new DeviceScopeError('DEVICE_SCOPE_DENIED');
      assertDeviceWorkScope(scope, undefined);
      return undefined;
    }
    if (requested !== undefined && (typeof requested !== 'string' || requested.trim() === ''))
      throw new DeviceScopeError('DEVICE_CONTEXT_REQUIRED');
    const deviceId = typeof requested === 'string' ? requested : configuration.deviceId;
    if (deviceId === undefined) throw new DeviceScopeError('DEVICE_CONTEXT_REQUIRED');
    const context = await directory.resolve({ deviceId, dataScopeKey: configuration.dataScopeKey });
    return {
      deviceId: context.deviceId,
      bindingId: context.bindingId,
      sdarServiceKey: context.sdarServiceKey,
    };
  };
}
