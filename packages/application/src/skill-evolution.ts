import { z } from 'zod';

import type {
  EvolutionExperience,
  ProposedEvolutionSkill,
  SkillEvolutionCorrectionExperience,
  SkillInductionReport,
  SkillFormalizationCandidate,
  SkillSimulationCaseResult,
  SkillVersion,
  RuntimeExecutionContext,
  SkillUsageSpecification,
} from '../../domain/src/index.js';
import { createRuntimeExecutionContext } from '../../domain/src/index.js';

import type {
  Clock,
  EvolutionExperienceRepository,
  JsonSchemaValidator,
  McpToolCatalog,
  StructuredModelProvider,
  TemporarySkillRepository,
} from './ports.js';
import { CorrectionDiffRecorder } from './correction-diff-recorder.js';
import type { SkillRegistryService } from './skill-registry.js';
import type { MemoryService } from './memory-service.js';

const InductionDecisionSchema = z.object({
  consistent: z.boolean(),
  stable: z.boolean(),
  generalizable: z.boolean(),
  duplicateSkillId: z.string().min(1).optional(),
  duplicateScore: z.number().min(0).max(1),
  evolutionKind: z.enum(['new_skill', 'new_version']),
  targetSkillId: z.string().min(1),
  boundaryDecisionSummary: z.string().min(1),
  decisionSummary: z.string().min(1),
  proposedSkill: z.object({
    skillId: z.string().min(1),
    name: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    workflowGuidance: z.string().min(1),
    outputInstruction: z.string().min(1),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    tools: z.array(z.object({ serverId: z.string().min(1), toolName: z.string().min(1) })).min(1),
    usageSpecification: z
      .unknown()
      .transform((value): SkillUsageSpecification => value as SkillUsageSpecification),
    outcomeSpecification: z.object({
      schemaVersion: z.literal('1.0'),
      skillId: z.string().min(1),
      skillVersion: z.number().int().positive(),
      effects: z.array(z.string().min(1)).min(1),
      evidence: z.array(z.string().min(1)).min(1),
      artifacts: z.array(z.string().min(1)),
      taskGoalPolicy: z.record(z.string(), z.unknown()),
      confidencePolicy: z.record(z.string(), z.unknown()),
      sideEffectPolicy: z.record(z.string(), z.unknown()),
      specificationHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    }),
  }),
  supplementalCases: z
    .array(
      z.object({
        caseId: z.string().min(1),
        kind: z.enum(['normal', 'boundary', 'exception']),
        input: z.record(z.string(), z.unknown()),
        expectedOutcome: z.enum(['success', 'failure']),
      }),
    )
    .min(3),
});

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'consistent',
    'stable',
    'generalizable',
    'duplicateScore',
    'evolutionKind',
    'targetSkillId',
    'boundaryDecisionSummary',
    'decisionSummary',
    'proposedSkill',
    'supplementalCases',
  ],
  properties: {
    consistent: { type: 'boolean' },
    stable: { type: 'boolean' },
    generalizable: { type: 'boolean' },
    duplicateSkillId: { type: 'string', minLength: 1 },
    duplicateScore: { type: 'number', minimum: 0, maximum: 1 },
    evolutionKind: { type: 'string', enum: ['new_skill', 'new_version'] },
    targetSkillId: { type: 'string', minLength: 1 },
    boundaryDecisionSummary: { type: 'string', minLength: 1 },
    decisionSummary: { type: 'string', minLength: 1 },
    proposedSkill: { type: 'object' },
    supplementalCases: { type: 'array', minItems: 3, items: { type: 'object' } },
  },
} as const;

export interface SkillSimulationRunner {
  run(
    input: Readonly<{
      proposedSkill: ProposedEvolutionSkill;
      case_: Readonly<{
        caseId: string;
        kind: 'normal' | 'boundary' | 'exception';
        input: Readonly<Record<string, unknown>>;
        expectedOutcome: 'success' | 'failure';
      }>;
      executionContext: RuntimeExecutionContext;
    }>,
  ): Promise<Readonly<{ passed: boolean; summary: string }>>;
  replay(
    input: Readonly<{
      experience: EvolutionExperience;
      executionContext: RuntimeExecutionContext;
    }>,
  ): Promise<Readonly<{ succeeded: boolean; summary: string }>>;
}

