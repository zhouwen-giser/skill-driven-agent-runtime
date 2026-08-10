import { createHash } from 'node:crypto';

import type {
  ControlAuditEvent,
  JsonValue,
  ManagementOperation,
  ManagedEvidenceExportConfiguration,
  EvidenceExportStatus,
} from '../../node-control-domain/src/index.js';
import {
  createConfigurationRevision,
  createManagementOperation,
  normalizeEvidenceExportConfiguration,
  transitionManagementOperation,
  type ConfigurationRevision,
} from '../../node-control-domain/src/index.js';
import type { NodeControlConfigurationService } from './configuration-service.js';
import type { NodeControlFoundationRepository } from './ports.js';

export interface NodeControlRuntimeEvidenceExportClient {
  apply(configuration: ManagedEvidenceExportConfiguration): Promise<ManagementOperation>;
  status(): Promise<EvidenceExportStatus>;
}

export interface EvidenceExportConfigurationView {
  readonly configuration: ManagedEvidenceExportConfiguration;
  readonly etag: string;
}

export class NodeControlEvidenceExportService {
  readonly #configurations: NodeControlConfigurationService;
  readonly #runtime: NodeControlRuntimeEvidenceExportClient;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nodeId: string;
  readonly #operations: NodeControlFoundationRepository;

  constructor(
    dependencies: Readonly<{
      configurations: NodeControlConfigurationService;
      runtime: NodeControlRuntimeEvidenceExportClient;
      clock: Readonly<{ now(): string }>;
      nodeId: string;
      operations: NodeControlFoundationRepository;
    }>,
  ) {
    this.#configurations = dependencies.configurations;
    this.#runtime = dependencies.runtime;
    this.#clock = dependencies.clock;
    this.#nodeId = dependencies.nodeId;
    this.#operations = dependencies.operations;
  }

  async current(): Promise<EvidenceExportConfigurationView> {
    const revisions = await this.#configurations.list({ targetType: 'telemetry_link', limit: 200 });
    const current = revisions
      .filter((revision) => revision.targetId === this.#nodeId)
      .sort((left, right) => right.revision - left.revision)[0];
    if (current === undefined)
      throw Object.assign(new Error('Evidence Export configuration was not found.'), {
        code: 'EVIDENCE_EXPORT_NOT_FOUND',
        status: 404,
      });
    return view(current);
  }

  async create(
    input: ManagedEvidenceExportConfiguration,
    idempotencyKey: string,
  ): Promise<EvidenceExportConfigurationView> {
    const now = this.#clock.now();
    const configuration = normalizeEvidenceExportConfiguration({
      ...input,
      nodeId: input.nodeId ?? this.#nodeId,
      status: 'draft',
    });
    const projected = createConfigurationRevision(
      {
        configurationId: configuration.exportId,
        targetType: 'telemetry_link',
        targetId: this.#nodeId,
        revision: configuration.revision,
        applyMode: configuration.applyMode ?? 'hot_reload',
        content: JSON.parse(JSON.stringify(configuration)) as JsonValue,
        createdBy: `node-control:${this.#nodeId}`,
      },
      now,
    );
    return view(
      await this.#configurations.createDraft(
        {
          configurationId: projected.configurationId,
          targetType: projected.targetType,
          targetId: projected.targetId,
          requestedRevision: projected.revision,
          applyMode: projected.applyMode,
          content: projected.content,
          requestedChecksum: projected.checksum,
          createdBy: projected.createdBy,
          createdAt: projected.createdAt,
        },
        idempotencyKey,
      ),
    );
  }

