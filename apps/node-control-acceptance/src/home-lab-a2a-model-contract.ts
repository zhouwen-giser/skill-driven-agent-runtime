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
const G09_READ_REQUEST = '读取主灯基线';
const G09_READ_TASK_TYPE_ID = 'task-type.home-lab-main-light-read-state';
const G09_CONTROL_TASK_TYPE_ID = 'task-type.home-lab-main-light-set-power';
const G09_READ_CAPABILITY_ID = 'home.light.read-state';
const G09_CONTROL_CAPABILITY_ID = 'home.light.set-power';
const G09_READ_SKILL_ID = 'home.light.get-state';
const G09_CONTROL_SKILL_ID = 'home.light.set-power';
const G09_LIGHT_SERVER_ID = 'home-lab-light-mcp-g09';
const G09_CONTROL_PROMPT =
  'Resume only after the exact task-scoped governed-control confirmation is issued.';

type G09Scenario =
  | Readonly<{ kind: 'read' }>
  | Readonly<{ kind: 'control'; purpose: 'set' | 'restore'; power: 'on' | 'off' }>;

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
    summary: `The ${component} component preserved the exact governed home-lab contract.`,
    findings: Object.freeze([]),
    evidenceRefs: Object.freeze([`task-quality:${component}:governed-runtime-evidence`]),
  });
}

