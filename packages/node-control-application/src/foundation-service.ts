import { createHash } from 'node:crypto';

import {
  createNodeProfile,
  createNodeProfileRevision,
  createManagementOperation,
  transitionManagementOperation,
  NodeControlDomainError,
  type NodeControlReadiness,
  type NodeHealth,
  type NodeProfile,
  type NodeProfileInput,
  type NodeProfileDraftInput,
  type ManagementOperation,
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
  readonly #runtimeControlConfigured: boolean;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlFoundationRepository;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
      runtimeControlConfigured?: boolean;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#runtimeControlConfigured = dependencies.runtimeControlConfigured ?? false;
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

  async updateNodeProfileDraft(
    input: NodeProfileDraftInput,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<NodeProfile> {
    const current = await this.getNodeProfile();
    const expectedRevision = profileRevisionFromEtag(expectedEtag, current.nodeId);
    if (input.nodeId !== current.nodeId)
      throw new NodeControlFoundationError(
        'NODE_PROFILE_IDENTITY_IMMUTABLE',
        'The managed Node identity cannot be replaced.',
        409,
      );
    if (input.status !== 'draft')
      throw new NodeControlFoundationError(
        'NODE_PROFILE_DRAFT_REQUIRED',
        'A Node Profile draft must have draft status.',
        422,
      );
    if (input.revision !== expectedRevision + 1)
      throw new NodeControlFoundationError(
        'NODE_PROFILE_REVISION_CONFLICT',
        'The next Node Profile revision is not contiguous.',
        409,
      );
    const profile = createNodeProfileRevision(input, input.revision, this.#clock.now());
    return this.#repository.createNodeProfileDraft(
      profile,
      expectedRevision,
      mutationContext('node.profile.draft', idempotencyKey, input, this.#clock.now()),
    );
  }

  async validateNodeProfileDraft(
    expectedEtag: string,
    idempotencyKey: string,
    command: Readonly<{ reason: string; expectedRevision?: number }>,
  ): Promise<NodeProfile> {
    const current = await this.getNodeProfile();
    const revision = profileRevisionFromEtag(expectedEtag, current.nodeId);
    assertExpectedProfileRevision(command.expectedRevision, revision);
    return this.#repository.validateNodeProfileDraft(
      revision,
      revision,
      mutationContext(
        'node.profile.validate',
        idempotencyKey,
        command,
        this.#clock.now(),
        command.reason,
      ),
    );
  }

  async publishNodeProfileDraft(
    expectedEtag: string,
    idempotencyKey: string,
    command: Readonly<{ reason: string; expectedRevision?: number }>,
  ): Promise<ManagementOperation> {
    const current = await this.getNodeProfile();
    const revision = profileRevisionFromEtag(expectedEtag, current.nodeId);
    assertExpectedProfileRevision(command.expectedRevision, revision);
    const occurredAt = this.#clock.now();
    const context = mutationContext(
      'node.profile.publish',
      idempotencyKey,
      command,
      occurredAt,
      command.reason,
    );
    const accepted = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: 'node.profile.publish',
        target: { type: 'node_profile', id: current.nodeId, revision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      occurredAt,
    );
    const completed = transitionManagementOperation(
      transitionManagementOperation(accepted, 'running', occurredAt),
      'succeeded',
      occurredAt,
      { result: { nodeId: current.nodeId, revision, status: 'active' } },
    );
    return this.#repository.publishNodeProfileDraft(
      revision,
      revision,
      completed,
      {
        auditId: this.#ids.next(),
        actorId: context.actorId,
        action: 'node.profile.publish',
        aggregateType: 'node_profile',
        aggregateId: current.nodeId,
        expectedRevision: revision,
        resultRevision: revision,
        reason: context.reason,
        requestHash: context.requestHash,
        resultCode: 'NODE_PROFILE_PUBLISHED',
        createdAt: occurredAt,
      },
      context,
    );
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
        status: this.#runtimeControlConfigured ? ('degraded' as const) : ('disabled' as const),
        reasonCode: this.#runtimeControlConfigured
          ? 'RUNTIME_CONTROL_REACHABILITY_NOT_PROBED'
          : 'RUNTIME_CONTROL_NOT_CONFIGURED',
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

export class NodeControlFoundationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'NodeControlFoundationError';
    this.code = code;
    this.status = status;
  }
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) return 100;
  return value;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mutationContext(
  scope: string,
  idempotencyKey: string,
  input: unknown,
  occurredAt: string,
  reason = 'Update Node Profile draft.',
) {
  const normalized = idempotencyKey.trim();
  if (normalized.length < 8 || normalized.length > 128)
    throw new NodeControlFoundationError(
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key must contain 8 to 128 characters.',
      400,
    );
  return Object.freeze({
    actorId: 'deployment-operator',
    reason,
    idempotencyKeyHash: createHash('sha256').update(`${scope}:${normalized}`).digest('hex'),
    requestHash: hashJson(input),
    occurredAt,
  });
}

function profileRevisionFromEtag(value: string, nodeId: string): number {
  const match = /^"node:(\d+):(draft|active|maintenance|retired):([a-f0-9]{64})"$/u.exec(value);
  const expectedIdentityHash = createHash('sha256').update(nodeId).digest('hex');
  if (match?.[3] !== expectedIdentityHash)
    throw new NodeControlFoundationError('PRECONDITION_FAILED', 'If-Match is stale.', 412);
  return Number(match[1]);
}

function assertExpectedProfileRevision(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual)
    throw new NodeControlFoundationError(
      'PRECONDITION_FAILED',
      'expectedRevision does not match If-Match.',
      412,
    );
}
