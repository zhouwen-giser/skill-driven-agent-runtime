import {
  createArtifactApprovalRecord,
  createArtifactRevalidationTrigger,
  type ArtifactActivationRecord,
  type ArtifactApprovalRecord,
  type ArtifactRevalidationTrigger,
} from '../../../domain/src/index.js';
import type { CognitiveManagementActionGate } from '../cognitive/cognitive-management-action.js';
import {
  type ArtifactValidationCommand,
  type OperatorIdentityPort,
  type OperatorRequestContext,
} from './artifact-governance.js';
import type { ArtifactRevalidationWakeQueue } from './artifact-shadow-runtime.js';

/** P06 approval/activation persists exact package and approval bindings in one P02 transaction. */
export interface ArtifactPromotionGovernanceStore {
  recordApproval(
    input: Readonly<{
      approval: ArtifactApprovalRecord;
      promotionPackageId: string;
      expectedVersion: number;
      tenantId?: string;
    }>,
  ): Promise<ArtifactApprovalRecord>;
  activateApproved(
    input: Readonly<{
      activationId: string;
      artifactId: string;
      artifactVersion: number;
      artifactKey: string;
      expectedVersion: number;
      expectedLockVersion: number;
      approvalId: string;
      approvalHash: string;
      promotionPackageHash: string;
      actorId: string;
      tenantId?: string;
      activatedAt: string;
    }>,
  ): Promise<ArtifactActivationRecord>;
  recordRevalidationTrigger(
    input: ArtifactRevalidationTrigger,
    validationRunId?: string,
  ): Promise<void>;
  requestRevalidationAtomically(
    input: Readonly<{
      trigger: ArtifactRevalidationTrigger;
      command: Omit<ArtifactValidationCommand, 'validationType'> & {
        readonly validationType: 'revalidation';
      };
      actorId: string;
      tenantId?: string;
    }>,
  ): Promise<void>;
}

