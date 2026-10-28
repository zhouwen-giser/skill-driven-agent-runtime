import { reviewedZmqCatalog, type ZmqCatalogProfile } from './zmq-catalogs.js';
import {
  prepareSkillUsagePlan,
  type JsonSchemaValidator,
  type PreparedSkillUsagePlan,
} from '../../application/src/index.js';
import {
  nativeZmqTaskExecution,
  zmqToolForSkill,
  ZMQ_NATIVE_CONTROLS,
} from '../../domain/src/zmq-capability.js';
import { zmqToolArguments } from './zmq-provider-profile.js';
import type { WorkflowBoundValue } from '../../domain/src/workflow.js';

export function prepareNativeZmqWorkflow(
  input: Parameters<typeof prepareSkillUsagePlan>[0],
  skillInput: unknown,
  schemas: Pick<JsonSchemaValidator, 'validate'>,
  now: string,
): PreparedSkillUsagePlan {
  const name = zmqToolForSkill(input.skill.skillId);
  if (
    !name ||
    !schemas.validate(input.skill.inputSchema, skillInput).valid ||
    typeof skillInput !== 'object' ||
    skillInput === null ||
    Array.isArray(skillInput)
  )
    throw Error('ZMQ_FROZEN_SKILL_INPUT_INVALID');
  const value = skillInput as Readonly<Record<string, unknown>>;
  if (typeof value['resourceId'] !== 'string') throw Error('ZMQ_FROZEN_SKILL_INPUT_INVALID');
  const declaredProfile = input.skill.outcomeSpecification?.taskGoalPolicy['catalogProfile'];
  const profile = (declaredProfile ?? 'zmq_v1_0_1_12') as ZmqCatalogProfile;
  reviewedZmqCatalog(profile);
  const args = zmqToolArguments(name, value, value['resourceId'], schemas, profile);
  const execution = ZMQ_NATIVE_CONTROLS.has(name)
    ? nativeZmqTaskExecution(value['timeWindow'], now, profile === 'zmq_v1_0_1_12' ? 30000 : 60000)
    : undefined;
  const prepared = prepareSkillUsagePlan(input),
    definition = prepared.deterministicDefinition;
  if (
    definition?.nodes.filter((n) => n.type === 'mcp_tool').length !== 1 ||
    prepared.policy.taskOperations.length !== 1 ||
    prepared.policy.taskOperations[0]?.operationName !== name
  )
    throw Error('ZMQ_DETERMINISTIC_PROCEDURE_REQUIRED');
  return {
    ...prepared,
    deterministicDefinition: {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.type !== 'mcp_tool'
          ? node
          : {
              ...node,
              arguments: literalArguments(args),
              ...(execution === undefined ? {} : { taskExecution: execution }),
            },
      ),
    },
  };
}

function literalArguments(value: unknown): WorkflowBoundValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value)) return value.map(literalArguments);
  if (typeof value === 'object') {
    if (Object.hasOwn(value, 'op')) throw Error('ZMQ_ARGUMENT_EXPRESSION_FORBIDDEN');
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, literalArguments(item)]),
    );
  }
  throw Error('ZMQ_ARGUMENT_JSON_INVALID');
}
