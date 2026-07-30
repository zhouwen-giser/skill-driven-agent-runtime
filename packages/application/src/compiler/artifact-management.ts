import type {
  A2AArtifactProjection,
  SseArtifactEventProjection,
} from '../../../domain/src/index.js';
import type {
  ArtifactGovernancePort,
  ArtifactKillSwitchCommand,
  ArtifactPermission,
  OperatorRequestContext,
} from './artifact-governance.js';
import type {
  ArtifactPromotionApplicationService,
  PromotionPackageInput,
} from './artifact-shadow-runtime.js';
import type { CognitiveManagementActionGate } from '../cognitive/cognitive-management-action.js';

export type ManagementRole =
  'viewer' | 'operator' | 'reviewer' | 'approver' | 'administrator' | 'security_operator';

export interface ManagementPrincipal {
  readonly actorId: string;
  readonly tenantId?: string;
  readonly roles: ReadonlySet<ManagementRole>;
  readonly kind: 'human' | 'service';
  readonly requestId: string;
  readonly sourceIp?: string;
}

export interface ArtifactManagementListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly status?: string;
  readonly artifactType?: string;
  readonly taskTypeId?: string;
  readonly riskLevel?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly driftSeverity?: string;
  readonly active?: boolean;
  readonly sort: 'created_desc' | 'created_asc' | 'key_asc';
}

export type ArtifactManagementView =
  | 'versions'
  | 'diff'
  | 'lineage'
  | 'validation'
  | 'shadow'
  | 'promotion'
  | 'approvals'
  | 'activations'
  | 'usage'
  | 'outcomes'
  | 'drift'
  | 'audit';

export type RuntimeManagementView = 'decisions' | 'model-usage' | 'case-usage';

export interface ArtifactManagementQueryRepository {
  listArtifacts(
    input: ArtifactManagementListQuery & Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>>;
  getArtifact(
    artifactId: string,
    scope: Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<unknown>;
  getArtifactView(
    artifactId: string,
    view: ArtifactManagementView,
    scope: Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<unknown>;
  getRuntimeView(
    view: RuntimeManagementView,
    input: Readonly<{ tenantId?: string; limit: number; cursor?: string }>,
  ): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>>;
  getRuntimeDetail(
    view: RuntimeManagementView,
    id: string,
    input: Readonly<{ tenantId?: string }>,
  ): Promise<unknown>;
  listEvents(
    input: Readonly<{
      tenantId?: string;
      includeGlobal: boolean;
      afterSequence: number;
      limit: number;
    }>,
  ): Promise<readonly ArtifactOutboxProjection[]>;
  recordReadAudit(input: ManagementReadAudit): Promise<void>;
}

export interface ArtifactOutboxProjection {
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface ManagementReadAudit {
  readonly auditId: string;
  readonly actorId: string;
  readonly roles: readonly ManagementRole[];
  readonly tenantId?: string;
  readonly operation: string;
  readonly target: string;
  readonly requestId: string;
  readonly result: 'allowed' | 'denied' | 'not_found';
  readonly sourceIp?: string;
  readonly occurredAt: string;
}

export interface ManagementPrincipalResolver {
  resolve(
    input: Readonly<{
      authorization?: string;
      requestId: string;
      sourceIp?: string;
    }>,
  ): Promise<ManagementPrincipal>;
}

export class ArtifactManagementQueryService {
  readonly #repository: ArtifactManagementQueryRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: ArtifactManagementQueryRepository;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  async list(principal: ManagementPrincipal, query: ArtifactManagementListQuery) {
    requireAnyRole(principal, ALL_READ_ROLES);
    const result = await this.#repository.listArtifacts({
      ...query,
      ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
      includeGlobal: hasElevatedRead(principal),
    });
    await this.#audit(principal, 'artifact.list', '*', 'allowed');
    return redactForPrincipal(result, principal);
  }

  async detail(principal: ManagementPrincipal, artifactId: string) {
    requireAnyRole(principal, ALL_READ_ROLES);
    const item = await this.#repository.getArtifact(artifactId, scope(principal));
    await this.#audit(
      principal,
      'artifact.detail',
      artifactId,
      item === undefined ? 'not_found' : 'allowed',
    );
    return item === undefined ? undefined : redactForPrincipal(item, principal);
  }