function goalEvaluation(input: Readonly<Record<string, unknown>>) {
  const workflow = record(input['workflow']);
  if (workflow['status'] !== 'succeeded' || Object.keys(record(workflow['errors'])).length !== 0)
    throw new Error('HOME_LAB_A2A_MODEL_GOAL_WORKFLOW_NOT_SUCCEEDED');
  const outputs = record(workflow['result']);
  if (outputs['resourceId'] === MAIN_LIGHT_RESOURCE_ID) {
    const power = lightPower(outputs['power']);
    if (outputs['reachable'] === false || outputs['confirmed'] === false)
      throw new Error('HOME_LAB_G09_MODEL_GOAL_PROVIDER_EVIDENCE_MISSING');
    return Object.freeze({
      decision: 'achieved',
      summary: `The exact governed main-light state is ${power} with Provider evidence.`,
    });
  }
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
    return g09TaskUnderstanding(
      input,
      g09ScenarioFromRequest(requiredText(input['untrustedUserRequest'])),
    );
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
  if (understanding['originalRequest'] !== REQUEST_TEXT)
    return g09GoalContract(g09ScenarioFromRequest(requiredText(understanding['originalRequest'])));
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
  const g09 = g09ScenarioFromGoalContract(contract);
  if (g09 !== undefined) return g09UserGoalPlan(contract, g09);
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
  if (
    skill['version'] === 3 &&
    (skill['skillId'] === G09_READ_SKILL_ID || skill['skillId'] === G09_CONTROL_SKILL_ID)
  )
    return Object.freeze({
      structuredInput: Object.freeze({}),
      unresolvedFields: Object.freeze([]),
      sourceRefs: Object.freeze([]),
      decisionSummary:
        'The authoritative A2A structured_input overlay supplies the exact G09 resource and power.',
    });
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
  const usagePolicy = input['skillUsagePolicy'];
  if (isRecord(usagePolicy)) {
    const skill = usagePolicy['skill'];
    if (isRecord(skill) && skill['skillVersion'] === 3) {
      if (skill['skillId'] === G09_READ_SKILL_ID) return g09Workflow(input, { kind: 'read' });
      if (skill['skillId'] === G09_CONTROL_SKILL_ID) {
        const scenario = g09ScenarioFromGoalContract(record(input['goalContract']));
        if (scenario?.kind !== 'control')
          throw new Error('HOME_LAB_G09_MODEL_CONTROL_GOAL_AUTHORITY_MISSING');
        return g09Workflow(input, scenario);
      }
    }
  }
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

function g09TaskUnderstanding(input: Readonly<Record<string, unknown>>, scenario: G09Scenario) {
  const definitions = records(input['taskTypeDefinitions']);
  const expectedTaskType =
    scenario.kind === 'read' ? G09_READ_TASK_TYPE_ID : G09_CONTROL_TASK_TYPE_ID;
  const expectedCapability =
    scenario.kind === 'read' ? G09_READ_CAPABILITY_ID : G09_CONTROL_CAPABILITY_ID;
  const definition = definitions.find((candidate) => candidate['taskTypeId'] === expectedTaskType);
  if (
    definition?.['version'] !== 3 ||
    !array(definition['capabilityRequirements']).includes(expectedCapability)
  )
    throw new Error('HOME_LAB_G09_MODEL_TASK_TYPE_NOT_EXACT');
  const objective =
    scenario.kind === 'read'
      ? G09_READ_REQUEST
      : `${scenario.purpose === 'restore' ? '恢复' : '设置'}主灯电源为 ${scenario.power}`;
  return Object.freeze({
    interpretedObjective: objective,
    taskTypeCandidates: Object.freeze([
      Object.freeze({
        taskTypeId: expectedTaskType,
        version: 3,
        confidence: 1,
        rationale:
          scenario.kind === 'read'
            ? 'The request names the exact governed main-light baseline read.'
            : 'The request names one exact governed main-light power target.',
      }),
    ]),
    capabilityRequirements: Object.freeze([
      Object.freeze({
        capabilityId: expectedCapability,
        description:
          scenario.kind === 'read'
            ? 'Return the exact current main-light public state.'
            : `Set and confirm main-light power ${scenario.power}.`,
        required: true,
      }),
    ]),
    knownConstraints: Object.freeze(
      scenario.kind === 'read'
        ? ['Use the exact G09 read Skill and Provider Binding.']
        : [
            'Require explicit immutable-plan confirmation.',
            'Require task-scoped governed-control confirmation before dispatch.',
            'Dispatch at most once and reconcile RemoteTask terminal evidence.',
          ],
    ),
    knownDimensions: Object.freeze([
      Object.freeze({ kind: 'target', value: MAIN_LIGHT_RESOURCE_ID }),
      Object.freeze({
        kind: 'criteria',
        value:
          scenario.kind === 'read'
            ? 'Return current power with Provider evidence.'
            : `Return confirmed power ${scenario.power} with terminal Provider evidence.`,
      }),
    ]),
    missingDimensions: Object.freeze([]),
    assumptions: Object.freeze([]),
    confidence: 1,
  });
}

function g09GoalContract(scenario: G09Scenario) {
  if (scenario.kind === 'read')
    return Object.freeze({
      title: 'G09 read main-light baseline',
      description: 'Read the exact governed living-room main-light public state.',
      constraints: Object.freeze([
        'Use home.light.read-state@3 through the exact fresh G09 Provider Binding.',
      ]),
      successCriteria: Object.freeze([
        'Return main-light power and Provider observation evidence.',
      ]),
    });
  return Object.freeze({
    title: `G09 ${scenario.purpose} main-light power ${scenario.power}`,
    description: `Use the exact governed control to ${scenario.purpose} living-room main-light power to ${scenario.power}.`,
    constraints: Object.freeze([
      'Require explicit immutable-plan confirmation.',
      'Pause at the governed-control barrier before any MCP dispatch.',
      'Require one task-scoped governed-control confirmation and at most one dispatch.',
      'Require RemoteTask terminal state, Continuation and Provider evidence.',
    ]),
    successCriteria: Object.freeze([
      `Return confirmed main-light power ${scenario.power} with terminal Provider evidence.`,
    ]),
  });
}

function g09UserGoalPlan(contract: Readonly<Record<string, unknown>>, scenario: G09Scenario) {
  const goalId = requiredText(contract['goalId']);
  const criteria = records(contract['criteria']);
  if (criteria.length === 0) throw new Error('HOME_LAB_G09_MODEL_GOAL_CRITERIA_MISSING');
  const capability = scenario.kind === 'read' ? G09_READ_CAPABILITY_ID : G09_CONTROL_CAPABILITY_ID;
  const effect =
    scenario.kind === 'read' ? 'effect.home.light.state_read' : 'effect.home.light.power_changed';
  return Object.freeze({
    skillGoals: Object.freeze([
      Object.freeze({
        skillGoalId: `skill-goal-home-lab-g09-${createHash('sha256').update(goalId).digest('hex').slice(0, 28)}`,
        requiredResult:
          scenario.kind === 'read'
            ? 'Return the exact governed main-light baseline.'
            : `Return confirmed governed main-light power ${scenario.power}.`,
        capabilityNeeds: Object.freeze([capability]),
        coveredCriterionIds: Object.freeze(
          criteria.map((criterion) => requiredText(criterion['criterionId'])),
        ),
        requiredEffectRefs: Object.freeze([effect]),
        evidenceRequirements: Object.freeze(['light.state.observation']),
        artifactRequirements: Object.freeze([]),
        assumptions: Object.freeze([]),
        constraints: Object.freeze(strings(contract['constraints'])),
      }),
    ]),
    dependencies: Object.freeze([]),
  });
}

function g09Workflow(input: Readonly<Record<string, unknown>>, scenario: G09Scenario) {
  const identity = record(input['workflowIdentity']);
  const workflowDefinitionId = requiredText(identity['workflowDefinitionId']);
  const goalId = requiredText(identity['goalId']);
  const version = positive(identity['version']);
  const goalVersion = positive(identity['goalVersion']);
  const control = scenario.kind === 'control';
  const toolNodeId = control ? 'setPower' : 'readLight';
  const contextGates = Object.freeze([
    Object.freeze({
      nodeId: 'contextPublicResource',
      name: 'Require exact public resource context',
      type: 'condition',
      expression: Object.freeze({
        op: 'ref',
        path: Object.freeze(['context', 'public-resource-id']),
      }),
    }),
    Object.freeze({
      nodeId: 'contextProviderBinding',
      name: 'Require fresh exact Provider Binding context',
      type: 'condition',
      expression: Object.freeze({
        op: 'ref',
        path: Object.freeze(['context', 'provider-binding-freshness']),
      }),
    }),
  ]);
  const firstExecutionNodeId = control ? 'confirmControl' : toolNodeId;
  return Object.freeze({
    workflowDefinitionId,
    version,
    goalId,
    goalVersion,
    entryNodeId: 'contextPublicResource',
    exitNodeIds: Object.freeze(['result', 'failure']),
    nodes: Object.freeze([
      ...contextGates,
      ...(control
        ? [
            Object.freeze({
              nodeId: 'confirmControl',
              name: 'Wait for task-scoped governed-control confirmation',
              type: 'human_confirmation',
              prompt: G09_CONTROL_PROMPT,
            }),
          ]
        : []),
      Object.freeze({
        nodeId: toolNodeId,
        name: control ? 'Set governed main-light power' : 'Read governed main-light state',
        type: 'mcp_tool',
        tool: Object.freeze({
          serverId: G09_LIGHT_SERVER_ID,
          toolName: control ? 'light_set_power' : 'light_get_state',
        }),
        arguments: Object.freeze({
          resourceId: MAIN_LIGHT_RESOURCE_ID,
          ...(control ? { power: scenario.power } : {}),
        }),
      }),
      Object.freeze({
        nodeId: 'evidenceLight',
        name: 'Require exact main-light Provider evidence',
        type: 'condition',
        expression: Object.freeze({
          op: 'exists',
          path: Object.freeze(['evidence', 'light.state.observation']),
        }),
      }),
      Object.freeze({
        nodeId: 'result',
        name: 'Return the exact governed main-light result',
        type: 'result',
        value: Object.freeze({
          op: 'ref',
          path: Object.freeze(['nodes', toolNodeId, 'data', 'structuredContent']),
        }),
      }),
      Object.freeze({
        nodeId: 'failure',
        name: 'Fail when confirmation or evidence is absent',
        type: 'result',
        value: Object.freeze({ op: 'literal', value: false }),
      }),
    ]),
    edges: Object.freeze([
      Object.freeze({
        sourceNodeId: 'contextPublicResource',
        targetNodeId: 'contextProviderBinding',
        outcome: 'true',
      }),
      Object.freeze({
        sourceNodeId: 'contextPublicResource',
        targetNodeId: 'failure',
        outcome: 'false',
      }),
      Object.freeze({
        sourceNodeId: 'contextProviderBinding',
        targetNodeId: firstExecutionNodeId,
        outcome: 'true',
      }),
      Object.freeze({
        sourceNodeId: 'contextProviderBinding',
        targetNodeId: 'failure',
        outcome: 'false',
      }),
      ...(control
        ? [
            Object.freeze({
              sourceNodeId: 'confirmControl',
              targetNodeId: toolNodeId,
              outcome: 'success',
            }),
            Object.freeze({
              sourceNodeId: 'confirmControl',
              targetNodeId: 'failure',
              outcome: 'failure',
            }),
          ]
        : []),
      Object.freeze({ sourceNodeId: toolNodeId, targetNodeId: 'evidenceLight' }),
      Object.freeze({
        sourceNodeId: 'evidenceLight',
        targetNodeId: 'result',
        outcome: 'true',
      }),
      Object.freeze({
        sourceNodeId: 'evidenceLight',
        targetNodeId: 'failure',
        outcome: 'false',
      }),
    ]),
  });
}

function g09ScenarioFromRequest(request: string): G09Scenario {
  if (request === G09_READ_REQUEST) return Object.freeze({ kind: 'read' as const });
  const match = /^(设置|恢复)主灯电源为 (on|off)$/u.exec(request);
  if (match === null) throw new Error('HOME_LAB_G09_MODEL_REQUEST_NOT_EXACT');
  return Object.freeze({
    kind: 'control' as const,
    purpose: match[1] === '恢复' ? ('restore' as const) : ('set' as const),
    power: match[2] === 'on' ? ('on' as const) : ('off' as const),
  });
}

function g09ScenarioFromGoalContract(
  contract: Readonly<Record<string, unknown>>,
): G09Scenario | undefined {
  const title = contract['title'];
  if (title === 'G09 read main-light baseline') return Object.freeze({ kind: 'read' as const });
  if (typeof title !== 'string') return undefined;
  const match = /^G09 (set|restore) main-light power (on|off)$/u.exec(title);
  if (match === null) return undefined;
  return Object.freeze({
    kind: 'control' as const,
    purpose: match[1] === 'restore' ? ('restore' as const) : ('set' as const),
    power: match[2] === 'on' ? ('on' as const) : ('off' as const),
  });
}

function processedResult(input: Readonly<Record<string, unknown>>) {
  const normalized = record(input['normalized']);
  if (array(normalized['errors']).length !== 0)
    throw new Error('HOME_LAB_A2A_MODEL_RESULT_ERRORS_PRESENT');
  const outputs = record(normalized['data']);
  if (outputs['resourceId'] === MAIN_LIGHT_RESOURCE_ID) {
    const power = lightPower(outputs['power']);
    const structured = Object.freeze({ ...outputs, resourceId: MAIN_LIGHT_RESOURCE_ID, power });
    return Object.freeze({
      text: `主灯受治理状态已确认为 ${power}。`,
      structured,
      keyFacts: Object.freeze([
        Object.freeze({ name: 'resourceId', value: MAIN_LIGHT_RESOURCE_ID, confidence: 1 }),
        Object.freeze({ name: 'power', value: power, confidence: 1 }),
      ]),
      valueAssessment: Object.freeze({
        valuable: true,
        summary: 'The exact governed main-light observation is present.',
      }),
      memoryCandidates: Object.freeze([]),
    });
  }
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
  if (!isRecord(value)) throw new Error('HOME_LAB_A2A_MODEL_OBJECT_REQUIRED');
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function lightPower(value: unknown): 'on' | 'off' | 'unknown' | 'unavailable' {
  if (!['on', 'off', 'unknown', 'unavailable'].includes(String(value)))
    throw new Error('HOME_LAB_G09_MODEL_LIGHT_POWER_INVALID');
  return value as 'on' | 'off' | 'unknown' | 'unavailable';
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
