import { createHash } from 'node:crypto';

import {
  assertNodeCapabilityPublishable,
  createCapabilityImplementationBinding,
  createManagementOperation,
  createNodeCapabilityDefinition,
  hashConfigurationRequest,
  nodeCapabilityEtag,
  transitionManagementOperation,
  type CapabilityImplementationBinding,
  type JsonObject,
  type ManagementOperation,
  type NodeCapabilityDefinitionVersion,
  type NodeCapabilityStatus,
} from '../../node-control-domain/src/index.js';
import type {
  NodeControlCapabilityImplementationCatalog,
  NodeControlCapabilityRepository,
  NodeControlCapabilitySchemaValidator,
  NodeControlClock,
  NodeControlIdGenerator,
} from './ports.js';

export type NodeControlCapabilityErrorCode =
  | 'NODE_CAPABILITY_NOT_FOUND'
  | 'NODE_CAPABILITY_CONFLICT'
  | 'CAPABILITY_IMPLEMENTATION_NOT_FOUND'
  | 'NODE_CAPABILITY_SCHEMA_INVALID'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED';

export class NodeControlCapabilityError extends Error {
  readonly code: NodeControlCapabilityErrorCode;
  constructor(code: NodeControlCapabilityErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlCapabilityError';
    this.code = code;
  }
}