  async view(principal: ManagementPrincipal, artifactId: string, view: ArtifactManagementView) {
    requireAnyRole(
      principal,
      view === 'audit' ? ['reviewer', 'administrator', 'security_operator'] : ALL_READ_ROLES,
    );
    const result = await this.#repository.getArtifactView(artifactId, view, scope(principal));
    await this.#audit(
      principal,
      `artifact.${view}`,
      artifactId,
      result === undefined ? 'not_found' : 'allowed',
    );
    return result === undefined ? undefined : redactForPrincipal(result, principal);
  }

  async runtime(
    principal: ManagementPrincipal,
    view: RuntimeManagementView,
    query: Readonly<{ limit: number; cursor?: string }>,
  ) {
    requireAnyRole(principal, ALL_READ_ROLES);
    const result = await this.#repository.getRuntimeView(view, {
      ...query,
      ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
    });
    await this.#audit(principal, `runtime.${view}`, '*', 'allowed');
    return redactForPrincipal(result, principal);
  }

  async runtimeDetail(principal: ManagementPrincipal, view: RuntimeManagementView, id: string) {
    requireAnyRole(principal, ALL_READ_ROLES);
    const result = await this.#repository.getRuntimeDetail(view, id, {
      ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
    });
    await this.#audit(
      principal,
      `runtime.${view}.detail`,
      id,
      result === undefined ? 'not_found' : 'allowed',
    );
    return result === undefined ? undefined : redactForPrincipal(result, principal);
  }

  async events(
    principal: ManagementPrincipal,
    input: Readonly<{ afterSequence: number; limit: number }>,
  ): Promise<readonly SseArtifactEventProjection[]> {
    requireAnyRole(principal, ALL_READ_ROLES);
    const rows = await this.#repository.listEvents({
      ...input,
      ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
      includeGlobal: hasElevatedRead(principal),
    });
    await this.#audit(principal, 'artifact.events', String(input.afterSequence), 'allowed');
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          eventId: String(row.sequence),
          eventType: row.eventType,
          tenantId: row.tenantId ?? 'global',
          safePayload: redactRecord(row.payload),
          sourceRef: row.eventId,
          createdAt: row.occurredAt,
        }),
      ),
    );
  }

  async #audit(
    principal: ManagementPrincipal,
    operation: string,
    target: string,
    result: ManagementReadAudit['result'],
  ): Promise<void> {
    await this.#repository.recordReadAudit({
      auditId: `management-read:${principal.requestId}:${operation}:${target}`,
      actorId: principal.actorId,
      roles: [...principal.roles].sort(),
      ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
      operation,
      target,
      requestId: principal.requestId,
      result,
      ...(principal.sourceIp === undefined ? {} : { sourceIp: principal.sourceIp }),
      occurredAt: this.#clock.now(),
    });
  }
}

export type ArtifactManagementCommandOperation =
  | 'validate'
  | 'shadow'
  | 'build-promotion-package'
  | 'approve'
  | 'reject'
  | 'activate'
  | 'revalidate'
  | 'deprecate'
  | 'rollback'
  | 'kill-switch-enable'
  | 'kill-switch-disable';

export interface ArtifactManagementCommandInput {
  readonly artifactId: string;
  readonly version: number;
  readonly expectedVersion: number;
  readonly expectedLockVersion?: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly artifactKey?: string;
  readonly validationRunId?: string;
  readonly validationType?: 'static' | 'replay' | 'simulation' | 'shadow' | 'revalidation';
  readonly datasetRef?: string;
  readonly approvalId?: string;
  readonly validationSummaryHash?: string;
  readonly targetArtifactId?: string;
  readonly targetVersion?: number;
  readonly scope?: Readonly<{ artifactKey?: string; domain?: string }>;
  readonly promotionPackage?: Omit<PromotionPackageInput, 'createdAt'>;
}

export interface ArtifactManagementOperationPolicy {
  isEnabled(operation: ArtifactManagementCommandOperation): boolean;
}

