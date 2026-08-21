import {
  FrozenSkillTaskReadinessAdapter,
  type Clock,
  type ExactSkillPackageAuthorityReader,
  type JsonSchemaValidator,
  type McpRuntimeBindingAuthorityVerifier,
  type RuntimeMcpCatalogAuthority,
  type SkillRepository,
  type SkillTaskOperationCandidateCatalog,
  type TaskAvailabilityBatchReader,
  resolveUgvProfileProviderSuccessOutputSchema,
} from '../../../packages/application/src/index.js';
import {
  createRuntimeExecutionContext,
  createSelectedTaskOperation,
  hashCanonicalEvidenceJson,
  UGV_MOVE_TASK_ALIAS_REVISION,
  type McpTaskOperationCandidate,
  type McpTool,
  type RuntimeExecutionContext,
  type SelectedTaskOperation,
  type SkillContextRequirement,
  type SkillTaskBinding,
  type TaskAvailabilityCheckResult,
  type TaskAvailabilityReadResult,
} from '../../../packages/domain/src/index.js';
import type {
  CurrentMcpProviderBindingAuthorityReader,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../packages/runtime-control-application/src/index.js';

import {
  adaptUgvMoveInput,
  UGV_MOVE_RESOURCE_ID,
  type AdaptedUgvMoveInput,
} from './ugv-move-input-adapter.js';

const UGV_PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const UGV_PROVIDER_TYPE = 'isr.vehicle.ugv';
const UGV_PROVIDER_VERSION = '1.0.0';
const NAVIGATE_OPERATION = 'vehicle_navigate';
const FINAL_STATE_OPERATION = 'vehicle_get_state';
const STATE_READ_ARGUMENTS = Object.freeze({
  resourceId: UGV_MOVE_RESOURCE_ID,
  include: Object.freeze(['chassis', 'health']),
});

export interface UgvMoveBindingResolution {
  readonly selected: SelectedTaskOperation;
  readonly adaptedInput: AdaptedUgvMoveInput;
}

type RuntimeBindingVerifier = Pick<
  McpRuntimeBindingAuthorityVerifier,
  'loadRuntimeAuthority' | 'assertCurrent'
>;

/** UGV-profile-only semantic alias and authority resolver. Generic Task catalog matching is untouched. */
export class UgvMoveTaskBindingResolver {
  readonly #skills: Pick<SkillRepository, 'findCurrentVersion'>;
  readonly #packages: ExactSkillPackageAuthorityReader;
  readonly #operations: SkillTaskOperationCandidateCatalog;
  readonly #availability: TaskAvailabilityBatchReader;
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityReader;
  readonly #runtimeBindings: RuntimeBindingVerifier;
  readonly #schemas: JsonSchemaValidator;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      skills: Pick<SkillRepository, 'findCurrentVersion'>;
      packages: ExactSkillPackageAuthorityReader;
      operations: SkillTaskOperationCandidateCatalog;
      availability: TaskAvailabilityBatchReader;
      providerBindings: CurrentMcpProviderBindingAuthorityReader;
      runtimeBindings: RuntimeBindingVerifier;
      schemas: JsonSchemaValidator;
      clock: Clock;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#packages = dependencies.packages;
    this.#operations = dependencies.operations;
    this.#availability = dependencies.availability;
    this.#providerBindings = dependencies.providerBindings;
    this.#runtimeBindings = dependencies.runtimeBindings;
    this.#schemas = dependencies.schemas;
    this.#clock = dependencies.clock;
  }

  async resolve(
    input: Readonly<{ skillInput: unknown; executionContext: RuntimeExecutionContext }>,
  ) {
    const executionContext = createRuntimeExecutionContext(input.executionContext);
    if (executionContext.mode !== 'simulation' || executionContext.simulationId === undefined)
      fail(
        'UGV_PROFILE_SIMULATION_CONTEXT_REQUIRED',
        'UGV Task binding is restricted to an explicit simulation execution context.',
      );
    const adaptedInput = adaptUgvMoveInput(input.skillInput);
    const skill = await this.#skills.findCurrentVersion('embodied.move_to');
    const exactSkill = exactSkillBinding(skill);
    const currentSkill = exactSkill.skill;
    const taskBinding = exactSkill.binding;
    const packageAuthority = await this.#packages
      .loadExactSkillPackageAuthority('embodied.move_to', 1)
      .catch(() =>
        fail(
          'UGV_PROFILE_SKILL_PACKAGE_AUTHORITY_REQUIRED',
          'UGV Task binding requires the exact PostgreSQL Skill package import authority.',
        ),
      );
    if (
      packageAuthority.skillId !== currentSkill.skillId ||
      packageAuthority.skillVersion !== currentSkill.version
    )
      fail(
        'UGV_PROFILE_SKILL_PACKAGE_AUTHORITY_REQUIRED',
        'UGV Skill and package import authority identities differ.',
      );

    const registered = await this.#operations.listTaskOperationCandidates(NAVIGATE_OPERATION);
    if (registered.length === 0)
      fail('UGV_PROFILE_BINDING_NOT_FOUND', 'No vehicle_navigate Task candidate is registered.');
    const inspected = await Promise.all(
      registered.map((candidate) => this.#inspectCandidate(candidate, adaptedInput)),
    );
    const compatible = inspected.filter(
      (item): item is CompatibleCandidate => item.kind === 'compatible',
    );
    if (compatible.length === 0) failForRejectedCandidates(inspected);
    if (compatible.length !== 1)
      fail(
        'UGV_PROFILE_BINDING_AMBIGUOUS',
        'More than one authority-exact UGV point-navigation candidate is current.',
      );
    const exact = compatible[0];
    if (exact === undefined)
      fail('UGV_PROFILE_BINDING_NOT_FOUND', 'No exact UGV Task candidate remains.');

    const capturedAvailability = new CapturingAvailabilityReader(this.#availability);
    const readiness = new FrozenSkillTaskReadinessAdapter({
      operations: exactCandidateCatalog(exact.candidate),
      availability: capturedAvailability,
      providerBindings: cachedBindingReader(exact.binding),
      clock: this.#clock,
    });
    const reported = await readiness.inspect({
      skillId: currentSkill.skillId,
      skillVersion: currentSkill.version,
      taskBindings: [aliasedBinding(taskBinding, exact.candidate.providerId)],
      allowPreferredProviderFallback: false,
      arguments: { unresolved: false, value: adaptedInput.providerArguments },
      executionContext,
    });
    // Selection and readiness evidence are stamped only after the Provider read completes.
    const selectedAt = this.#clock.now();
    const bindingReadiness = reported.bindings[0];
    const availability = capturedAvailability.exactResult(NAVIGATE_OPERATION);
    if (
      reported.bindings.length !== 1 ||
      bindingReadiness?.selectedProviderId !== exact.candidate.providerId ||
      bindingReadiness.selectedOperationName !== NAVIGATE_OPERATION ||
      bindingReadiness.disposition !== 'ready' ||
      availability.result.availability !== 'available' ||
      availability.result.validUntil === undefined ||
      Date.parse(availability.result.validUntil) <= Date.parse(selectedAt) ||
      Date.parse(exact.binding.binding.availabilityValidUntil) <= Date.parse(selectedAt)
    )
      fail(
        'UGV_PROFILE_READINESS_NOT_ADMITTED',
        'Exact UGV navigation readiness is unavailable, stale, or uncorrelated.',
      );

    const provider = exact.runtime.snapshot.providerCatalog;
    if (provider === undefined)
      fail(
        'UGV_PROFILE_PROVIDER_IDENTITY_INVALID',
        'UGV Runtime discovery has no validated Provider Catalog identity.',
      );
    const selected = createSelectedTaskOperation({
      profileId: 'ugv-agent-profile',
      selectedAt,
      skill: Object.freeze({
        skillId: currentSkill.skillId,
        version: currentSkill.version,
        packageChecksum: packageAuthority.packageChecksum,
      }),
      task: Object.freeze({
        semanticTaskType: 'embodied.move',
        operationAlias: NAVIGATE_OPERATION,
        aliasRevision: UGV_MOVE_TASK_ALIAS_REVISION,
        semanticBindingId: 'ugv-agent-profile/move-resource',
        skillBindingId: 'move-resource',
        bindingId: exact.binding.binding.bindingId,
      }),
      providerBinding: Object.freeze({
        bindingId: exact.binding.binding.bindingId,
        revision: exact.binding.binding.revision,
      }),
      provider: Object.freeze({ ...provider }),
      server: Object.freeze({
        serverId: exact.runtime.record.server.serverId,
        protocolMode: 'frozen_v1',
        discoverySnapshotId: exact.runtime.snapshot.snapshotId,
        toolRevision: exact.runtime.record.server.toolRevision,
        catalogRevision: exact.runtime.catalogAuthority.catalogRevision,
        catalogChecksum: exact.runtime.catalogAuthority.catalogChecksum,
      }),
      resource: Object.freeze({
        resourceId: UGV_MOVE_RESOURCE_ID,
        resourceType: 'vehicle',
      }),
      operation: Object.freeze({
        operationName: NAVIGATE_OPERATION,
        inputSchema: exact.navigate.inputSchema,
        inputSchemaHash: hashCanonicalEvidenceJson(exact.navigate.inputSchema),
        outputSchema: exact.navigate.outputSchema,
        outputSchemaHash: hashCanonicalEvidenceJson(exact.navigate.outputSchema),
        executionSemantics: exact.navigate.executionSemantics,
        taskExecutionProfile: exact.navigate.taskExecutionProfile,
        taskNotifications: true,
      }),
      finalStateRead: Object.freeze({
        operationName: FINAL_STATE_OPERATION,
        serverId: exact.runtime.record.server.serverId,
        providerId: provider.providerId,
        resourceId: UGV_MOVE_RESOURCE_ID,
        catalogChecksum: exact.runtime.catalogAuthority.catalogChecksum,
        inputSchema: exact.getState.inputSchema,
        inputSchemaHash: hashCanonicalEvidenceJson(exact.getState.inputSchema),
        outputSchema: exact.getState.outputSchema,
        outputSchemaHash: hashCanonicalEvidenceJson(exact.getState.outputSchema),
        executionSemantics: exact.getState.executionSemantics,
        taskExecutionProfile: exact.getState.taskExecutionProfile,
        resolvedArguments: STATE_READ_ARGUMENTS,
        argumentsHash: hashCanonicalEvidenceJson(STATE_READ_ARGUMENTS),
      }),
      resolvedArguments: adaptedInput.providerArguments,
      argumentsHash: adaptedInput.argumentsHash,
      availability: Object.freeze({
        protocolRevision: availability.outcome.protocolRevision,
        schemaRevision: availability.outcome.availabilitySchemaRevision,
        checkedAt: selectedAt,
        validUntil: availability.result.validUntil,
        disposition: 'ready',
        riskLevel: availability.result.riskLevel,
        reservationMode: availability.result.reservationMode,
        ...(availability.result.reservationRef === undefined
          ? {}
          : { reservationRef: availability.result.reservationRef }),
        possibleEffects: Object.freeze([...availability.result.possibleEffects]),
      }),
      execution: Object.freeze({
        mode: 'simulation',
        simulationId: executionContext.simulationId,
        confirmation: 'existing_outer_plan_confirmation',
        confirmationRequired: true,
      }),
    });
    return Object.freeze({ selected, adaptedInput });
  }

  async #inspectCandidate(
    candidate: McpTaskOperationCandidate,
    input: AdaptedUgvMoveInput,
  ): Promise<CandidateInspection> {
    try {
      const binding = await this.#providerBindings.loadCurrentMcpProviderBinding({
        localServerId: candidate.providerId,
      });
      const runtime = await this.#runtimeBindings.loadRuntimeAuthority(candidate.providerId);
      await this.#runtimeBindings.assertCurrent({
        authority: binding,
        bindingId: binding.binding.bindingId,
        localServerId: candidate.providerId,
        providerId: UGV_PROVIDER_ID,
        runtimeAuthority: runtime,
      });
      const navigate = exactTool(runtime, NAVIGATE_OPERATION);
      const getState = exactTool(runtime, FINAL_STATE_OPERATION);
      assertProviderIdentity(binding, runtime);
      assertNavigateContract(candidate, navigate, runtime, input, this.#schemas);
      assertGetStateContract(getState, input.resourceId, this.#schemas);
      return Object.freeze({
        kind: 'compatible' as const,
        candidate,
        binding,
        runtime,
        navigate,
        getState,
      });
    } catch (error: unknown) {
      return Object.freeze({ kind: 'rejected' as const, code: candidateFailureCode(error) });
    }
  }
}

