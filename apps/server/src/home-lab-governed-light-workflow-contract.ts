import type {
  SkillUsagePlanPolicy,
  WorkflowDefinition,
} from '../../../packages/domain/src/index.js';
import type {
  WorkflowCandidateGuard,
  WorkflowCandidateGuardError,
} from '../../../packages/application/src/workflow-planner.js';
import type { SkillCompositionRoot } from '../../../packages/application/src/skill-composition.js';

import {
  HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
  HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
} from './home-lab-task-understanding.js';

export const HOME_LAB_GOVERNED_LIGHT_SKILLS = Object.freeze({
  read: Object.freeze({ skillId: 'home.light.get-state', skillVersion: 3 }),
  control: Object.freeze({ skillId: 'home.light.set-power', skillVersion: 3 }),
} as const);

export const HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT =
  'Resume only after the exact task-scoped governed-control confirmation is issued.';

export type HomeLabGovernedLightWorkflowContractErrorCode =
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_IDENTITY_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONTEXT_GATE_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONFIRMATION_GATE_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOOL_BINDING_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_EVIDENCE_GATE_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_RESULT_MAPPING_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_OUTCOME_AUTHORITY_INVALID';

const HOME_LAB_GOVERNED_LIGHT_OUTCOME_REFS = Object.freeze({
  read: Object.freeze({
    effectRefs: Object.freeze(['effect.home.light.state_read']),
    evidenceRefs: Object.freeze(['light.state.observation']),
    artifactRefs: Object.freeze([]),
  }),
  control: Object.freeze({
    effectRefs: Object.freeze(['effect.home.light.power_changed']),
    evidenceRefs: Object.freeze(['light.state.observation']),
    artifactRefs: Object.freeze([]),
  }),
} as const);

export class HomeLabGovernedLightWorkflowContractError extends Error {
  readonly code: HomeLabGovernedLightWorkflowContractErrorCode;

  constructor(code: HomeLabGovernedLightWorkflowContractErrorCode, message: string) {
    super(message);
    this.name = 'HomeLabGovernedLightWorkflowContractError';
    this.code = code;
  }
}

