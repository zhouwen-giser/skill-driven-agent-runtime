import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';

/** Subscription authority is device/service/server, with explicit non-device isolation. */
export function businessEventSubscriptionScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias = 'business_event_subscription',
) {
  if (scope === undefined) return { predicate: 'TRUE', values: [] };
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias) || !Number.isSafeInteger(first) || first < 1)
    throw new Error('DEVICE_SCOPE_SQL_INVALID');
  return {
    predicate: `((${alias}.device_id=ANY($${String(first)}::text[]) AND EXISTS(
      SELECT 1 FROM gowm_device.device_service_binding event_owner
      WHERE event_owner.device_id=${alias}.device_id AND event_owner.smpp_service_key=${alias}.smpp_service_key
        AND event_owner.sdar_mcp_server_id=${alias}.provider_id AND event_owner.sdar_service_key=$${String(first + 1)}))
      OR (${alias}.device_id IS NULL AND ${alias}.smpp_service_key IS NULL AND $${String(first + 2)}::boolean))`,
    values: [scope.allowedDeviceIds, scope.sdarServiceKey, scope.includeNonDevice],
  };
}

export function businessEventChildScope(
  scope: DeviceWorkScope | undefined,
  first: number,
  alias: string,
) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(alias)) throw new Error('DEVICE_SCOPE_SQL_INVALID');
  const filter = businessEventSubscriptionScope(scope, first, 'event_subscription');
  return scope === undefined
    ? filter
    : {
        ...filter,
        predicate: `EXISTS(SELECT 1 FROM business_event_subscription event_subscription WHERE event_subscription.subscription_id=${alias}.subscription_id AND ${filter.predicate})`,
      };
}
