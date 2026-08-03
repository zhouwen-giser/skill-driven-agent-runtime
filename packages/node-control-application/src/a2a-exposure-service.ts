import { createHash } from 'node:crypto';

import {
  a2aExposureEtag,
  assertA2aExposureTransition,
  createA2aExposureVersion,
  createManagementOperation,
  transitionManagementOperation,
  type A2aExposureStatus,
  type A2aExposureVersion,
  type AgentCardRevision,
  type JsonObject,
  type ManagementOperation,
  type NodeCapabilityDefinitionVersion,
  type RuntimeAgentCardCandidate,
} from '../../node-control-domain/src/index.js';

export interface NodeControlA2aExposureRepository {
  find(exposureId: string, version: number): Promise<A2aExposureVersion | undefined>;
  list(status: string | undefined, limit: number): Promise<readonly A2aExposureVersion[]>;
  create(exposure: A2aExposureVersion, command: A2aCommandContext): Promise<A2aExposureVersion>;
  findCommandReplay(
    scope: string,
    command: A2aCommandContext,
  ): Promise<ManagementOperation | undefined>;
  transition(
    prior: A2aExposureVersion,
    next: A2aExposureVersion,
    operation: ManagementOperation,
    command: A2aCommandContext,
  ): Promise<ManagementOperation>;
  listPublished(): Promise<readonly A2aExposureVersion[]>;
  nextAgentCardRevision(): Promise<number>;
  findActiveAgentCard(): Promise<AgentCardRevision | undefined>;
  saveCandidate(candidate: RuntimeAgentCardCandidate): Promise<AgentCardRevision>;
  markAgentCard(
    revision: number,
    status: AgentCardRevision['status'],
    activatedAt?: string,
    rejectionCode?: string,
  ): Promise<AgentCardRevision>;
  listAgentCards(limit: number): Promise<readonly AgentCardRevision[]>;
  findAgentCard(revision: number): Promise<AgentCardRevision | undefined>;
  transitionOperation(
    operation: ManagementOperation,
    command: A2aCommandContext,
    completed: ManagementOperation,
  ): Promise<ManagementOperation>;
}

export interface A2aCommandContext {
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface A2aCapabilitySource {
  get(capabilityId: string, capabilityVersion: number): Promise<NodeCapabilityDefinitionVersion>;
}

export interface A2aReadinessSource {
  get(
    capabilityId: string,
    capabilityVersion: number,
  ): Promise<
    | Readonly<{
        snapshot: Readonly<{
          status: 'available' | 'degraded' | 'unavailable' | 'suspended';
          snapshotVersion: number;
          validUntil: string;
        }>;
        snapshotHash: string;
      }>
    | undefined
  >;
}

export interface RuntimeAgentCardDeployment {
  stage(candidate: RuntimeAgentCardCandidate, command: A2aCommandContext): Promise<void>;
  activate(revision: number, command: A2aCommandContext): Promise<void>;
  rollback(
    revision: number,
    priorRevision: number | undefined,
    command: A2aCommandContext,
  ): Promise<void>;
}

export interface A2aAgentCardValidator {
  validate(card: JsonObject): void;
}

export class NodeControlA2aExposureService {
  readonly #repository: NodeControlA2aExposureRepository;
  readonly #capabilities: A2aCapabilitySource;
  readonly #readiness: A2aReadinessSource;
  readonly #runtime: RuntimeAgentCardDeployment;
  readonly #validator: A2aAgentCardValidator;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nodeId: string;
  readonly #a2aUrl: string;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlA2aExposureRepository;
      capabilities: A2aCapabilitySource;
      readiness: A2aReadinessSource;
      runtime: RuntimeAgentCardDeployment;
      validator: A2aAgentCardValidator;
      clock: Readonly<{ now(): string }>;
      nodeId: string;
      a2aUrl: string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#capabilities = dependencies.capabilities;
    this.#readiness = dependencies.readiness;
    this.#runtime = dependencies.runtime;
    this.#validator = dependencies.validator;
    this.#clock = dependencies.clock;
    this.#nodeId = dependencies.nodeId;
    this.#a2aUrl = dependencies.a2aUrl;
  }

  list(status?: string, limit = 100) {
    return this.#repository.list(status, boundedLimit(limit));
  }

  async get(exposureId: string, version: number) {
    const exposure = await this.#repository.find(exposureId, version);
    if (exposure === undefined) throw new Error('A2A_EXPOSURE_NOT_FOUND');
    return exposure;
  }

  async create(input: A2aExposureVersion, idempotencyKey: string) {
    const exposure = createA2aExposureVersion(input);
    if (exposure.status !== 'draft') throw new Error('A2A_EXPOSURE_CREATE_REQUIRES_DRAFT');
    const command = this.command('a2a-exposure:create', idempotencyKey, exposure);
    const existing = await this.#repository.find(exposure.exposureId, exposure.version);
    if (existing !== undefined) {
      if (existing.exposureHash === exposure.exposureHash) return existing;
      throw new Error('A2A_EXPOSURE_CONFLICT');
    }
    return this.#repository.create(exposure, command);
  }

