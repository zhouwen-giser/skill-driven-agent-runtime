import { createHash } from 'node:crypto';

export const HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID = 'provider.home-lab-a2a-structured-fixture';
export const HOME_LAB_A2A_MODEL_FIXTURE_MODEL = 'home-lab-a2a-structured-fixture-v1';
export const HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY = 'simulated_local_structured_fixture';
export const HOME_LAB_A2A_MODEL_STAGES = Object.freeze([
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
] as const);
export const HOME_LAB_A2A_MODEL_AUXILIARY_STAGES = Object.freeze([
  'goal',
  'evaluation',
  'experience_observation',
  'experience_reflection',
] as const);
export const HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES = Object.freeze([
  ...HOME_LAB_A2A_MODEL_STAGES,
  ...HOME_LAB_A2A_MODEL_AUXILIARY_STAGES,
] as const);

export type HomeLabA2AModelStage = (typeof HOME_LAB_A2A_MODEL_STAGES)[number];
export type HomeLabA2AModelDecisionStage =
  HomeLabA2AModelStage | (typeof HOME_LAB_A2A_MODEL_AUXILIARY_STAGES)[number];
export type HomeLabA2AModelFixtureMode =
  | 'valid'
  | 'workflow_wrong_resource_ref'
  | 'workflow_unreachable'
  | 'workflow_wrong_result_mapping';

export interface HomeLabA2AModelDecision {
  readonly stage: HomeLabA2AModelDecisionStage;
  readonly structuredResult: Readonly<Record<string, unknown>>;
}

const REQUEST_TEXT = '查询客厅主灯和空调当前状态';
const TASK_TYPE_ID = 'task-type.home-lab-living-room-read-state';
const CAPABILITY_ID = 'home.living-room.read-state';
const SKILL_ID = 'home.living-room.get-state';
const MAIN_LIGHT_RESOURCE_ID = 'living-room-main-light';
const CLIMATE_RESOURCE_ID = 'living-room-air-conditioner';

export function homeLabA2AModelDecision(
  instruction: string,
  mode: HomeLabA2AModelFixtureMode = 'valid',
): HomeLabA2AModelDecision {
  const input = parseInstruction(instruction);
  if (input['extractor'] !== undefined)
    return Object.freeze({
      stage: 'experience_observation',
      structuredResult: Object.freeze({
        extractorKind: requiredText(record(input['extractor'])['kind']),
        statements: Object.freeze([]),
        changeSuggestions: Object.freeze([]),
      }),
    });
  if (input['observations'] !== undefined)
    return Object.freeze({
      stage: 'experience_reflection',
      structuredResult: Object.freeze({ impacts: Object.freeze([]), drafts: Object.freeze([]) }),
    });
  if (input['untrustedUserRequest'] !== undefined)
    return Object.freeze({
      stage: 'task_understanding',
      structuredResult: taskUnderstanding(input),
    });
  if (input['taskUnderstanding'] !== undefined)
    return Object.freeze({
      stage: 'goal_contract_generation',
      structuredResult: goalContract(input),
    });
  switch (input['operation']) {
    case 'plan_user_goal_skill_goal_dag':
      return Object.freeze({ stage: 'goal_planning', structuredResult: userGoalPlan(input) });
    case 'resolve_top_level_skill_input':
      return Object.freeze({
        stage: 'skill_input_resolution',
        structuredResult: skillInput(input),
      });
    case 'task_initial_plan':
    case 'plan_with_goal_execution_contract':
    case 'plan_with_preferred_workflow_template':
    case 'plan_with_stage_memory':
      return Object.freeze({
        stage: 'workflow_planning',
        structuredResult: workflow(input, mode),
      });
    case 'process_workflow_result':
      return Object.freeze({
        stage: 'result_processing',
        structuredResult: processedResult(input),
      });
    case 'refine_memory':
      return Object.freeze({ stage: 'result_processing', structuredResult: refinedMemory(input) });
    case 'evaluate_task_component':
      return Object.freeze({ stage: 'evaluation', structuredResult: taskQuality(input) });
    default:
      if (input['goal'] !== undefined && input['workflow'] !== undefined)
        return Object.freeze({
          stage: 'goal_evaluation',
          structuredResult: goalEvaluation(input),
        });
      throw new Error('HOME_LAB_A2A_MODEL_INSTRUCTION_UNSUPPORTED');
  }
}

