import type {
  TaskAvailabilityUnknownPolicy,
  TaskAvailabilityUnknownPolicyDecision,
} from '../../../packages/application/src/index.js';
import type { TaskAvailabilityCheckResult } from '../../../packages/domain/src/index.js';

const EXPLICIT_NOT_READY_SEGMENTS = new Set(['RECOVERING', 'STALE', 'UNHEALTHY', 'UNCORRELATED']);

/**
 * UGV profile policy: an unqualified Provider `unknown` may proceed after confirmation, while an
 * unknown carrying an explicit stale/unhealthy/uncorrelated/recovering condition remains blocked.
 * The bounded reason code is classified by segments so additive Provider prefixes are preserved.
 */
export const UGV_UNKNOWN_AVAILABILITY_POLICY: TaskAvailabilityUnknownPolicy = Object.freeze({
  decide(result: TaskAvailabilityCheckResult): TaskAvailabilityUnknownPolicyDecision {
    if (result.availability !== 'unknown') return 'explicitly_not_ready';
    const segments = result.reasonCode?.toUpperCase().split(/[^A-Z0-9]+/u) ?? [];
    return segments.some((segment) => EXPLICIT_NOT_READY_SEGMENTS.has(segment))
      ? 'explicitly_not_ready'
      : 'allowed_by_default';
  },
});