export class SkillEvolutionService {
  readonly #temporarySkills: TemporarySkillRepository;
  readonly #model: StructuredModelProvider;
  readonly #schemas: JsonSchemaValidator;
  readonly #tools: McpToolCatalog;
  readonly #skills: Pick<SkillRegistryService, 'listCurrentVersions' | 'register'>;
  readonly #runner: SkillSimulationRunner;
  readonly #experiences: Pick<EvolutionExperienceRepository, 'listByTool'>;
  readonly #clock: Clock;
  readonly #nextCorrectionId: () => string;
  readonly #memories: Pick<MemoryService, 'recordEvolution'> | undefined;

  constructor(
    dependencies: Readonly<{
      temporarySkills: TemporarySkillRepository;
      model: StructuredModelProvider;
      schemas: JsonSchemaValidator;
      tools: McpToolCatalog;
      skills: Pick<SkillRegistryService, 'listCurrentVersions' | 'register'>;
      runner: SkillSimulationRunner;
      experiences: Pick<EvolutionExperienceRepository, 'listByTool'>;
      clock: Clock;
      nextCorrectionId(): string;
      memories?: Pick<MemoryService, 'recordEvolution'>;
    }>,
  ) {
    this.#temporarySkills = dependencies.temporarySkills;
    this.#model = dependencies.model;
    this.#schemas = dependencies.schemas;
    this.#tools = dependencies.tools;
    this.#skills = dependencies.skills;
    this.#runner = dependencies.runner;
    this.#experiences = dependencies.experiences;
    this.#clock = dependencies.clock;
    this.#nextCorrectionId = dependencies.nextCorrectionId;
    this.#memories = dependencies.memories;
  }

