import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  EvolutionExperience,
  McpServer,
  McpTool,
  SkillFormalizationCandidate,
  SkillVersion,
  WorkflowDefinition,
  McpInvocation,
} from '../../../packages/domain/src/index.js';
import type { SkillEvolutionCommitPort } from '../../../packages/application/src/skill-evolution-commit.js';
import { VerifiedSkillEvolutionService } from '../../../packages/application/src/verified-skill-evolution.js';
import { RecordedSkillCandidateValidator } from '../../../packages/application/src/recorded-skill-candidate-validator.js';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import {
  budgetCeiling,
  schemas,
  timestamp,
} from '../../../packages/application/test/skill-evolution-fixture.js';
import { recordedSkillValidationExecutor } from '../src/composition/skill-evolution.js';

export function verifiedEvolutionFixture(
  input: Readonly<{
    base: SkillVersion;
    server: McpServer;
    tool: McpTool;
    newSkill?: boolean;
    candidate?: SkillFormalizationCandidate;
    commit?: SkillEvolutionCommitPort;
    candidateReader?: () => Promise<SkillFormalizationCandidate | undefined>;
  }>,
) {
  const fingerprint = input.candidate?.capabilityFingerprint ?? `evolution-${randomUUID()}`;
  const sourceInputs = ['normal', 'another', 'a', 'offline', 'not-achieved'];
  const histories: EvolutionExperience[] = sourceInputs.map((id, index) => ({
    experienceId: `history-${String(index)}`,
    controlId: `control-${String(index)}`,
    roundIndex: 0,
    taskId: `task-${String(index)}`,
    contextId: 'evolution-test-context',
    goal: {
      goalId: 'evolution-goal',
      version: 1,
      title: 'Read status twice',
      description: 'Read status and preserve the observed result',
      constraints: [],
      successCriteria: ['Recorded provider status'],
    },
    workflow: workflow(`original-${String(index)}`, input.tool),
    instanceId: `instance-${String(index)}`,
    skillVersions: [{ skillId: input.base.skillId, version: input.base.version }],
    tools: [input.tool],
    input: { id },
    ...(id === 'offline' ? {} : { result: { status: 'online' } }),
    errors:
      id === 'offline' ? { second: { code: 'DEVICE_OFFLINE', message: 'Recorded failure' } } : {},
    evaluation:
      id === 'offline'
        ? { decision: 'unachievable', summary: 'Recorded failure' }
        : id === 'not-achieved'
          ? { decision: 'adjust_plan', summary: 'Execution succeeded but Goal needs another round' }
          : { decision: 'achieved', summary: 'Recorded status' },
    successful: id !== 'offline' && id !== 'not-achieved',
    durationMs: 10,
    createdAt: timestamp,
  }));
  const recordedStatuses = new Map(
    histories.map((history, index) => [
      history.instanceId,
      sourceInputs[index] === 'offline' ? ('failed' as const) : ('succeeded' as const),
    ]),
  );
  const sourceExperiences = histories
    .filter((history) => history.successful)
    .map((history, index) => ({
      experienceId: `temporary-experience-${String(index)}`,
      temporarySkillId: `temporary-${String(index)}`,
      taskId: history.taskId ?? '',
      contextId: history.contextId,
      capabilityFingerprint: fingerprint,
      successful: true,
      outcomeSummary: 'Recorded qualified terminal outcome',
      createdAt: timestamp,
    }));
  const sourceSkills = sourceExperiences.map((experience) => ({
    temporarySkillId: experience.temporarySkillId,
    taskId: experience.taskId,
    contextId: experience.contextId,
    name: 'Temporary status',
    description: 'Read status twice',
    tools: [input.tool],
    inputSchema: input.base.inputSchema,
    outputSchema: input.base.outputSchema,
    capabilityFingerprint: experience.capabilityFingerprint,
    status: 'expired' as const,
    createdAt: timestamp,
    expiredAt: timestamp,
  }));
  let candidate: SkillFormalizationCandidate = input.candidate ?? {
    candidateId: `candidate-${randomUUID()}`,
    capabilityFingerprint: fingerprint,
    successfulExperienceCount: 3,
    requiredSuccessThreshold: 3,
    sourceExperienceIds: sourceExperiences.map((item) => item.experienceId),
    status: 'awaiting_simulation',
    createdAt: timestamp,
  };
  const initial = candidate;
  const proposed = {
    skillId: input.base.skillId,
    name: input.base.name,
    summary: input.base.summary,
    description: input.base.description,
    capabilities: input.base.capabilities,
    workflowGuidance: 'Candidate read twice',
    outputInstruction: input.base.outputInstruction,
    inputSchema: input.base.inputSchema,
    outputSchema: input.base.outputSchema,
    tools: [input.tool],
    usageSpecification: input.base.usageSpecification,
    outcomeSpecification: input.base.outcomeSpecification,
  };
  const commits: Parameters<SkillEvolutionCommitPort['commit']>[0][] = [];
  let wrongResult = false;
  let exceptionInput = 'offline';
  const inductionInputs: string[] = [];
  let modelCalls = 0;
  let candidateCalls = 0;
  const model = {
    generateStructuredWithAudit: (request: { stage: string; instruction: string }) => {
      modelCalls++;
      if (request.stage === 'skill_authoring') {
        inductionInputs.push(request.instruction);
        return Promise.resolve({
          invocationId: `induction-${String(modelCalls)}`,
          structuredResult: {
            consistent: true,
            stable: true,
            generalizable: true,
            duplicateScore: input.newSkill === true ? 0 : 1,
            evolutionKind: input.newSkill === true ? 'new_skill' : 'new_version',
            targetSkillId: proposed.skillId,
            ...(input.newSkill === true
              ? {
                  publicationPolicy: {
                    toolPolicy: input.base.toolPolicy,
                    runtimePolicy: input.base.runtimePolicy,
                  },
                }
              : { duplicateSkillId: proposed.skillId }),
            boundaryDecisionSummary: 'Preserve explicit source authority',
            decisionSummary: 'Validate candidate behavior on the recorded corpus',
            proposedSkill: proposed,
            supplementalCases: [
              {
                caseId: 'normal',
                kind: 'normal',
                input: { id: 'normal' },
                expectedOutcome: 'success',
              },
              {
                caseId: 'boundary',
                kind: 'boundary',
                input: { id: 'a' },
                expectedOutcome: 'success',
              },
              {
                caseId: 'exception',
                kind: 'exception',
                input: { id: exceptionInput },
                expectedOutcome: 'failure',
              },
            ],
          },
        });
      }
      candidateCalls++;
      const parsed = z
        .object({
          usage: z.object({ workflowIdentity: z.object({ workflowDefinitionId: z.string() }) }),
        })
        .parse(JSON.parse(request.instruction));
      return Promise.resolve({
        invocationId: `planning-${String(modelCalls)}`,
        structuredResult: workflow(
          parsed.usage.workflowIdentity.workflowDefinitionId,
          input.tool,
          wrongResult,
        ),
      });
    },
  };
  const skills = {
    findCurrentVersion: () => Promise.resolve(input.base),
    findVersion: () => Promise.resolve(input.base),
    listEnabledVersions: () => Promise.resolve([input.base]),
    listCurrentVersions: () => Promise.resolve(input.newSkill === true ? [] : [input.base]),
  };
  const runner = new RecordedSkillCandidateValidator({
    skills,
    graph: { listRelationsFrom: () => Promise.resolve([]) },
    schemas,
    model,
    executor: recordedSkillValidationExecutor,
    recordings: {
      read: (experience) => {
        const retained = histories.find(
          (history) => history.experienceId === experience.experienceId,
        );
        if (retained === undefined) throw new Error('Fixture missing');
        const instanceStatus = recordedStatuses.get(retained.instanceId);
        if (instanceStatus === undefined) throw new Error('Fixture instance status missing');
        return Promise.resolve({
          instanceStatus,
          invocations: [1, 2].map((index): McpInvocation => ({
            invocationId: `${experience.experienceId}-call-${String(index)}`,
            serverId: input.tool.serverId,
            toolName: input.tool.toolName,
            taskId: experience.taskId ?? '',
            executionMode: 'live',
            executionSemantics: input.tool.executionSemantics,
            arguments: z.record(z.string(), z.unknown()).parse(retained.input),
            status: index === 2 && instanceStatus === 'failed' ? 'failed' : 'succeeded',
            ...(index === 2 && instanceStatus === 'failed'
              ? { errorCode: 'DEVICE_OFFLINE', errorMessage: 'Recorded failure' }
              : {
                  result: { content: [], structuredContent: { status: 'online' }, isError: false },
                }),
            startedAt: timestamp,
            completedAt: timestamp,
            durationMs: 0,
          })),
        });
      },
    },
    workflowSchema: { type: 'object' },
    clock: { now: () => timestamp },
    nextId: randomUUID,
    budgetCeiling,
  });
  const service = new VerifiedSkillEvolutionService({
    temporarySkills: {
      findFormalizationCandidateById: () => input.candidateReader?.() ?? Promise.resolve(candidate),
      listSuccessfulExperiences: () => Promise.resolve(sourceExperiences),
      find: (id) => Promise.resolve(sourceSkills.find((skill) => skill.temporarySkillId === id)),
      listCorrectionExperiences: () =>
        Promise.resolve(
          commits.flatMap((commit) => (commit.correction === undefined ? [] : [commit.correction])),
        ),
    },
    model,
    schemas,
    skills,
    runner,
    mcp: {
      findServer: () =>
        Promise.resolve({ server: input.server, encryptedCredential: 'not-used-by-validator' }),
      listTools: () => Promise.resolve([input.tool]),
    },
    experiences: { listByTool: () => Promise.resolve(histories) },
    commit: {
      commit: async (request) => {
        commits.push(request);
        if (input.commit !== undefined) candidate = await input.commit.commit(request);
        else {
          if (canonicalHash(candidate) !== request.expectedCandidateHash)
            throw new Error('Fixture CAS mismatch');
          candidate = request.candidate;
        }
        return candidate;
      },
    },
    clock: { now: () => timestamp },
    nextCorrectionId: randomUUID,
    budgetCeiling,
  });
  return {
    service,
    initial,
    commits,
    modelCalls: () => modelCalls,
    candidateCalls: () => candidateCalls,
    setWrongResult: (value: boolean) => {
      wrongResult = value;
    },
    setExceptionInput: (value: string) => {
      exceptionInput = value;
    },
    proposed,
    histories,
    inductionInputs,
  };
}

function workflow(id: string, tool: McpTool, wrongResult = false): WorkflowDefinition {
  return {
    executionSemanticsVersion: '2.0',
    workflowDefinitionId: id,
    version: 1,
    goalId: 'evolution-goal',
    goalVersion: 1,
    entryNodeId: 'first',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'first',
        name: 'First read',
        type: 'mcp_tool',
        tool: { serverId: tool.serverId, toolName: tool.toolName },
        arguments: { op: 'ref', path: ['input'] },
      },
      {
        nodeId: 'second',
        name: 'Second read',
        type: 'mcp_tool',
        tool: { serverId: tool.serverId, toolName: tool.toolName },
        arguments: { op: 'ref', path: ['input'] },
      },
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value: wrongResult
          ? { op: 'literal', value: false }
          : { op: 'ref', path: ['nodes', 'second', 'data', 'structuredContent'] },
      },
    ],
    edges: [
      { sourceNodeId: 'first', targetNodeId: 'second' },
      { sourceNodeId: 'second', targetNodeId: 'result' },
    ],
  };
}
