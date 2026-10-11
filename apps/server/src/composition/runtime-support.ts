import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { type PoolClient } from 'pg';
import type {
  RemoteTaskCancellationService,
  RuntimeTaskCapabilityService,
  parseArtifactFeatureFlags,
} from '../../../../packages/application/src/index.js';
import { type ArtifactManagementCommandOperation } from '../../../../packages/application/src/index.js';
import {
  type AgentTask,
  type McpInvocationOutcome,
  type SkillUsageCandidateSnapshot,
  type SkillUsageSelectionContext,
  type SkillVersion,
  type WorkflowInstance,
} from '../../../../packages/domain/src/index.js';
import { type DeterministicCapabilityExecutionInput } from '../../../../packages/management-api/src/index.js';
import type { PostgresWorkflowPlanRepository } from '../../../../packages/persistence-postgres/src/index.js';
import {
  type CapabilityAuthorityReader,
  type CurrentMcpProviderBindingAuthorityReader,
  type CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../../packages/runtime-control-application/src/index.js';
import {
  assertNoHomeAssistantEntityId,
  deterministicExecutionError,
} from '.././deterministic-capability-recovery.js';
import {
  UGV_AGENT_PROFILE_SKILL_ID,
  UGV_AGENT_PROFILE_SKILL_VERSION,
} from '.././ugv-agent-profile.js';
import type { UgvMoveWorkflowAuthority } from '.././ugv-move-workflow-authority.js';
import type { ServerRuntimeOptions, UgvTaskProviderBindingExpectation } from './contracts.js';

export const PROMOTION_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS =
  new Set<ArtifactManagementCommandOperation>([
    'build-promotion-package',
    'approve',
    'reject',
    'activate',
  ]);

export const SHADOW_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS =
  new Set<ArtifactManagementCommandOperation>(['shadow', 'revalidate']);

export const HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS = Object.freeze({
  'home.light.read-state': Object.freeze({
    capabilityVersion: 1,
    capabilityBindingId: 'capability-binding-home.light.read-state-v1',
    capabilityBindingVersion: 1,
    skillId: 'home.light.get-state',
    skillVersion: 1,
    mcpProviderBindingId: 'mcp-binding-ha-light-lab',
    toolName: 'light_get_state',
    resourceId: 'living-room-main-light',
    evidenceType: 'light.state.observation',
  }),
  'home.climate.read-state': Object.freeze({
    capabilityVersion: 1,
    capabilityBindingId: 'capability-binding-home.climate.read-state-v1',
    capabilityBindingVersion: 1,
    skillId: 'home.climate.get-state',
    skillVersion: 1,
    mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
    toolName: 'climate_get_state',
    resourceId: 'living-room-air-conditioner',
    evidenceType: 'climate.state.observation',
  }),
});

export function requireHomeLabReadOnlyTerminalPreparation(
  profile: NonNullable<ServerRuntimeOptions['taskUnderstanding']>['profile'] | undefined,
  task: Pick<AgentTask, 'temporarySkillId'>,
  instance: Pick<WorkflowInstance, 'status' | 'errors'>,
): readonly Readonly<{ code: string; message: string }>[] | undefined {
  if (profile !== 'home_lab_read_only') return undefined;
  if (task.temporarySkillId !== undefined)
    throw new Error('HOME_LAB_READ_ONLY_TEMPORARY_SKILL_FORBIDDEN');
  if (instance.status !== 'succeeded')
    throw new Error('HOME_LAB_READ_ONLY_TERMINAL_INSTANCE_NOT_SUCCEEDED');
  const errors = Object.values(instance.errors);
  if (errors.length !== 0) throw new Error('HOME_LAB_READ_ONLY_TERMINAL_INSTANCE_ERRORS_PRESENT');
  return Object.freeze(errors);
}

export function createA2ACancelReconciliationHandler(
  tasks: Readonly<{ cancel(taskId: string): Promise<unknown> }>,
): (taskId: string) => Promise<void> {
  return async (taskId) => {
    await tasks.cancel(taskId);
  };
}

export function requestContinuationActivationFailureCancellation(
  cancellations: Pick<RemoteTaskCancellationService, 'request'>,
  input: Readonly<{
    bindingId: string;
    snapshotId: string;
    workflowInstanceId: string;
  }>,
) {
  return cancellations.request({
    bindingId: input.bindingId,
    idempotencyKey: `continuation-activation-failure:${input.snapshotId}:${input.bindingId}`,
    source: 'compensation',
    reasonCode: 'WORKFLOW_CONTINUATION_ACTIVATION_FAILED',
    summary: `Workflow ${input.workflowInstanceId} continuation activation failed after remote Task admission.`,
  });
}

export async function resumeTaskOwnedHumanConfirmation<TTask, TResult>(
  input: Readonly<{ instanceId: string; confirmed: boolean }>,
  dependencies: Readonly<{
    findInstance(instanceId: string): Promise<Readonly<{ planId: string }> | undefined>;
    findTaskByPlanId(planId: string): Promise<TTask | undefined>;
    taskIdentity(task: TTask): Readonly<{ taskId: string; contextId: string }>;
    resolveWorkflowControlId(task: TTask): Promise<string>;
    resume(
      input: Readonly<{
        instanceId: string;
        confirmed: boolean;
        continuationAuthority: Readonly<{
          agentTaskId: string;
          contextId: string;
          workflowControlId: string;
        }>;
      }>,
    ): Promise<TResult>;
  }>,
): Promise<TResult> {
  const instance = await dependencies.findInstance(input.instanceId);
  if (instance === undefined)
    throw Object.assign(new Error('Workflow instance was not found.'), {
      code: 'WORKFLOW_INSTANCE_NOT_FOUND' as const,
    });
  const task = await dependencies.findTaskByPlanId(instance.planId);
  if (task === undefined)
    throw Object.assign(new Error('Task-owned Workflow continuation authority is required.'), {
      code: 'WORKFLOW_CONTINUATION_TASK_AUTHORITY_REQUIRED' as const,
    });
  const identity = dependencies.taskIdentity(task);
  return dependencies.resume({
    ...input,
    continuationAuthority: Object.freeze({
      agentTaskId: identity.taskId,
      contextId: identity.contextId,
      workflowControlId: await dependencies.resolveWorkflowControlId(task),
    }),
  });
}

export function resolveSkillUsageSelectionId(
  input: Readonly<{
    selectedSkill: boolean;
    skillSelectionConfigured: boolean;
    skillSelectionId?: string;
  }>,
): string | undefined {
  if (!input.selectedSkill) return undefined;
  if (input.skillSelectionId !== undefined) return input.skillSelectionId;
  if (input.skillSelectionConfigured) throw new Error('SKILL_USAGE_SELECTION_ID_REQUIRED');
  return undefined;
}

export function conservativeSkillUsageSelectionContext() {
  return Object.freeze({
    observations: Object.freeze([]),
    risk: 'medium' as const,
    humanConfirmation: 'pending' as const,
    systemPolicy: Object.freeze({
      allowedModes: Object.freeze(['guidance', 'template', 'procedure'] as const),
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: true,
    }),
  });
}

export function requireHomeLabReadOnlyExecutionContract(
  input: DeterministicCapabilityExecutionInput,
) {
  assertDeterministicExecutionRequestIdentity(input);
  const contract = Object.entries(HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS).find(
    ([capabilityId]) => capabilityId === input.capabilityId,
  )?.[1];
  if (
    input.capabilityVersion !== contract?.capabilityVersion ||
    input.capabilityBindingId !== contract.capabilityBindingId ||
    input.capabilityBindingVersion !== contract.capabilityBindingVersion ||
    input.skillId !== contract.skillId ||
    input.skillVersion !== contract.skillVersion ||
    input.mcpProviderBindingId !== contract.mcpProviderBindingId ||
    input.toolName !== contract.toolName ||
    input.resourceId !== contract.resourceId
  )
    throw deterministicExecutionError(
      'DETERMINISTIC_READ_ONLY_CONTRACT_NOT_EXACT',
      'Execution authority does not match one supported home-lab read-only contract.',
    );
  return contract;
}

export function assertDeterministicExecutionRequestIdentity(
  input: DeterministicCapabilityExecutionInput,
): void {
  if (input.idempotencyKey !== input.taskId)
    throw deterministicExecutionError(
      'DETERMINISTIC_IDEMPOTENCY_IDENTITY_MISMATCH',
      'Idempotency-Key must equal the deterministic Task ID.',
    );
  assertNoHomeAssistantEntityId(input);
}

export function assertDeterministicReadOnlySkill(
  skill: SkillVersion,
  input: DeterministicCapabilityExecutionInput,
  evidenceType: string,
): void {
  const usage = skill.usageSpecification;
  const requiredTool = skill.toolPolicy.required[0];
  const taskBinding = usage?.taskBindings[0];
  const sideEffectPolicy = skill.outcomeSpecification?.sideEffectPolicy;
  const requiredEvidence = usage?.evidencePolicy.requirements.filter(
    (requirement) => requirement.required || requirement.hardGate,
  );
  if (
    skill.capabilities.length !== 1 ||
    skill.capabilities[0] !== input.capabilityId ||
    requiredTool?.serverId !== input.serverId ||
    requiredTool.toolName !== input.toolName ||
    skill.toolPolicy.required.length !== 1 ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.runtimePolicy.maxLlmCalls !== 0 ||
    skill.runtimePolicy.maxMcpCalls !== 1 ||
    !isRecord(sideEffectPolicy) ||
    sideEffectPolicy['sideEffecting'] !== false ||
    usage?.modes.supported.length !== 1 ||
    usage.modes.supported[0] !== 'procedure' ||
    usage.modes.defaultMode !== 'procedure' ||
    taskBinding?.taskType !== input.toolName ||
    taskBinding.providerPolicy.selection !== 'required' ||
    taskBinding.providerPolicy.requiredProviderId !== input.serverId ||
    !taskBinding.providerPolicy.requiredAttributes.includes('task_behavior:synchronous_only') ||
    usage.taskBindings.length !== 1 ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    requiredEvidence?.length !== 1 ||
    requiredEvidence[0]?.evidenceType !== evidenceType ||
    !requiredEvidence[0].hardGate
  )
    throw deterministicExecutionError(
      'DETERMINISTIC_READ_ONLY_SKILL_POLICY_INVALID',
      'The exact Skill does not preserve the closed read-only procedure contract.',
    );
}

export function assertDeterministicUsageCandidate(
  candidate: SkillUsageCandidateSnapshot | undefined,
  input: DeterministicCapabilityExecutionInput,
  requiredReadinessAttributes: readonly string[],
): asserts candidate is SkillUsageCandidateSnapshot &
  Readonly<{
    modeDecision: Extract<SkillUsageCandidateSnapshot['modeDecision'], { decision: 'selected' }>;
  }> {
  const binding = candidate?.applicability.readiness.bindings[0];
  const selectedProvider = binding?.candidates?.find((provider) => provider.selected);
  if (
    candidate?.skillId !== input.skillId ||
    candidate.skillVersion !== input.skillVersion ||
    candidate.applicability.status !== 'satisfied' ||
    candidate.applicability.readiness.overall !== 'ready' ||
    candidate.modeDecision.decision !== 'selected' ||
    candidate.modeDecision.mode !== 'procedure' ||
    !candidate.modeDecision.confirmationSatisfied ||
    candidate.applicability.readiness.bindings.length !== 1 ||
    binding?.selectedProviderId !== input.serverId ||
    binding.selectedOperationName !== input.toolName ||
    selectedProvider?.providerId !== input.serverId ||
    selectedProvider.operationName !== input.toolName ||
    !requiredReadinessAttributes.every((attribute) =>
      selectedProvider.attributes.includes(attribute),
    )
  )
    throw deterministicExecutionError(
      'DETERMINISTIC_SKILL_USAGE_NOT_READY',
      'Exact Skill procedure applicability or synchronous Provider readiness is not satisfied.',
    );
}

export async function currentTaskProviderBindingContext(
  task: AgentTask,
  localServerId: string,
  taskCapabilities: Pick<
    RuntimeTaskCapabilityService,
    'resolveCurrentProviderBindingId' | 'resolveCurrentCapabilityAttemptId'
  >,
  providerBindings?: CurrentMcpProviderBindingAuthorityReader,
  strictExpected?: UgvTaskProviderBindingExpectation,
): Promise<
  | Readonly<{
      providerBindingId?: string;
      providerId?: string;
      capabilityAttemptId?: string;
    }>
  | undefined
> {
  const capabilityAttemptId = await taskCapabilities.resolveCurrentCapabilityAttemptId(task.taskId);
  const deterministic = task.requestMetadata['io.sdar/deterministicCapabilityExecution'];
  if (isRecord(deterministic) && strictExpected === undefined) {
    const bindingId = deterministic['mcpProviderBindingId'];
    const providerId = deterministic['providerId'];
    const serverId = deterministic['serverId'];
    if (
      typeof bindingId !== 'string' ||
      bindingId.trim() === '' ||
      typeof providerId !== 'string' ||
      providerId.trim() === '' ||
      serverId !== localServerId
    )
      throw new Error('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
    return Object.freeze({
      providerBindingId: bindingId,
      providerId,
      ...(capabilityAttemptId === undefined ? {} : { capabilityAttemptId }),
    });
  }
  const providerBindingId = await taskCapabilities.resolveCurrentProviderBindingId(
    task.taskId,
    localServerId,
  );
  if (
    strictExpected !== undefined &&
    (!validUgvTaskProviderBindingExpectation(strictExpected) ||
      providerBindingId === undefined ||
      providerBindingId !== strictExpected.bindingId ||
      capabilityAttemptId === undefined ||
      providerBindings === undefined ||
      localServerId !== strictExpected.localServerId)
  )
    throw new Error('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
  if (providerBindingId === undefined && capabilityAttemptId === undefined) return undefined;
  let providerBinding: CurrentMcpProviderBindingAuthoritySnapshot | undefined;
  try {
    providerBinding =
      providerBindingId === undefined || providerBindings === undefined
        ? undefined
        : await providerBindings.loadCurrentMcpProviderBinding({
            bindingId: providerBindingId,
            localServerId,
          });
  } catch {
    throw new Error('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
  }
  if (
    (strictExpected !== undefined && providerBinding === undefined) ||
    (providerBinding !== undefined &&
      (providerBinding.binding.bindingId !== providerBindingId ||
        providerBinding.binding.localServerId !== localServerId ||
        providerBinding.binding.providerId.trim() === '' ||
        (strictExpected !== undefined &&
          (providerBinding.binding.providerId !== strictExpected.providerId ||
            providerBinding.binding.revision !== strictExpected.bindingRevision ||
            providerBinding.binding.catalogRevision !== strictExpected.catalogRevision ||
            providerBinding.binding.catalogChecksum !== strictExpected.catalogChecksum)))) ||
    (strictExpected !== undefined && deterministic !== undefined)
  )
    throw new Error('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
  return Object.freeze({
    ...(providerBindingId === undefined ? {} : { providerBindingId }),
    ...(providerBinding === undefined ? {} : { providerId: providerBinding.binding.providerId }),
    ...(capabilityAttemptId === undefined ? {} : { capabilityAttemptId }),
  });
}

export function validUgvTaskProviderBindingExpectation(
  value: UgvTaskProviderBindingExpectation,
): boolean {
  return (
    value.bindingId.trim() !== '' &&
    Number.isSafeInteger(value.bindingRevision) &&
    value.bindingRevision > 0 &&
    value.providerId.trim() !== '' &&
    value.localServerId.trim() !== '' &&
    value.catalogRevision.trim() !== '' &&
    /^[0-9a-f]{64}$/u.test(value.catalogChecksum)
  );
}

export async function loadExactUgvTaskProviderBindingExpectation(
  input: Readonly<{
    task: AgentTask;
    instance: WorkflowInstance | undefined;
    plan: Awaited<ReturnType<PostgresWorkflowPlanRepository['findPlan']>>;
    definition: NonNullable<
      Awaited<ReturnType<PostgresWorkflowPlanRepository['findPlan']>>
    >['definition'];
    workflowAuthority: UgvMoveWorkflowAuthority | undefined;
  }>,
): Promise<UgvTaskProviderBindingExpectation> {
  if (
    input.instance === undefined ||
    input.plan === undefined ||
    input.definition === undefined ||
    input.workflowAuthority === undefined ||
    input.task.selectedSkillId !== UGV_AGENT_PROFILE_SKILL_ID ||
    input.task.selectedSkillVersion !== UGV_AGENT_PROFILE_SKILL_VERSION
  )
    throw new Error('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
  const selected = await input.workflowAuthority.loadExact({
    taskId: input.task.taskId,
    workflowPlanId: input.plan.planId,
    workflowDefinitionId: input.definition.workflowDefinitionId,
    workflowDefinitionVersion: input.definition.version,
    goalId: input.instance.goalId,
    goalVersion: input.instance.goalVersion,
    skillId: input.task.selectedSkillId,
    skillVersion: input.task.selectedSkillVersion,
  });
  return Object.freeze({
    bindingId: selected.providerBinding.bindingId,
    bindingRevision: selected.providerBinding.revision,
    providerId: selected.provider.providerId,
    localServerId: selected.server.serverId,
    catalogRevision: selected.server.catalogRevision,
    catalogChecksum: selected.server.catalogChecksum,
  });
}

export async function requireDeterministicProviderBindingAuthority(
  input: DeterministicCapabilityExecutionInput,
  reader: CurrentMcpProviderBindingAuthorityReader | undefined,
): Promise<CurrentMcpProviderBindingAuthoritySnapshot> {
  if (reader === undefined)
    throw deterministicExecutionError(
      'DETERMINISTIC_PROVIDER_BINDING_AUTHORITY_UNAVAILABLE',
      'Current Node Control MCP Provider Binding authority is required.',
    );
  try {
    const authority = await reader.loadCurrentMcpProviderBinding({
      bindingId: input.mcpProviderBindingId,
      localServerId: input.serverId,
    });
    if (
      authority.binding.bindingId !== input.mcpProviderBindingId ||
      authority.binding.localServerId !== input.serverId ||
      authority.binding.providerId !== input.providerId ||
      authority.binding.availabilityStatus !== 'available' ||
      Date.parse(authority.binding.availabilityValidUntil) <= Date.parse(authority.observedAt)
    )
      throw new Error('MCP_PROVIDER_BINDING_NOT_CURRENT');
    return authority;
  } catch {
    throw deterministicExecutionError(
      'DETERMINISTIC_PROVIDER_BINDING_NOT_CURRENT',
      'Current Node Control MCP Provider Binding authority does not match the request.',
    );
  }
}

export async function requireManagedDeterministicCapabilityAuthority(
  input: DeterministicCapabilityExecutionInput,
  reader: CapabilityAuthorityReader | undefined,
) {
  if (reader === undefined)
    throw deterministicExecutionError(
      'DETERMINISTIC_CAPABILITY_AUTHORITY_UNAVAILABLE',
      'Current Node Control Capability authority is required.',
    );
  try {
    return await reader.load(input.capabilityId, input.capabilityVersion);
  } catch {
    throw deterministicExecutionError(
      'DETERMINISTIC_CAPABILITY_AUTHORITY_NOT_CURRENT',
      'Current Node Control Capability authority does not match the request.',
    );
  }
}

export function deterministicSkillUsageContext(
  input: DeterministicCapabilityExecutionInput,
  providerBinding: CurrentMcpProviderBindingAuthoritySnapshot,
): SkillUsageSelectionContext {
  return Object.freeze({
    observations: Object.freeze([
      Object.freeze({
        requirementId: 'public-resource-id',
        source: 'authoritative_context' as const,
        status: 'available' as const,
        evidenceRef: `public-resource:${input.resourceId}`,
      }),
      Object.freeze({
        requirementId: 'provider-binding-freshness',
        source: 'authoritative_context' as const,
        status: 'available' as const,
        evidenceRef: `node-control-provider-binding:${providerBinding.binding.bindingId}:revision:${String(providerBinding.binding.revision)}:observed-at:${providerBinding.observedAt}`,
      }),
    ]),
    risk: 'low' as const,
    humanConfirmation: 'confirmed' as const,
    systemPolicy: Object.freeze({
      allowedModes: Object.freeze(['procedure'] as const),
      preferredMode: 'procedure' as const,
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: false,
    }),
  });
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function uniqueToolReferences<T extends Readonly<{ serverId: string; toolName: string }>>(
  references: readonly T[],
): readonly T[] {
  return [
    ...new Map(
      references.map((reference) => [
        `${reference.serverId}\u0000${reference.toolName}`,
        reference,
      ]),
    ).values(),
  ];
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function businessEventHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function unwrapMcpInvocationOutcome(outcome: McpInvocationOutcome): unknown {
  if (outcome.kind === 'immediate') return outcome.result;
  throw new RemoteMcpTaskPhaseNotConnectedError(outcome.task.remoteTaskId);
}

export class RemoteMcpTaskPhaseNotConnectedError extends Error {
  readonly code = 'MCP_REMOTE_TASK_PHASE_NOT_CONNECTED';

  constructor(remoteTaskId: string) {
    super(
      `Remote MCP Task ${remoteTaskId} was accepted before the Phase 4 continuation is active.`,
    );
    this.name = 'RemoteMcpTaskPhaseNotConnectedError';
  }
}

export class RemoteMcpTaskAdmissionUncertainError extends Error {
  readonly code = 'REMOTE_TASK_ADMISSION_UNCERTAIN';

  constructor(remoteTaskId: string) {
    super(
      `Remote MCP Task ${remoteTaskId} may be running, but its local binding could not be committed.`,
    );
    this.name = 'RemoteMcpTaskAdmissionUncertainError';
  }
}

export async function applyRuntimeMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended('sdar-runtime-migrations',0))`);
    const schemaState = await client.query<{
      migration_table: string | null;
      public_table_count: number;
    }>(
      `SELECT to_regclass('public.schema_migration')::text AS migration_table,
              (SELECT count(*)::integer
               FROM information_schema.tables
               WHERE table_schema='public' AND table_type='BASE TABLE') AS public_table_count`,
    );
    const state = schemaState.rows[0];
    if (state?.migration_table !== null && state?.migration_table !== undefined) {
      const versions = await client.query<{ version: string }>(
        `SELECT version
         FROM public.schema_migration
         ORDER BY CASE WHEN version='v1.2.2_clean_slate_baseline' THEN 0 ELSE 1 END, version`,
      );
      await applyPostV122Migrations(
        client,
        versions.rows.map((row) => row.version),
      );
      return;
    }
    if ((state?.public_table_count ?? 0) !== 0)
      throw new Error('SDAR_V122_CLEAN_DATABASE_REQUIRED');

    const baseline = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'baseline', '0001_sdar_v1_2_2_baseline.sql'),
      'utf8',
    );
    await client.query(baseline);
    const seed = await readFile(
      resolve(process.cwd(), 'infra', 'postgres', 'seed', '0001_sdar_v1_2_2_minimal_seed.sql'),
      'utf8',
    );
    await client.query(seed);
    await assertV122RuntimeReady(client);
    await applyPostV122Migrations(client, ['v1.2.2_clean_slate_baseline']);
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(hashtextextended('sdar-runtime-migrations',0))`)
      .catch(() => undefined);
    client.release();
  }
}

export function isArtifactManagementOperationEnabled(
  operation: ArtifactManagementCommandOperation,
  flags: ReturnType<typeof parseArtifactFeatureFlags>,
): boolean {
  if (PROMOTION_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS.has(operation)) {
    return flags.promotionEnabled;
  }
  if (SHADOW_CONTROLLED_ARTIFACT_MANAGEMENT_OPERATIONS.has(operation)) {
    return flags.shadowEnabled;
  }
  // Validation remains an explicit operator action. Deprecation, rollback and
  // kill-switch commands are safety controls and must remain available while
  // promotion and shadow paths are stopped.
  return true;
}

export async function applyPostV122Migrations(
  pool: Pick<PoolClient, 'query'>,
  appliedVersions: readonly string[],
): Promise<void> {
  const migrationDirectory = resolve(process.cwd(), 'infra', 'postgres', 'migrations');
  const migrationFiles = planPostV122MigrationFiles(
    await readdir(migrationDirectory),
    appliedVersions,
  );
  for (const file of migrationFiles) {
    await pool.query(await readFile(resolve(migrationDirectory, file), 'utf8'));
  }
}

export const POST_V122_MIGRATION_FILE_PATTERN =
  /^(?:01[0-9]{2}_v(?:123|13|14)_[a-z0-9_]+|0173_remote_task_accepted_substate)\.up\.sql$/u;

export function planPostV122MigrationFiles(
  availableFiles: readonly string[],
  appliedVersions: readonly string[],
): readonly string[] {
  const migrationFiles = availableFiles
    .filter((file) => POST_V122_MIGRATION_FILE_PATTERN.test(file))
    .sort();
  const expectedVersions = [
    'v1.2.2_clean_slate_baseline',
    ...migrationFiles.map((file) => file.slice(0, -'.up.sql'.length)),
  ];
  if (
    appliedVersions.length > expectedVersions.length ||
    appliedVersions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error('SDAR_V123_MIGRATION_LEDGER_INVALID');
  }
  return migrationFiles.slice(Math.max(0, appliedVersions.length - 1));
}

export async function assertV122RuntimeReady(pool: Pick<PoolClient, 'query'>): Promise<void> {
  const result = await pool.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.schema_migration
       WHERE version='v1.2.2_clean_slate_baseline'
     ) AS ready`,
  );
  if (result.rows[0]?.ready !== true) throw new Error('SDAR_V122_BASELINE_NOT_APPLIED');
}

export function runtimeErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'TASK_EXECUTION_FAILED';
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}