interface CompatibleCandidate {
  readonly kind: 'compatible';
  readonly candidate: McpTaskOperationCandidate;
  readonly binding: CurrentMcpProviderBindingAuthoritySnapshot;
  readonly runtime: RuntimeMcpCatalogAuthority;
  readonly navigate: McpTool &
    Readonly<{
      outputSchema: unknown;
      taskExecutionProfile: NonNullable<McpTool['taskExecutionProfile']>;
    }>;
  readonly getState: McpTool &
    Readonly<{
      outputSchema: unknown;
      taskExecutionProfile: NonNullable<McpTool['taskExecutionProfile']>;
    }>;
}

type CandidateInspection =
  CompatibleCandidate | Readonly<{ kind: 'rejected'; code: UgvMoveBindingErrorCode }>;

function exactSkillBinding(
  skill: Awaited<ReturnType<Pick<SkillRepository, 'findCurrentVersion'>['findCurrentVersion']>>,
) {
  const bindings = skill?.usageSpecification?.taskBindings ?? [];
  const binding = bindings[0];
  const policy = binding?.providerPolicy;
  const evidence = skill?.usageSpecification?.evidencePolicy;
  const finalPosition = evidence?.requirements[0];
  const contextRequirements = skill?.usageSpecification?.contextRequirements ?? [];
  const outcome = skill?.outcomeSpecification;
  if (
    skill?.skillId !== 'embodied.move_to' ||
    skill.version !== 1 ||
    skill.status !== 'enabled' ||
    !skill.validationPassed ||
    bindings.length !== 1 ||
    binding?.bindingId !== 'move-resource' ||
    binding.taskType !== 'embodied.move' ||
    policy?.selection !== 'dynamic' ||
    policy.preferredProviderIds.length !== 0 ||
    policy.requiredProviderId !== undefined ||
    policy.forbiddenProviderIds.length !== 0 ||
    policy.requiredAttributes.length !== 2 ||
    !policy.requiredAttributes.includes('observations') ||
    !policy.requiredAttributes.includes('task_notifications') ||
    skill.usageSpecification?.adaptive.allowPreferredProviderFallback !== false ||
    evidence?.rejectSuccessWithoutRequiredEvidence !== true ||
    evidence.requirements.length !== 1 ||
    finalPosition?.requirementId !== 'final-position' ||
    finalPosition.evidenceType !== 'position.observation' ||
    !finalPosition.required ||
    !finalPosition.hardGate ||
    contextRequirements.length !== 3 ||
    !exactContextRequirement(contextRequirements[0], 'current-position', [
      'authoritative_context',
      'read_only_query',
    ]) ||
    !exactContextRequirement(contextRequirements[1], 'resource-state', [
      'authoritative_context',
      'read_only_query',
    ]) ||
    !exactContextRequirement(contextRequirements[2], 'permission-context', [
      'authoritative_context',
      'user_input',
    ]) ||
    !skill.usageSpecification.normative.forbiddenActions.includes(
      'Report completion without required final-position evidence.',
    ) ||
    skill.toolPolicy.required.length !== 0 ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.toolPolicy.forbidden.length !== 0 ||
    skill.runtimePolicy.autoConfirmPlan ||
    skill.runtimePolicy.maxMcpCalls !== 8 ||
    outcome?.effects.length !== 1 ||
    outcome.effects[0] !== 'effect.final_position' ||
    outcome.evidence.length !== 1 ||
    outcome.evidence[0] !== 'evidence.final_position'
  )
    fail(
      'UGV_PROFILE_SKILL_NOT_CURRENT',
      'UGV binding requires current enabled embodied.move_to@1 with its exact Task binding.',
    );
  return Object.freeze({ skill, binding });
}

