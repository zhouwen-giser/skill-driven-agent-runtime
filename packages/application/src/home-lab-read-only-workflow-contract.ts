import type { SkillUsagePlanPolicy, WorkflowDefinition } from '../../domain/src/index.js';
import type { WorkflowCandidateGuard, WorkflowCandidateGuardError } from './workflow-planner.js';
import type { SkillCompositionRoot } from './skill-composition.js';

export const HOME_LAB_READ_ONLY_COMPOSITE_SKILL = Object.freeze({
  skillId: 'home.living-room.get-state',
  skillVersion: 1,
} as const);

const OPERATIONS = Object.freeze([
  Object.freeze({
    nodeId: 'mainLight',
    serverId: 'home-lab-light-mcp',
    toolName: 'light_get_state',
    inputField: 'mainLightResourceId',
  }),
  Object.freeze({
    nodeId: 'climate',
    serverId: 'home-lab-climate-mcp',
    toolName: 'climate_get_state',
    inputField: 'climateResourceId',
  }),
] as const);

export type HomeLabReadOnlyWorkflowContractErrorCode =
  | 'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID'
  | 'HOME_LAB_READ_ONLY_WORKFLOW_TOOL_BINDING_INVALID'
  | 'HOME_LAB_READ_ONLY_WORKFLOW_EVIDENCE_GATE_INVALID'
  | 'HOME_LAB_READ_ONLY_WORKFLOW_RESULT_MAPPING_INVALID';

export class HomeLabReadOnlyWorkflowContractError extends Error {
  readonly code: HomeLabReadOnlyWorkflowContractErrorCode;
  constructor(code: HomeLabReadOnlyWorkflowContractErrorCode, message: string) {
    super(message);
    this.name = 'HomeLabReadOnlyWorkflowContractError';
    this.code = code;
  }
}

export function assertHomeLabReadOnlyWorkflowContract(definition: unknown): void {
  const value = object(definition, 'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID');
  const nodes = objects(value['nodes'], 'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID');
  const edges = objects(value['edges'], 'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID');
  if (
    nodes.length !== 6 ||
    value['entryNodeId'] !== 'mainLight' ||
    canonical(value['exitNodeIds']) !== canonical(['result', 'failure']) ||
    canonical(
      edges.map((edge) => ({
        sourceNodeId: edge['sourceNodeId'],
        targetNodeId: edge['targetNodeId'],
        ...(edge['outcome'] === undefined ? {} : { outcome: edge['outcome'] }),
      })),
    ) !== canonical(expectedEdges())
  )
    invalid(
      'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID',
      'The composite Workflow must preserve the exact reachable six-node topology.',
    );

  const mcpNodes = nodes.filter((node) => node['type'] === 'mcp_tool');
  if (
    mcpNodes.length !== OPERATIONS.length ||
    OPERATIONS.some((operation) => {
      const matches = mcpNodes.filter((node) => {
        const tool = isObject(node['tool']) ? node['tool'] : undefined;
        return (
          node['nodeId'] === operation.nodeId &&
          tool?.['serverId'] === operation.serverId &&
          tool['toolName'] === operation.toolName &&
          node['taskExecution'] === undefined &&
          canonical(node['arguments']) ===
            canonical({
              resourceId: {
                op: 'ref',
                path: ['input', 'skillInput', operation.inputField],
              },
            })
        );
      });
      return matches.length !== 1;
    })
  )
    invalid(
      'HOME_LAB_READ_ONLY_WORKFLOW_TOOL_BINDING_INVALID',
      'Both exact synchronous read Tools require their fixed authoritative resource references.',
    );

  const expectedGates = [
    {
      nodeId: 'evidenceMainLight',
      expression: { op: 'exists', path: ['evidence', 'light.state.observation'] },
    },
    {
      nodeId: 'evidenceClimate',
      expression: { op: 'exists', path: ['evidence', 'climate.state.observation'] },
    },
  ] as const;
  if (
    expectedGates.some((expected) => {
      const node = nodes.find((candidate) => candidate['nodeId'] === expected.nodeId);
      return (
        node?.['type'] !== 'condition' ||
        canonical(node['expression']) !== canonical(expected.expression)
      );
    })
  )
    invalid(
      'HOME_LAB_READ_ONLY_WORKFLOW_EVIDENCE_GATE_INVALID',
      'Both exact Provider evidence keys require structural false-to-failure gates.',
    );

  const success = nodes.find((node) => node['nodeId'] === 'result');
  const failure = nodes.find((node) => node['nodeId'] === 'failure');
  if (
    success?.['type'] !== 'result' ||
    canonical(success['value']) !== canonical({ op: 'ref', path: ['outputs'] }) ||
    failure?.['type'] !== 'result' ||
    canonical(failure['value']) !== canonical({ op: 'literal', value: false })
  )
    invalid(
      'HOME_LAB_READ_ONLY_WORKFLOW_RESULT_MAPPING_INVALID',
      'Success must return the fixed outputs projection and evidence failure must return false.',
    );
}