  async transition(
    exposureId: string,
    version: number,
    targetStatus: Exclude<A2aExposureStatus, 'draft'>,
    idempotencyKey: string,
    ifMatch: string,
    reason: string,
  ) {
    const prior = await this.get(exposureId, version);
    const command = this.command(`a2a-exposure:${targetStatus}`, idempotencyKey, {
      exposureId,
      version,
      targetStatus,
      reason,
      ifMatch,
    });
    const replay = await this.#repository.findCommandReplay(command.scope, command);
    if (replay !== undefined) return replay;
    if (a2aExposureEtag(prior) !== ifMatch) throw new Error('PRECONDITION_FAILED');
    assertA2aExposureTransition(prior, targetStatus);
    if (targetStatus === 'published') await this.assertPublishable(prior);
    const next = createA2aExposureVersion({ ...prior, status: targetStatus });
    const operation = operationFor(
      `exposure-${hash(idempotencyKey).slice(0, 32)}`,
      'a2a.exposure.transition',
      exposureId,
      version,
      reason,
      idempotencyKey,
      command.requestHash,
      command.occurredAt,
    );
    return this.#repository.transition(prior, next, operation, command);
  }

  listAgentCards(limit = 100) {
    return this.#repository.listAgentCards(boundedLimit(limit));
  }

  async getAgentCard(revision: number) {
    const card = await this.#repository.findAgentCard(revision);
    if (card === undefined) throw new Error('AGENT_CARD_REVISION_NOT_FOUND');
    return card;
  }

  async rebuild(idempotencyKey: string, reason: string): Promise<ManagementOperation> {
    const command = this.command('agent-card:rebuild', idempotencyKey, { reason });
    const replay = await this.#repository.findCommandReplay(command.scope, command);
    if (replay !== undefined) return replay;
    const exposures = await this.#repository.listPublished();
    const generatedAt = command.occurredAt;
    const eligible: Readonly<{
      exposure: A2aExposureVersion;
      readinessStatus: string;
      readinessHash: string;
    }>[] = [];
    for (const exposure of exposures) {
      const capability = await this.#capabilities.get(
        exposure.capabilityId,
        exposure.capabilityVersion,
      );
      if (capability.status !== 'published') continue;
      const readiness = await this.#readiness.get(
        exposure.capabilityId,
        exposure.capabilityVersion,
      );
      if (
        readiness === undefined ||
        Date.parse(readiness.snapshot.validUntil) <= Date.parse(generatedAt) ||
        !publishableReadiness(
          readiness.snapshot.status,
          exposure.readinessPublicationPolicy ?? 'publish_when_available',
        )
      )
        continue;
      if (exposure.visibility !== 'public') continue;
      eligible.push({
        exposure,
        readinessStatus: readiness.snapshot.status,
        readinessHash: readiness.snapshotHash,
      });
    }
    const sorted = [...eligible].sort((left, right) =>
      left.exposure.agentSkillId.localeCompare(right.exposure.agentSkillId),
    );
    if (new Set(sorted.map((value) => value.exposure.agentSkillId)).size !== sorted.length)
      throw new Error('A2A_AGENT_SKILL_ID_CONFLICT');
    const exposureRefs = Object.freeze(
      sorted.map(({ exposure }) => `${exposure.exposureId}:${String(exposure.version)}`),
    );
    const capabilityCatalogHash = hash(
      canonical(
        sorted.map(({ exposure, readinessHash }) => ({
          capabilityId: exposure.capabilityId,
          capabilityVersion: exposure.capabilityVersion,
          exposureHash: exposure.exposureHash,
          readinessHash,
        })),
      ),
    );
    const card = buildCard(this.#a2aUrl, sorted);
    this.#validator.validate(card);
    const contentHash = hash(canonical(card));
    const current = await this.#repository.findActiveAgentCard();
    if (
      current?.status === 'active' &&
      current.contentHash === contentHash &&
      current.capabilityCatalogHash === capabilityCatalogHash
    ) {
      const unchanged = operationFor(
        `agent-card-${hash(idempotencyKey).slice(0, 32)}`,
        'agent_card.rebuild',
        this.#nodeId,
        current.revision,
        reason,
        idempotencyKey,
        command.requestHash,
        generatedAt,
      );
      return await this.#repository.transitionOperation(
        unchanged,
        command,
        transitionManagementOperation(
          transitionManagementOperation(unchanged, 'running', generatedAt),
          'succeeded',
          generatedAt,
          { result: current },
        ),
      );
    }
    const revisionNumber = await this.#repository.nextAgentCardRevision();
    const candidate: RuntimeAgentCardCandidate = Object.freeze({
      revision: Object.freeze({
        revision: revisionNumber,
        nodeId: this.#nodeId,
        exposureRefs,
        contentHash,
        capabilityCatalogHash,
        status: 'candidate',
        generatedAt,
      }),
      card,
      exposureSnapshots: Object.freeze(sorted.map(({ exposure }) => exposure)),
    });
    await this.#repository.saveCandidate(candidate);
    const operation = operationFor(
      `agent-card-${hash(idempotencyKey).slice(0, 32)}`,
      'agent_card.rebuild',
      this.#nodeId,
      revisionNumber,
      reason,
      idempotencyKey,
      command.requestHash,
      generatedAt,
    );
    let runtimeActivated = false;
    try {
      await this.#runtime.stage(candidate, command);
      await this.#repository.markAgentCard(revisionNumber, 'staged');
      await this.#runtime.activate(revisionNumber, command);
      runtimeActivated = true;
      const active = await this.#repository.markAgentCard(revisionNumber, 'active', generatedAt);
      return await this.#repository.transitionOperation(
        operation,
        command,
        transitionManagementOperation(
          transitionManagementOperation(operation, 'running', generatedAt),
          'succeeded',
          generatedAt,
          { result: active },
        ),
      );
    } catch (error) {
      if (runtimeActivated) {
        await this.#runtime.rollback(revisionNumber, current?.revision, command);
      }
      const errorCode = safeErrorCode(error);
      const rejected = await this.#repository.markAgentCard(
        revisionNumber,
        'rejected',
        undefined,
        errorCode,
      );
      return await this.#repository.transitionOperation(
        operation,
        command,
        transitionManagementOperation(
          transitionManagementOperation(operation, 'running', generatedAt),
          'failed',
          generatedAt,
          { result: rejected, errorCode },
        ),
      );
    }
  }

  async assertPublishable(exposure: A2aExposureVersion): Promise<void> {
    const capability = await this.#capabilities.get(
      exposure.capabilityId,
      exposure.capabilityVersion,
    );
    if (capability.status !== 'published') throw new Error('A2A_CAPABILITY_NOT_PUBLISHED');
    if (canonical(capability.inputSchema) !== canonical(exposure.requestSchema))
      throw new Error('A2A_REQUEST_SCHEMA_MISMATCH');
    if (canonical(capability.outputSchema) !== canonical(exposure.resultSchema))
      throw new Error('A2A_RESULT_SCHEMA_MISMATCH');
  }

  private command(scope: string, idempotencyKey: string, input: unknown): A2aCommandContext {
    if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 256)
      throw new Error('IDEMPOTENCY_KEY_INVALID');
    return Object.freeze({
      scope,
      idempotencyKey,
      requestHash: hash(canonical(input)),
      occurredAt: this.#clock.now(),
    });
  }
}