export class ArtifactManagementCommandService {
  readonly #governance: ArtifactGovernancePort;
  readonly #promotionPackages:
    Pick<ArtifactPromotionApplicationService, 'createPackage'> | undefined;
  readonly #authorizationQueries:
    Pick<ArtifactManagementQueryRepository, 'getArtifact'> | undefined;
  readonly #audit: CognitiveManagementActionGate | undefined;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #operationPolicy: ArtifactManagementOperationPolicy;

  constructor(
    dependencies: Readonly<{
      governance: ArtifactGovernancePort;
      promotionPackages?: Pick<ArtifactPromotionApplicationService, 'createPackage'>;
      authorizationQueries?: Pick<ArtifactManagementQueryRepository, 'getArtifact'>;
      audit?: CognitiveManagementActionGate;
      clock: Readonly<{ now(): string }>;
      operationPolicy?: ArtifactManagementOperationPolicy;
    }>,
  ) {
    this.#governance = dependencies.governance;
    this.#promotionPackages = dependencies.promotionPackages;
    this.#authorizationQueries = dependencies.authorizationQueries;
    this.#audit = dependencies.audit;
    this.#clock = dependencies.clock;
    this.#operationPolicy = dependencies.operationPolicy ?? {
      isEnabled: () => true,
    };
  }

  async execute(
    principal: ManagementPrincipal,
    operation: ArtifactManagementCommandOperation,
    input: ArtifactManagementCommandInput,
  ): Promise<Readonly<{ status: 'accepted'; operation: ArtifactManagementCommandOperation }>> {
    requireCommandRole(principal, operation);
    if (!this.#operationPolicy.isEnabled(policyOperationFor(operation, input.validationType))) {
      throw new ArtifactManagementError('ARTIFACT_OPERATION_DISABLED', 503);
    }
    if (
      principal.kind === 'service' &&
      ['approve', 'reject', 'activate', 'kill-switch-disable'].includes(operation)
    )
      throw new ArtifactManagementError('MANAGEMENT_SERVICE_PRINCIPAL_DENIED', 403);
    const context = operatorContext(principal, permissionFor(operation));
    const occurredAt = this.#clock.now();
    const base = {
      artifactId: input.artifactId,
      version: input.version,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      occurredAt,
      context,
    };
    if (operation === 'build-promotion-package') {
      if (
        this.#promotionPackages === undefined ||
        this.#authorizationQueries === undefined ||
        this.#audit === undefined
      )
        throw new ArtifactManagementError('ARTIFACT_PROMOTION_PACKAGE_UNAVAILABLE', 503);
      const visible = await this.#authorizationQueries.getArtifact(
        input.artifactId,
        scope(principal),
      );
      if (visible === undefined) throw new ArtifactManagementError('ARTIFACT_NOT_FOUND', 404);
      const promotionPackage = requiredPromotionPackage(input.promotionPackage);
      const promotionPackages = this.#promotionPackages;
      const audit = this.#audit;
      if (promotionPackage.artifactRef !== `${input.artifactId}:${String(input.version)}`)
        throw new ArtifactManagementError('ARTIFACT_PROMOTION_TARGET_MISMATCH', 422);
      await audit.execute(
        {
          operation: 'artifact_build_promotion_package',
          subjectId: `${input.artifactId}:${String(input.version)}`,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          actorId: principal.actorId,
          reason: input.reason,
          requestFingerprint: JSON.stringify(promotionPackage),
        },
        () =>
          promotionPackages.createPackage(
            Object.freeze({
              ...promotionPackage,
              createdAt: occurredAt,
            }),
          ),
      );
    } else if (operation === 'validate' || operation === 'shadow' || operation === 'revalidate') {
      await (operation === 'revalidate'
        ? this.#governance.requestRevalidation({
            ...base,
            validationRunId: required(input.validationRunId, 'validationRunId'),
            validationType: input.validationType ?? 'revalidation',
            datasetRef: required(input.datasetRef, 'datasetRef'),
          })
        : this.#governance.requestValidation({
            ...base,
            validationRunId: required(input.validationRunId, 'validationRunId'),
            validationType: operation === 'shadow' ? 'shadow' : (input.validationType ?? 'static'),
            datasetRef: required(input.datasetRef, 'datasetRef'),
          }));
    } else if (operation === 'approve' || operation === 'reject') {
      await this.#governance.recordApproval({
        ...base,
        approvalId: required(input.approvalId, 'approvalId'),
        decision: operation === 'approve' ? 'approved' : 'rejected',
        validationSummaryHash: required(input.validationSummaryHash, 'validationSummaryHash'),
      });
    } else if (operation === 'activate') {
      await this.#governance.activate({
        ...base,
        artifactKey: required(input.artifactKey, 'artifactKey'),
        expectedLockVersion: requiredNumber(input.expectedLockVersion, 'expectedLockVersion'),
        validationSummaryHash: required(input.validationSummaryHash, 'validationSummaryHash'),
      });
    } else if (operation === 'deprecate') {
      await this.#governance.deprecate({
        ...base,
        artifactKey: required(input.artifactKey, 'artifactKey'),
        expectedLockVersion: requiredNumber(input.expectedLockVersion, 'expectedLockVersion'),
      });
    } else if (operation === 'rollback' || operation === 'kill-switch-disable') {
      await this.#governance.rollback({
        ...base,
        artifactKey: required(input.artifactKey, 'artifactKey'),
        targetArtifactId: required(input.targetArtifactId, 'targetArtifactId'),
        targetVersion: requiredNumber(input.targetVersion, 'targetVersion'),
        expectedLockVersion: requiredNumber(input.expectedLockVersion, 'expectedLockVersion'),
        validationSummaryHash: required(input.validationSummaryHash, 'validationSummaryHash'),
        reason:
          operation === 'kill-switch-disable'
            ? `kill-switch-disable:${input.reason}`
            : input.reason,
      });
    } else {
      const command: ArtifactKillSwitchCommand = {
        context,
        scope:
          input.scope === undefined
            ? Object.freeze({
                ...(input.artifactKey === undefined ? {} : { artifactKey: input.artifactKey }),
                ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
              })
            : Object.freeze({
                ...input.scope,
                ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
              }),
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: `${operation}:${input.reason}`,
        occurredAt,
      };
      await this.#governance.killSwitch(command);
    }
    return Object.freeze({ status: 'accepted', operation });
  }
}

