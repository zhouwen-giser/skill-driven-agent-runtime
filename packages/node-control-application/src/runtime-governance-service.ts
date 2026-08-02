import { createHash } from 'node:crypto';

import {
  createManagementOperation,
  transitionManagementOperation,
  type ControlAuditEvent,
  type ManagementOperation,
  type ResourceRef,
} from '../../node-control-domain/src/index.js';

export interface SkillVersionView {
  readonly skillId: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  readonly status: 'draft' | 'validated' | 'published' | 'suspended' | 'deprecated' | 'retired';
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly usageSpecification?: Readonly<Record<string, unknown>>;
  readonly outcomeSpecification?: Readonly<Record<string, unknown>>;
  readonly evidencePolicy?: Readonly<Record<string, unknown>>;
  readonly providerPolicy?: Readonly<Record<string, unknown>>;
  readonly checksum?: string;
  readonly createdAt?: string;
}

export interface PlanTemplateVersionView {
  readonly artifactId: string;
  readonly version: string;
  readonly name?: string;
  readonly status:
    'candidate' | 'validated' | 'approved' | 'active' | 'suspended' | 'deprecated' | 'retired';
  readonly checksum: string;
  readonly validationSummary?: Readonly<Record<string, unknown>>;
  readonly activePointer?: boolean;
  readonly createdAt?: string;
}

export interface RuntimePlanTemplateVersionView extends PlanTemplateVersionView {
  /** Exact P02/P06 authority identifier; never exposed by the public Node Control API. */
  readonly authorityArtifactId: string;
}

export interface RuntimeGovernanceCommand {
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly payload?: unknown;
  readonly expectedRevision?: number;
}