export class NodeControlCapabilityService {
  readonly #repository: NodeControlCapabilityRepository;
  readonly #catalog: NodeControlCapabilityImplementationCatalog;
  readonly #schemas: NodeControlCapabilitySchemaValidator;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlCapabilityRepository;
      catalog: NodeControlCapabilityImplementationCatalog;
      schemas: NodeControlCapabilitySchemaValidator;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#schemas = dependencies.schemas;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  list(status?: string, limit = 100) {
    return this.#repository.list(status, boundedLimit(limit));
  }

  async get(capabilityId: string, version: number) {
    return this.requireCapability(capabilityId, version);
  }

  async createDraft(input: NodeCapabilityDefinitionVersion, idempotencyKey: string) {
    if (input.status !== 'draft')
      throw new NodeControlCapabilityError(
        'NODE_CAPABILITY_CONFLICT',
        'New Capability Versions must start as draft.',
      );
    const definition = createNodeCapabilityDefinition(input);
    if (definition.previousVersion !== undefined) {
      const prior = await this.#repository.find(
        definition.capabilityId,
        definition.previousVersion,
      );
      if (prior === undefined)
        throw new NodeControlCapabilityError(
          'NODE_CAPABILITY_CONFLICT',
          'previousVersion must identify an existing Capability Version.',
        );
    }
    return this.#repository.createDraft(
      definition,
      this.context(
        'capability:create',
        idempotencyKey,
        'Create Capability Version draft.',
        requestJson(definition),
      ),
    );
  }

  async addImplementation(input: CapabilityImplementationBinding, idempotencyKey: string) {
    const binding = createCapabilityImplementationBinding(input);
    const context = this.context(
      'capability-implementation:create',
      idempotencyKey,
      'Create Capability Implementation Binding.',
      requestJson(binding),
    );
    const replay = await this.#repository.findImplementationReplay(
      context,
      binding.bindingId,
      binding.revision,
    );
    if (replay !== undefined) return replay;
    const capability = await this.requireCapability(
      binding.capabilityId,
      binding.capabilityVersion,
    );
    if (capability.status !== 'draft' && capability.status !== 'validating')
      throw new NodeControlCapabilityError(
        'NODE_CAPABILITY_CONFLICT',
        'Published or terminal Capability Versions cannot accept implementation bindings.',
      );
    if (
      !(await this.#catalog.exists(
        binding.implementationType,
        binding.implementationId,
        binding.implementationVersion,
      ))
    )
      throw new NodeControlCapabilityError(
        'CAPABILITY_IMPLEMENTATION_NOT_FOUND',
        'The exact Skill or Plan Template Version does not exist in its authority.',
      );
    return this.#repository.createImplementation(binding, context);
  }

  listImplementations(capabilityId: string, version: number, limit = 100) {
    return this.#repository.listImplementations(capabilityId, version, boundedLimit(limit));
  }

  async validate(
    capabilityId: string,
    version: number,
    expectedEtag: string,
    idempotencyKey: string,
    reason: string,
  ) {
    const capability = await this.requireCapability(capabilityId, version);
    const context = this.context('capability:validate', idempotencyKey, reason, {
      capabilityId,
      version,
    });
    if (await this.#repository.hasCommandReceipt('capability:validate', context))
      return this.#repository.validate(capability, capability, context);
    assertEtag(capability, expectedEtag);
    if (capability.status !== 'draft' && capability.status !== 'validating')
      throw new NodeControlCapabilityError(
        'NODE_CAPABILITY_CONFLICT',
        'Only a draft Capability Version can enter validation.',
      );
    this.assertSchemasValid(capability);
    const implementations = await this.#repository.listImplementations(
      capabilityId,
      version,
      1_000,
    );
    await this.assertImplementationsExist(implementations);
    const validating = createNodeCapabilityDefinition({ ...capability, status: 'validating' });
    assertNodeCapabilityPublishable(validating, implementations);
    return this.#repository.validate(capability, validating, context);
  }

  async publish(
    capabilityId: string,
    version: number,
    expectedEtag: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const capability = await this.requireCapability(capabilityId, version);
    const replayContext = this.context('capability:published', idempotencyKey, reason, {
      capabilityId,
      version,
      status: 'published',
    });
    const replay = await this.#repository.findCommandReplay('capability:published', replayContext);
    if (replay !== undefined) return replay;
    assertEtag(capability, expectedEtag);
    this.assertSchemasValid(capability);
    const implementations = await this.#repository.listImplementations(
      capabilityId,
      version,
      1_000,
    );
    await this.assertImplementationsExist(implementations);
    assertNodeCapabilityPublishable(capability, implementations);
    return this.transition(capability, 'published', expectedEtag, idempotencyKey, reason);
  }

  async suspend(
    capabilityId: string,
    version: number,
    expectedEtag: string,
    key: string,
    reason: string,
  ) {
    return this.transition(
      await this.requireCapability(capabilityId, version),
      'suspended',
      expectedEtag,
      key,
      reason,
    );
  }

  async deprecate(
    capabilityId: string,
    version: number,
    expectedEtag: string,
    key: string,
    reason: string,
  ) {
    return this.transition(
      await this.requireCapability(capabilityId, version),
      'deprecated',
      expectedEtag,
      key,
      reason,
    );
  }

  async retire(
    capabilityId: string,
    version: number,
    expectedEtag: string,
    key: string,
    reason: string,
  ) {
    return this.transition(
      await this.requireCapability(capabilityId, version),
      'retired',
      expectedEtag,
      key,
      reason,
    );
  }

  private async transition(
    prior: NodeCapabilityDefinitionVersion,
    status: Exclude<NodeCapabilityStatus, 'draft' | 'validating'>,
    expectedEtag: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const context = this.context(`capability:${status}`, idempotencyKey, reason, {
      capabilityId: prior.capabilityId,
      version: prior.version,
      status,
    });
    const replay = await this.#repository.findCommandReplay(`capability:${status}`, context);
    if (replay !== undefined) return replay;
    assertEtag(prior, expectedEtag);
    assertTransition(prior.status, status);
    const accepted = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: `node_capability.${status}`,
        target: { type: 'node_capability', id: prior.capabilityId, version: String(prior.version) },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
    const operation = transitionManagementOperation(
      transitionManagementOperation(accepted, 'running', context.occurredAt),
      'succeeded',
      context.occurredAt,
      { result: { capabilityId: prior.capabilityId, version: prior.version, status } },
    );
    const next = createNodeCapabilityDefinition({ ...prior, status });
    return this.#repository.transition(prior, next, operation, context, `capability_${status}`);
  }

  private async assertImplementationsExist(
    implementations: readonly CapabilityImplementationBinding[],
  ): Promise<void> {
    for (const binding of implementations) {
      if (
        !(await this.#catalog.exists(
          binding.implementationType,
          binding.implementationId,
          binding.implementationVersion,
        ))
      )
        throw new NodeControlCapabilityError(
          'CAPABILITY_IMPLEMENTATION_NOT_FOUND',
          `Implementation ${binding.implementationId}:${binding.implementationVersion} no longer exists.`,
        );
    }
  }

  private assertSchemasValid(capability: NodeCapabilityDefinitionVersion): void {
    for (const [name, schema] of [
      ['inputSchema', capability.inputSchema],
      ['outputSchema', capability.outputSchema],
    ] as const) {
      const result = this.#schemas.checkSchema(schema);
      if (!result.valid)
        throw new NodeControlCapabilityError(
          'NODE_CAPABILITY_SCHEMA_INVALID',
          `${name} is not a valid JSON Schema: ${result.errors.join('; ')}`,
        );
    }
  }

  private async requireCapability(capabilityId: string, version: number) {
    const capability = await this.#repository.find(capabilityId, version);
    if (capability === undefined)
      throw new NodeControlCapabilityError(
        'NODE_CAPABILITY_NOT_FOUND',
        'Node Capability Version was not found.',
      );
    return capability;
  }

  private context(scope: string, key: string, reason: string, request: JsonObject) {
    const cleanKey = key.trim();
    const cleanReason = reason.trim();
    if (cleanKey.length < 8 || cleanKey.length > 256 || cleanReason === '')
      throw new NodeControlCapabilityError(
        'NODE_CAPABILITY_CONFLICT',
        'A bounded Idempotency-Key and non-empty reason are required.',
      );
    return Object.freeze({
      actorId: 'deployment-operator',
      reason: cleanReason,
      idempotencyKeyHash: createHash('sha256').update(cleanKey).digest('hex'),
      requestHash: hashConfigurationRequest({ scope, request }),
      occurredAt: this.#clock.now(),
    });
  }
}

function assertTransition(from: NodeCapabilityStatus, to: NodeCapabilityStatus): void {
  const allowed: Readonly<Record<NodeCapabilityStatus, readonly NodeCapabilityStatus[]>> = {
    draft: [],
    validating: ['published'],
    published: ['suspended', 'deprecated', 'retired'],
    suspended: ['deprecated', 'retired'],
    deprecated: ['retired'],
    retired: [],
  };
  if (!allowed[from].includes(to))
    throw new NodeControlCapabilityError(
      'NODE_CAPABILITY_CONFLICT',
      `Capability Version cannot transition from ${from} to ${to}.`,
    );
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100;
}

function assertEtag(capability: NodeCapabilityDefinitionVersion, expectedEtag: string): void {
  if (expectedEtag.trim() !== nodeCapabilityEtag(capability))
    throw new NodeControlCapabilityError(
      'PRECONDITION_FAILED',
      'If-Match does not identify the current Capability Version state.',
    );
}

function requestJson(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