function exactContextRequirement(
  value: SkillContextRequirement | undefined,
  requirementId: string,
  sourceOrder: readonly string[],
): boolean {
  return (
    value?.requirementId === requirementId &&
    value.required &&
    sameJson(value.sourceOrder, sourceOrder)
  );
}

function exactTool(
  runtime: RuntimeMcpCatalogAuthority,
  operationName: string,
): CompatibleCandidate['navigate'] {
  const tools = runtime.tools.filter(
    (tool) => tool.serverId === runtime.record.server.serverId && tool.toolName === operationName,
  );
  const tool = tools[0];
  if (
    tools.length !== 1 ||
    tool?.outputSchema === undefined ||
    tool.taskExecutionProfile === undefined
  )
    throw new UgvMoveBindingError(
      'UGV_PROFILE_TASK_CONTRACT_INVALID',
      `UGV Runtime requires one exact ${operationName} Tool contract.`,
    );
  return tool as CompatibleCandidate['navigate'];
}

function assertProviderIdentity(
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
  runtime: RuntimeMcpCatalogAuthority,
): void {
  const provider = runtime.snapshot.providerCatalog;
  const binding = authority.binding;
  if (
    provider?.providerId !== UGV_PROVIDER_ID ||
    provider.providerType !== UGV_PROVIDER_TYPE ||
    provider.providerVersion !== UGV_PROVIDER_VERSION ||
    binding.originType !== 'smpp_registry' ||
    binding.providerId !== provider.providerId ||
    binding.externalProviderId !== provider.providerId ||
    authority.sourceCandidateLineage?.externalProviderId !== provider.providerId ||
    binding.catalogChecksum !== runtime.catalogAuthority.catalogChecksum ||
    binding.catalogRevision !== runtime.catalogAuthority.catalogRevision
  )
    throw new UgvMoveBindingError(
      'UGV_PROFILE_PROVIDER_IDENTITY_INVALID',
      'Current Binding, Runtime Catalog, and Provider manifest identities differ.',
    );
}

