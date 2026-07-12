import { z } from 'zod';

import type {
  ProposedEvolutionSkill,
  SkillFormalizationCandidate,
  SkillSimulationCaseResult,
  SkillVersion,
} from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  McpToolCatalog,
  StructuredModelProvider,
  TemporarySkillRepository,
} from './ports.js';
import type { SkillRegistryService } from './skill-registry.js';

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
    }>,
  ): Promise<Readonly<{ passed: boolean; summary: string }>>;
}

export class SkillEvolutionService {
  readonly #temporarySkills: TemporarySkillRepository;
  readonly #model: StructuredModelProvider;
  readonly #schemas: JsonSchemaValidator;
  readonly #tools: McpToolCatalog;
  readonly #skills: Pick<SkillRegistryService, 'listCurrentVersions' | 'register'>;
  readonly #runner: SkillSimulationRunner;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      temporarySkills: TemporarySkillRepository;
      model: StructuredModelProvider;
      schemas: JsonSchemaValidator;
      tools: McpToolCatalog;
      skills: Pick<SkillRegistryService, 'listCurrentVersions' | 'register'>;
      runner: SkillSimulationRunner;
      clock: Clock;
    }>,
  ) {
    this.#temporarySkills = dependencies.temporarySkills;
    this.#model = dependencies.model;
    this.#schemas = dependencies.schemas;
    this.#tools = dependencies.tools;
    this.#skills = dependencies.skills;
    this.#runner = dependencies.runner;
    this.#clock = dependencies.clock;
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
        kind: 'historical_replay',
        input: {},
        expectedOutcome: 'success',
        passed: experience.successful,
        summary: experience.outcomeSummary,
      });
    const requiredKinds = new Set(decision.supplementalCases.map((item) => item.kind));
    if (
      !['normal', 'boundary', 'exception'].every((kind) =>
        requiredKinds.has(kind as 'normal' | 'boundary' | 'exception'),
      )
    )
      throw new Error('SKILL_EVOLUTION_TEST_KINDS_INCOMPLETE');
    for (const case_ of decision.supplementalCases) {
      const outcome = await this.#runner.run({ proposedSkill, case_ });
      cases.push({ ...case_, passed: outcome.passed, summary: outcome.summary });
    }
    const inductionPassed = decision.consistent && decision.stable && decision.generalizable;
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
      const published = await this.#skills.register({
        ...proposedSkill,
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