export class A2AArtifactProjectionService {
  project(
    input: Readonly<{
      capabilities: readonly string[];
      inputRequired: boolean;
      confirmation: boolean;
      formalTaskState: string;
      evidence: Readonly<Record<string, unknown>>;
    }>,
  ): A2AArtifactProjection {
    const allowlistedCapabilities = input.capabilities.filter((value) =>
      PUBLIC_CAPABILITIES.has(value),
    );
    return Object.freeze({
      publicCapabilitySummary: Object.freeze([...new Set(allowlistedCapabilities)].sort()),
      inputRequired: input.inputRequired,
      confirmation: input.confirmation,
      formalTaskState: input.formalTaskState,
      safeEvidence: Object.freeze(
        Object.fromEntries(
          Object.entries(redactRecord(input.evidence)).filter(([, value]) =>
            ['string', 'number', 'boolean'].includes(typeof value),
          ),
        ) as Record<string, string | number | boolean | null>,
      ),
      redactionPolicyVersion: 'artifact-exposure/1.1',
    });
  }
}

const ALL_READ_ROLES: readonly ManagementRole[] = [
  'viewer',
  'operator',
  'reviewer',
  'approver',
  'administrator',
  'security_operator',
];
const PUBLIC_CAPABILITIES = new Set([
  'experience-informed-planning',
  'validated-planning-templates',
  'policy-governed-fast-paths',
  'interactive-confirmation',
]);
const SENSITIVE = [
  'credential',
  'secret',
  'token',
  'apikey',
  'password',
  'prompt',
  'privatereasoning',
  'chainofthought',
  'pii',
  'email',
  'phone',
  'address',
  'sourceepisode',
  'sourceknowledge',
  'sourcecorrection',
  'sourcepattern',
];