function assertNavigateContract(
  candidate: McpTaskOperationCandidate,
  tool: CompatibleCandidate['navigate'],
  runtime: RuntimeMcpCatalogAuthority,
  input: AdaptedUgvMoveInput,
  schemas: JsonSchemaValidator,
): void {
  const profile = tool.taskExecutionProfile;
  const successOutputSchema = resolveUgvProfileProviderSuccessOutputSchema(tool.outputSchema);
  if (
    candidate.operationName !== NAVIGATE_OPERATION ||
    !sameJson(candidate.taskExecutionProfile, profile) ||
    !candidate.taskNotifications ||
    !runtime.snapshot.taskNotifications ||
    profile.taskBehavior !== 'task_required' ||
    profile.availability !== 'dynamic' ||
    !profile.supportsScheduling ||
    !profile.supportsMaxElapsed ||
    !profile.supportsObservations ||
    profile.supportsInputRequired ||
    profile.supportsCancellation !== true ||
    profile.supportsPauseResume !== true ||
    profile.idempotency !== 'server_managed' ||
    tool.executionSemantics.effect !== 'side_effecting' ||
    tool.executionSemantics.execution !== 'task_required' ||
    tool.executionSemantics.cancellation !== 'task_cancel' ||
    tool.executionSemantics.idempotency !== 'server_managed' ||
    tool.executionSemantics.replay !== 'simulation_only' ||
    !navigateSchemaDeclaresExactPointResource(tool.inputSchema) ||
    successOutputSchema === undefined ||
    !navigateOutputDeclaresOutcomeAuthority(successOutputSchema) ||
    !schemas.checkSchema(tool.inputSchema).valid ||
    !schemas.checkSchema(tool.outputSchema).valid ||
    !schemas.validate(tool.inputSchema, input.providerArguments).valid
  )
    throw new UgvMoveBindingError(
      'UGV_PROFILE_SCHEMA_DRIFT',
      'UGV navigation Schema, lifecycle, or execution semantics has drifted.',
    );
}