  async evaluateAndPublish(candidateId: string): Promise<SkillFormalizationCandidate> {
    const candidate = await this.#temporarySkills.findFormalizationCandidateById(candidateId);
    if (candidate === undefined) throw new Error('SKILL_FORMALIZATION_CANDIDATE_NOT_FOUND');
    if (candidate.status === 'published') return candidate;
    const experiences = await this.#temporarySkills.listSuccessfulExperiences(
      candidate.capabilityFingerprint,
    );
    if (experiences.length < candidate.requiredSuccessThreshold)
      throw new Error('SKILL_EVOLUTION_THRESHOLD_NOT_MET');
    const sourceSkills = await Promise.all(
      experiences.map(async (experience) => {
        const skill = await this.#temporarySkills.find(experience.temporarySkillId);
        if (skill === undefined) throw new Error('SKILL_EVOLUTION_SOURCE_MISSING');
        return skill;
      }),
    );
    const currentSkills = await this.#skills.listCurrentVersions();
    const decision = InductionDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'skill_authoring',
        instruction: JSON.stringify({
          operation: 'induce_skill_from_experience',
          candidate,
          experiences,
          sourceSkills,
          currentSkills: currentSkills.map(skillSummary),
        }),
        responseSchema,
        correctionErrors: [],
      }),
    );
    const inductionReport = {
      consistent: decision.consistent,
      stable: decision.stable,
      generalizable: decision.generalizable,
      ...(decision.duplicateSkillId === undefined
        ? {}
        : { duplicateSkillId: decision.duplicateSkillId }),
      duplicateScore: decision.duplicateScore,
      evolutionKind: decision.evolutionKind,
      targetSkillId: decision.targetSkillId,
      boundaryDecisionSummary: decision.boundaryDecisionSummary,
      decisionSummary: decision.decisionSummary,
    };
    const proposedSkill = {
      ...decision.proposedSkill,
      skillId: decision.targetSkillId,
    };
    assertEvolutionTarget(decision, currentSkills);
    return this.#validateAndPublish(
      candidate,
      experiences,
      inductionReport,
      proposedSkill,
      decision.supplementalCases,
    );
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
      throw new Error('SKILL_EVOLUTION_CORRECTION_REQUIRES_FAILED_DRAFT');
    if (
      existing.proposedSkill === undefined ||
      existing.inductionReport === undefined ||
      existing.validationReport === undefined
    )
      throw new Error('SKILL_EVOLUTION_CORRECTION_SOURCE_INCOMPLETE');
    const actor = input.actor.trim();
    const summary = input.summary.trim();
    if (actor.length === 0) throw new Error('SKILL_EVOLUTION_CORRECTION_ACTOR_REQUIRED');
    if (summary.length === 0) throw new Error('SKILL_EVOLUTION_CORRECTION_SUMMARY_REQUIRED');
    if (input.proposedSkill.skillId !== existing.inductionReport.targetSkillId)
      throw new Error('SKILL_EVOLUTION_CORRECTION_TARGET_IMMUTABLE');
    const diff = new CorrectionDiffRecorder().diff(existing.proposedSkill, input.proposedSkill);
    if (diff.length === 0) throw new Error('SKILL_EVOLUTION_CORRECTION_HAS_NO_CHANGES');
    const supplementalCases = existing.validationReport.cases
      .filter(
        (item) => item.kind === 'normal' || item.kind === 'boundary' || item.kind === 'exception',
      )
      .map(({ caseId, kind, input: caseInput, expectedOutcome }) => ({
        caseId,
        kind: kind as 'normal' | 'boundary' | 'exception',
        input: caseInput,
        expectedOutcome,
      }));
    const experiences = await this.#temporarySkills.listSuccessfulExperiences(
      existing.capabilityFingerprint,
    );
    const candidate = await this.#validateAndPublish(
      existing,
      experiences,
      existing.inductionReport,
      input.proposedSkill,
      supplementalCases,
    );
    if (candidate.validationReport === undefined)
      throw new Error('SKILL_EVOLUTION_CORRECTION_VALIDATION_MISSING');
    const correction: SkillEvolutionCorrectionExperience = {
      correctionId: this.#nextCorrectionId(),
      candidateId,
      capabilityFingerprint: existing.capabilityFingerprint,
      actor,
      summary,
      beforeSkill: existing.proposedSkill,
      afterSkill: input.proposedSkill,
      diff,
      validationReport: candidate.validationReport,
      outcome: candidate.status === 'published' ? 'published' : 'validation_failed',
      createdAt: this.#clock.now(),
    };
    await this.#temporarySkills.saveCorrectionExperience(correction);
    await this.#memories?.recordEvolution({
      kind: 'skill_correction',
      sourceRef: `skill-evolution-correction:${correction.correctionId}`,
      summary: correction.summary,
      content: {
        candidateId: correction.candidateId,
        actor: correction.actor,
        diff: correction.diff,
        outcome: correction.outcome,
      },
      confidence: 1,
      successful: correction.outcome === 'published',
    });
    return { candidate, correction };
  }

  listCorrections(candidateId: string): Promise<readonly SkillEvolutionCorrectionExperience[]> {
    return this.#temporarySkills.listCorrectionExperiences(candidateId);
  }

  async #validateAndPublish(
    candidate: SkillFormalizationCandidate,
    experiences: Awaited<ReturnType<TemporarySkillRepository['listSuccessfulExperiences']>>,
    inductionReport: SkillInductionReport,
    proposedSkill: ProposedEvolutionSkill,
    supplementalCases: readonly Readonly<{
      caseId: string;
      kind: 'normal' | 'boundary' | 'exception';
      input: Readonly<Record<string, unknown>>;
      expectedOutcome: 'success' | 'failure';
    }>[],
  ): Promise<SkillFormalizationCandidate> {
    const cases: SkillSimulationCaseResult[] = [];
    const staticErrors = await this.#staticErrors(proposedSkill);
    cases.push({
      caseId: 'static-validation',
      kind: 'static_validation',
      input: {},
      expectedOutcome: 'success',
      passed: staticErrors.length === 0,
      summary:
        staticErrors.length === 0
          ? 'Schemas and Tool references are valid.'
          : staticErrors.join('; '),
    });
    for (const experience of experiences)
      cases.push({
        caseId: `replay-${experience.experienceId}`,
        kind: 'source_experience',
        input: {},
        expectedOutcome: 'success',
        passed: experience.successful,
        summary: experience.outcomeSummary,
      });
    const histories = new Map<string, EvolutionExperience>();
    for (const tool of proposedSkill.tools)
      for (const history of await this.#experiences.listByTool(tool))
        histories.set(history.experienceId, history);
    for (const history of histories.values()) {
      const replay = await this.#runner.replay({
        experience: history,
        executionContext: createRuntimeExecutionContext({
          mode: 'historical-replay',
          simulationId: `skill-evolution:${candidate.candidateId}:historical:${history.experienceId}`,
        }),
      });
      cases.push({
        caseId: `historical-${history.experienceId}`,
        kind: 'historical_replay',
        input: isRecord(history.input) ? history.input : {},
        expectedOutcome: history.successful ? 'success' : 'failure',
        passed: replay.succeeded === history.successful,
        summary: replay.summary,
      });
    }
    const requiredKinds = new Set(supplementalCases.map((item) => item.kind));
    if (
      !['normal', 'boundary', 'exception'].every((kind) =>
        requiredKinds.has(kind as 'normal' | 'boundary' | 'exception'),
      )
    )
      throw new Error('SKILL_EVOLUTION_TEST_KINDS_INCOMPLETE');
    for (const case_ of supplementalCases) {
      const outcome = await this.#runner.run({
        proposedSkill,
        case_,
        executionContext: createRuntimeExecutionContext({
          mode: 'simulation',
          simulationId: `skill-evolution:${candidate.candidateId}:simulation:${case_.caseId}`,
        }),
      });
      cases.push({ ...case_, passed: outcome.passed, summary: outcome.summary });
    }
    const inductionPassed =
      inductionReport.consistent && inductionReport.stable && inductionReport.generalizable;
    const allPassed = inductionPassed && cases.every((item) => item.passed);
    const validationReport = {
      allPassed,
      cases,
      decisionSummary: allPassed
        ? 'Every induction and simulation gate passed.'
        : 'The evolution draft remains unpublished because at least one gate failed.',
    };
    let evaluated: SkillFormalizationCandidate = {
      ...candidate,
      status: 'validation_failed',
      inductionReport,
      validationReport,
      proposedSkill,
      evaluatedAt: this.#clock.now(),
    };
    if (allPassed) {
      if (
        proposedSkill.usageSpecification === undefined ||
        proposedSkill.outcomeSpecification === undefined
      )
        throw new Error('SKILL_EVOLUTION_EXPLICIT_CONTRACTS_REQUIRED');
      const published = await this.#skills.register({
        ...proposedSkill,
        usageSpecification: proposedSkill.usageSpecification,
        outcomeSpecification: proposedSkill.outcomeSpecification,
        toolPolicy: { required: proposedSkill.tools, optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'experience_evolution',
        validationPassed: true,
      });
      evaluated = {
        ...evaluated,
        status: 'published',
        publishedSkillId: published.skillId,
        publishedSkillVersion: published.version,
      };
    }
    await this.#temporarySkills.saveFormalizationCandidate(evaluated);
    return evaluated;
  }

  async get(candidateId: string): Promise<SkillFormalizationCandidate> {
    const candidate = await this.#temporarySkills.findFormalizationCandidateById(candidateId);
    if (candidate === undefined) throw new Error('SKILL_FORMALIZATION_CANDIDATE_NOT_FOUND');
    return candidate;
  }

  async #staticErrors(skill: ProposedEvolutionSkill): Promise<string[]> {
    const errors = [
      ...this.#schemas.checkSchema(skill.inputSchema).errors.map((item) => `input: ${item}`),
      ...this.#schemas.checkSchema(skill.outputSchema).errors.map((item) => `output: ${item}`),
    ];
    for (const tool of skill.tools)
      if (!(await this.#tools.exists(tool)))
        errors.push(`Tool ${tool.serverId}/${tool.toolName} is unavailable.`);
    return errors;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skillSummary(skill: SkillVersion) {
  return {
    skillId: skill.skillId,
    version: skill.version,
    name: skill.name,
    summary: skill.summary,
    capabilities: skill.capabilities,
  };
}

function assertEvolutionTarget(
  decision: z.infer<typeof InductionDecisionSchema>,
  currentSkills: readonly SkillVersion[],
): void {
  const target = currentSkills.find((skill) => skill.skillId === decision.targetSkillId);
  if (decision.evolutionKind === 'new_version') {
    if (target === undefined) throw new Error('SKILL_EVOLUTION_VERSION_TARGET_NOT_FOUND');
    if (decision.duplicateSkillId !== decision.targetSkillId)
      throw new Error('SKILL_EVOLUTION_DUPLICATE_TARGET_MISMATCH');
    return;
  }
  if (target !== undefined) throw new Error('SKILL_EVOLUTION_NEW_SKILL_ALREADY_EXISTS');
  if (decision.proposedSkill.skillId !== decision.targetSkillId)
    throw new Error('SKILL_EVOLUTION_NEW_SKILL_TARGET_MISMATCH');
}