function requireAnyRole(principal: ManagementPrincipal, allowed: readonly ManagementRole[]): void {
  if (![...principal.roles].some((role) => allowed.includes(role)))
    throw new ArtifactManagementError('MANAGEMENT_PERMISSION_DENIED', 403);
}

function requireCommandRole(
  principal: ManagementPrincipal,
  operation: ArtifactManagementCommandOperation,
): void {
  const roles: readonly ManagementRole[] =
    operation === 'approve' || operation === 'reject'
      ? ['approver']
      : operation === 'activate' || operation === 'deprecate' || operation === 'rollback'
        ? ['administrator']
        : operation === 'build-promotion-package'
          ? ['reviewer', 'operator', 'administrator']
          : operation.startsWith('kill-switch')
            ? ['security_operator']
            : ['operator', 'administrator'];
  requireAnyRole(principal, roles);
}

function permissionFor(operation: ArtifactManagementCommandOperation): ArtifactPermission {
  if (operation === 'approve' || operation === 'reject') return 'artifact.approve';
  if (operation === 'activate') return 'artifact.activate';
  if (operation === 'revalidate') return 'artifact.revalidate';
  if (operation === 'deprecate') return 'artifact.deprecate';
  if (operation === 'rollback' || operation === 'kill-switch-disable') return 'artifact.rollback';
  if (operation.startsWith('kill-switch')) return 'artifact.kill_switch';
  return 'artifact.validate';
}

function policyOperationFor(
  operation: ArtifactManagementCommandOperation,
  validationType: ArtifactManagementCommandInput['validationType'],
): ArtifactManagementCommandOperation {
  if (operation !== 'validate') return operation;
  if (validationType === 'shadow') return 'shadow';
  if (validationType === 'revalidation') return 'revalidate';
  return operation;
}

function requiredPromotionPackage(
  value: Omit<PromotionPackageInput, 'createdAt'> | undefined,
): Omit<PromotionPackageInput, 'createdAt'> {
  if (value === undefined)
    throw new ArtifactManagementError('MANAGEMENT_REQUIRED_FIELD_MISSING:promotionPackage', 422);
  return value;
}

function operatorContext(
  principal: ManagementPrincipal,
  permission: ArtifactPermission,
): OperatorRequestContext {
  return Object.freeze({
    operatorId: principal.actorId,
    ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
    permissions: Object.freeze([permission]),
  });
}

function scope(principal: ManagementPrincipal) {
  return Object.freeze({
    ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
    includeGlobal: hasElevatedRead(principal),
  });
}

function hasElevatedRead(principal: ManagementPrincipal): boolean {
  return (
    principal.tenantId === undefined ||
    principal.roles.has('administrator') ||
    principal.roles.has('security_operator')
  );
}

function redactForPrincipal(value: unknown, principal: ManagementPrincipal): unknown {
  const redacted = redactUnknown(value);
  if (
    principal.roles.has('reviewer') ||
    principal.roles.has('approver') ||
    principal.roles.has('administrator') ||
    principal.roles.has('security_operator')
  )
    return redacted;
  return removeRestrictedDetails(redacted);
}

function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 24) return '[redacted:depth]';
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE.some((marker) =>
        key
          .toLowerCase()
          .replace(/[^a-z0-9]/gu, '')
          .includes(marker),
      )
        ? '[redacted]'
        : redactUnknown(item, depth + 1),
    ]),
  );
}

function redactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(redactUnknown(value) as Record<string, unknown>);
}

function removeRestrictedDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeRestrictedDetails);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      ['definition', 'lineage', 'counterexamples', 'audit'].includes(key.toLowerCase())
        ? []
        : [[key, removeRestrictedDetails(item)]],
    ),
  );
}

function required(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '')
    throw new ArtifactManagementError(`MANAGEMENT_${field.toUpperCase()}_REQUIRED`, 422);
  return value;
}

function requiredNumber(value: number | undefined, field: string): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0)
    throw new ArtifactManagementError(`MANAGEMENT_${field.toUpperCase()}_REQUIRED`, 422);
  return value;
}

export class ArtifactManagementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ArtifactManagementError';
    this.code = code;
    this.status = status;
  }
}
