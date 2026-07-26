import type { CognitiveManagementActionGate } from '../cognitive/cognitive-management-action.js';
import type {
  ArtifactActivationInput,
  ArtifactDeprecationInput,
  ArtifactRef,
  ArtifactRepository,
} from './artifact-persistence.js';

export const OPERATOR_IDENTITY_PORT_SCHEMA_HASH =
  '1ec57c600b439bcd1efe67c67ee319b04f38681e2ab3da6fad71dbae734dfe75' as const;
export const ARTIFACT_GOVERNANCE_PORT_SCHEMA_HASH =
  '991d8aeb156f03d07b6181ac2d1d097f78633cf7988a93336b61815e8c3b74cf' as const;

export type ArtifactPermission =
  | 'artifact.validate'
  | 'artifact.approve'
  | 'artifact.activate'
  | 'artifact.revalidate'
  | 'artifact.deprecate'
  | 'artifact.rollback'
  | 'artifact.kill_switch';

export interface OperatorRequestContext {
  readonly operatorId?: string;
  readonly tenantId?: string;
  readonly permissions?: readonly ArtifactPermission[];
}

export interface OperatorIdentity {
  readonly operatorId: string;
  readonly tenantId?: string;
  readonly permissions: ReadonlySet<ArtifactPermission>;
}

export interface OperatorIdentityPort {
  requireIdentity(context: OperatorRequestContext): Promise<OperatorIdentity>;
  requirePermission(identity: OperatorIdentity, permission: ArtifactPermission): Promise<void>;
  getTenantScope(identity: OperatorIdentity): Promise<string | undefined>;
}

export interface ArtifactGovernanceCommand extends ArtifactRef {
  readonly context: OperatorRequestContext;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ArtifactValidationCommand extends ArtifactGovernanceCommand {
  readonly validationRunId: string;
  readonly validationType: 'static' | 'replay' | 'simulation' | 'shadow' | 'revalidation';
  readonly datasetRef: string;
}

export interface ArtifactApprovalCommand extends ArtifactGovernanceCommand {
  readonly approvalId: string;
  readonly decision: 'approved' | 'rejected';
  readonly validationSummaryHash: string;
}

export interface ArtifactActivationCommand extends ArtifactGovernanceCommand {
  readonly artifactKey: string;
  readonly expectedLockVersion: number;
  readonly validationSummaryHash: string;
}

export interface ArtifactDeprecationCommand extends ArtifactGovernanceCommand {
  readonly artifactKey: string;
  readonly expectedLockVersion: number;
}

export interface ArtifactRollbackCommand extends ArtifactGovernanceCommand {
  readonly artifactKey: string;
  readonly targetArtifactId: string;
  readonly targetVersion: number;
  readonly expectedLockVersion: number;
  readonly validationSummaryHash: string;
}

export interface ArtifactKillSwitchCommand {
  readonly context: OperatorRequestContext;
  readonly scope: Readonly<{ artifactKey?: string; tenantId?: string; domain?: string }>;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ArtifactGovernanceStore {
  requestValidation(
    input: ArtifactValidationCommand & Readonly<{ actorId: string }>,
  ): Promise<void>;
  recordApproval(input: ArtifactApprovalCommand & Readonly<{ actorId: string }>): Promise<void>;
  requestRevalidation(
    input: ArtifactValidationCommand & Readonly<{ actorId: string }>,
  ): Promise<void>;
  rollback(input: ArtifactRollbackCommand & Readonly<{ actorId: string }>): Promise<void>;
  killSwitch(input: ArtifactKillSwitchCommand & Readonly<{ actorId: string }>): Promise<void>;
}

export interface ArtifactGovernancePort {
  requestValidation(input: ArtifactValidationCommand): Promise<void>;
  recordApproval(input: ArtifactApprovalCommand): Promise<void>;
  activate(input: ArtifactActivationCommand): Promise<void>;
  requestRevalidation(input: ArtifactValidationCommand): Promise<void>;
  deprecate(input: ArtifactDeprecationCommand): Promise<void>;
  rollback(input: ArtifactRollbackCommand): Promise<void>;
  killSwitch(input: ArtifactKillSwitchCommand): Promise<void>;
}

export class DefaultArtifactGovernanceService implements ArtifactGovernancePort {
  readonly #identity: OperatorIdentityPort;
  readonly #repository: ArtifactRepository;
  readonly #store: ArtifactGovernanceStore;
  readonly #audit: CognitiveManagementActionGate;

  constructor(
    dependencies: Readonly<{
      identity: OperatorIdentityPort;
      repository: ArtifactRepository;
      store: ArtifactGovernanceStore;
      audit: CognitiveManagementActionGate;
    }>,
  ) {
    this.#identity = dependencies.identity;
    this.#repository = dependencies.repository;
    this.#store = dependencies.store;
    this.#audit = dependencies.audit;
  }

  async requestValidation(input: ArtifactValidationCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.validate');
    await this.#executeAudited('artifact_request_validation', input, actorId, () =>
      this.#store.requestValidation({ ...input, actorId }),
    );
  }

  async recordApproval(input: ArtifactApprovalCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.approve');
    await this.#executeAudited('artifact_record_approval', input, actorId, () =>
      this.#store.recordApproval({ ...input, actorId }),
    );
  }

  async activate(input: ArtifactActivationCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.activate');
    const activation: ArtifactActivationInput = {
      artifactId: input.artifactId,
      version: input.version,
      artifactKey: input.artifactKey,
      expectedLockVersion: input.expectedLockVersion,
      expectedVersion: input.expectedVersion,
      actorId,
      validationSummaryHash: input.validationSummaryHash,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      activatedAt: input.occurredAt,
    };
    await this.#repository.activate(activation);
  }