function assertGetStateContract(
  tool: CompatibleCandidate['getState'],
  resourceId: string,
  schemas: JsonSchemaValidator,
): void {
  const profile = tool.taskExecutionProfile;
  const successOutputSchema = resolveUgvProfileProviderSuccessOutputSchema(tool.outputSchema);
  if (
    profile.taskBehavior !== 'synchronous_only' ||
    profile.availability !== 'dynamic' ||
    profile.supportsScheduling ||
    profile.supportsMaxElapsed ||
    profile.supportsCancellation !== false ||
    profile.supportsPauseResume !== false ||
    profile.supportsObservations ||
    profile.supportsInputRequired ||
    profile.idempotency !== 'server_managed' ||
    tool.executionSemantics.effect !== 'read_only' ||
    tool.executionSemantics.execution !== 'synchronous' ||
    tool.executionSemantics.cancellation !== 'unsupported' ||
    tool.executionSemantics.idempotency !== 'server_managed' ||
    tool.executionSemantics.replay !== 'allowed' ||
    successOutputSchema === undefined ||
    !stateOutputDeclaresPositionAuthority(successOutputSchema) ||
    !schemas.checkSchema(tool.inputSchema).valid ||
    !schemas.checkSchema(tool.outputSchema).valid ||
    resourceId !== UGV_MOVE_RESOURCE_ID ||
    !schemas.validate(tool.inputSchema, STATE_READ_ARGUMENTS).valid
  )
    throw new UgvMoveBindingError(
      'UGV_PROFILE_SCHEMA_DRIFT',
      'UGV final-state read Schema or lifecycle has drifted.',
    );
}

