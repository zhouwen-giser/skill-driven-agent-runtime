import { z } from 'zod';
import {
  createRuntimeExecutionContext,
  resolveWorkflowBudgetLimits,
  type EvolutionExperience,
  type InternalToolResult,
  type McpInvocation,
  type McpTool,
  type RuntimeExecutionContext,
  type SkillCandidateExecutionEvidence,
  type SkillVersion,
  type ToolReference,
  type WorkflowBudgetLimits,
  type WorkflowPlanAttempt,
} from '../../domain/src/index.js';
import type {
  Clock,
  JsonSchemaValidator,
  SkillGraphRepository,
  SkillRepository,
  StructuredModelProvider,
  WorkflowExecutor,
} from './ports.js';
import { canonicalHash } from './mcp-task-readiness.js';
import { ResultProcessor } from './result-processor.js';
import { SkillCompositionPlanner } from './skill-composition.js';
import {
  SkillApplicabilityAssessor,
  SkillContextRequirementResolver,
  SkillModeSelector,
  SkillUsageCandidateAssessor,
} from './skill-usage-selection.js';
import { prepareSkillUsagePlan } from './skill-usage-planning.js';
import { WorkflowCandidateGenerator } from './workflow-candidate-generator.js';
import { WorkflowValidator } from './workflow-validator.js';
import { SkillEvolutionValidationError } from './skill-evolution-authority.js';

