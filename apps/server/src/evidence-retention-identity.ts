import { createHash } from 'node:crypto';
import type { DeviceWorkScope } from '../../../packages/domain/src/device-task-context.js';

/** Preserve standalone identities; shared workers own separate durable daily runs. */
export function evidenceRetentionIdentity(
  exportId: string,
  revision: number,
  day: string,
  scope?: DeviceWorkScope,
): string {
  const legacy = `${exportId}:${String(revision)}:${day}`;
  const identity =
    scope === undefined
      ? legacy
      : JSON.stringify({
          version: 2,
          legacy,
          allowedDeviceIds: [...new Set(scope.allowedDeviceIds)].sort(),
          sdarServiceKey: scope.sdarServiceKey,
          includeNonDevice: scope.includeNonDevice,
        });
  return createHash('sha256').update(identity).digest('hex');
}