export class HomeLabReadOnlyWorkflowCandidateGuard implements WorkflowCandidateGuard {
  validate(
    input: Readonly<{
      definition: WorkflowDefinition;
      skillUsagePolicy?: SkillUsagePlanPolicy;
      compositionRoot?: SkillCompositionRoot;
    }>,
  ): readonly WorkflowCandidateGuardError[] {
    if (
      input.skillUsagePolicy?.skill.skillId !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillId ||
      input.skillUsagePolicy.skill.skillVersion !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillVersion
    )
      return Object.freeze([
        contractGuardError(
          'HOME_LAB_READ_ONLY_WORKFLOW_TOOL_BINDING_INVALID',
          'The home-lab profile requires the exact composite Skill version.',
        ),
      ]);
    if (
      input.compositionRoot !== undefined &&
      (input.compositionRoot.skillId !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillId ||
        input.compositionRoot.skillVersion !== HOME_LAB_READ_ONLY_COMPOSITE_SKILL.skillVersion)
    )
      return Object.freeze([
        contractGuardError(
          'HOME_LAB_READ_ONLY_WORKFLOW_TOOL_BINDING_INVALID',
          'The home-lab profile rejects a mismatched composition root.',
        ),
      ]);
    try {
      assertHomeLabReadOnlyWorkflowContract(input.definition);
      return Object.freeze([]);
    } catch (error: unknown) {
      if (error instanceof HomeLabReadOnlyWorkflowContractError)
        return Object.freeze([contractGuardError(error.code, error.message)]);
      throw error;
    }
  }
}

function expectedEdges() {
  return [
    { sourceNodeId: 'mainLight', targetNodeId: 'evidenceMainLight' },
    { sourceNodeId: 'evidenceMainLight', targetNodeId: 'climate', outcome: 'true' },
    { sourceNodeId: 'evidenceMainLight', targetNodeId: 'failure', outcome: 'false' },
    { sourceNodeId: 'climate', targetNodeId: 'evidenceClimate' },
    { sourceNodeId: 'evidenceClimate', targetNodeId: 'result', outcome: 'true' },
    { sourceNodeId: 'evidenceClimate', targetNodeId: 'failure', outcome: 'false' },
  ] as const;
}

function contractGuardError(
  code: HomeLabReadOnlyWorkflowContractErrorCode,
  message: string,
): WorkflowCandidateGuardError {
  return Object.freeze({ code, path: 'definition', message });
}

function object(
  value: unknown,
  code: HomeLabReadOnlyWorkflowContractErrorCode,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) invalid(code, 'The Workflow candidate must be an object.');
  return value;
}

function objects(
  value: unknown,
  code: HomeLabReadOnlyWorkflowContractErrorCode,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) invalid(code, 'The Workflow candidate collection is missing.');
  return value.map((item) => object(item, code));
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: HomeLabReadOnlyWorkflowContractErrorCode, message: string): never {
  throw new HomeLabReadOnlyWorkflowContractError(code, message);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