function taskQuality(input: Readonly<Record<string, unknown>>) {
  const component = requiredText(input['component']);
  if (!['goal', 'workflow', 'skill', 'result_quality', 'tool_call'].includes(component))
    throw new Error('HOME_LAB_A2A_MODEL_TASK_QUALITY_COMPONENT_INVALID');
  const evidence = record(input['evidence']);
  requiredText(evidence['taskId']);
  record(evidence['goal']);
  record(evidence['goalEvaluation']);
  record(evidence['workflow']);
  record(evidence['instance']);
  record(evidence['processedResult']);
  return Object.freeze({
    score: 1,
    summary: `The ${component} component preserved the exact governed read-only contract.`,
    findings: Object.freeze([]),
    evidenceRefs: Object.freeze([`task-quality:${component}:governed-runtime-evidence`]),
  });
}

function goalEvaluation(input: Readonly<Record<string, unknown>>) {
  const workflow = record(input['workflow']);
  if (workflow['status'] !== 'succeeded' || Object.keys(record(workflow['errors'])).length !== 0)
    throw new Error('HOME_LAB_A2A_MODEL_GOAL_WORKFLOW_NOT_SUCCEEDED');
  const outputs = record(workflow['result']);
  if (outputs['evidenceMainLight'] !== true || outputs['evidenceClimate'] !== true)
    throw new Error('HOME_LAB_A2A_MODEL_GOAL_PROVIDER_EVIDENCE_MISSING');
  structuredContent(outputs['mainLight'], MAIN_LIGHT_RESOURCE_ID);
  structuredContent(outputs['climate'], CLIMATE_RESOURCE_ID);
  return Object.freeze({
    decision: 'achieved',
    summary: 'Both exact public resource states were returned with Provider evidence.',
  });
}

function refinedMemory(input: Readonly<Record<string, unknown>>) {
  const candidate = record(input['candidate']);
  const content = record(candidate['content']);
  const evaluationConclusion =
    candidate['authorityHint'] === 'skill_experience' &&
    content['evolutionKind'] === 'evaluation_conclusion';
  return Object.freeze({
    type: requiredText(candidate['type']),
    content: Object.freeze({ ...content }),
    summary: requiredText(candidate['summary']),
    confidence: finiteConfidence(candidate['confidence']),
    durability: evaluationConclusion ? 'durable' : 'volatile',
    authority: evaluationConclusion ? 'skill_experience' : 'mcp',
    durabilityReason: evaluationConclusion
      ? 'The evaluation conclusion is stable governed Skill experience with persisted Runtime evidence.'
      : 'Current device state remains volatile MCP authority and is not durable Memory.',
  });
}

function taskUnderstanding(input: Readonly<Record<string, unknown>>) {
  if (input['untrustedUserRequest'] !== REQUEST_TEXT)
    throw new Error('HOME_LAB_A2A_MODEL_REQUEST_NOT_EXACT');
  const definitions = records(input['taskTypeDefinitions']);
  const definition = definitions.length === 1 ? definitions[0] : undefined;
  if (
    definition?.['taskTypeId'] !== TASK_TYPE_ID ||
    !array(definition['capabilityRequirements']).includes(CAPABILITY_ID)
  )
    throw new Error('HOME_LAB_A2A_MODEL_TASK_TYPE_NOT_EXACT');
  return Object.freeze({
    interpretedObjective: REQUEST_TEXT,
    taskTypeCandidates: Object.freeze([
      Object.freeze({
        taskTypeId: TASK_TYPE_ID,
        version: 1,
        confidence: 1,
        rationale: 'The exact request names both governed living-room read targets.',
      }),
    ]),
    capabilityRequirements: Object.freeze([
      Object.freeze({
        capabilityId: CAPABILITY_ID,
        description: 'Return the exact main-light and climate public resource states.',
        required: true,
      }),
    ]),
    knownConstraints: Object.freeze([
      'Read only; invoke no device write operation.',
      'Use only the exact governed public resources and Providers.',
    ]),
    knownDimensions: Object.freeze([
      Object.freeze({ kind: 'target', value: '客厅主灯和空调' }),
      Object.freeze({ kind: 'criteria', value: 'Return both current public resource states.' }),
    ]),
    missingDimensions: Object.freeze([]),
    assumptions: Object.freeze([]),
    confidence: 1,
  });
}