function navigateSchemaDeclaresExactPointResource(value: unknown): boolean {
  const schema = record(value);
  const properties = record(schema?.['properties']);
  const resource = record(properties?.['resourceId']);
  const mission = record(properties?.['mission']);
  const stop = record(properties?.['stopOnObstacle']);
  const branches = Array.isArray(mission?.['oneOf']) ? mission['oneOf'] : [];
  return (
    schema?.['additionalProperties'] === false &&
    resource?.['const'] === UGV_MOVE_RESOURCE_ID &&
    stop?.['type'] === 'boolean' &&
    branches.some((branch) => {
      const branchProperties = record(record(branch)?.['properties']);
      const target = record(branchProperties?.['target']);
      const targetProperties = record(target?.['properties']);
      return (
        record(branchProperties?.['type'])?.['const'] === 'point' &&
        Array.isArray(target?.['required']) &&
        target['required'].includes('longitude') &&
        target['required'].includes('latitude') &&
        record(targetProperties?.['longitude'])?.['minimum'] === -180 &&
        record(targetProperties?.['longitude'])?.['maximum'] === 180 &&
        record(targetProperties?.['latitude'])?.['minimum'] === -90 &&
        record(targetProperties?.['latitude'])?.['maximum'] === 90
      );
    })
  );
}

function navigateOutputDeclaresOutcomeAuthority(value: unknown): boolean {
  const schema = record(value);
  const properties = record(schema?.['properties']);
  const resource = record(properties?.['resourceId']);
  const status = record(properties?.['status']);
  const observedAt = record(properties?.['observedAt']);
  const snapshotRevision = record(properties?.['snapshotRevision']);
  const correlationStrength = record(properties?.['correlationStrength']);
  const observationAuthority = record(properties?.['observationAuthority']);
  const positionAuthority = record(properties?.['positionAuthority']);
  const positionProperties = record(positionAuthority?.['properties']);
  const timeAuthority = record(positionProperties?.['timeAuthority']);
  return (
    schema?.['type'] === 'object' &&
    schema['additionalProperties'] === false &&
    requiredFields(schema, ['resourceId', 'status', 'observedAt']) &&
    resource?.['const'] === UGV_MOVE_RESOURCE_ID &&
    arrayIncludes(record(status)?.['enum'], 'completed') &&
    observedAt?.['format'] === 'date-time' &&
    snapshotRevision?.['type'] === 'string' &&
    arrayIncludes(correlationStrength?.['enum'], 'STRICT_CORRELATED') &&
    arrayIncludes(correlationStrength?.['enum'], 'MISMATCH') &&
    observationAuthority?.['type'] === 'string' &&
    positionAuthority?.['type'] === 'object' &&
    positionAuthority['additionalProperties'] === false &&
    requiredFields(positionAuthority, [
      'field',
      'topic',
      'observedAt',
      'timeAuthority',
      'cursor',
    ]) &&
    schemaAllowsString(positionProperties?.['field']) &&
    record(positionProperties?.['topic'])?.['type'] === 'string' &&
    record(positionProperties?.['observedAt'])?.['type'] === 'string' &&
    arrayIncludes(timeAuthority?.['enum'], 'source') &&
    arrayIncludes(timeAuthority?.['enum'], 'ingest') &&
    record(positionProperties?.['cursor'])?.['type'] === 'string'
  );
}

