import type {
  EvolutionExperience,
  ProposedEvolutionSkill,
  SkillEvolutionCorrectionExperience,
  SkillFormalizationCandidate,
  SkillInductionReport,
  SkillSimulationCaseResult,
  SkillSimulationReport,
  SkillVersion,
  WorkflowBudgetLimits,
  TemporarySkill,
  TemporarySkillExperience,
  SkillCandidateExecutionEvidence,
  ToolReference,
} from '../../domain/src/index.js';
import type {
  Clock,
  EvolutionExperienceRepository,
  JsonSchemaValidator,
  McpRegistryRepository,
  SkillRepository,
  TemporarySkillRepository,
} from './ports.js';
import { CorrectionDiffRecorder } from './correction-diff-recorder.js';
import { canonicalHash } from './mcp-task-readiness.js';
import {
  freezeEvolutionSkill,
  NewEvolutionPolicySchema,
  SkillEvolutionValidationError,
} from './skill-evolution-authority.js';
import { InductionDecisionSchema, inductionResponseSchema } from './skill-evolution-induction.js';
import type { SkillEvolutionCommitPort } from './skill-evolution-commit.js';
import type {
  EvolutionAuditedModel,
  RecordedSkillCandidateValidator,
} from './recorded-skill-candidate-validator.js';

type SupplementalCase = Readonly<{
  caseId: string;
  kind: 'normal' | 'boundary' | 'exception';
  input: Readonly<Record<string, unknown>>;
  expectedOutcome: 'success' | 'failure';
}>;
type Sources = Readonly<{
  experiences: readonly TemporarySkillExperience[];
  sourceSkills: readonly TemporarySkill[];
}>;

export class VerifiedSkillEvolutionService {
  constructor(
    private readonly dependencies: Readonly<{
      temporarySkills: Pick<
        TemporarySkillRepository,
        | 'findFormalizationCandidateById'
        | 'listSuccessfulExperiences'
        | 'find'
        | 'listCorrectionExperiences'
      >;
      model: EvolutionAuditedModel;
      schemas: JsonSchemaValidator;
      mcp: Pick<McpRegistryRepository, 'findServer' | 'listTools'>;
      skills: Pick<SkillRepository, 'listCurrentVersions'>;
      runner: Pick<RecordedSkillCandidateValidator, 'validate'>;
      experiences: Pick<EvolutionExperienceRepository, 'listByTool'>;
      commit: SkillEvolutionCommitPort;
      clock: Clock;
      budgetCeiling: WorkflowBudgetLimits;
      nextCorrectionId(): string;
    }>,
  ) {}

  async get(candidateId: string): Promise<SkillFormalizationCandidate> {
    const candidate =
      await this.dependencies.temporarySkills.findFormalizationCandidateById(candidateId);
    if (candidate === undefined)
      throw new SkillEvolutionValidationError('SKILL_FORMALIZATION_CANDIDATE_NOT_FOUND');
    return candidate;
  }

  listCorrections(candidateId: string) {
    return this.dependencies.temporarySkills.listCorrectionExperiences(candidateId);
  }

