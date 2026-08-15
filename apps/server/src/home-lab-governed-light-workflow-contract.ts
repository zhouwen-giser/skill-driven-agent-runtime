import type {
  SkillUsagePlanPolicy,
  WorkflowDefinition,
} from '../../../packages/domain/src/index.js';
import type {
  WorkflowCandidateGuard,
  WorkflowCandidateGuardError,
} from '../../../packages/application/src/workflow-planner.js';
import type { SkillCompositionRoot } from '../../../packages/application/src/skill-composition.js';

import { HOME_LAB_GOVERNED_LIGHT_SERVER_ID } from './home-lab-task-understanding.js';

export const HOME_LAB_GOVERNED_LIGHT_SKILLS = Object.freeze({
  read: Object.freeze({ skillId: 'home.light.get-state', skillVersion: 2 }),
  control: Object.freeze({ skillId: 'home.light.set-power', skillVersion: 2 }),
} as const);

export const HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT =
  'Resume only after the exact task-scoped governed-control confirmation is issued.';

export type HomeLabGovernedLightWorkflowContractErrorCode =
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_IDENTITY_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_CONFIRMATION_GATE_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOOL_BINDING_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_EVIDENCE_GATE_INVALID'
  | 'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_RESULT_MAPPING_INVALID';

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
    nodes.length !== (control ? 5 : 4) ||
    value['entryNodeId'] !== (control ? 'confirmControl' : 'readLight') ||
    canonical(value['exitNodeIds']) !== canonical(['result', 'failure']) ||
    canonical(projectEdges(edges)) !== canonical(control ? controlEdges() : readEdges())
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOPOLOGY_INVALID',
      'The G09 Workflow must preserve its exact reachable confirmation/read, evidence and result topology.',
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
  const expectedArguments = {
    resourceId: { op: 'ref', path: ['input', 'skillInput', 'resourceId'] },
    ...(control ? { power: { op: 'ref', path: ['input', 'skillInput', 'power'] } } : {}),
  };
  const expectedTaskExecution = control
    ? { protocolMode: 'frozen_v1', availabilityCheck: 'required' }
    : undefined;
  if (
    mcpNodes.length !== 1 ||
    mcp?.['nodeId'] !== expectedNodeId ||
    tool?.['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    tool['toolName'] !== expectedTool ||
    canonical(mcp['arguments']) !== canonical(expectedArguments) ||
    canonical(mcp['taskExecution']) !== canonical(expectedTaskExecution)
  )
    invalid(
      'HOME_LAB_GOVERNED_LIGHT_WORKFLOW_TOOL_BINDING_INVALID',
      'The G09 Workflow requires one exact v2 light Tool, authoritative input refs and task semantics.',
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
          'The G09 composition root does not match its exact v2 Skill.',
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
    'The G09 Workflow requires one exact v2 main-light Skill.',
  );
}

function controlEdges() {
  return [
    { sourceNodeId: 'confirmControl', targetNodeId: 'setPower', outcome: 'success' },
    { sourceNodeId: 'confirmControl', targetNodeId: 'failure', outcome: 'failure' },
    { sourceNodeId: 'setPower', targetNodeId: 'evidenceLight' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
  ] as const;
}

function readEdges() {
  return [
    { sourceNodeId: 'readLight', targetNodeId: 'evidenceLight' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'result', outcome: 'true' },
    { sourceNodeId: 'evidenceLight', targetNodeId: 'failure', outcome: 'false' },
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
