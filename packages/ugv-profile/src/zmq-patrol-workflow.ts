import { prepareSkillUsagePlan } from '../../application/src/skill-usage-planning.js';
import {
  parseZmqPatrolInput,
  assertZmqPatrolDeadline,
  zmqPatrolChildInput,
} from '../../domain/src/zmq-area-patrol.js';
import type {
  WorkflowBoundValue,
  WorkflowExpression,
  WorkflowNode,
  WorkflowDefinition,
} from '../../domain/src/workflow.js';
export function prepareZmqPatrolWorkflow(
  input: Parameters<typeof prepareSkillUsagePlan>[0],
  value: unknown,
  now: string,
): ReturnType<typeof prepareSkillUsagePlan> & { deterministicDefinition: WorkflowDefinition } {
  const patrolInput = parseZmqPatrolInput(value);
  assertZmqPatrolDeadline(value, now);
  const prepared = prepareSkillUsagePlan(input);
  const definition = prepared.deterministicDefinition;
  if (
    !definition ||
    prepared.policy.childPolicies.length !== 2 ||
    definition.nodes.filter((n) => n.type === 'skill_call').length !== 2 ||
    definition.nodes.some((n) => n.type === 'mcp_tool')
  )
    throw Error('ZMQ_PATROL_EXACT_COMPOSITION_REQUIRED');
  const navigation = definition.nodes.find(
    (n) => n.type === 'skill_call' && n.skillId === 'ugv.zmq.vehicle_zmq_navigate',
  );
  const next = definition.edges.find(
    (edge) => edge.sourceNodeId === navigation?.nodeId && edge.outcome === undefined,
  );
  if (!navigation || !next) throw Error('ZMQ_PATROL_NAVIGATION_ORDER_INVALID');
  const equal = (path: string[], value: string | boolean): WorkflowExpression => ({
    op: 'eq',
    left: { op: 'ref', path: ['nodes', navigation.nodeId, ...path] },
    right: { op: 'literal', value },
  });
  const checks = [
    equal(['schemaVersion'], 'sdar.zmq-skill-report/2'),
    equal(['resourceId'], patrolInput.resourceId),
    equal(['providerResult', 'nativeOutcome'], 'completed'),
    equal(['providerResult', 'stopConfirmed'], true),
  ];
  const expression = checks.reduce<WorkflowExpression>(
    (left, right) => ({ op: 'and', left, right }),
    { op: 'literal', value: true },
  );
  const gate: WorkflowNode = {
    nodeId: 'zmq_patrol_navigation_stopped',
    name: '核验导航成功及停稳',
    type: 'condition',
    expression,
  };
  return {
    ...prepared,
    deterministicDefinition: {
      ...definition,
      nodes: [
        ...definition.nodes.map((node) =>
          node.type === 'skill_call'
            ? {
                ...node,
                input: zmqPatrolChildInput(value, node.skillId) as WorkflowBoundValue,
              }
            : node.type === 'error_handler' && node.handledNodeId === navigation.nodeId
              ? { ...node, gotoNodeId: 'usage_failure' }
              : node,
        ),
        gate,
      ],
      edges: [
        ...definition.edges.map((edge) =>
          edge === next ? { ...edge, targetNodeId: gate.nodeId } : edge,
        ),
        { sourceNodeId: gate.nodeId, targetNodeId: next.targetNodeId, outcome: 'true' as const },
        { sourceNodeId: gate.nodeId, targetNodeId: 'usage_failure', outcome: 'false' as const },
      ],
    },
  };
}
