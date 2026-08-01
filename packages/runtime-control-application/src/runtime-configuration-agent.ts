import {
  assertRevisionIntegrity,
  type ConfigurationRevision,
  type RuntimeRevisionAck,
  type RuntimeRevisionAckStatus,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeConfigurationApplier,
  RuntimeConfigurationSource,
  RuntimeConfigurationStore,
  RuntimeConfigurationTarget,
  RuntimeControlClock,
  RuntimeTaskConfigurationBinding,
} from './ports.js';

export type RuntimeConfigurationErrorCode = 'CONTROL_LKG_UNAVAILABLE' | 'CONTROL_APPLY_REJECTED';

export class RuntimeConfigurationError extends Error {
  readonly code: RuntimeConfigurationErrorCode;

  constructor(code: RuntimeConfigurationErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeConfigurationError';
    this.code = code;
  }
}

export interface RuntimeConfigurationSyncResult {
  readonly source: 'control' | 'lkg';
  readonly status: RuntimeRevisionAckStatus | 'unchanged';
  readonly active: ConfigurationRevision;
  readonly acknowledgementPending: boolean;
}

export class RuntimeConfigurationAgent {
  readonly #runtimeInstanceId: string;
  readonly #runtimeVersion: string;
  readonly #source: RuntimeConfigurationSource;
  readonly #store: RuntimeConfigurationStore;
  readonly #applier: RuntimeConfigurationApplier;
  readonly #clock: RuntimeControlClock;

  constructor(
    dependencies: Readonly<{
      runtimeInstanceId: string;
      runtimeVersion: string;
      source: RuntimeConfigurationSource;
      store: RuntimeConfigurationStore;
      applier: RuntimeConfigurationApplier;
      clock: RuntimeControlClock;
    }>,
  ) {
    this.#runtimeInstanceId = required(dependencies.runtimeInstanceId, 'runtimeInstanceId');
    this.#runtimeVersion = required(dependencies.runtimeVersion, 'runtimeVersion');
    this.#source = dependencies.source;
    this.#store = dependencies.store;
    this.#applier = dependencies.applier;
    this.#clock = dependencies.clock;
  }

  async synchronize(target: RuntimeConfigurationTarget): Promise<RuntimeConfigurationSyncResult> {
    const lkg = await this.#store.findLkg(target);
    let revision: ConfigurationRevision | undefined;
    try {
      revision = await this.#source.latest(target, lkg?.revision);
    } catch {
      if (lkg === undefined)
        throw new RuntimeConfigurationError(
          'CONTROL_LKG_UNAVAILABLE',
          'Control Backend is unavailable and no local LKG exists.',
        );
      return Object.freeze({
        source: 'lkg',
        status: 'unavailable',
        active: lkg,
        acknowledgementPending: false,
      });
    }
    if (revision === undefined) {
      if (lkg === undefined)
        throw new RuntimeConfigurationError(
          'CONTROL_LKG_UNAVAILABLE',
          'Control Backend returned no revision and no local LKG exists.',
        );
      return Object.freeze({
        source: 'lkg',
        status: 'unchanged',
        active: lkg,
        acknowledgementPending: false,
      });
    }
    try {
      assertRevisionIntegrity(revision);
    } catch {
      const acknowledgement = this.ack(revision, 'rejected', {
        reasonCode: 'CONFIGURATION_CHECKSUM_MISMATCH',
      });
      await this.#store.recordOutcome(revision, acknowledgement, false);
      const pending = !(await this.deliver(acknowledgement));
      if (lkg === undefined)
        throw new RuntimeConfigurationError(
          'CONTROL_APPLY_REJECTED',
          'Invalid Configuration Revision was rejected and no LKG is available.',
        );
      return Object.freeze({
        source: 'lkg',
        status: 'rejected',
        active: lkg,
        acknowledgementPending: pending,
      });
    }
    if (lkg !== undefined && revision.revision <= lkg.revision) {
      const acknowledgement = this.ack(revision, 'stale', {
        reasonCode: 'CONFIGURATION_REVISION_STALE',
        activeChecksum: lkg.checksum,
      });
      await this.#store.recordOutcome(revision, acknowledgement, false);
      return Object.freeze({
        source: 'lkg',
        status: 'stale',
        active: lkg,
        acknowledgementPending: !(await this.deliver(acknowledgement)),
      });
    }
    if (revision.applyMode === 'immutable' && lkg !== undefined) {
      return this.rejectAndKeepLkg(revision, lkg, 'CONFIGURATION_IMMUTABLE');
    }
    if (revision.applyMode === 'restart_required') {
      const acknowledgement = this.ack(revision, 'restart_required', {
        reasonCode: 'RUNTIME_RESTART_REQUIRED',
        ...(lkg === undefined ? {} : { activeChecksum: lkg.checksum }),
      });
      await this.#store.recordOutcome(revision, acknowledgement, false);
      if (lkg === undefined)
        throw new RuntimeConfigurationError(
          'CONTROL_LKG_UNAVAILABLE',
          'Revision requires restart and no active LKG exists.',
        );
      return Object.freeze({
        source: 'lkg',
        status: 'restart_required',
        active: lkg,
        acknowledgementPending: !(await this.deliver(acknowledgement)),
      });
    }
    const applied = await this.#applier.apply(revision, lkg);
    if (applied.status !== 'applied') {
      const reasonCode = applied.reasonCode ?? 'CONTROL_APPLY_REJECTED';
      const acknowledgement = this.ack(revision, applied.status, {
        reasonCode,
        ...(lkg === undefined ? {} : { activeChecksum: lkg.checksum }),
        ...(applied.detail === undefined ? {} : { detail: applied.detail }),
      });
      await this.#store.recordOutcome(revision, acknowledgement, false);
      const pending = !(await this.deliver(acknowledgement));
      if (lkg === undefined)
        throw new RuntimeConfigurationError(
          'CONTROL_APPLY_REJECTED',
          `Configuration application ended as ${applied.status} without an LKG.`,
        );
      return Object.freeze({
        source: 'lkg',
        status: applied.status,
        active: lkg,
        acknowledgementPending: pending,
      });
    }
    const acknowledgement = this.ack(revision, 'applied', {
      activeChecksum: revision.checksum,
      ...(applied.detail === undefined ? {} : { detail: applied.detail }),
    });
    await this.#store.recordOutcome(revision, acknowledgement, true);
    return Object.freeze({
      source: 'control',
      status: 'applied',
      active: revision,
      acknowledgementPending: !(await this.deliver(acknowledgement)),
    });
  }