export function assertHomeLabGovernedLightWorkflowContract(
  definition: unknown,
  skill: Readonly<{ skillId: string; skillVersion: number }>,
): void {
  const kind = skillKind(skill);
  const value = object(definition, 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID');
  const nodes = objects(value['nodes'], 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID');
  const edges = objects(value['edges'], 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID');
  const control = kind === 'control';
  if (
    nodes.length !== (control ? 7 : 6) ||
    value['entryNodeId'] !== 'contextPublicResource' ||
    canonical(value['exitNodeIds']) !== canonical(['result', 'failure']) ||
    canonical(projectEdges(edges)) !== canonical(control ? controlEdges() : readEdges())
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID',
      'The G09 Workflow must preserve its exact reachable confirmation/read, evidence and result topology.',
    );

  const publicResourceContext = nodes.find((node) => node['nodeId'] === 'contextPublicResource');
  const providerBindingContext = nodes.find((node) => node['nodeId'] === 'contextProviderBinding');
  if (
    publicResourceContext?.['type'] !== 'condition' ||
    canonical(publicResourceContext['expression']) !==
      canonical({ op: 'ref', path: ['context', 'public-resource-id'] }) ||
    providerBindingContext?.['type'] !== 'condition' ||
    canonical(providerBindingContext['expression']) !==
      canonical({ op: 'ref', path: ['context', 'provider-binding-freshness'] })
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONTEXT_GATE_INVALID',
      'The G09 Workflow requires exact public-resource and Provider-Binding context gates.',
    );

  if (control) {
    const confirmation = nodes.find((node) => node['nodeId'] === 'confirmControl');
    if (
      confirmation?.['type'] !== 'human_confirmation' ||
      confirmation['prompt'] !== HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT
    )
      invalid(
        'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONFIRMATION_GATE_INVALID',
        'The G09 write Workflow requires the exact pre-dispatch governed-control barrier.',
      );
  } else if (nodes.some((node) => node['type'] === 'human_confirmation'))
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONFIRMATION_GATE_INVALID',
      'The G09 baseline read Workflow must not contain a physical-control barrier.',
    );

  const expectedTool = control ? 'light_set_power' : 'light_get_state';
  const expectedNodeId = control ? 'setPower' : 'readLight';
  const mcpNodes = nodes.filter((node) => node['type'] === 'mcp_tool');
  const mcp = mcpNodes[0];
  const tool = isObject(mcp?.['tool']) ? mcp['tool'] : undefined;
  const argumentsValue = isObject(mcp?.['arguments']) ? mcp['arguments'] : undefined;
  const powerArgument = argumentsValue?.['power'];
  const expectedTaskExecution = control
    ? { protocolMode: 'frozen_v1', availabilityCheck: 'required' }
    : undefined;
  if (
    mcpNodes.length !== 1 ||
    mcp?.['nodeId'] !== expectedNodeId ||
    tool?.['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    tool['toolName'] !== expectedTool ||
    argumentsValue?.['resourceId'] !== HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID ||
    (control
      ? (powerArgument !== 'on' && powerArgument !== 'off') ||
        Object.keys(argumentsValue).length !== 2
      : powerArgument !== undefined || Object.keys(argumentsValue).length !== 1) ||
    canonical(mcp['taskExecution']) !== canonical(expectedTaskExecution)
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOOL_BINDING_INVALID',
      'The G09 Workflow requires one exact v3 light Tool, frozen public input and task semantics.',
    );

  const evidence = nodes.find((node) => node['nodeId'] === 'evidenceLight');
  if (
    evidence?.['type'] !== 'condition' ||
    canonical(evidence['expression']) !==
      canonical({ op: 'exists', path: ['evidence', 'light.state.observation'] })
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_EVIDENCE_GATE_INVALID',
      'The G09 Workflow requires the exact Provider evidence hard gate.',
    );

  const success = nodes.find((node) => node['nodeId'] === 'result');
  const failure = nodes.find((node) => node['nodeId'] === 'failure');
  if (
    success?.['type'] !== 'result' ||
    canonical(success['value']) !==
      canonical({ op: 'ref', path: ['nodes', expectedNodeId, 'data', 'structuredContent'] }) ||
    failure?.['type'] !== 'result' ||
    canonical(failure['value']) !== canonical({ op: 'literal', value: false })
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_RESULT_MAPPING_INVALID',
      'The G09 Workflow must return only the exact structured Provider result.',
    );
}

export function verifiedHomeLabGovernedLightOutcomeRefs(
  skill: Readonly<{
    skillId: string;
    version: number;
    outcomeSpecification?: Readonly<{
      effects: readonly string[];
      evidence: readonly string[];
      artifacts: readonly string[];
    }>;
  }>,
): Readonly<{
  effectRefs: readonly string[];
  evidenceRefs: readonly string[];
  artifactRefs: readonly string[];
}> {
  const kind = skillKind({ skillId: skill.skillId, skillVersion: skill.version });
  const expected = HOME_LAB_GOVERNED_LIGHT_OUTCOME_REFS[kind];
  const outcome = skill.outcomeSpecification;
  if (
    outcome === undefined ||
    canonical(outcome.effects) !== canonical(expected.effectRefs) ||
    canonical(outcome.evidence) !== canonical(expected.evidenceRefs) ||
    canonical(outcome.artifacts) !== canonical(expected.artifactRefs)
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_OUTCOME_AUTHORITY_INVALID',
      'The G09 Skill outcome authority must exactly cover its governed effect and observation evidence.',
    );
  return Object.freeze({
    effectRefs: Object.freeze([...outcome.effects]),
    evidenceRefs: Object.freeze([...outcome.evidence]),
    artifactRefs: Object.freeze([...outcome.artifacts]),
  });
}

export class HomeLabGovernedLightWorkflowCandidateGuard implements WorkflowCandidateGuard {
  validate(
    input: Readonly<{
      definition: WorkflowDefinition;
      skillUsagePolicy?: SkillUsagePlanPolicy;
      compositionRoot?: SkillCompositionRoot;
    }>,
  ): readonly WorkflowCandidateGuardError[] {
    const skill = input.skillUsagePolicy?.skill;
    if (skill === undefined)
      return Object.freeze([
        guardError(
          'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_IDENTITY_INVALID',
          'The G09 profile requires exact Skill Usage authority.',
        ),
      ]);
    try {
      skillKind(skill);
      if (
        input.compositionRoot !== undefined &&
        (input.compositionRoot.skillId !== skill.skillId ||
          input.compositionRoot.skillVersion !== skill.skillVersion)
      )
        invalid(
          'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_IDENTITY_INVALID',
          'The G09 composition root does not match its exact v3 Skill.',
        );
      assertHomeLabGovernedLightWorkflowContract(input.definition, skill);
      return Object.freeze([]);
    } catch (error: unknown) {
      if (error instanceof HomeLabGovernedLightWorkflowContractError)
        return Object.freeze([guardError(error.code, error.message)]);
      throw error;
    }
  }
}

function skillKind(skill: Readonly<{ skillId: string; skillVersion: number }>): 'read' | 'control' {
  if (
    skill.skillId === HOME_LAB_GOVERNED_LIGHT_SKILLS.read.skillId &&
    skill.skillVersion === HOME_LAB_GOVERNED_LIGHT_SKILLS.read.skillVersion
  )
    return 'read';
  if (
    skill.skillId === HOME_LAB_GOVERNED_LIGHT_SKILLS.control.skillId &&
    skill.skillVersion === HOME_LAB_GOVERNED_LIGHT_SKILLS.control.skillVersion
  )
    return 'control';
  return invalid(
    'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_IDENTITY_INVALID',
    'The G09 Workflow requires one exact v3 main-light Skill.',
  );
}

function controlEdges() {
  return [
    ...contextEdges('confirmControl'),
    { sourceNodeId: 'confirmControl', targetNodeId: 'setPower', outcome: 'success' },
    { sourceNodeId: 'confirmControl', targetNodeId: 'failure', outcome: 'failure' },
    { sourceNodeId: 'setPower', targetNodeId: 'evidenceLight' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
  ] as const;
}

function readEdges() {
  return [
    ...contextEdges('readLight'),
    { sourceNodeId: 'readLight', targetNodeId: 'evidenceLight' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
  ] as const;
}

function contextEdges(targetNodeId: 'confirmControl' | 'readLight') {
  return [
    {
      sourceNodeId: 'contextPublicResource',
      targetNodeId: 'contextProviderBinding',
      outcome: 'true',
    },
    { sourceNodeId: 'contextPublicResource', targetNodeId: 'failure', outcome: 'false' },
    { sourceNodeId: 'contextProviderBinding', targetNodeId, outcome: 'true' },
    { sourceNodeId: 'contextProviderBinding', targetNodeId: 'failure', outcome: 'false' },
  ] as const;
}

function projectEdges(edges: readonly Readonly<Record<string, unknown>>[]) {
  return edges.map((edge) => ({
    sourceNodeId: edge['sourceNodeId'],
    targetNodeId: edge['targetNodeId'],
    ...(edge['outcome'] === undefined ? {} : { outcome: edge['outcome'] }),
  }));
}

function guardError(
  code: HomeLabGovernedLightWorkflowContractErrorCode,
  message: string,
): WorkflowCandidateGuardError {
  return Object.freeze({ code, path: 'definition', message });
}

function object(
  value: unknown,
  code: HomeLabGovernedLightWorkflowContractErrorCode,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) invalid(code, 'The G09 Workflow candidate must be an object.');
  return value;
}

function objects(
  value: unknown,
  code: HomeLabGovernedLightWorkflowContractErrorCode,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) invalid(code, 'The G09 Workflow candidate collection is missing.');
  return value.map((item) => object(item, code));
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: HomeLabGovernedLightWorkflowContractErrorCode, message: string): never {
  throw new HomeLabGovernedLightWorkflowContractError(code, message);
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