export interface NodeControlRuntimeGovernanceClient {
  listSkills(): Promise<readonly SkillVersionView[]>;
  listSkillVersions(skillId: string): Promise<readonly SkillVersionView[]>;
  getSkillVersion(skillId: string, version: string): Promise<SkillVersionView>;
  listPlanTemplates(): Promise<readonly RuntimePlanTemplateVersionView[]>;
  importSkill(command: RuntimeGovernanceCommand): Promise<ManagementOperation>;
  governSkill(
    operation: 'publish' | 'suspend' | 'deprecate',
    skillId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation>;
  governPlanTemplate(
    operation: 'publish' | 'revalidate' | 'suspend',
    artifactId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation>;
}

export interface NodeControlGovernanceOperationRepository {
  findGovernanceOperationReplay(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined>;
  recordGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
}

export class NodeControlRuntimeGovernanceService {
  readonly #runtime: NodeControlRuntimeGovernanceClient;
  readonly #operations: NodeControlGovernanceOperationRepository;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #actorId: string;

  constructor(
    dependencies: Readonly<{
      runtime: NodeControlRuntimeGovernanceClient;
      operations: NodeControlGovernanceOperationRepository;
      clock: Readonly<{ now(): string }>;
      actorId: string;
    }>,
  ) {
    this.#runtime = dependencies.runtime;
    this.#operations = dependencies.operations;
    this.#clock = dependencies.clock;
    this.#actorId = dependencies.actorId;
  }

  async listSkills(status?: string): Promise<readonly SkillVersionView[]> {
    const items = await this.#runtime.listSkills();
    return Object.freeze(
      status === undefined ? [...items] : items.filter((item) => item.status === status),
    );
  }

  listSkillVersions(skillId: string): Promise<readonly SkillVersionView[]> {
    return this.#runtime.listSkillVersions(skillId);
  }

  getSkillVersion(skillId: string, version: string): Promise<SkillVersionView> {
    return this.#runtime.getSkillVersion(skillId, version);
  }

  async listPlanTemplates(): Promise<readonly PlanTemplateVersionView[]> {
    const items = await this.#runtime.listPlanTemplates();
    const selected = new Map<string, RuntimePlanTemplateVersionView>();
    for (const item of items) {
      const current = selected.get(item.artifactId);
      if (current === undefined || preferredPlanTemplate(item, current))
        selected.set(item.artifactId, item);
    }
    return Object.freeze([...selected.values()].map(publicPlanTemplate));
  }

  async listPlanTemplateVersions(artifactId: string): Promise<readonly PlanTemplateVersionView[]> {
    return Object.freeze(
      (await this.#runtime.listPlanTemplates())
        .filter((item) => item.artifactId === artifactId)
        .map(publicPlanTemplate),
    );
  }

  async getPlanTemplateVersion(
    artifactId: string,
    version: string,
  ): Promise<PlanTemplateVersionView> {
    const found = (await this.listPlanTemplateVersions(artifactId)).find(
      (item) => item.version === version,
    );
    if (found === undefined)
      throw new NodeControlRuntimeGovernanceError(
        'PLAN_TEMPLATE_VERSION_NOT_FOUND',
        'The exact Plan Template version was not found.',
        404,
      );
    return found;
  }

  importSkill(command: RuntimeGovernanceCommand): Promise<ManagementOperation> {
    return this.#execute('skill.import', { type: 'skill_package', id: 'import' }, command, () =>
      this.#runtime.importSkill(command),
    );
  }

  governSkill(
    operation: 'publish' | 'suspend' | 'deprecate',
    skillId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation> {
    return this.#execute(
      `skill.${operation}`,
      { type: 'skill_version', id: skillId, version },
      command,
      () => this.#runtime.governSkill(operation, skillId, version, command),
    );
  }

  async governPlanTemplate(
    operation: 'publish' | 'revalidate' | 'suspend',
    artifactId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation> {
    return this.#execute(
      `plan-template.${operation}`,
      { type: 'plan_template_version', id: artifactId, version },
      command,
      async () => {
        const versions = await this.#runtime.listPlanTemplates();
        const exact = versions.find(
          (item) => item.artifactId === artifactId && item.version === version,
        );
        if (exact === undefined)
          throw new NodeControlRuntimeGovernanceError(
            'PLAN_TEMPLATE_VERSION_NOT_FOUND',
            'The exact Plan Template version was not found.',
            404,
          );
        return this.#runtime.governPlanTemplate(
          operation,
          exact.authorityArtifactId,
          version,
          commandForPlanTemplate(command, artifactId, versions),
        );
      },
    );
  }

  async #execute(
    operationType: string,
    target: ResourceRef,
    command: RuntimeGovernanceCommand,
    invoke: () => Promise<ManagementOperation>,
  ): Promise<ManagementOperation> {
    const idempotencyKeyHash = sha256(command.idempotencyKey);
    const inputHash = sha256Json({ operationType, target, command });
    const replay = await this.#operations.findGovernanceOperationReplay(
      operationType,
      idempotencyKeyHash,
    );
    if (replay !== undefined) {
      if (replay.inputHash !== inputHash)
        throw new NodeControlRuntimeGovernanceError(
          'RUNTIME_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for a different governance request.',
          409,
        );
      return replay;
    }
    const occurredAt = this.#clock.now();
    const accepted = createManagementOperation(
      {
        operationId: `control-governance-${sha256(`${operationType}:${idempotencyKeyHash}`)}`,
        operationType,
        target,
        actorId: this.#actorId,
        reason: command.reason,
        idempotencyKeyHash,
        inputHash,
      },
      occurredAt,
    );
    try {
      const runtime = await invoke();
      const running = transitionManagementOperation(accepted, 'running', occurredAt);
      const completed =
        runtime.status === 'failed'
          ? transitionManagementOperation(running, 'failed', this.#clock.now(), {
              errorCode: runtime.errorCode ?? 'RUNTIME_GOVERNANCE_FAILED',
              result: { runtimeOperationId: runtime.operationId },
            })
          : transitionManagementOperation(running, 'succeeded', this.#clock.now(), {
              result: { runtimeOperationId: runtime.operationId, runtimeOperation: runtime },
            });
      return await this.#operations.recordGovernanceOperation(
        completed,
        auditFor(completed, inputHash, completed.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED'),
      );
    } catch (error) {
      const failed = transitionManagementOperation(
        transitionManagementOperation(accepted, 'running', occurredAt),
        'failed',
        this.#clock.now(),
        { errorCode: governanceErrorCode(error) },
      );
      await this.#operations.recordGovernanceOperation(
        failed,
        auditFor(failed, inputHash, 'FAILED'),
      );
      throw error;
    }
  }
}

