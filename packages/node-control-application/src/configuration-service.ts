import { createHash } from 'node:crypto';

import {
  createManagementOperation,
  hashConfigurationRequest,
  type ConfigurationRevision,
  type JsonObject,
  type JsonValue,
  type ManagementOperation,
  type RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';
import type {
  ConfigurationDraftInput,
  ConfigurationMutationContext,
  NodeControlClock,
  NodeControlConfigurationRepository,
  NodeControlFoundationRepository,
  NodeControlIdGenerator,
  RuntimeBootstrapProjection,
} from './ports.js';

export type NodeControlConfigurationErrorCode =
  | 'CONFIGURATION_NOT_FOUND'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CONTROL_REVISION_CONFLICT'
  | 'CONTROL_REVISION_IMMUTABLE';

export class NodeControlConfigurationError extends Error {
  readonly code: NodeControlConfigurationErrorCode;

  constructor(code: NodeControlConfigurationErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlConfigurationError';
    this.code = code;
  }
}

export interface ConfigurationCommand {
  readonly reason: string;
  readonly payload?: JsonValue;
  readonly expectedRevision?: number;
}

export class NodeControlConfigurationService {
  readonly #configurations: NodeControlConfigurationRepository;
  readonly #foundation: NodeControlFoundationRepository;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      configurations: NodeControlConfigurationRepository;
      foundation: NodeControlFoundationRepository;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#configurations = dependencies.configurations;
    this.#foundation = dependencies.foundation;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  createDraft(
    input: ConfigurationDraftInput,
    idempotencyKey: string,
  ): Promise<ConfigurationRevision> {
    return this.#configurations.createDraft(
      input,
      this.context(
        input.createdBy,
        'Create configuration draft.',
        idempotencyKey,
        Object.freeze({
          configurationId: input.configurationId,
          targetType: input.targetType,
          targetId: input.targetId,
          requestedRevision: input.requestedRevision,
          applyMode: input.applyMode,
          content: input.content,
          requestedChecksum: input.requestedChecksum,
          createdBy: input.createdBy,
          createdAt: input.createdAt,
        }),
      ),
    );
  }

  async get(configurationId: string, revision: number): Promise<ConfigurationRevision> {
    const result = await this.#configurations.find(configurationId, revision);
    if (result === undefined)
      throw new NodeControlConfigurationError(
        'CONFIGURATION_NOT_FOUND',
        'Configuration Revision was not found.',
      );
    return result;
  }

  list(filter?: Readonly<{ targetType?: string; targetId?: string; limit?: number }>) {
    return this.#configurations.list(filter);
  }

  validate(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    idempotencyKey: string,
    command: ConfigurationCommand,
  ): Promise<ConfigurationRevision> {
    assertExpectedRevision(command.expectedRevision, revision);
    return this.#configurations.validate(
      configurationId,
      revision,
      requiredHeader(expectedEtag, 'If-Match'),
      this.context('deployment-operator', command.reason, idempotencyKey, commandAsJson(command)),
    );
  }

  async publish(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    idempotencyKey: string,
    command: ConfigurationCommand,
  ): Promise<ManagementOperation> {
    assertExpectedRevision(command.expectedRevision, revision);
    const context = this.context(
      'deployment-operator',
      command.reason,
      idempotencyKey,
      commandAsJson(command),
    );
    const operation = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: 'configuration.publish',
        target: { type: 'configuration_revision', id: configurationId, revision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
    return (
      await this.#configurations.publish(
        configurationId,
        revision,
        requiredHeader(expectedEtag, 'If-Match'),
        operation,
        context,
      )
    ).operation;
  }

  async rollback(
    configurationId: string,
    sourceRevision: number,
    expectedEtag: string,
    idempotencyKey: string,
    command: ConfigurationCommand,
  ): Promise<ManagementOperation> {
    assertExpectedRevision(command.expectedRevision, sourceRevision);
    const context = this.context(
      'deployment-operator',
      command.reason,
      idempotencyKey,
      commandAsJson(command),
    );
    const operation = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: 'configuration.rollback',
        target: { type: 'configuration_revision', id: configurationId, revision: sourceRevision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
    return (
      await this.#configurations.rollback(
        configurationId,
        sourceRevision,
        requiredHeader(expectedEtag, 'If-Match'),
        operation,
        context,
      )
    ).operation;
  }

  latest(targetType: string, targetId: string, currentRevision?: number) {
    return this.#configurations.latestPublished(targetType, targetId, currentRevision);
  }

  acknowledge(acknowledgement: RuntimeRevisionAck): Promise<ConfigurationRevision> {
    return this.#configurations.acknowledge(acknowledgement);
  }

  getOperation(operationId: string): Promise<ManagementOperation | undefined> {
    return this.#foundation.findManagementOperation(operationId);
  }

  async bootstrap(): Promise<RuntimeBootstrapProjection> {
    const nodeProfile = await this.#foundation.findNodeProfile();
    if (nodeProfile === undefined)
      throw new NodeControlConfigurationError(
        'CONFIGURATION_NOT_FOUND',
        'Node Profile was not found.',
      );
    return Object.freeze({
      nodeProfile,
      runtimeContractVersion: '1.0.0',
      activeConfigurationRefs: Object.freeze([
        ...(await this.#configurations.activeConfigurationRefs()),
      ]),
      activeCapabilityCatalogRef: Object.freeze({
        type: 'node_capability_catalog',
        id: 'not-configured',
      }),
      activeExposureCatalogRef: Object.freeze({
        type: 'a2a_exposure_catalog',
        id: 'not-configured',
      }),
      serviceCredentialPolicy: Object.freeze({ mode: 'deployment_service_bearer' }),
    });
  }

  private context(
    actorId: string,
    reason: string,
    idempotencyKey: string,
    request: JsonValue,
  ): ConfigurationMutationContext {
    const cleanReason = reason.trim();
    if (cleanReason === '' || cleanReason.length > 1024)
      throw new NodeControlConfigurationError(
        'CONTROL_REVISION_CONFLICT',
        'A bounded non-empty command reason is required.',
      );
    const cleanKey = requiredHeader(idempotencyKey, 'Idempotency-Key');
    if (cleanKey.length < 8 || cleanKey.length > 128)
      throw new NodeControlConfigurationError(
        'CONTROL_REVISION_CONFLICT',
        'Idempotency-Key must contain between 8 and 128 characters.',
      );
    return Object.freeze({
      actorId,
      reason: cleanReason,
      idempotencyKeyHash: createHash('sha256').update(cleanKey).digest('hex'),
      requestHash: hashConfigurationRequest(request),
      occurredAt: this.#clock.now(),
    });
  }
}

function commandAsJson(command: ConfigurationCommand): JsonObject {
  return Object.freeze({
    reason: command.reason,
    ...(command.payload === undefined ? {} : { payload: command.payload }),
    ...(command.expectedRevision === undefined
      ? {}
      : { expectedRevision: command.expectedRevision }),
  });
}

function assertExpectedRevision(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual)
    throw new NodeControlConfigurationError(
      'PRECONDITION_FAILED',
      `Expected revision ${String(expected)} does not match ${String(actual)}.`,
    );
}

function requiredHeader(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized === '')
    throw new NodeControlConfigurationError('PRECONDITION_FAILED', `${name} is required.`);
  return normalized;
}