  async evaluateAndPublish(candidateId: string): Promise<SkillFormalizationCandidate> {
    const candidate = await this.get(candidateId);
    if (candidate.status === 'published') return candidate;
    const source = await this.#sources(candidate);
    const current = await this.dependencies.skills.listCurrentVersions();
    let decision;
    const inductionInvocationIds: string[] = [];
    try {
      const generated = await this.dependencies.model.generateStructuredWithAudit({
        stage: 'skill_authoring',
        instruction: JSON.stringify({
          operation: 'induce_skill_from_experience',
          candidate,
          ...source,
          currentSkills: current,
          replayCorpus: [
            ...(
              await this.#histories(source.sourceSkills.flatMap((skill) => skill.tools))
            ).values(),
          ].map((history) => ({
            experienceId: history.experienceId,
            input: history.input,
            result: history.result,
            errors: history.errors,
            evaluation: history.evaluation,
            successful: history.successful,
          })),
          priorCorrections:
            await this.dependencies.temporarySkills.listCorrectionExperiences(candidateId),
          budgetCeiling: this.dependencies.budgetCeiling,
          instruction:
            'Propose complete native contracts. New Skills require explicit publicationPolicy within existing budgets and source Tool authority; no automatic confirmation. Existing Skills permit adaptive changes only. Supplemental inputs must match distinct retained inputs; boundary cases exercise an explicit Schema bound and exception cases need a recorded stable execution error. The successful flag combines Workflow success and Goal achievement; an unmet Goal does not imply Workflow failure. Supplemental expectedOutcome describes Workflow execution. Model judgments cannot override deterministic validation.',
        }),
        responseSchema: inductionResponseSchema,
        correctionErrors: [],
      });
      inductionInvocationIds.push(generated.invocationId);
      decision = InductionDecisionSchema.parse(generated.structuredResult);
    } catch (error) {
      return this.dependencies.commit.commit({
        expectedCandidateHash: canonicalHash(candidate),
        candidate: {
          ...candidate,
          status: 'validation_failed',
          evaluatedAt: this.dependencies.clock.now(),
          validationReport: {
            inductionInvocationIds,
            allPassed: false,
            decisionSummary:
              'Induction did not produce a complete candidate; no execution or publication occurred.',
            cases: [
              failedCase(
                'induction',
                'static_validation',
                error instanceof Error ? error.message : 'Induction failed',
              ),
            ],
          },
        },
      });
    }
    const { proposedSkill, supplementalCases, publicationPolicy, duplicateSkillId, ...details } =
      decision;
    const induction: SkillInductionReport = {
      ...details,
      ...(duplicateSkillId === undefined ? {} : { duplicateSkillId }),
    };
    const base = current.find((skill) => skill.skillId === induction.targetSkillId);
    if (
      proposedSkill.skillId !== induction.targetSkillId ||
      (induction.evolutionKind === 'new_version' &&
        (base === undefined || induction.duplicateSkillId !== induction.targetSkillId)) ||
      (induction.evolutionKind === 'new_skill' && base !== undefined)
    )
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TARGET_CONFLICT');
    const authority =
      base === undefined
        ? publicationPolicy === undefined
          ? {}
          : { newPolicy: publicationPolicy }
        : { base };
    const evaluated = await this.#validate(
      candidate,
      proposedSkill,
      induction,
      supplementalCases,
      authority,
      inductionInvocationIds,
      source,
    );
    return this.dependencies.commit.commit({
      expectedCandidateHash: canonicalHash(candidate),
      candidate: evaluated,
    });
  }

  async correctAndRevalidate(
    candidateId: string,
    input: Readonly<{ actor: string; summary: string; proposedSkill: ProposedEvolutionSkill }>,
  ): Promise<
    Readonly<{
      candidate: SkillFormalizationCandidate;
      correction: SkillEvolutionCorrectionExperience;
    }>
  > {
    const existing = await this.get(candidateId);
    if (existing.status !== 'validation_failed')
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_REQUIRES_FAILED_DRAFT');
    if (
      existing.proposedSkill === undefined ||
      existing.inductionReport === undefined ||
      existing.validationReport?.authority === undefined
    )
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_SOURCE_INCOMPLETE');
    const actor = input.actor.trim();
    const summary = input.summary.trim();
    if (actor === '')
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_ACTOR_REQUIRED');
    if (summary === '')
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_SUMMARY_REQUIRED');
    if (input.proposedSkill.skillId !== existing.inductionReport.targetSkillId)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_TARGET_IMMUTABLE');
    const diff = new CorrectionDiffRecorder().diff(existing.proposedSkill, input.proposedSkill);
    if (diff.length === 0)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_HAS_NO_CHANGES');
    const supplemental = existing.validationReport.cases.flatMap((item): SupplementalCase[] =>
      item.kind === 'normal' || item.kind === 'boundary' || item.kind === 'exception'
        ? [{ ...item, kind: item.kind }]
        : [],
    );
    const evaluated = await this.#validate(
      existing,
      input.proposedSkill,
      existing.inductionReport,
      supplemental,
      existing.validationReport.authority,
      existing.validationReport.inductionInvocationIds ??
        existing.validationReport.executionValidation?.inductionInvocationIds ??
        [],
      await this.#sources(existing),
    );
    if (evaluated.validationReport === undefined)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_CORRECTION_VALIDATION_MISSING');
    const correction: SkillEvolutionCorrectionExperience = {
      correctionId: this.dependencies.nextCorrectionId(),
      candidateId,
      capabilityFingerprint: existing.capabilityFingerprint,
      actor,
      summary,
      beforeSkill: existing.proposedSkill,
      afterSkill: input.proposedSkill,
      diff,
      validationReport: evaluated.validationReport,
      outcome: evaluated.status === 'published' ? 'published' : 'validation_failed',
      createdAt: this.dependencies.clock.now(),
    };
    const candidate = await this.dependencies.commit.commit({
      expectedCandidateHash: canonicalHash(existing),
      candidate: evaluated,
      correction,
    });
    return { candidate, correction };
  }

  async #sources(candidate: SkillFormalizationCandidate): Promise<Sources> {
    const experiences = (
      await this.dependencies.temporarySkills.listSuccessfulExperiences(
        candidate.capabilityFingerprint,
      )
    ).filter((item) => candidate.sourceExperienceIds.includes(item.experienceId));
    if (
      new Set(candidate.sourceExperienceIds).size !== candidate.sourceExperienceIds.length ||
      new Set(experiences.map((item) => item.taskId)).size !== experiences.length ||
      experiences.length < candidate.requiredSuccessThreshold ||
      experiences.length !== candidate.sourceExperienceIds.length
    )
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_THRESHOLD_NOT_MET');
    const sourceSkills = await Promise.all(
      experiences.map(async (experience) => {
        const skill = await this.dependencies.temporarySkills.find(experience.temporarySkillId);
        if (
          skill?.taskId !== experience.taskId ||
          skill.status !== 'expired' ||
          experience.capabilityFingerprint !== candidate.capabilityFingerprint ||
          skill.capabilityFingerprint !== candidate.capabilityFingerprint ||
          !experience.successful
        )
          throw new SkillEvolutionValidationError('SKILL_EVOLUTION_SOURCE_MISSING');
        return skill;
      }),
    );
    return { experiences, sourceSkills };
  }

  async #histories(tools: readonly ToolReference[]) {
    const histories = new Map<string, EvolutionExperience>();
    const seen = new Set<string>();
    for (const tool of tools) {
      const key = `${tool.serverId}\0${tool.toolName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const history of await this.dependencies.experiences.listByTool(tool))
        histories.set(history.experienceId, history);
    }
    if (histories.size === 0 || histories.size > 200)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_REPLAY_CORPUS_UNAVAILABLE');
    return histories;
  }

  async #validate(
    candidate: SkillFormalizationCandidate,
    proposed: ProposedEvolutionSkill,
    induction: SkillInductionReport,
    supplemental: readonly SupplementalCase[],
    authority: NonNullable<SkillSimulationReport['authority']>,
    inductionInvocationIds: readonly string[],
    source: Sources,
  ): Promise<SkillFormalizationCandidate> {
    const timestamp = this.dependencies.clock.now();
    const cases: SkillSimulationCaseResult[] = [];
    let target: SkillVersion | undefined;
    let report: SkillSimulationReport = {
      allPassed: false,
      inductionInvocationIds,
      cases,
      authority,
      decisionSummary: 'Candidate remains unpublished.',
    };
    try {
      target = freezeEvolutionSkill({
        proposed,
        ...(authority.base === undefined ? {} : { base: authority.base }),
        ...(authority.newPolicy === undefined
          ? {}
          : { newPolicy: NewEvolutionPolicySchema.parse(authority.newPolicy) }),
        sourceTools: source.sourceSkills.flatMap((skill) => skill.tools),
        budgetCeiling: this.dependencies.budgetCeiling,
        schemas: this.dependencies.schemas,
        timestamp,
      });
      const servers = await Promise.all(
        [...new Set(proposed.tools.map((tool) => tool.serverId))].map(async (id) => {
          const server = await this.dependencies.mcp.findServer(id);
          if (server?.server.status !== 'enabled')
            throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TOOL_UNAVAILABLE');
          return server.server;
        }),
      );
      const tools = (
        await Promise.all(servers.map((server) => this.dependencies.mcp.listTools(server.serverId)))
      )
        .flat()
        .filter((tool) =>
          proposed.tools.some(
            (reference) =>
              tool.serverId === reference.serverId && tool.toolName === reference.toolName,
          ),
        );
      if (tools.length !== proposed.tools.length)
        throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TOOL_UNAVAILABLE');
      const histories = await this.#histories(tools);
      if (
        new Set(supplemental.map((item) => item.caseId)).size !== supplemental.length ||
        supplemental.some((item) =>
          /^(?:static-|source-|history-|validation-)/u.test(item.caseId),
        ) ||
        new Set(supplemental.map((item) => canonicalHash(item.input))).size !==
          supplemental.length ||
        !['normal', 'boundary', 'exception'].every((kind) =>
          supplemental.some((item) => item.kind === kind),
        )
      )
        throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TEST_KINDS_INCOMPLETE');
      cases.push({
        caseId: 'static-validation',
        kind: 'static_validation',
        input: {},
        expectedOutcome: 'success',
        passed: true,
        summary: 'Explicit candidate contracts and frozen authority validated.',
      });
      const executions: SkillCandidateExecutionEvidence[] = [];
      const dependencies = new Map<string, SkillVersion>();
      const run = async (
        caseId: string,
        kind: SkillSimulationCaseResult['kind'],
        history: EvolutionExperience,
        declaredOutcome?: SupplementalCase['expectedOutcome'],
      ) => {
        if (target === undefined)
          throw new SkillEvolutionValidationError('SKILL_EVOLUTION_TARGET_MISSING');
        const validated = await this.dependencies.runner.validate({
          caseId,
          target,
          experience: history,
          tools,
        });
        const outcomeMatches =
          declaredOutcome === undefined ||
          validated.evidence.recordedInstanceStatus ===
            (declaredOutcome === 'success' ? 'succeeded' : 'failed');
        cases.push({
          caseId,
          kind,
          input: isRecord(history.input) ? history.input : {},
          expectedOutcome:
            declaredOutcome ??
            (validated.evidence.recordedInstanceStatus === 'succeeded' ? 'success' : 'failure'),
          passed: validated.passed && outcomeMatches,
          summary: outcomeMatches
            ? validated.summary
            : 'Supplemental outcome differs from the authoritative recorded Workflow terminal status.',
        });
        executions.push(validated.evidence);
        for (const dependency of validated.dependencies) {
          const prior = dependencies.get(dependency.skillId);
          if (prior !== undefined && canonicalHash(prior) !== canonicalHash(dependency))
            throw new SkillEvolutionValidationError(
              'SKILL_EVOLUTION_DEPENDENCY_CHANGED_DURING_VALIDATION',
            );
          dependencies.set(dependency.skillId, dependency);
        }
      };
      for (const experience of source.experiences) {
        const history = [...histories.values()]
          .filter((item) => item.taskId === experience.taskId && item.successful)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (history === undefined)
          cases.push(
            failedCase(
              `source-${experience.experienceId}`,
              'source_experience',
              'No exact retained execution for this source Task.',
            ),
          );
        else await run(`source-${experience.experienceId}`, 'source_experience', history);
      }
      for (const history of histories.values())
        await run(`history-${history.experienceId}`, 'historical_replay', history);
      for (const item of supplemental) {
        const history = [...histories.values()].find(
          (entry) =>
            canonicalHash(entry.input) === canonicalHash(item.input) &&
            (item.kind !== 'normal' || entry.successful) &&
            executions.find((execution) => execution.caseId === `history-${entry.experienceId}`)
              ?.recordedInstanceStatus ===
              (item.expectedOutcome === 'success' ? 'succeeded' : 'failed'),
        );
        if (
          history === undefined ||
          (item.kind === 'normal' && !history.successful) ||
          (item.kind === 'exception' &&
            (history.successful ||
              item.expectedOutcome !== 'failure' ||
              Object.keys(history.errors).length === 0)) ||
          (item.kind === 'boundary' && !isSchemaBoundary(proposed.inputSchema, item.input))
        )
          cases.push({
            ...item,
            passed: false,
            summary:
              'Supplemental case lacks a distinct authoritative recording or the declared Schema boundary.',
          });
        else await run(item.caseId, item.kind, history, item.expectedOutcome);
      }
      const allPassed =
        induction.consistent &&
        induction.stable &&
        induction.generalizable &&
        cases.every((item) => item.passed);
      report = {
        allPassed,
        inductionInvocationIds,
        cases,
        authority,
        decisionSummary: allPassed
          ? 'Candidate executions and deterministic oracles passed; publication requires atomic CAS.'
          : 'Failed or unavailable required cases prevent publication.',
        executionValidation: {
          schemaVersion: '2.0',
          inputCandidateHash: canonicalHash(candidate),
          targetHash: canonicalHash(target),
          target,
          ...(authority.base === undefined ? {} : { base: authority.base }),
          dependencies: [...dependencies.values()],
          servers,
          tools,
          inductionInvocationIds,
          executions,
          validatedAt: this.dependencies.clock.now(),
        },
      };
    } catch (error) {
      cases.push(
        failedCase(
          'validation-authority',
          'static_validation',
          error instanceof SkillEvolutionValidationError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Validation authority failed',
        ),
      );
      for (const item of supplemental)
        if (!cases.some((existing) => existing.caseId === item.caseId))
          cases.push({
            ...item,
            passed: false,
            summary: 'Not executed because candidate authority validation failed.',
          });
    }
    return {
      ...candidate,
      status: report.allPassed ? 'published' : 'validation_failed',
      proposedSkill: proposed,
      inductionReport: induction,
      validationReport: report,
      evaluatedAt: this.dependencies.clock.now(),
      ...(report.allPassed && target !== undefined
        ? { publishedSkillId: target.skillId, publishedSkillVersion: target.version }
        : {}),
    };
  }
}

function failedCase(
  caseId: string,
  kind: SkillSimulationCaseResult['kind'],
  summary: string,
): SkillSimulationCaseResult {
  return { caseId, kind, input: {}, expectedOutcome: 'success', passed: false, summary };
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isSchemaBoundary(schema: unknown, input: unknown): boolean {
  if (!isRecord(schema) || !isRecord(input)) return false;
  const actual = isRecord(input['skillInput']) ? input['skillInput'] : input;
  if (!isRecord(schema['properties'])) return false;
  return Object.entries(schema['properties']).some(([key, property]) => {
    if (!isRecord(property)) return false;
    const value = actual[key];
    if (typeof value === 'number')
      return value === property['minimum'] || value === property['maximum'];
    if (typeof value === 'string')
      return value.length === property['minLength'] || value.length === property['maxLength'];
    if (Array.isArray(value))
      return value.length === property['minItems'] || value.length === property['maxItems'];
    return false;
  });
}