function publicPlanTemplate(input: RuntimePlanTemplateVersionView): PlanTemplateVersionView {
  return Object.freeze({
    artifactId: input.artifactId,
    version: input.version,
    ...(input.name === undefined ? {} : { name: input.name }),
    status: input.status,
    checksum: input.checksum,
    ...(input.validationSummary === undefined
      ? {}
      : { validationSummary: input.validationSummary }),
    ...(input.activePointer === undefined ? {} : { activePointer: input.activePointer }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

function preferredPlanTemplate(
  candidate: RuntimePlanTemplateVersionView,
  current: RuntimePlanTemplateVersionView,
): boolean {
  if (candidate.activePointer === true && current.activePointer !== true) return true;
  if (candidate.activePointer !== true && current.activePointer === true) return false;
  const candidateVersion = Number(candidate.version);
  const currentVersion = Number(current.version);
  return Number.isSafeInteger(candidateVersion) && Number.isSafeInteger(currentVersion)
    ? candidateVersion > currentVersion
    : candidate.version.localeCompare(current.version, 'en') > 0;
}

function commandForPlanTemplate(
  command: RuntimeGovernanceCommand,
  artifactId: string,
  versions: readonly RuntimePlanTemplateVersionView[],
): RuntimeGovernanceCommand {
  const source: Readonly<Record<string, unknown>> = isRecord(command.payload)
    ? command.payload
    : Object.freeze({});
  const targetArtifactId = source['targetArtifactId'];
  const targetVersion = source['targetVersion'];
  let authorityTargetArtifactId: string | undefined;
  if (targetArtifactId !== undefined || targetVersion !== undefined) {
    if (
      typeof targetArtifactId !== 'string' ||
      (typeof targetVersion !== 'string' && typeof targetVersion !== 'number')
    )
      throw new NodeControlRuntimeGovernanceError(
        'PLAN_TEMPLATE_ROLLBACK_TARGET_INVALID',
        'Plan Template rollback requires a logical target artifactId and exact targetVersion.',
        400,
      );
    const target = versions.find(
      (item) => item.artifactId === targetArtifactId && item.version === String(targetVersion),
    );
    if (target === undefined)
      throw new NodeControlRuntimeGovernanceError(
        'PLAN_TEMPLATE_ROLLBACK_TARGET_NOT_FOUND',
        'The exact Plan Template rollback target was not found.',
        404,
      );
    authorityTargetArtifactId = target.authorityArtifactId;
  }
  return Object.freeze({
    ...command,
    payload: Object.freeze({
      ...source,
      artifactKey: artifactId,
      ...(authorityTargetArtifactId === undefined
        ? {}
        : { targetArtifactId: authorityTargetArtifactId }),
    }),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function auditFor(
  operation: ManagementOperation,
  requestHash: string,
  resultCode: string,
): ControlAuditEvent {
  return Object.freeze({
    auditId: `audit-${operation.operationId}`,
    actorId: operation.actorId,
    action: operation.operationType,
    aggregateType: operation.target.type,
    aggregateId: `${operation.target.id}${operation.target.version === undefined ? '' : `:${operation.target.version}`}`,
    reason: operation.reason,
    requestHash,
    resultCode,
    createdAt: operation.completedAt ?? operation.createdAt,
  });
}

function governanceErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'RUNTIME_GOVERNANCE_UNAVAILABLE';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export class NodeControlRuntimeGovernanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'NodeControlRuntimeGovernanceError';
    this.code = code;
    this.status = status;
  }
}