  async requestRevalidation(input: ArtifactValidationCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.revalidate');
    await this.#executeAudited('artifact_request_revalidation', input, actorId, () =>
      this.#store.requestRevalidation({ ...input, actorId }),
    );
  }

  async deprecate(input: ArtifactDeprecationCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.deprecate');
    await this.#executeAudited('artifact_deprecate', input, actorId, async () => {
      const command: ArtifactDeprecationInput = {
        artifactId: input.artifactId,
        version: input.version,
        artifactKey: input.artifactKey,
        expectedLockVersion: input.expectedLockVersion,
        actorId,
        deprecatedAt: input.occurredAt,
      };
      await this.#repository.deprecate(command);
    });
  }

  async rollback(input: ArtifactRollbackCommand): Promise<void> {
    assertGovernanceCommand(input);
    const actorId = await this.#authorize(input.context, 'artifact.rollback');
    await this.#executeAudited('artifact_rollback', input, actorId, () =>
      this.#store.rollback({ ...input, actorId }),
    );
  }

  async killSwitch(input: ArtifactKillSwitchCommand): Promise<void> {
    assertGovernanceWriteMetadata(input);
    const actorId = await this.#authorize(input.context, 'artifact.kill_switch');
    const subjectId = JSON.stringify(input.scope);
    await this.#audit.execute(
      {
        operation: 'artifact_kill_switch',
        subjectId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId,
        reason: input.reason,
      },
      async () => {
        await this.#store.killSwitch({ ...input, actorId });
        return { subjectId, status: 'completed' };
      },
    );
  }

  async #authorize(context: OperatorRequestContext, permission: ArtifactPermission) {
    const identity = await this.#identity.requireIdentity(context);
    await this.#identity.requirePermission(identity, permission);
    const tenantScope = await this.#identity.getTenantScope(identity);
    if (
      context.tenantId !== undefined &&
      tenantScope !== undefined &&
      tenantScope !== context.tenantId
    ) {
      throw new ArtifactGovernanceError('ARTIFACT_TENANT_SCOPE_DENIED');
    }
    return identity.operatorId;
  }

  async #executeAudited(
    operation:
      | 'artifact_request_validation'
      | 'artifact_record_approval'
      | 'artifact_request_revalidation'
      | 'artifact_deprecate'
      | 'artifact_rollback',
    input: ArtifactGovernanceCommand,
    actorId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    await this.#audit.execute(
      {
        operation,
        subjectId: `${input.artifactId}:${String(input.version)}`,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId,
        reason: input.reason,
      },
      async () => {
        await action();
        return {
          artifactId: input.artifactId,
          artifactVersion: input.version,
          status: 'completed',
        };
      },
    );
  }
}

export interface ExternalOperatorIdentityProvider {
  resolve(context: OperatorRequestContext): Promise<OperatorIdentity | undefined>;
}

export class ConfiguredOperatorIdentityPort implements OperatorIdentityPort {
  readonly #environment: 'local' | 'test' | 'production';
  readonly #provider: ExternalOperatorIdentityProvider | undefined;

  constructor(
    input: Readonly<{
      environment: 'local' | 'test' | 'production';
      provider?: ExternalOperatorIdentityProvider;
    }>,
  ) {
    if (input.environment === 'production' && input.provider === undefined) {
      throw new ArtifactGovernanceError('OPERATOR_IDENTITY_PROVIDER_REQUIRED');
    }
    this.#environment = input.environment;
    this.#provider = input.provider;
  }

  async requireIdentity(context: OperatorRequestContext): Promise<OperatorIdentity> {
    const external = await this.#provider?.resolve(context);
    if (external !== undefined) return external;
    if (this.#environment === 'production') {
      throw new ArtifactGovernanceError('OPERATOR_IDENTITY_REQUIRED');
    }
    if (context.operatorId === undefined || context.permissions === undefined) {
      throw new ArtifactGovernanceError('OPERATOR_IDENTITY_REQUIRED');
    }
    return Object.freeze({
      operatorId: context.operatorId,
      ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      permissions: Object.freeze(new Set(context.permissions)),
    });
  }

  requirePermission(identity: OperatorIdentity, permission: ArtifactPermission): Promise<void> {
    if (!identity.permissions.has(permission)) {
      return Promise.reject(new ArtifactGovernanceError('ARTIFACT_PERMISSION_DENIED'));
    }
    return Promise.resolve();
  }

  getTenantScope(identity: OperatorIdentity): Promise<string | undefined> {
    return Promise.resolve(identity.tenantId);
  }
}

export class ArtifactGovernanceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ArtifactGovernanceError';
    this.code = code;
  }
}

function assertGovernanceCommand(input: ArtifactGovernanceCommand): void {
  assertGovernanceWriteMetadata(input);
  if (
    input.artifactId.trim().length === 0 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  ) {
    throw new ArtifactGovernanceError('ARTIFACT_GOVERNANCE_COMMAND_INVALID');
  }
}

function assertGovernanceWriteMetadata(
  input: Readonly<{
    expectedVersion: number;
    idempotencyKey: string;
    reason: string;
    occurredAt: string;
  }>,
): void {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.idempotencyKey.trim().length === 0 ||
    input.idempotencyKey.length > 256 ||
    input.reason.trim().length === 0 ||
    input.reason.length > 4096 ||
    !Number.isFinite(Date.parse(input.occurredAt))
  ) {
    throw new ArtifactGovernanceError('ARTIFACT_GOVERNANCE_COMMAND_INVALID');
  }
}
