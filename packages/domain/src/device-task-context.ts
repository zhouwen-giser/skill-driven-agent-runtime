/** Stable business ownership, independent of worker and MCP session identities. */
export interface DeviceTaskOwnership {
  readonly deviceId: string;
  readonly bindingId: string;
  readonly sdarServiceKey: string;
}

export interface DeviceTaskContext extends DeviceTaskOwnership {
  readonly dataScopeKey: string;
  readonly smppServiceKey: string;
  readonly providerId: string;
  readonly resourceId: string;
  readonly sdarMcpServerId: string;
  readonly agentProfileId?: string;
}

export interface DeviceWorkScope {
  readonly allowedDeviceIds: readonly string[];
  readonly sdarServiceKey: string;
  /** Non-device work is an explicit channel, never a wildcard. */
  readonly includeNonDevice: boolean;
}

export class DeviceScopeError extends Error {
  constructor(
    readonly code:
      | 'DEVICE_CONTEXT_REQUIRED'
      | 'DEVICE_SCOPE_DENIED'
      | 'DEVICE_BINDING_UNAVAILABLE'
      | 'DEVICE_BINDING_AMBIGUOUS',
  ) {
    super(code);
    this.name = 'DeviceScopeError';
  }
}

export function assertDeviceWorkScope(
  scope: DeviceWorkScope,
  owner: Pick<DeviceTaskContext, 'deviceId' | 'sdarServiceKey'> | undefined,
): void {
  if (owner === undefined) {
    if (!scope.includeNonDevice) throw new DeviceScopeError('DEVICE_SCOPE_DENIED');
    return;
  }
  if (
    owner.sdarServiceKey !== scope.sdarServiceKey ||
    !scope.allowedDeviceIds.includes(owner.deviceId)
  ) {
    throw new DeviceScopeError('DEVICE_SCOPE_DENIED');
  }
}