export interface EvolutionAuditedModel {
  generateStructuredWithAudit(
    input: Parameters<StructuredModelProvider['generateStructured']>[0],
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>>;
}

/** This factory receives recorded local IO only, never the deployed broker or Task services. */
export interface SkillValidationExecutorFactory {
  create(
    io: Readonly<{
      callTool(
        reference: ToolReference,
        arguments_: unknown,
        context: RuntimeExecutionContext,
      ): Promise<InternalToolResult>;
      rejectUnsupported(operation: string): never;
    }>,
  ): WorkflowExecutor;
}

export interface SkillCandidateRecordingReader {
  /** Must prove that every invocation belongs to this exact historical instance/time range. */
  read(experience: EvolutionExperience): Promise<
    Readonly<{
      instanceStatus: 'succeeded' | 'failed';
      invocations: readonly McpInvocation[];
    }>
  >;
}

const InternalResultSchema = z
  .object({
    content: z.array(z.unknown()),
    structuredContent: z.unknown().optional(),
    isError: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export class RecordedSkillCandidateValidator {
  constructor(
    private readonly dependencies: Readonly<{
      skills: Pick<SkillRepository, 'findCurrentVersion' | 'findVersion' | 'listEnabledVersions'>;
      graph: Pick<SkillGraphRepository, 'listRelationsFrom'>;
      schemas: JsonSchemaValidator;
      model: EvolutionAuditedModel;
      executor: SkillValidationExecutorFactory;
      recordings: SkillCandidateRecordingReader;
      workflowSchema: unknown;
      clock: Clock;
      nextId(): string;
      budgetCeiling: WorkflowBudgetLimits;
    }>,
  ) {}

  async validate(
    input: Readonly<{
      caseId: string;
      target: SkillVersion;
      experience: EvolutionExperience;
      tools: readonly McpTool[];
    }>,
  ): Promise<
    Readonly<{
      passed: boolean;
      summary: string;
      evidence: SkillCandidateExecutionEvidence;
      dependencies: readonly SkillVersion[];
    }>
  > {
    const { target, experience } = input;
    const planId = `evolution-plan-${this.dependencies.nextId()}`;
    const instanceId = `evolution-instance-${this.dependencies.nextId()}`;
    const executionContext = createRuntimeExecutionContext({
      mode: 'historical-replay',
      simulationId: instanceId,
    });
    const attempts: WorkflowPlanAttempt[] = [];
    const modelInvocationIds: string[] = [];
    const used = new Set<string>();
    const violations: string[] = [];
    const dependencies = new Map<string, SkillVersion>();
    let recordings: readonly McpInvocation[] = [];
    let recordedInstanceStatus: 'succeeded' | 'failed' | undefined;
    let definition: SkillCandidateExecutionEvidence['definition'];
    let result: Awaited<ReturnType<WorkflowExecutor['execute']>> | undefined;
    let recordedFailure: RecordedInvocationFailure | undefined;
    const assertions: { name: string; passed: boolean }[] = [];
    const rejectUnsupported: (operation: string) => never = (operation) => {
      violations.push(operation);
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_RECORDING_UNAVAILABLE', operation);
    };
    try {
      if (target.status !== 'draft' || target.validationPassed)
        rejectUnsupported('candidate_is_not_an_unpublished_draft');
      if (
        target.runtimePolicy.taskBusinessEvidencePolicy !== undefined ||
        target.runtimePolicy.taskBusinessMutationPolicy !== undefined
      )
        rejectUnsupported(
          'task_business_terminal_authority_requires_recorded_projection_validation',
        );
      const usage = target.usageSpecification;
      if (usage === undefined) rejectUnsupported('candidate_usage_missing');
      // Provider evidence is not manufactured from a previously successful status flag.
      if (usage.evidencePolicy.requirements.length > 0 || usage.taskBindings.length > 0)
        rejectUnsupported('provider_evidence_or_remote_task_recording_unavailable');
      const sourceInput = experience.input;
      const candidateInput =
        typeof sourceInput === 'object' && sourceInput !== null && 'skillInput' in sourceInput
          ? sourceInput.skillInput
          : sourceInput;
      if (!this.dependencies.schemas.validate(target.inputSchema, candidateInput).valid)
        rejectUnsupported('candidate_input_schema_invalid');
      const retained = await this.dependencies.recordings.read(experience);
      recordings = retained.invocations;
      recordedInstanceStatus = retained.instanceStatus;
      if (recordings.length === 0) rejectUnsupported('source_has_no_tool_recording');
      for (const invocation of recordings) {
        if (invocation.status === 'canceled') rejectUnsupported('canceled_recording');
        if (
          !input.tools.some(
            (tool) =>
              tool.serverId === invocation.serverId &&
              tool.toolName === invocation.toolName &&
              canonicalHash(tool.executionSemantics) ===
                canonicalHash(invocation.executionSemantics),
          )
        )
          rejectUnsupported('recorded_tool_authority_changed');
      }
      const skills = {
        findCurrentVersion: async (skillId: string) => {
          const skill = await this.dependencies.skills.findCurrentVersion(skillId);
          if (skill !== undefined) dependencies.set(skill.skillId, skill);
          return skill;
        },
        findVersion: this.dependencies.skills.findVersion.bind(this.dependencies.skills),
        listEnabledVersions: this.dependencies.skills.listEnabledVersions.bind(
          this.dependencies.skills,
        ),
      };
      const composer = new SkillCompositionPlanner({ skills, graph: this.dependencies.graph });
      const composition = await composer.composeCandidateUsage(target);
      const sourcePolicy = experience.workflow.skillUsagePolicy;
      const assessment = await new SkillUsageCandidateAssessor({
        applicability: new SkillApplicabilityAssessor({
          contexts: new SkillContextRequirementResolver(),
          readiness: {
            inspect() {
              return Promise.resolve({ overall: 'ready' as const, bindings: [] });
            },
          },
        }),
        modes: new SkillModeSelector(),
      }).assess(target, {
        observations: (sourcePolicy?.context.requirements ?? []).flatMap((item) =>
          item.source === undefined || item.evidenceRef === undefined
            ? []
            : [
                {
                  requirementId: item.requirementId,
                  source: item.source,
                  status: 'available' as const,
                  evidenceRef: item.evidenceRef,
                },
              ],
        ),
        risk: 'low',
        humanConfirmation: 'not_requested',
        systemPolicy: {
          allowedModes: usage.modes.supported,
          requireProcedureForHighRisk: true,
          allowGuidanceWithIncompleteContext: false,
        },
        runtimeExecutionContext: executionContext,
      });
      const interpretation = composer.interpretUsage(target, assessment.modeDecision, composition);
      const prepared = prepareSkillUsagePlan({
        skill: target,
        candidate: assessment,
        interpretation,
        goalContract: experience.goal,
        workflowDefinitionId: planId,
        workflowVersion: 1,
      });
      const toolCatalog = {
        exists(reference: ToolReference) {
          return Promise.resolve(
            input.tools.some(
              (tool) =>
                tool.serverId === reference.serverId && tool.toolName === reference.toolName,
            ),
          );
        },
        getInputSchema(reference: ToolReference) {
          return Promise.resolve(
            input.tools.find(
              (tool) =>
                tool.serverId === reference.serverId && tool.toolName === reference.toolName,
            )?.inputSchema,
          );
        },
      };
      const generator = new WorkflowCandidateGenerator({
        model: {
          generateStructured: async (request) => {
            const generated = await this.dependencies.model.generateStructuredWithAudit(request);
            modelInvocationIds.push(generated.invocationId);
            return generated.structuredResult;
          },
        },
        validator: new WorkflowValidator({
          tools: toolCatalog,
          skills,
          schemas: this.dependencies.schemas,
        }),
        plans: {
          findPlan() {
            return Promise.resolve(undefined);
          },
        },
        audit: {
          saveAttempt(attempt) {
            attempts.push(attempt);
            return Promise.resolve(false);
          },
        },
        workflowSchema: this.dependencies.workflowSchema,
        clock: this.dependencies.clock,
        maxAttempts: 3,
      });
      const candidate = await generator.generate({
        planId,
        workflowDefinitionId: planId,
        workflowVersion: 1,
        goalId: experience.goal.goalId,
        goalVersion: experience.goal.version,
        goalContract: experience.goal,
        planningInstruction: JSON.stringify({
          usage: JSON.parse(prepared.planningInstruction) as unknown,
          candidate: target,
          input: experience.input,
        }),
        skillUsagePolicy: prepared.policy,
        ...(prepared.deterministicDefinition === undefined
          ? {}
          : { deterministicDefinition: prepared.deterministicDefinition, deterministicOnly: true }),
        executionContext,
      });
      definition = candidate.plan.definition;
      if (candidate.outcome !== 'ready' || definition === undefined)
        rejectUnsupported('candidate_plan_validation_failed');
      const executor = this.dependencies.executor.create({
        rejectUnsupported,
        callTool: (reference, arguments_, context) => {
          if (canonicalHash(context) !== canonicalHash(executionContext))
            rejectUnsupported('execution_context_drift');
          const tool = input.tools.find(
            (item) => item.serverId === reference.serverId && item.toolName === reference.toolName,
          );
          if (
            tool === undefined ||
            !['allowed', 'simulation_only'].includes(tool.executionSemantics.replay)
          )
            rejectUnsupported('tool_replay_forbidden_or_unknown');
          if (!this.dependencies.schemas.validate(tool.inputSchema, arguments_).valid)
            rejectUnsupported('tool_arguments_invalid');
          const recording = recordings.find(
            (item) =>
              !used.has(item.invocationId) &&
              item.serverId === reference.serverId &&
              item.toolName === reference.toolName &&
              canonicalHash(item.arguments) === canonicalHash(arguments_),
          );
          if (recording === undefined) rejectUnsupported('exact_tool_arguments_not_recorded');
          used.add(recording.invocationId);
          if (recording.status === 'failed') {
            if (recording.errorCode === undefined)
              rejectUnsupported('recorded_failure_has_no_stable_code');
            throw new RecordedInvocationFailure(
              recording.errorCode,
              recording.errorMessage ?? recording.errorCode,
            );
          }
          const parsed = InternalResultSchema.safeParse(recording.result);
          if (!parsed.success) rejectUnsupported('recorded_result_schema_unsupported');
          return Promise.resolve({
            content: parsed.data.content,
            isError: parsed.data.isError,
            ...(parsed.data.structuredContent === undefined
              ? {}
              : { structuredContent: parsed.data.structuredContent }),
            ...(parsed.data.metadata === undefined ? {} : { metadata: parsed.data.metadata }),
          });
        },
      });
      try {
        result = await executor.execute(
          definition,
          experience.input,
          resolveWorkflowBudgetLimits(this.dependencies.budgetCeiling, [target.runtimePolicy]),
          undefined,
          instanceId,
          executionContext,
        );
      } catch (error) {
        if (!(error instanceof RecordedInvocationFailure)) throw error;
        recordedFailure = error;
      }
      assertions.push({
        name: 'terminal_outcome',
        passed:
          (result?.status ?? (recordedFailure === undefined ? 'not_executed' : 'failed')) ===
          recordedInstanceStatus,
      });
      assertions.push({
        name: 'all_recorded_calls_consumed',
        passed: used.size === recordings.length,
      });
      if (recordedInstanceStatus === 'succeeded') {
        assertions.push({
          name: 'recorded_output_oracle',
          passed:
            experience.result !== undefined &&
            canonicalHash(result?.result) === canonicalHash(experience.result),
        });
        const processed = new ResultProcessor(this.dependencies.schemas).process({
          text: result?.result === undefined ? '' : JSON.stringify(result.result),
          structured: result?.result,
          outputSchema: target.outputSchema,
        });
        assertions.push({
          name: 'candidate_output_schema',
          passed: processed.structured !== undefined,
        });
      } else {
        const expected = Object.values(experience.errors)
          .map((item) => item.code)
          .sort();
        const actual = Object.values(result?.errors ?? {})
          .map((item) => item.code)
          .sort();
        if (recordedFailure !== undefined) actual.push(recordedFailure.code);
        assertions.push({
          name: 'recorded_error_oracle',
          passed: expected.length > 0 && canonicalHash(actual) === canonicalHash(expected),
        });
      }
    } catch (error) {
      violations.push(error instanceof Error ? error.message : 'candidate_validation_error');
    }
    assertions.push({ name: 'no_missing_or_live_transport', passed: violations.length === 0 });
    const passed = assertions.length > 1 && assertions.every((item) => item.passed);
    return {
      passed,
      summary: passed
        ? 'Candidate plan executed against exact recordings and all deterministic assertions passed.'
        : `Candidate validation failed: ${
            violations.join('; ') ||
            assertions
              .filter((item) => !item.passed)
              .map((item) => item.name)
              .join(', ')
          }`,
      dependencies: [...dependencies.values()],
      evidence: {
        caseId: input.caseId,
        experienceId: experience.experienceId,
        recordingHash: canonicalHash(recordings),
        expectationHash: canonicalHash({
          result: experience.result,
          errors: experience.errors,
          successful: experience.successful,
          evaluation: experience.evaluation,
          recordedInstanceStatus,
        }),
        planId,
        instanceId,
        modelInvocationIds,
        planningAttempts: attempts,
        ...(definition === undefined ? {} : { definition }),
        status: result?.status ?? (recordedFailure === undefined ? 'not_executed' : 'failed'),
        ...(recordedInstanceStatus === undefined ? {} : { recordedInstanceStatus }),
        ...(result?.result === undefined ? {} : { actualResultHash: canonicalHash(result.result) }),
        errorCodes: [
          ...Object.values(result?.errors ?? {}).map((item) => item.code),
          ...(recordedFailure === undefined ? [] : [recordedFailure.code]),
        ],
        assertions,
        invocationIds: [...used],
      },
    };
  }
}

/** Only an error raised by an exact consumed recording can satisfy an exception oracle. */
class RecordedInvocationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordedInvocationFailure';
  }
}
