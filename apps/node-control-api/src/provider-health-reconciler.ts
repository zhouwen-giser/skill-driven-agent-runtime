import { createHash } from 'node:crypto';

import type {
  McpProviderBindingDetail,
  NodeControlMcpProviderBindingService,
} from '../../../packages/node-control-application/src/index.js';

export const PROVIDER_HEALTH_RECONCILIATION_INTERVAL_MS = 30_000;
const MINIMUM_REMAINING_HEALTH_VALIDITY_MS = 60_000;

type ProviderHealthBindingService = Pick<
  NodeControlMcpProviderBindingService,
  'listBindings' | 'getBinding' | 'refresh'
>;

export interface ProviderHealthReconciliationResult {
  readonly refreshedCount: number;
  readonly skippedCount: number;
  readonly failures: readonly Readonly<{ bindingId: string; errorCode: string }>[];
}

/**
 * Scheduling only. The formal refresh service owns durable health observations and semantic
 * revision changes; its discovery path uses server/discover + tools/list and never tools/call.
 */
export class NodeControlProviderHealthReconciler {
  readonly #bindings: ProviderHealthBindingService;
  readonly #clock: Readonly<{ now(): string }>;
  #inFlight: Promise<ProviderHealthReconciliationResult> | undefined;

  constructor(
    dependencies: Readonly<{
      bindings: ProviderHealthBindingService;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#bindings = dependencies.bindings;
    this.#clock = dependencies.clock;
  }

  reconcile(): Promise<ProviderHealthReconciliationResult> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    const current = this.observeRegisteredBindings().finally(() => {
      if (this.#inFlight === current) this.#inFlight = undefined;
    });
    this.#inFlight = current;
    return current;
  }

  private async observeRegisteredBindings(): Promise<ProviderHealthReconciliationResult> {
    const observedAt = Date.parse(this.#clock.now());
    if (!Number.isFinite(observedAt)) throw new Error('PROVIDER_HEALTH_CLOCK_INVALID');
    const bindings = await this.#bindings.listBindings(1_000);
    const failures: { bindingId: string; errorCode: string }[] = [];
    let refreshedCount = 0;
    let skippedCount = 0;
    for (const binding of bindings) {
      if (binding.status !== 'active') {
        skippedCount += 1;
        continue;
      }
      try {
        // Re-read so a suspension or a new revision after listing cannot be renewed from stale state.
        const current = await this.#bindings.getBinding(binding.bindingId);
        if (!needsObservation(current, observedAt)) {
          skippedCount += 1;
          continue;
        }
        const identity = createHash('sha256')
          .update(
            JSON.stringify([
              current.bindingId,
              current.revision,
              Math.floor(observedAt / PROVIDER_HEALTH_RECONCILIATION_INTERVAL_MS),
            ]),
          )
          .digest('hex');
        const operation = await this.#bindings.refresh(
          current.bindingId,
          `provider-health-${identity}`,
          'Observe registered Provider health through MCP discovery without executing tools.',
        );
        if (operation.status === 'succeeded') refreshedCount += 1;
        else {
          failures.push({
            bindingId: binding.bindingId,
            errorCode: safeHealthErrorCode({ code: operation.errorCode }),
          });
        }
      } catch (error: unknown) {
        failures.push({ bindingId: binding.bindingId, errorCode: safeHealthErrorCode(error) });
      }
    }
    return Object.freeze({
      refreshedCount,
      skippedCount,
      failures: Object.freeze(failures.map((failure) => Object.freeze(failure))),
    });
  }
}

function needsObservation(binding: McpProviderBindingDetail, observedAt: number): boolean {
  if (binding.status !== 'active') return false;
  const validUntil = Date.parse(binding.availabilityValidUntil);
  return (
    binding.availabilityStatus !== 'available' ||
    !Number.isFinite(validUntil) ||
    validUntil - observedAt <= MINIMUM_REMAINING_HEALTH_VALIDITY_MS
  );
}

function safeHealthErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)
  )
    return error.code;
  return 'MCP_PROVIDER_HEALTH_REFRESH_FAILED';
}
