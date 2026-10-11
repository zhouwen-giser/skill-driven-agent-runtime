import type { AsyncLocalStorage } from 'node:async_hooks';
import type {
  GoalService,
  McpRegistryService,
  ResultProcessor,
  SkillCompositionPlanner,
  SkillExecutionRecordingService,
  SkillInputResolutionService,
  SkillSelectionService,
  TaskService,
  WorkflowExecutionService,
  WorkflowPlannerService,
} from '../../../../packages/application/src/index.js';
import {
  buildMcpToolPlanningMetadata,
  checkSkillUsagePlanCompliance,
  matchSkillEvidence,
  prepareSkillUsagePlan,
  snapshotMcpToolPlanningExecutionSemantics,
  type CognitiveManagementActionLeaseGuard,
} from '../../../../packages/application/src/index.js';
import {
  createGoalExecutionContract,
  createRuntimeExecutionContext,
  deriveFrozenMcpCatalogAuthority,
  type WorkflowBudgetLimits,
} from '../../../../packages/domain/src/index.js';
import { type WorkflowCallCosts } from '../../../../packages/langgraph-runtime/src/index.js';
import {
  type DeterministicCapabilityExecutionInput,
  type DeterministicCapabilityExecutionOperation,
} from '../../../../packages/management-api/src/index.js';
import type {
  PostgresAgentTaskRepository,
  PostgresMcpRegistryRepository,
  PostgresSkillExecutionRepository,
  PostgresSkillRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import { type CurrentMcpProviderBindingAuthoritySnapshot } from '../../../../packages/runtime-control-application/src/index.js';
import {
  DeterministicCapabilityRecoveryService,
  assertNoHomeAssistantEntityId,
  deterministicCapabilityExecutionResponse,
  deterministicExecutionError,
  deterministicExecutionIdentity,
  requireDeterministicToolResult,
  type DeterministicSkillSuccessProjection,
} from '.././deterministic-capability-recovery.js';
import {
  admitManagedDeterministicReadOnlyCapability,
  type ManagedDeterministicReadOnlyAdmission,
} from '.././managed-deterministic-capability-admission.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import {
  assertDeterministicExecutionRequestIdentity,
  assertDeterministicReadOnlySkill,
  assertDeterministicUsageCandidate,
  canonicalJson,
  deterministicSkillUsageContext,
  isRecord,
  requireDeterministicProviderBindingAuthority,
  requireHomeLabReadOnlyExecutionContract,
  requireManagedDeterministicCapabilityAuthority,
  runtimeErrorCode,
} from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeDeterministicDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly skillExecutionRecording: SkillExecutionRecordingService;
  readonly tasks: PostgresAgentTaskRepository;
  readonly workflowExecution: WorkflowExecutionService;
  readonly skillExecutionRepository: PostgresSkillExecutionRepository;
  readonly skills: PostgresSkillRepository;
  readonly mcpRegistry: McpRegistryService;
  readonly workflowBudgetDefaults: WorkflowBudgetLimits;
  readonly workflowCallCosts: WorkflowCallCosts;
  readonly service: RuntimeValueRef<TaskService>;
  readonly resultProcessor: ResultProcessor;
  readonly deterministicCapabilityLease: AsyncLocalStorage<
    Readonly<{
      input: DeterministicCapabilityExecutionInput;
      lease: CognitiveManagementActionLeaseGuard;
    }>
  >;
  readonly managedCapabilityProfile: boolean;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly clock: { now: () => string };
  readonly goalService: GoalService;
  readonly createDeterministicSkillSelection: (
    input: DeterministicCapabilityExecutionInput,
    contract: Pick<ManagedDeterministicReadOnlyAdmission, 'readinessAttributes'>,
    providerBinding: CurrentMcpProviderBindingAuthoritySnapshot,
  ) => SkillSelectionService;
  readonly skillInputResolution: SkillInputResolutionService;
  readonly skillComposition: SkillCompositionPlanner;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly recordSkillProjectionSafely: (operation: () => Promise<unknown>) => Promise<void>;
}
export function composeDeterministic(dependencies: composeDeterministicDependencies) {
  const {
    options,
    skillExecutionRecording,
    tasks,
    workflowExecution,
    skillExecutionRepository,
    skills,
    mcpRegistry,
    workflowBudgetDefaults,
    workflowCallCosts,
    resultProcessor,
    deterministicCapabilityLease,
    managedCapabilityProfile,
    mcpRepository,
    clock,
    goalService,
    createDeterministicSkillSelection,
    skillInputResolution,
    skillComposition,
    workflowPlanner,
    recordSkillProjectionSafely,
  } = dependencies;
  const recordDeterministicSkillEvidenceAndReferences = async (
    projection: DeterministicSkillSuccessProjection,
  ): Promise<void> => {
    const evidence = await skillExecutionRecording.recordEvidenceMatches({
      workflowPlanId: projection.workflowPlanId,
      sourceSystem: projection.providerId,
      matches: projection.evidence,
    });
    if (evidence === undefined) throw new Error('DETERMINISTIC_RECOVERY_SKILL_NOT_FOUND');
    const references = [
      {
        kind: 'provider' as const,
        referenceId: projection.providerBindingId,
        referenceType: 'mcp.provider_binding',
        sourceSystem: 'node_control',
        metadata: { providerId: projection.providerId, serverId: projection.serverId },
      },
      {
        kind: 'evidence' as const,
        referenceId: projection.capabilityBindingId,
        referenceType: 'node.capability_binding',
        sourceSystem: 'node_control',
        metadata: {
          capabilityBindingVersion: projection.capabilityBindingVersion,
          capabilityId: projection.capabilityId,
          capabilityVersion: projection.capabilityVersion,
        },
      },
      {
        kind: 'resource' as const,
        referenceId: projection.resourceId,
        referenceType: 'public.resource',
        sourceSystem: 'node_control',
        metadata: { identifierAuthority: 'public_resource_id' },
      },
      {
        kind: 'outcome' as const,
        referenceId: projection.invocationId,
        referenceType: 'mcp.invocation',
        sourceSystem: 'mcp_registry',
        metadata: { workflowInstanceId: projection.workflowInstanceId },
      },
    ];
    for (const reference of references) {
      const recorded = await skillExecutionRecording.recordReference({
        workflowPlanId: projection.workflowPlanId,
        ...reference,
      });
      if (recorded === undefined) throw new Error('DETERMINISTIC_RECOVERY_SKILL_NOT_FOUND');
    }
  };
  const deterministicCapabilityRecovery = new DeterministicCapabilityRecoveryService({
    findTask: (taskId) => tasks.findById(taskId),
    findWorkflow: (instanceId) => workflowExecution.get(instanceId),
    findSkillExecutionByPlan: (planId) => skillExecutionRepository.findByPlan(planId),
    findSkillVersion: (skillId, skillVersion) => skills.findVersion(skillId, skillVersion),
    listInvocationsByTask: (taskId) => mcpRegistry.listInvocationsByTask(taskId),
    workflowBudgetDefaults,
    mcpCallCost: workflowCallCosts.mcp,
    recordTaskResult: ({ taskId, structured, outputSchema }) =>
      dependencies.service.value.recordResult(
        taskId,
        {
          text: 'Schema-valid governed read-only Provider state returned.',
          structured,
          outputSchema,
        },
        resultProcessor,
      ),
    recordTaskFailure: async (taskId, errorCode) => {
      await dependencies.service.value.fail(
        taskId,
        errorCode,
        'Interrupted deterministic execution was terminated during durable reconciliation.',
      );
    },
    recordSkillEvidenceAndReferences: recordDeterministicSkillEvidenceAndReferences,
    recordSkillCompleted: async (workflowPlanId, details) => {
      const recorded = await skillExecutionRecording.recordStatus({
        workflowPlanId,
        eventType: 'skill.execution_completed',
        status: 'completed',
        summary: 'Deterministic governed read-only Workflow execution completed.',
        details,
      });
      if (recorded === undefined) throw new Error('DETERMINISTIC_RECOVERY_SKILL_NOT_FOUND');
    },
    recordSkillFailure: async (workflowPlanId, errorCode) => {
      const recorded = await skillExecutionRecording.recordStatus({
        workflowPlanId,
        eventType: 'skill.execution_failed',
        status: 'failed',
        summary: 'Interrupted deterministic execution failed closed during reconciliation.',
        details: { errorCode },
      });
      if (recorded === undefined) throw new Error('DETERMINISTIC_RECOVERY_SKILL_NOT_FOUND');
    },
  });
  const deterministicCapabilityExecutions: DeterministicCapabilityExecutionOperation = {
    async execute(input, lease) {
      return deterministicCapabilityLease.run({ input, lease }, async () => {
        const executionContext = createRuntimeExecutionContext({
          mode: input.executionMode ?? 'live',
          ...(input.simulationId === undefined ? {} : { simulationId: input.simulationId }),
        });
        const homeLabContract = managedCapabilityProfile
          ? undefined
          : requireHomeLabReadOnlyExecutionContract(input);
        if (managedCapabilityProfile) assertDeterministicExecutionRequestIdentity(input);
        let acceptedTask = false;
        let workflowPlanId: string | undefined;
        try {
          const currentProviderBinding = await requireDeterministicProviderBindingAuthority(
            input,
            options.currentMcpProviderBindingAuthorityReader,
          );
          const [skill, runtimeServer, runtimeTools, runtimeSnapshot] = await Promise.all([
            skills.findVersion(input.skillId, input.skillVersion),
            mcpRepository.findServer(input.serverId),
            mcpRepository.listTools(input.serverId),
            mcpRepository.findCurrentProtocolSnapshot(input.serverId),
          ]);
          if (skill?.status !== 'enabled')
            throw deterministicExecutionError(
              'DETERMINISTIC_SKILL_NOT_ENABLED',
              'The exact governed Skill version is not enabled.',
            );
          const tool = runtimeTools.find((candidate) => candidate.toolName === input.toolName);
          if (
            runtimeServer?.server.status !== 'enabled' ||
            runtimeServer.server.endpoint !== currentProviderBinding.binding.endpointRef ||
            runtimeSnapshot?.protocolMode !== 'frozen_v1' ||
            runtimeSnapshot.toolRevision !== runtimeServer.server.toolRevision ||
            tool?.protocolMode !== 'frozen_v1' ||
            tool.taskExecutionProfile?.taskBehavior !== 'synchronous_only' ||
            tool.outputSchema === undefined
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_READ_ONLY_TOOL_NOT_READY',
              'The exact frozen synchronous read Tool is not registered.',
            );
          const runtimeCatalog = deriveFrozenMcpCatalogAuthority(
            runtimeSnapshot,
            runtimeTools,
            runtimeServer.server.toolRevision,
          );
          if (
            runtimeCatalog.catalogRevision !== currentProviderBinding.binding.catalogRevision ||
            runtimeCatalog.catalogChecksum !== currentProviderBinding.binding.catalogChecksum ||
            runtimeCatalog.operationCount !== currentProviderBinding.binding.operationCount
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_PROVIDER_CATALOG_NOT_CURRENT',
              'Runtime frozen MCP Catalog differs from current Node Control Binding authority.',
            );
          const contract: ManagedDeterministicReadOnlyAdmission = managedCapabilityProfile
            ? admitManagedDeterministicReadOnlyCapability({
                request: input,
                capability: await requireManagedDeterministicCapabilityAuthority(
                  input,
                  options.capabilityAuthorityReader,
                ),
                providerBinding: currentProviderBinding,
                skill,
                runtimeServer: runtimeServer.server,
                runtimeTools,
                runtimeSnapshot,
                now: clock.now(),
              })
            : Object.freeze({
                evidenceTypes: Object.freeze([homeLabContract?.evidenceType ?? '']),
                readinessAttributes: Object.freeze(['task_behavior:synchronous_only']),
                goalConstraints: Object.freeze([
                  'Use the exact published Capability implementation and exact enabled Skill version.',
                  'Invoke exactly one synchronous get-state Tool and perform no physical write.',
                ]),
                goalSuccessCriteria: Object.freeze([
                  'The Skill output schema and public resource identity are valid.',
                  'Required Provider evidence is present and validated.',
                ]),
              });
          if (!managedCapabilityProfile) {
            const evidenceType = homeLabContract?.evidenceType;
            if (evidenceType === undefined)
              throw deterministicExecutionError(
                'DETERMINISTIC_READ_ONLY_CONTRACT_NOT_EXACT',
                'The home-lab deterministic contract is missing.',
              );
            assertDeterministicReadOnlySkill(skill, input, evidenceType);
          }
          const toolPlanningMetadata = await buildMcpToolPlanningMetadata(
            skill.toolPolicy,
            async (reference) =>
              (await mcpRepository.listTools(reference.serverId)).find(
                (candidate) => candidate.toolName === reference.toolName,
              ),
          );
          const requiredTool = toolPlanningMetadata.find(
            (metadata) =>
              metadata.policy === 'required' &&
              metadata.reference.serverId === input.serverId &&
              metadata.reference.toolName === input.toolName,
          );
          if (
            requiredTool?.taskExecutionProfile?.taskBehavior !== 'synchronous_only' ||
            toolPlanningMetadata.filter((metadata) => metadata.policy === 'required').length !== 1
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_SKILL_TOOL_POLICY_NOT_EXACT',
              'The governed Skill does not require exactly one synchronous read Tool.',
            );
          const submitted = await dependencies.service.value.submitDeterministic({
            taskId: input.taskId,
            contextId: input.contextId,
            messageText: `deterministic:${input.capabilityBindingId}:${input.resourceId}`,
            metadata: {
              'io.sdar/deterministicCapabilityExecution': {
                schemaVersion: '1.0',
                capabilityBindingId: input.capabilityBindingId,
                capabilityBindingVersion: input.capabilityBindingVersion,
                capabilityId: input.capabilityId,
                capabilityVersion: input.capabilityVersion,
                skillId: input.skillId,
                skillVersion: input.skillVersion,
                mcpProviderBindingId: input.mcpProviderBindingId,
                providerId: input.providerId,
                serverId: input.serverId,
                toolName: input.toolName,
                resourceId: input.resourceId,
                executionMode: executionContext.mode,
                ...(executionContext.simulationId === undefined
                  ? {}
                  : { simulationId: executionContext.simulationId }),
              },
            },
          });
          acceptedTask = true;
          const identity = deterministicExecutionIdentity(input.taskId);
          const goal = await goalService.create({
            goalId: identity.goalId,
            contextId: submitted.context.contextId,
            title: 'Deterministic governed read-only execution',
            description: `Execute ${input.capabilityId}@${String(input.capabilityVersion)} for the admitted public resource.`,
            constraints: contract.goalConstraints,
            successCriteria: contract.goalSuccessCriteria,
          });
          const goalContract = createGoalExecutionContract(goal);
          await lease.assertCurrent();
          const selection = await createDeterministicSkillSelection(
            input,
            contract,
            currentProviderBinding,
          ).selectFromCandidates(
            goalContract,
            [skill],
            deterministicSkillUsageContext(input, currentProviderBinding),
          );
          if (
            selection.selectedSkillId !== input.skillId ||
            selection.selectedSkillVersion !== input.skillVersion
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_SKILL_SELECTION_NOT_EXACT',
              'Persisted Skill selection differs from the requested exact version.',
            );
          const usageCandidate = selection.candidates[0]?.usageCandidate;
          assertDeterministicUsageCandidate(usageCandidate, input, contract.readinessAttributes);
          const preparedTask = await dependencies.service.value.prepareDeterministicExecution(
            input.taskId,
            {
              goalId: goal.goalId,
              goalVersion: goal.version,
              skillId: input.skillId,
              skillVersion: input.skillVersion,
              selectionId: selection.selectionId,
            },
          );
          const resolution = await skillInputResolution.resolveExact({
            task: preparedTask,
            goal,
            skill,
            supplementaryInputs: [],
            structuredInput: { resourceId: input.resourceId },
            sourceRef: `node-control:${input.mcpProviderBindingId}:resource:${input.resourceId}`,
          });
          const composition = await skillComposition.composeUsage(
            { skillId: skill.skillId, skillVersion: skill.version },
            [],
          );
          const interpretation = skillComposition.interpretUsage(
            skill,
            usageCandidate.modeDecision,
            composition,
          );
          if (interpretation.kind !== 'procedure')
            throw deterministicExecutionError(
              'DETERMINISTIC_SKILL_PROCEDURE_REQUIRED',
              'Read-only execution requires the governed procedure mode.',
            );
          const preparedUsage = prepareSkillUsagePlan({
            skill,
            candidate: usageCandidate,
            interpretation,
            goalContract,
            workflowDefinitionId: identity.workflowDefinitionId,
            workflowVersion: 1,
          });
          if (preparedUsage.deterministicDefinition === undefined)
            throw deterministicExecutionError(
              'DETERMINISTIC_WORKFLOW_DEFINITION_REQUIRED',
              'The governed procedure did not compile to Workflow DSL.',
            );
          const compliance = checkSkillUsagePlanCompliance(
            preparedUsage.deterministicDefinition,
            preparedUsage.policy,
          );
          if (!compliance.compliant)
            throw deterministicExecutionError(
              'DETERMINISTIC_WORKFLOW_POLICY_INVALID',
              'The governed procedure failed structural Skill policy compliance.',
            );
          workflowPlanId = identity.workflowPlanId;
          const plan = await workflowPlanner.plan({
            planId: workflowPlanId,
            workflowDefinitionId: identity.workflowDefinitionId,
            workflowVersion: 1,
            goalId: goal.goalId,
            goalVersion: goal.version,
            goalContract,
            compositionRoot: { skillId: skill.skillId, skillVersion: skill.version },
            toolExecutionSemantics: snapshotMcpToolPlanningExecutionSemantics(toolPlanningMetadata),
            taskId: input.taskId,
            executionContext,
            skillUsagePolicy: preparedUsage.policy,
            deterministicDefinition: preparedUsage.deterministicDefinition,
            deterministicOnly: true,
            planningInstruction: canonicalJson({
              operation: 'deterministic_read_only_capability_execution',
              capabilityBindingId: input.capabilityBindingId,
              capabilityBindingVersion: input.capabilityBindingVersion,
              skillId: input.skillId,
              skillVersion: input.skillVersion,
              providerBindingId: input.mcpProviderBindingId,
              resourceId: input.resourceId,
              executionMode: executionContext.mode,
              ...(executionContext.simulationId === undefined
                ? {}
                : { simulationId: executionContext.simulationId }),
            }),
          });
          if (plan.definition === undefined)
            throw deterministicExecutionError(
              'DETERMINISTIC_WORKFLOW_DEFINITION_REQUIRED',
              'The persisted deterministic Workflow plan has no validated definition.',
            );
          await skillExecutionRecording.recordPlanning({
            executionId: identity.skillExecutionId,
            taskId: input.taskId,
            goalId: goal.goalId,
            goalVersion: goal.version,
            selectionRef: selection.selectionId,
            applicabilityStatus: usageCandidate.applicability.status,
            policy: preparedUsage.policy,
            workflowPlanId: plan.planId,
            workflowDefinitionId: plan.definition.workflowDefinitionId,
            workflowDefinitionVersion: plan.definition.version,
            procedureCompiled: true,
            planCompliancePassed: true,
          });
          await dependencies.service.value.attachPlan(input.taskId, {
            planId: plan.planId,
            goalId: goal.goalId,
            goalVersion: goal.version,
            skillInputResolutionId: resolution.resolutionId,
          });
          await workflowExecution.confirm(plan.planId, input.taskId);
          await dependencies.service.value.beginDeterministicExecution(input.taskId);
          await skillExecutionRecording.recordStatus({
            workflowPlanId: plan.planId,
            eventType: 'skill.execution_started',
            status: 'executing',
            summary: 'Deterministic governed read-only Workflow execution started.',
          });
          await lease.assertCurrent();
          const instance = await workflowExecution.execute({
            instanceId: identity.workflowInstanceId,
            planId: plan.planId,
            input: resolution.structuredInput,
            skillIds: [skill.skillId],
            executionContext,
          });
          if (
            instance.status !== 'succeeded' ||
            instance.result === false ||
            instance.budgetUsage.llmCalls !== 0 ||
            instance.budgetUsage.mcpCalls !== 1
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_WORKFLOW_OUTCOME_INVALID',
              'The read-only Workflow did not complete with zero model calls and one MCP call.',
            );
          const invocations = await mcpRegistry.listInvocationsByTask(input.taskId);
          if (invocations.length !== 1)
            throw deterministicExecutionError(
              'DETERMINISTIC_MCP_INVOCATION_NOT_EXACT',
              'Deterministic execution requires exactly one Task-bound MCP invocation.',
            );
          const invocation = invocations[0];
          if (
            invocation?.invocationId !== identity.mcpInvocationId ||
            invocation.serverId !== input.serverId ||
            invocation.toolName !== input.toolName ||
            invocation.status !== 'succeeded' ||
            invocation.executionMode !== executionContext.mode ||
            invocation.simulationId !== executionContext.simulationId ||
            invocation.arguments['resourceId'] !== input.resourceId
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_MCP_INVOCATION_NOT_EXACT',
              'The recorded MCP invocation differs from the exact read-only authority.',
            );
          const toolResult = requireDeterministicToolResult(invocation.result);
          if (canonicalJson(toolResult.structuredContent) !== canonicalJson(instance.result))
            throw deterministicExecutionError(
              'DETERMINISTIC_RESULT_LINEAGE_INVALID',
              'Workflow output differs from the recorded MCP result.',
            );
          if (!isRecord(instance.result) || instance.result['resourceId'] !== input.resourceId)
            throw deterministicExecutionError(
              'DETERMINISTIC_RESOURCE_IDENTITY_INVALID',
              'Structured output does not preserve the admitted public resource identity.',
            );
          assertNoHomeAssistantEntityId(instance.result);
          const matchedEvidence = matchSkillEvidence({
            requirements: preparedUsage.policy.evidenceRequirements,
            result: toolResult,
          });
          if (
            matchedEvidence.matches.some(
              (match) => (match.required || match.hardGate) && !match.satisfied,
            )
          )
            throw deterministicExecutionError(
              'DETERMINISTIC_PROVIDER_EVIDENCE_REQUIRED',
              'Required Provider evidence did not satisfy the governed Skill policy.',
            );
          await lease.runFencedProjection(async () => {
            await recordDeterministicSkillEvidenceAndReferences({
              workflowPlanId: plan.planId,
              providerId: input.providerId,
              providerBindingId: input.mcpProviderBindingId,
              serverId: input.serverId,
              capabilityBindingId: input.capabilityBindingId,
              capabilityBindingVersion: input.capabilityBindingVersion,
              capabilityId: input.capabilityId,
              capabilityVersion: input.capabilityVersion,
              resourceId: input.resourceId,
              invocationId: invocation.invocationId,
              workflowInstanceId: instance.instanceId,
              evidence: matchedEvidence.matches,
            });
            await dependencies.service.value.recordResult(
              input.taskId,
              {
                text: 'Schema-valid governed read-only Provider state returned.',
                structured: instance.result,
                outputSchema: skill.outputSchema,
              },
              resultProcessor,
            );
            await skillExecutionRecording.recordStatus({
              workflowPlanId: plan.planId,
              eventType: 'skill.execution_completed',
              status: 'completed',
              summary: 'Deterministic governed read-only Workflow execution completed.',
              details: {
                workflowInstanceId: instance.instanceId,
                mcpInvocationId: invocation.invocationId,
              },
            });
          });
          const response = deterministicCapabilityExecutionResponse(
            input,
            instance,
            invocation.invocationId,
            matchedEvidence.matches,
          );
          assertNoHomeAssistantEntityId(response);
          return response;
        } catch (error: unknown) {
          const leaseLost =
            lease.signal.aborted ||
            runtimeErrorCode(error) === 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST';
          const providerDispatchIndeterminate = lease.executionPhase() === 'provider_dispatch';
          const failedPlanId = workflowPlanId;
          if (
            !leaseLost &&
            !providerDispatchIndeterminate &&
            (failedPlanId !== undefined || acceptedTask)
          ) {
            try {
              await lease.runFencedProjection(async () => {
                if (failedPlanId !== undefined)
                  await recordSkillProjectionSafely(() =>
                    skillExecutionRecording.recordStatus({
                      workflowPlanId: failedPlanId,
                      eventType: 'skill.execution_failed',
                      status: 'failed',
                      summary: 'Deterministic governed read-only Workflow execution failed.',
                      details: { errorCode: runtimeErrorCode(error) },
                    }),
                  );
                if (acceptedTask)
                  await dependencies.service.value.fail(
                    input.taskId,
                    runtimeErrorCode(error),
                    'Deterministic governed read-only execution failed closed.',
                  );
              });
            } catch {
              // Preserve the authoritative execution error if failure projection is unavailable.
            }
          }
          throw error;
        }
      });
    },
    reconcile(input, lease) {
      return deterministicCapabilityRecovery.reconcile(input, lease);
    },
  };
  return { deterministicCapabilityExecutions };
}