function goalContract(input: Readonly<Record<string, unknown>>) {
  const understanding = record(input['taskUnderstanding']);
  if (
    understanding['originalRequest'] !== REQUEST_TEXT ||
    !records(understanding['capabilityRequirements']).some(
      (requirement) => requirement['capabilityId'] === CAPABILITY_ID,
    )
  )
    throw new Error('HOME_LAB_A2A_MODEL_UNDERSTANDING_NOT_EXACT');
  return Object.freeze({
    title: '查询客厅主灯和空调当前状态',
    description: '读取并返回客厅主灯和空调两个受治理公共资源的当前状态。',
    constraints: Object.freeze([
      'Read only.',
      'Use the exact composite Capability and never invoke a write Tool.',
    ]),
    successCriteria: Object.freeze([
      'Return both mainLight and climate current-state objects with Provider evidence.',
    ]),
  });
}

function userGoalPlan(input: Readonly<Record<string, unknown>>) {
  const contract = record(input['contract']);
  const goalId = requiredText(contract['goalId']);
  const criteria = records(contract['criteria']);
  if (criteria.length === 0) throw new Error('HOME_LAB_A2A_MODEL_GOAL_CRITERIA_MISSING');
  return Object.freeze({
    skillGoals: Object.freeze([
      Object.freeze({
        // Model-proposed SkillGoal IDs are persisted as global identities. Keep retries for the
        // same Goal stable while preventing a previous G08 Task from colliding with a later Goal.
        skillGoalId: `skill-goal-home-lab-${createHash('sha256').update(goalId).digest('hex').slice(0, 32)}`,
        requiredResult: 'Return both mainLight and climate current-state objects.',
        capabilityNeeds: Object.freeze([CAPABILITY_ID]),
        coveredCriterionIds: Object.freeze(
          criteria.map((criterion) => requiredText(criterion['criterionId'])),
        ),
        requiredEffectRefs: Object.freeze(['effect.home.living-room.state_read']),
        evidenceRequirements: Object.freeze([
          'light.state.observation',
          'climate.state.observation',
        ]),
        artifactRequirements: Object.freeze([]),
        assumptions: Object.freeze([]),
        constraints: Object.freeze(strings(contract['constraints'])),
      }),
    ]),
    dependencies: Object.freeze([]),
  });
}

function skillInput(input: Readonly<Record<string, unknown>>) {
  const skill = record(input['skill']);
  if (skill['skillId'] !== SKILL_ID || skill['version'] !== 1)
    throw new Error('HOME_LAB_A2A_MODEL_SKILL_NOT_EXACT');
  return Object.freeze({
    structuredInput: Object.freeze({
      mainLightResourceId: MAIN_LIGHT_RESOURCE_ID,
      climateResourceId: CLIMATE_RESOURCE_ID,
    }),
    unresolvedFields: Object.freeze([]),
    sourceRefs: Object.freeze([]),
    decisionSummary: 'Resolved both exact public resource IDs from authoritative A2A input.',
  });
}