function stateOutputDeclaresPositionAuthority(value: unknown): boolean {
  const schema = record(value);
  const properties = record(schema?.['properties']);
  const identity = record(properties?.['identity']);
  const identityProperties = record(identity?.['properties']);
  const connectivity = record(properties?.['connectivity']);
  const freshness = record(properties?.['freshness']);
  const freshnessProperties = record(freshness?.['properties']);
  const chassis = record(properties?.['chassis']);
  const revision = record(properties?.['revision']);
  const observedAt = record(properties?.['observedAt']);
  const cursor = record(properties?.['mqttIngressSequence']);
  return (
    schema?.['type'] === 'object' &&
    schema['additionalProperties'] === false &&
    requiredFields(schema, [
      'identity',
      'connectivity',
      'freshness',
      'revision',
      'observedAt',
      'mqttIngressSequence',
    ]) &&
    identity?.['type'] === 'object' &&
    identity['additionalProperties'] === false &&
    requiredFields(identity, ['providerId', 'resourceId', 'vehicleType', 'executionMode']) &&
    record(identityProperties?.['providerId'])?.['type'] === 'string' &&
    record(identityProperties?.['resourceId'])?.['const'] === UGV_MOVE_RESOURCE_ID &&
    record(identityProperties?.['vehicleType'])?.['type'] === 'string' &&
    arrayIncludes(record(identityProperties?.['executionMode'])?.['enum'], 'simulation') &&
    connectivity?.['type'] === 'object' &&
    freshness?.['type'] === 'object' &&
    record(freshnessProperties?.['chassisObservedAt'])?.['format'] === 'date-time' &&
    chassis?.['type'] === 'object' &&
    revision?.['type'] === 'string' &&
    revision['minLength'] === 1 &&
    observedAt?.['format'] === 'date-time' &&
    cursor?.['type'] === 'integer' &&
    cursor['minimum'] === 0
  );
}

