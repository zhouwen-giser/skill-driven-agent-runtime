import { describe, expect, it } from 'vitest';

import {
  createConfigurationRevision,
  publishConfigurationRevision,
  validateConfigurationRevision,
  type ConfigurationRevision,
  type RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeConfigurationSource,
  RuntimeConfigurationStore,
  RuntimeConfigurationTarget,
  RuntimeTaskConfigurationBinding,
} from '../src/index.js';
import { RuntimeConfigurationAgent } from '../src/index.js';

const now = '2026-08-01T18:45:00.000Z';
const target = { targetType: 'runtime_policy', targetId: 'node-1' } as const;

describe('RuntimeConfigurationAgent', () => {
  it('activates good revisions, preserves task pins and falls back to LKG during outage', async () => {
    const store = new MemoryStore();
    const source = new MemorySource(revision(1));
    const agent = agentFor(source, store);
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      source: 'control',
      status: 'applied',
      active: { revision: 1 },
    });
    const firstPin = await agent.pinTask('task-1', target);
    source.current = revision(2);
    await expect(agent.synchronize(target)).resolves.toMatchObject({ active: { revision: 2 } });
    await expect(agent.pinTask('task-1', target)).resolves.toEqual(firstPin);
    await expect(agent.pinTask('task-2', target)).resolves.toMatchObject({ revision: 2 });

    source.unavailable = true;
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      source: 'lkg',
      status: 'unavailable',
      active: { revision: 2 },
    });
  });

  it('does not replace LKG for partial, restart-required, immutable or corrupt revisions', async () => {
    const store = new MemoryStore();
    const source = new MemorySource(revision(1));
    const agent = agentFor(source, store);
    await agent.synchronize(target);

    source.current = revision(2);
    source.applyStatus = 'partially_applied';
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      status: 'partially_applied',
      active: { revision: 1 },
    });
    expect(store.lkg?.revision).toBe(1);

    source.current = revision(2, 'restart_required');
    source.applyStatus = 'applied';
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      status: 'restart_required',
      active: { revision: 1 },
    });

    source.current = revision(2, 'immutable');
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      status: 'rejected',
      active: { revision: 1 },
    });

    source.current = { ...revision(2), content: { forged: true } };
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      status: 'rejected',
      active: { revision: 1 },
    });
    expect(store.lkg?.revision).toBe(1);
  });

  it('keeps applied state when Ack delivery fails and drains the durable Ack later', async () => {
    const store = new MemoryStore();
    const source = new MemorySource(revision(1));
    source.ackUnavailable = true;
    const agent = agentFor(source, store);
    await expect(agent.synchronize(target)).resolves.toMatchObject({
      status: 'applied',
      acknowledgementPending: true,
    });
    expect(store.lkg?.revision).toBe(1);
    source.ackUnavailable = false;
    await expect(agent.drainPendingAcks()).resolves.toBe(1);
    expect(store.pending).toHaveLength(0);
  });
});

class MemorySource implements RuntimeConfigurationSource {
  current: ConfigurationRevision;
  unavailable = false;
  ackUnavailable = false;
  applyStatus: 'applied' | 'partially_applied' | 'rejected' = 'applied';

  constructor(current: ConfigurationRevision) {
    this.current = current;
  }

  latest(_target: RuntimeConfigurationTarget, currentRevision?: number) {
    if (this.unavailable) return Promise.reject(new Error('CONTROL_UNAVAILABLE'));
    return Promise.resolve(currentRevision === this.current.revision ? undefined : this.current);
  }

  acknowledge(): Promise<void> {
    return this.ackUnavailable ? Promise.reject(new Error('ACK_UNAVAILABLE')) : Promise.resolve();
  }
}

class MemoryStore implements RuntimeConfigurationStore {
  lkg: ConfigurationRevision | undefined;
  readonly pending: RuntimeRevisionAck[] = [];
  readonly bindings = new Map<string, RuntimeTaskConfigurationBinding>();

  findLkg(): Promise<ConfigurationRevision | undefined> {
    return Promise.resolve(this.lkg);
  }

  recordOutcome(
    revisionValue: ConfigurationRevision,
    acknowledgement: RuntimeRevisionAck,
    activate: boolean,
  ): Promise<void> {
    if (activate) this.lkg = revisionValue;
    this.pending.push(acknowledgement);
    return Promise.resolve();
  }

  pinTask(
    taskId: string,
    targetValue: RuntimeConfigurationTarget,
    boundAt: string,
  ): Promise<RuntimeTaskConfigurationBinding> {
    const key = `${taskId}:${targetValue.targetType}:${targetValue.targetId}`;
    const existing = this.bindings.get(key);
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.lkg === undefined) return Promise.reject(new Error('LKG_MISSING'));
    const binding = Object.freeze({
      taskId,
      ...targetValue,
      configurationId: this.lkg.configurationId,
      revision: this.lkg.revision,
      checksum: this.lkg.checksum,
      boundAt,
    });
    this.bindings.set(key, binding);
    return Promise.resolve(binding);
  }

  listPendingAcks(limit: number): Promise<readonly RuntimeRevisionAck[]> {
    return Promise.resolve(this.pending.slice(0, limit));
  }

  markAckDelivered(acknowledgement: RuntimeRevisionAck): Promise<void> {
    const index = this.pending.indexOf(acknowledgement);
    if (index >= 0) this.pending.splice(index, 1);
    return Promise.resolve();
  }

  recordAckDeliveryFailure(): Promise<void> {
    return Promise.resolve();
  }
}

function agentFor(source: MemorySource, store: MemoryStore): RuntimeConfigurationAgent {
  return new RuntimeConfigurationAgent({
    runtimeInstanceId: 'runtime-1',
    runtimeVersion: '1.4.0',
    source,
    store,
    applier: {
      apply: () =>
        Promise.resolve({
          status: source.applyStatus,
          ...(source.applyStatus === 'applied' ? {} : { reasonCode: 'TEST_APPLY_RESULT' }),
        }),
    },
    clock: { now: () => now },
  });
}

function revision(
  revisionNumber: number,
  applyMode: ConfigurationRevision['applyMode'] = 'new_task_only',
): ConfigurationRevision {
  return publishConfigurationRevision(
    validateConfigurationRevision(
      createConfigurationRevision(
        {
          configurationId: 'runtime-policy',
          targetType: target.targetType,
          targetId: target.targetId,
          revision: revisionNumber,
          applyMode,
          content: { revision: revisionNumber },
          createdBy: 'operator-1',
        },
        now,
      ),
    ),
    now,
  );
}