export interface P06ApprovalCommand {
  readonly approvalId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly promotionPackageId: string;
  readonly promotionPackageHash: string;
  readonly validationSummaryHash: string;
  readonly decision: 'approved' | 'rejected';
  readonly reason: string;
  readonly context: OperatorRequestContext;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface P06ActivationCommand {
  readonly activationId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactKey: string;
  readonly approvalId: string;
  readonly approvalHash: string;
  readonly promotionPackageHash: string;
  readonly context: OperatorRequestContext;
  readonly expectedVersion: number;
  readonly expectedLockVersion: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export class ArtifactPromotionGovernanceService {
  constructor(
    private readonly dependencies: Readonly<{
      identity: OperatorIdentityPort;
      audit: CognitiveManagementActionGate;
      store: ArtifactPromotionGovernanceStore;
      /** Optional only when the P06/P05 runtime migrations are not installed. */
      revalidationWake?: ArtifactRevalidationWakeQueue;
    }>,
  ) {}

  async recordApproval(command: P06ApprovalCommand): Promise<ArtifactApprovalRecord> {
    const identity = await this.dependencies.identity.requireIdentity(command.context);
    await this.dependencies.identity.requirePermission(identity, 'artifact.approve');
    assertHumanOperator(identity.operatorId);
    const tenantId = await scopedTenant(this.dependencies.identity, identity, command.context);
    const approval = createArtifactApprovalRecord({
      approvalId: command.approvalId,
      artifactId: command.artifactId,
      artifactVersion: command.artifactVersion,
      approverId: identity.operatorId,
      decision: command.decision,
      reason: command.reason,
      validationSummaryHash: command.validationSummaryHash,
      promotionPackageHash: command.promotionPackageHash,
      createdAt: command.occurredAt,
    });
    return this.dependencies.audit.execute(
      {
        operation: 'artifact_record_approval',
        subjectId: `${command.artifactId}:${String(command.artifactVersion)}`,
        expectedVersion: command.expectedVersion,
        idempotencyKey: command.idempotencyKey,
        actorId: identity.operatorId,
        reason: command.reason,
        requestFingerprint: JSON.stringify([
          command.promotionPackageId,
          command.promotionPackageHash,
          command.validationSummaryHash,
          command.decision,
        ]),
      },
      async () => {
        return this.dependencies.store.recordApproval({
          approval,
          promotionPackageId: command.promotionPackageId,
          expectedVersion: command.expectedVersion,
          ...(tenantId === undefined ? {} : { tenantId }),
        });
      },
    );
  }

  async activate(command: P06ActivationCommand): Promise<ArtifactActivationRecord> {
    const identity = await this.dependencies.identity.requireIdentity(command.context);
    await this.dependencies.identity.requirePermission(identity, 'artifact.activate');
    assertHumanOperator(identity.operatorId);
    const tenantId = await scopedTenant(this.dependencies.identity, identity, command.context);
    return this.dependencies.audit.execute(
      {
        operation: 'artifact_activate',
        subjectId: `${command.artifactId}:${String(command.artifactVersion)}`,
        expectedVersion: command.expectedVersion,
        idempotencyKey: command.idempotencyKey,
        actorId: identity.operatorId,
        reason: command.reason,
        requestFingerprint: JSON.stringify([
          command.approvalId,
          command.approvalHash,
          command.promotionPackageHash,
          command.expectedLockVersion,
        ]),
      },
      async () => {
        return this.dependencies.store.activateApproved({
          activationId: command.activationId,
          artifactId: command.artifactId,
          artifactVersion: command.artifactVersion,
          artifactKey: command.artifactKey,
          expectedVersion: command.expectedVersion,
          expectedLockVersion: command.expectedLockVersion,
          approvalId: command.approvalId,
          approvalHash: command.approvalHash,
          promotionPackageHash: command.promotionPackageHash,
          actorId: identity.operatorId,
          ...(tenantId === undefined ? {} : { tenantId }),
          activatedAt: command.occurredAt,
        });
      },
    );
  }

  async requestRevalidation(
    trigger: ArtifactRevalidationTrigger,
    command: ArtifactValidationCommand,
  ): Promise<void> {
    const identity = await this.dependencies.identity.requireIdentity(command.context);
    await this.dependencies.identity.requirePermission(identity, 'artifact.revalidate');
    assertHumanOperator(identity.operatorId);
    const tenantId = await scopedTenant(this.dependencies.identity, identity, command.context);
    if (command.validationType !== 'revalidation') {
      throw new ArtifactPromotionGovernanceError('ARTIFACT_REVALIDATION_TYPE_REQUIRED');
    }
    const revalidationCommand = { ...command, validationType: 'revalidation' as const };
    const normalizedTrigger = createArtifactRevalidationTrigger(trigger);
    if (normalizedTrigger.artifactRef !== `${command.artifactId}:${String(command.version)}`) {
      throw new ArtifactPromotionGovernanceError('ARTIFACT_REVALIDATION_TRIGGER_MISMATCH');
    }
    if (normalizedTrigger.createdAt !== command.occurredAt) {
      throw new ArtifactPromotionGovernanceError('ARTIFACT_REVALIDATION_TIMESTAMP_MISMATCH');
    }
    if (normalizedTrigger.severity === 'critical') {
      await this.dependencies.identity.requirePermission(identity, 'artifact.kill_switch');
    }
    // This is one PostgreSQL transaction: P02's active -> revalidating state,
    // authoritative validation row, P06 trigger, P05 replay pins, and outbox
    // either all exist or none do. It deliberately writes P02's authority tables
    // rather than creating another lifecycle source of truth.
    await this.dependencies.audit.execute(
      {
        operation: 'artifact_request_revalidation',
        subjectId: `${command.artifactId}:${String(command.version)}`,
        expectedVersion: command.expectedVersion,
        idempotencyKey: command.idempotencyKey,
        actorId: identity.operatorId,
        reason: command.reason,
        requestFingerprint: JSON.stringify([
          normalizedTrigger.triggerId,
          normalizedTrigger.triggerType,
          normalizedTrigger.severity,
          revalidationCommand.validationRunId,
          revalidationCommand.datasetRef,
        ]),
      },
      () =>
        this.dependencies.store.requestRevalidationAtomically({
          trigger: normalizedTrigger,
          command: revalidationCommand,
          actorId: identity.operatorId,
          ...(tenantId === undefined ? {} : { tenantId }),
        }),
    );
    await this.dependencies.revalidationWake?.enqueue(normalizedTrigger.triggerId);
  }
}

export class ArtifactPromotionGovernanceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ArtifactPromotionGovernanceError';
    this.code = code;
  }
}

async function scopedTenant(
  identityPort: OperatorIdentityPort,
  identity: Awaited<ReturnType<OperatorIdentityPort['requireIdentity']>>,
  context: OperatorRequestContext,
): Promise<string | undefined> {
  const scope = await identityPort.getTenantScope(identity);
  if (scope !== undefined && context.tenantId !== undefined && scope !== context.tenantId) {
    throw new ArtifactPromotionGovernanceError('ARTIFACT_TENANT_SCOPE_DENIED');
  }
  return scope ?? context.tenantId;
}

function assertHumanOperator(operatorId: string): void {
  if (operatorId.startsWith('worker:') || operatorId.startsWith('llm:')) {
    throw new ArtifactPromotionGovernanceError('ARTIFACT_OPERATOR_REQUIRED');
  }
}
