import type { WorkflowDefinition } from '../../domain/src/workflow.js';

/** GOWM 078 validates PLAN_NODE owners against nodes[].id. Keep the native DSL
 * intact and add only this storage alias; it is never exposed to the compiler. */
export function encodeGowmWorkflowDefinition(definition: WorkflowDefinition): unknown {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if ('id' in node) throw new GowmWorkflowDefinitionError();
      return { ...node, id: node.nodeId };
    }),
  };
}

/** Used by every persisted-plan reader, including confirmation hash readers.
 * Legacy definitions without aliases remain byte-semantically unchanged. */
export function decodeGowmWorkflowDefinition(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value['nodes'])) return value;
  return {
    ...value,
    nodes: value['nodes'].map((node: unknown) => {
      if (!isRecord(node) || !Object.hasOwn(node, 'id') || !Object.hasOwn(node, 'nodeId'))
        return node;
      if (typeof node['nodeId'] !== 'string' || node['id'] !== node['nodeId'])
        throw new GowmWorkflowDefinitionError();
      const restored = { ...node };
      delete restored['id'];
      return restored;
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class GowmWorkflowDefinitionError extends Error {
  readonly code = 'GOWM_WORKFLOW_NODE_ALIAS_CONFLICT';
  constructor() {
    super('GOWM_WORKFLOW_NODE_ALIAS_CONFLICT');
    this.name = 'GowmWorkflowDefinitionError';
  }
}
