import { createHash } from 'node:crypto';

import type {
  NodeControlCapabilityService,
  NodeControlFoundationService,
} from '../../../packages/node-control-application/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
  type ManagementOperation,
} from '../../../packages/node-control-domain/src/index.js';
import type {
  RuntimeCapabilityReadinessService,
  CapabilityReadinessStatus,
} from '../../../packages/runtime-control-application/src/index.js';

export class NodeControlCapabilityReadinessCoordinator {
  readonly #capabilities: NodeControlCapabilityService;
  readonly #runtime: RuntimeCapabilityReadinessService;
  readonly #foundation: NodeControlFoundationService;
  readonly #ttlMs: number;
  readonly #minimumStableWindowMs: number;

  constructor(
    dependencies: Readonly<{
      capabilities: NodeControlCapabilityService;
      runtime: RuntimeCapabilityReadinessService;
      foundation: NodeControlFoundationService;
      ttlMs?: number;
      minimumStableWindowMs?: number;
    }>,
  ) {
    this.#capabilities = dependencies.capabilities;
    this.#runtime = dependencies.runtime;
    this.#foundation = dependencies.foundation;
    this.#ttlMs = dependencies.ttlMs ?? 60_000;
    this.#minimumStableWindowMs = dependencies.minimumStableWindowMs ?? 10_000;
  }

  async list(status: string | undefined, limit: number) {
    const parsed = readinessStatus(status);
    const records = await this.#runtime.list(parsed, limit);
    return records.map((record) => record.snapshot);
  }

  async get(capabilityId: string, capabilityVersion: number) {
    return this.#runtime.get(capabilityId, capabilityVersion);
  }

  async evaluate(
    capabilityId: string,
    capabilityVersion: number,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const definition = await this.#capabilities.get(capabilityId, capabilityVersion);
    const implementations = await this.#capabilities.listImplementations(
      capabilityId,
      capabilityVersion,
      1_000,
    );
    const profile = await this.#foundation.getNodeProfile();
    const readinessInput = {
      definition,
      implementations,
      maintenanceMode: profile.status === 'maintenance' || profile.status === 'retired',
      killSwitch: definition.status === 'suspended',
      ttlMs: this.#ttlMs,
      minimumStableWindowMs: this.#minimumStableWindowMs,
      trigger: reason,
    } as const;
    const requestHash = hash(JSON.stringify(readinessInput));
    const record = await this.#runtime.evaluate(readinessInput, {
      idempotencyKey,
      requestHash: `sha256:${requestHash}`,
    });
    const operation = createManagementOperation(
      {
        operationId: `readiness-${hash(idempotencyKey).slice(0, 32)}`,
        operationType: 'capability.readiness.evaluate',
        target: {
          type: 'capability_readiness',
          id: capabilityId,
          version: String(capabilityVersion),
        },
        actorId: 'node-control-api',
        reason,
        idempotencyKeyHash: hash(idempotencyKey),
        inputHash: requestHash,
      },
      record.snapshot.evaluatedAt,
    );
    return transitionManagementOperation(
      transitionManagementOperation(operation, 'running', record.snapshot.evaluatedAt),
      'succeeded',
      record.snapshot.evaluatedAt,
      { result: record.snapshot },
    );
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readinessStatus(value: string | undefined): CapabilityReadinessStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === 'available' ||
    value === 'degraded' ||
    value === 'unavailable' ||
    value === 'suspended'
  )
    return value;
  throw new Error('CAPABILITY_READINESS_STATUS_INVALID');
}