  async validate(
    revision: number,
    expectedEtag: string,
    idempotencyKey: string,
    command: Readonly<{ reason: string; expectedRevision?: number }>,
  ): Promise<EvidenceExportConfigurationView> {
    const current = await this.findByRevision(revision);
    return view(
      await this.#configurations.validate(
        current.configurationId,
        revision,
        expectedEtag,
        idempotencyKey,
        command,
      ),
    );
  }

  async publish(
    revision: number,
    expectedEtag: string,
    idempotencyKey: string,
    command: Readonly<{ reason: string; expectedRevision?: number }>,
  ): Promise<ManagementOperation> {
    const current = await this.findByRevision(revision);
    const operation = await this.#configurations.publish(
      current.configurationId,
      revision,
      expectedEtag,
      idempotencyKey,
      command,
    );
    const runtime = await this.#runtime.apply(active(current));
    await this.#configurations.acknowledge({
      runtimeInstanceId: 'sdar-runtime',
      targetType: 'telemetry_link',
      targetId: this.#nodeId,
      revision,
      status: runtime.status === 'succeeded' ? 'applied' : 'rejected',
      observedRuntimeVersion: '1.4.1',
      ...(runtime.status === 'succeeded'
        ? { activeChecksum: current.checksum }
        : { reasonCode: runtime.errorCode ?? 'EVIDENCE_EXPORT_APPLY_REJECTED' }),
      detail: {
        runtimeOperationId: runtime.operationId,
        runtimeStatus: runtime.status,
      },
      acknowledgedAt: this.#clock.now(),
    });
    return (await this.#configurations.getOperation(operation.operationId)) ?? operation;
  }

  async test(
    idempotencyKey: string,
    command: Readonly<{ reason: string }>,
  ): Promise<ManagementOperation> {
    const current = await this.findActive();
    const cleanKey = idempotencyKey.trim();
    const cleanReason = command.reason.trim();
    if (cleanKey.length < 8 || cleanReason === '')
      throw Object.assign(new Error('Evidence test command is invalid.'), {
        code: 'EVIDENCE_EXPORT_TEST_COMMAND_INVALID',
        status: 400,
      });
    const idempotencyKeyHash = sha256(cleanKey);
    const inputHash = sha256(
      JSON.stringify({
        operationType: 'evidence-export.test',
        exportId: current.configurationId,
        revision: current.revision,
        reason: cleanReason,
      }),
    );
    const replay = await this.#operations.findGovernanceOperationReplay?.(
      'evidence-export.test',
      idempotencyKeyHash,
    );
    if (replay !== undefined) {
      if (replay.inputHash !== inputHash)
        throw Object.assign(new Error('Evidence test idempotency key was reused.'), {
          code: 'EVIDENCE_EXPORT_TEST_IDEMPOTENCY_CONFLICT',
          status: 409,
        });
      return replay;
    }
    const occurredAt = this.#clock.now();
    const accepted = createManagementOperation(
      {
        operationId: `control-evidence-test-${idempotencyKeyHash}`,
        operationType: 'evidence-export.test',
        target: {
          type: 'evidence_export_configuration',
          id: current.configurationId,
          revision: current.revision,
        },
        actorId: `node-control:${this.#nodeId}`,
        reason: cleanReason,
        idempotencyKeyHash,
        inputHash,
      },
      occurredAt,
    );
    const runtime = await this.#runtime.apply(active(current));
    const running = transitionManagementOperation(accepted, 'running', occurredAt);
    const completed = transitionManagementOperation(
      running,
      runtime.status === 'succeeded' ? 'succeeded' : 'failed',
      this.#clock.now(),
      runtime.status === 'succeeded'
        ? { result: { runtimeOperationId: runtime.operationId, runtimeResult: runtime.result } }
        : { errorCode: runtime.errorCode ?? 'EVIDENCE_EXPORT_TEST_FAILED' },
    );
    if (this.#operations.recordGovernanceOperation === undefined) return completed;
    return this.#operations.recordGovernanceOperation(
      completed,
      auditForEvidenceTest(completed, inputHash),
    );
  }

  status(): Promise<EvidenceExportStatus> {
    return this.#runtime.status();
  }

  async findByRevision(revision: number): Promise<ConfigurationRevision> {
    const revisions = await this.#configurations.list({ targetType: 'telemetry_link', limit: 200 });
    const current = revisions.find(
      (candidate) => candidate.targetId === this.#nodeId && candidate.revision === revision,
    );
    if (current === undefined)
      throw Object.assign(new Error('Evidence Export revision was not found.'), {
        code: 'EVIDENCE_EXPORT_NOT_FOUND',
        status: 404,
      });
    return current;
  }

  async findActive(): Promise<ConfigurationRevision> {
    const revisions = await this.#configurations.list({ targetType: 'telemetry_link', limit: 200 });
    const active = revisions
      .filter((revision) => revision.targetId === this.#nodeId && revision.status === 'applied')
      .sort((left, right) => right.revision - left.revision)[0];
    if (active === undefined)
      throw Object.assign(new Error('Active Evidence Export configuration was not found.'), {
        code: 'EVIDENCE_EXPORT_ACTIVE_NOT_FOUND',
        status: 404,
      });
    return active;
  }
}

function auditForEvidenceTest(
  operation: ManagementOperation,
  requestHash: string,
): ControlAuditEvent {
  return Object.freeze({
    auditId: `audit-${operation.operationId}`,
    actorId: operation.actorId,
    action: operation.operationType,
    aggregateType: operation.target.type,
    aggregateId: `${operation.target.id}:${String(operation.target.revision ?? 0)}`,
    reason: operation.reason,
    requestHash,
    resultCode: operation.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
    createdAt: operation.completedAt ?? operation.createdAt,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function active(revision: ConfigurationRevision): ManagedEvidenceExportConfiguration {
  return Object.freeze({ ...configurationContent(revision), status: 'active' });
}

function view(revision: ConfigurationRevision): EvidenceExportConfigurationView {
  const configuration = configurationContent(revision);
  return Object.freeze({
    configuration: Object.freeze({
      ...configuration,
      status: ['published', 'applying', 'applied'].includes(revision.status) ? 'active' : 'draft',
    }),
    etag: `"configuration:${revision.configurationId}:${String(revision.revision)}:${revision.status}:${revision.checksum}"`,
  });
}

function configurationContent(revision: ConfigurationRevision): ManagedEvidenceExportConfiguration {
  return normalizeEvidenceExportConfiguration(
    revision.content as unknown as ManagedEvidenceExportConfiguration,
  );
}