function requiredFields(value: Readonly<Record<string, unknown>>, fields: readonly string[]) {
  const required = value['required'];
  return Array.isArray(required) && fields.every((field) => required.includes(field));
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function schemaAllowsString(value: unknown): boolean {
  const schema = record(value);
  return (
    schema?.['type'] === 'string' ||
    (Array.isArray(schema?.['anyOf']) &&
      schema['anyOf'].some((branch) => record(branch)?.['type'] === 'string'))
  );
}

function aliasedBinding(binding: SkillTaskBinding, providerId: string): SkillTaskBinding {
  return Object.freeze({
    ...binding,
    taskType: NAVIGATE_OPERATION,
    providerPolicy: Object.freeze({
      selection: 'required' as const,
      preferredProviderIds: Object.freeze([]),
      requiredProviderId: providerId,
      forbiddenProviderIds: Object.freeze([]),
      requiredAttributes: Object.freeze([
        ...binding.providerPolicy.requiredAttributes,
        'cancellation',
        'pause_resume',
      ]),
    }),
  });
}

function exactCandidateCatalog(
  candidate: McpTaskOperationCandidate,
): SkillTaskOperationCandidateCatalog {
  return Object.freeze({
    listTaskOperationCandidates(taskType: string) {
      return Promise.resolve(
        taskType === NAVIGATE_OPERATION ? Object.freeze([candidate]) : Object.freeze([]),
      );
    },
  });
}

function cachedBindingReader(
  authority: CurrentMcpProviderBindingAuthoritySnapshot,
): CurrentMcpProviderBindingAuthorityReader {
  return Object.freeze({
    loadCurrentMcpProviderBinding(input: Readonly<{ bindingId?: string; localServerId: string }>) {
      if (
        input.localServerId !== authority.binding.localServerId ||
        (input.bindingId !== undefined && input.bindingId !== authority.binding.bindingId)
      )
        return Promise.reject(new Error('UGV_PROFILE_BINDING_NOT_FOUND'));
      return Promise.resolve(authority);
    },
  });
}

class CapturingAvailabilityReader implements TaskAvailabilityBatchReader {
  readonly #source: TaskAvailabilityBatchReader;
  #outcomes: TaskAvailabilityReadResult[] = [];

  constructor(source: TaskAvailabilityBatchReader) {
    this.#source = source;
  }

  async checkTaskAvailability(
    input: Parameters<TaskAvailabilityBatchReader['checkTaskAvailability']>[0],
  ) {
    const outcome = await this.#source.checkTaskAvailability(input);
    this.#outcomes.push(outcome);
    return outcome;
  }

  exactResult(operationName: string): Readonly<{
    outcome: Extract<TaskAvailabilityReadResult, { kind: 'results' }>;
    result: TaskAvailabilityCheckResult;
  }> {
    const outcome = this.#outcomes[0];
    if (this.#outcomes.length !== 1 || outcome?.kind !== 'results')
      return fail(
        'UGV_PROFILE_READINESS_NOT_ADMITTED',
        'UGV readiness requires one correlated Provider availability result.',
      );
    const results = outcome.results.filter((result) => result.operationName === operationName);
    const result = results[0];
    if (results.length !== 1 || result === undefined)
      return fail(
        'UGV_PROFILE_READINESS_NOT_ADMITTED',
        'UGV readiness response does not contain one exact navigation result.',
      );
    return Object.freeze({ outcome, result });
  }
}

function failForRejectedCandidates(candidates: readonly CandidateInspection[]): never {
  const codes = candidates.flatMap((item) => (item.kind === 'rejected' ? [item.code] : []));
  if (codes.includes('UGV_PROFILE_SCHEMA_DRIFT'))
    return fail('UGV_PROFILE_SCHEMA_DRIFT', 'Every UGV navigation candidate has Schema drift.');
  if (codes.includes('UGV_PROFILE_PROVIDER_IDENTITY_INVALID'))
    return fail(
      'UGV_PROFILE_PROVIDER_IDENTITY_INVALID',
      'Every UGV navigation candidate lacks exact Provider identity.',
    );
  if (codes.includes('UGV_PROFILE_TASK_CONTRACT_INVALID'))
    return fail(
      'UGV_PROFILE_TASK_CONTRACT_INVALID',
      'Every UGV navigation candidate violates the Task contract.',
    );
  return fail(
    'UGV_PROFILE_BINDING_NOT_FOUND',
    'No UGV navigation candidate has one current Runtime and Provider Binding authority.',
  );
}

function candidateFailureCode(error: unknown): UgvMoveBindingErrorCode {
  return error instanceof UgvMoveBindingError ? error.code : 'UGV_PROFILE_BINDING_NOT_FOUND';
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
}

export type UgvMoveBindingErrorCode =
  | 'UGV_PROFILE_SIMULATION_CONTEXT_REQUIRED'
  | 'UGV_PROFILE_SKILL_NOT_CURRENT'
  | 'UGV_PROFILE_SKILL_PACKAGE_AUTHORITY_REQUIRED'
  | 'UGV_PROFILE_BINDING_NOT_FOUND'
  | 'UGV_PROFILE_BINDING_AMBIGUOUS'
  | 'UGV_PROFILE_PROVIDER_IDENTITY_INVALID'
  | 'UGV_PROFILE_TASK_CONTRACT_INVALID'
  | 'UGV_PROFILE_SCHEMA_DRIFT'
  | 'UGV_PROFILE_READINESS_NOT_ADMITTED';

export class UgvMoveBindingError extends Error {
  constructor(
    readonly code: UgvMoveBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveBindingError';
  }
}

function fail(code: UgvMoveBindingErrorCode, message: string): never {
  throw new UgvMoveBindingError(code, message);
}
