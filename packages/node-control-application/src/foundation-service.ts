import { createHash } from 'node:crypto';

import {
  createNodeProfile,
  NodeControlDomainError,
  type NodeControlReadiness,
  type NodeHealth,
  type NodeProfile,
  type NodeProfileInput,
} from '../../node-control-domain/src/index.js';
import type {
  NodeControlClock,
  NodeControlFoundationRepository,
  NodeControlIdGenerator,
} from './ports.js';

export class NodeControlFoundationService {
  readonly #repository: NodeControlFoundationRepository;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlFoundationRepository;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  migrate(): Promise<void> {
    return this.#repository.migrate();
  }

  async bootstrapNodeProfile(input: NodeProfileInput): Promise<NodeProfile> {
    const profile = createNodeProfile(input, this.#clock.now());
    await this.#repository.bootstrapNodeProfile(profile, {
      auditId: this.#ids.next(),
      actorId: 'deployment-bootstrap',
      action: 'node.profile.bootstrap',
      aggregateType: 'node_profile',
      aggregateId: profile.nodeId,
      resultRevision: profile.revision,
      reason: 'Initialize the single managed Node identity.',
      requestHash: hashJson(profile),
      resultCode: 'NODE_PROFILE_BOOTSTRAPPED',
      createdAt: this.#clock.now(),
    });
    return this.getNodeProfile();
  }

  async getNodeProfile(): Promise<NodeProfile> {
    const profile = await this.#repository.findNodeProfile();
    if (profile === undefined) {
      throw new NodeControlDomainError('NODE_PROFILE_NOT_FOUND', 'Node Profile was not found.');
    }
    return profile;
  }

  async getReadiness(): Promise<NodeControlReadiness> {
    const observedAt = this.#clock.now();
    const databaseReady = await this.#repository.probe().catch(() => false);
    const profileReady = databaseReady && (await this.#repository.findNodeProfile()) !== undefined;
    const checks = [
      {
        component: 'control_database',
        status: databaseReady ? ('healthy' as const) : ('unavailable' as const),
        ...(databaseReady ? {} : { reasonCode: 'CONTROL_DATABASE_UNAVAILABLE' }),
        observedAt,
      },
      {
        component: 'node_profile',
        status: profileReady ? ('healthy' as const) : ('unavailable' as const),
        ...(profileReady ? {} : { reasonCode: 'NODE_PROFILE_UNAVAILABLE' }),
        observedAt,
      },
    ];
    return Object.freeze({
      status: databaseReady && profileReady ? 'ready' : 'not_ready',
      checks: Object.freeze(checks),
      observedAt,
    });
  }

  async getNodeHealth(): Promise<NodeHealth> {
    const profile = await this.getNodeProfile();
    const readiness = await this.getReadiness();
    const observedAt = readiness.observedAt;
    const components = [
      ...readiness.checks,
      {
        component: 'runtime_control',
        status: 'disabled' as const,
        reasonCode: 'P02_RUNTIME_CONTROL_NOT_CONFIGURED',
        observedAt,
      },
    ];
    return Object.freeze({
      nodeId: profile.nodeId,
      status:
        profile.status === 'maintenance'
          ? 'maintenance'
          : readiness.status === 'ready'
            ? 'degraded'
            : 'unavailable',
      components: Object.freeze(components),
      activeTasks: 0,
      observedAt,
    });
  }

  listManagementOperations(limit = 100) {
    return this.#repository.listManagementOperations(boundedLimit(limit));
  }

  async getManagementOperation(operationId: string) {
    const operation = await this.#repository.findManagementOperation(operationId);
    if (operation === undefined)
      throw new NodeControlApplicationError(
        'MANAGEMENT_OPERATION_NOT_FOUND',
        'Management Operation was not found.',
      );
    return operation;
  }

  listAuditEvents(limit = 100) {
    return this.#repository.listAuditEvents(boundedLimit(limit));
  }
}

export type NodeControlApplicationErrorCode = 'MANAGEMENT_OPERATION_NOT_FOUND';

export class NodeControlApplicationError extends Error {
  readonly code: NodeControlApplicationErrorCode;

  constructor(code: NodeControlApplicationErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlApplicationError';
    this.code = code;
  }
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) return 100;
  return value;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