function workflow(input: Readonly<Record<string, unknown>>, mode: HomeLabA2AModelFixtureMode) {
  const identity = record(input['workflowIdentity']);
  const workflowDefinitionId = requiredText(identity['workflowDefinitionId']);
  const goalId = requiredText(identity['goalId']);
  const version = positive(identity['version']);
  const goalVersion = positive(identity['goalVersion']);
  const lightPath =
    mode === 'workflow_wrong_resource_ref'
      ? ['input', 'skillInput', 'auxiliaryLightResourceId']
      : ['input', 'skillInput', 'mainLightResourceId'];
  const resultValue =
    mode === 'workflow_wrong_result_mapping'
      ? { op: 'ref', path: ['outputs', 'mainLight', 'data', 'structuredContent'] }
      : { op: 'ref', path: ['outputs'] };
  const lightTrueTarget = mode === 'workflow_unreachable' ? 'result' : 'climate';
  return Object.freeze({
    workflowDefinitionId,
    version,
    goalId,
    goalVersion,
    entryNodeId: 'mainLight',
    exitNodeIds: Object.freeze(['result', 'failure']),
    nodes: Object.freeze([
      Object.freeze({
        nodeId: 'mainLight',
        name: 'Read living-room main light state',
        type: 'mcp_tool',
        tool: Object.freeze({ serverId: 'home-lab-light-mcp', toolName: 'light_get_state' }),
        arguments: Object.freeze({
          resourceId: Object.freeze({ op: 'ref', path: Object.freeze(lightPath) }),
        }),
      }),
      Object.freeze({
        nodeId: 'evidenceMainLight',
        name: 'Require main-light Provider evidence',
        type: 'condition',
        expression: Object.freeze({
          op: 'exists',
          path: Object.freeze(['evidence', 'light.state.observation']),
        }),
      }),
      Object.freeze({
        nodeId: 'climate',
        name: 'Read living-room climate state',
        type: 'mcp_tool',
        tool: Object.freeze({ serverId: 'home-lab-climate-mcp', toolName: 'climate_get_state' }),
        arguments: Object.freeze({
          resourceId: Object.freeze({
            op: 'ref',
            path: Object.freeze(['input', 'skillInput', 'climateResourceId']),
          }),
        }),
      }),
      Object.freeze({
        nodeId: 'evidenceClimate',
        name: 'Require climate Provider evidence',
        type: 'condition',
        expression: Object.freeze({
          op: 'exists',
          path: Object.freeze(['evidence', 'climate.state.observation']),
        }),
      }),
      Object.freeze({
        nodeId: 'result',
        name: 'Return both governed read results',
        type: 'result',
        value: Object.freeze(resultValue),
      }),
      Object.freeze({
        nodeId: 'failure',
        name: 'Fail when required Provider evidence is absent',
        type: 'result',
        value: Object.freeze({ op: 'literal', value: false }),
      }),
    ]),
    edges: Object.freeze([
      Object.freeze({ sourceNodeId: 'mainLight', targetNodeId: 'evidenceMainLight' }),
      Object.freeze({
        sourceNodeId: 'evidenceMainLight',
        targetNodeId: lightTrueTarget,
        outcome: 'true',
      }),
      Object.freeze({
        sourceNodeId: 'evidenceMainLight',
        targetNodeId: 'failure',
        outcome: 'false',
      }),
      Object.freeze({ sourceNodeId: 'climate', targetNodeId: 'evidenceClimate' }),
      Object.freeze({
        sourceNodeId: 'evidenceClimate',
        targetNodeId: 'result',
        outcome: 'true',
      }),
      Object.freeze({
        sourceNodeId: 'evidenceClimate',
        targetNodeId: 'failure',
        outcome: 'false',
      }),
    ]),
  });
}

function processedResult(input: Readonly<Record<string, unknown>>) {
  const normalized = record(input['normalized']);
  if (array(normalized['errors']).length !== 0)
    throw new Error('HOME_LAB_A2A_MODEL_RESULT_ERRORS_PRESENT');
  const outputs = record(normalized['data']);
  const mainLight = structuredContent(outputs['mainLight'], MAIN_LIGHT_RESOURCE_ID);
  const climate = structuredContent(outputs['climate'], CLIMATE_RESOURCE_ID);
  const structured = Object.freeze({ mainLight, climate });
  return Object.freeze({
    text: '已读取客厅主灯和空调当前状态。',
    structured,
    keyFacts: Object.freeze([
      Object.freeze({ name: 'mainLight.resourceId', value: MAIN_LIGHT_RESOURCE_ID, confidence: 1 }),
      Object.freeze({ name: 'climate.resourceId', value: CLIMATE_RESOURCE_ID, confidence: 1 }),
    ]),
    valueAssessment: Object.freeze({
      valuable: true,
      summary: 'Both requested current-state observations are present.',
    }),
    memoryCandidates: Object.freeze([]),
  });
}

function structuredContent(value: unknown, expectedResourceId: string) {
  const envelope = record(value);
  const result = record(envelope['data']);
  if (result['isError'] !== false) throw new Error('HOME_LAB_A2A_MODEL_RESULT_PROVIDER_ERROR');
  const structured = record(result['structuredContent']);
  if (structured['resourceId'] !== expectedResourceId)
    throw new Error('HOME_LAB_A2A_MODEL_RESULT_RESOURCE_NOT_EXACT');
  return Object.freeze({ ...structured });
}

function parseInstruction(value: string): Readonly<Record<string, unknown>> {
  try {
    return record(JSON.parse(value) as unknown);
  } catch (error: unknown) {
    throw new Error('HOME_LAB_A2A_MODEL_INSTRUCTION_INVALID', { cause: error });
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('HOME_LAB_A2A_MODEL_OBJECT_REQUIRED');
  return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return array(value).map(record);
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('HOME_LAB_A2A_MODEL_ARRAY_REQUIRED');
  return value;
}

function strings(value: unknown): readonly string[] {
  return array(value).map(requiredText);
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error('HOME_LAB_A2A_MODEL_TEXT_REQUIRED');
  return value;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error('HOME_LAB_A2A_MODEL_POSITIVE_INTEGER_REQUIRED');
  return Number(value);
}

function finiteConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('HOME_LAB_A2A_MODEL_CONFIDENCE_INVALID');
  return value;
}