  pinTask(
    taskId: string,
    target: RuntimeConfigurationTarget,
  ): Promise<RuntimeTaskConfigurationBinding> {
    return this.#store.pinTask(required(taskId, 'taskId'), target, this.#clock.now());
  }

  async drainPendingAcks(limit = 100): Promise<number> {
    let delivered = 0;
    for (const acknowledgement of await this.#store.listPendingAcks(boundedLimit(limit))) {
      if (await this.deliver(acknowledgement)) delivered += 1;
    }
    return delivered;
  }

  private async rejectAndKeepLkg(
    revision: ConfigurationRevision,
    lkg: ConfigurationRevision,
    reasonCode: string,
  ): Promise<RuntimeConfigurationSyncResult> {
    const acknowledgement = this.ack(revision, 'rejected', {
      reasonCode,
      activeChecksum: lkg.checksum,
    });
    await this.#store.recordOutcome(revision, acknowledgement, false);
    return Object.freeze({
      source: 'lkg',
      status: 'rejected',
      active: lkg,
      acknowledgementPending: !(await this.deliver(acknowledgement)),
    });
  }

  private ack(
    revision: ConfigurationRevision,
    status: RuntimeRevisionAckStatus,
    extra: Readonly<{
      activeChecksum?: string;
      reasonCode?: string;
      detail?: RuntimeRevisionAck['detail'];
    }>,
  ): RuntimeRevisionAck {
    return Object.freeze({
      runtimeInstanceId: this.#runtimeInstanceId,
      targetType: revision.targetType,
      targetId: revision.targetId,
      revision: revision.revision,
      status,
      observedRuntimeVersion: this.#runtimeVersion,
      ...(extra.activeChecksum === undefined ? {} : { activeChecksum: extra.activeChecksum }),
      ...(extra.reasonCode === undefined ? {} : { reasonCode: extra.reasonCode }),
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
      acknowledgedAt: this.#clock.now(),
    });
  }

  private async deliver(acknowledgement: RuntimeRevisionAck): Promise<boolean> {
    try {
      await this.#source.acknowledge(acknowledgement);
      await this.#store.markAckDelivered(acknowledgement, this.#clock.now());
      return true;
    } catch (error) {
      await this.#store.recordAckDeliveryFailure(
        acknowledgement,
        error instanceof Error ? error.message : 'ACK_DELIVERY_FAILED',
      );
      return false;
    }
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(`${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : 100;
}