function buildCard(
  url: string,
  entries: readonly Readonly<{
    exposure: A2aExposureVersion;
    readinessStatus: string;
    readinessHash: string;
  }>[],
): JsonObject {
  return {
    name: 'Skill-Driven Agent Runtime',
    description: 'Capability-governed A2A endpoint.',
    supportedInterfaces: [
      { url, protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: '1.0' },
    ],
    version: '1.4.0',
    capabilities: { streaming: true, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    skills: entries.map(({ exposure, readinessStatus }) => ({
      id: exposure.agentSkillId,
      name: exposure.name,
      description: exposure.description,
      tags: [
        ...(exposure.tags ?? []),
        `capability:${exposure.capabilityId}`,
        `readiness:${readinessStatus}`,
      ],
      examples: [...(exposure.examples ?? [])],
      inputModes: [...(exposure.inputModes ?? ['application/json'])],
      outputModes: [...(exposure.outputModes ?? ['application/json'])],
      securityRequirements: [],
    })),
    signatures: [],
  };
}

function publishableReadiness(status: string, policy: string): boolean {
  return policy === 'always_publish_with_status'
    ? true
    : policy === 'publish_degraded'
      ? status === 'available' || status === 'degraded'
      : status === 'available';
}

function operationFor(
  operationId: string,
  operationType: string,
  id: string,
  version: number,
  reason: string,
  idempotencyKey: string,
  inputHash: string,
  occurredAt: string,
): ManagementOperation {
  return createManagementOperation(
    {
      operationId,
      operationType,
      target: { type: 'a2a', id, version: String(version) },
      actorId: 'node-control-api',
      reason,
      idempotencyKeyHash: hash(idempotencyKey),
      inputHash,
    },
    occurredAt,
  );
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.message)
    ? error.message
    : 'AGENT_CARD_RUNTIME_APPLY_FAILED';
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
