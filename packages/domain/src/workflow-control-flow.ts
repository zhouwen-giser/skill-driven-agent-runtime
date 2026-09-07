import { analyzeWorkflowRegions, type WorkflowRegionIssue } from './workflow-regions.js';
import type { WorkflowDefinition } from './workflow.js';

export interface WorkflowControlFlowIssue {
  readonly code:
    | 'WORKFLOW_CONDITION_EDGES_INVALID'
    | 'WORKFLOW_LOOP_EDGES_INVALID'
    | WorkflowRegionIssue['code'];
  readonly path: string;
  readonly message: string;
}

/** Pure route checks shared by admission and compilation; this module never schedules work. */
function validateControlRoutes(
  definition: WorkflowDefinition,
): readonly WorkflowControlFlowIssue[] {
  const issues: WorkflowControlFlowIssue[] = [];
  for (const node of definition.nodes) {
    const outgoing = definition.edges.filter((edge) => edge.sourceNodeId === node.nodeId);
    if (node.type === 'condition') {
      if (
        outgoing.length !== 2 ||
        outgoing.filter((edge) => edge.outcome === 'true').length !== 1 ||
        outgoing.filter((edge) => edge.outcome === 'false').length !== 1
      )
        issues.push({
          code: 'WORKFLOW_CONDITION_EDGES_INVALID',
          path: `nodes.${node.nodeId}`,
          message: 'Condition requires exactly one true and one false edge.',
        });
    }
    if (node.type === 'loop') {
      // The body reference is an implicit route. An explicit loop edge may mirror it.
      const bodyEdges = outgoing.filter((edge) => edge.outcome === 'loop');
      if (
        outgoing.filter((edge) => edge.outcome === 'done').length !== 1 ||
        bodyEdges.length > 1 ||
        bodyEdges.some((edge) => edge.targetNodeId !== node.bodyEntryNodeId) ||
        outgoing.some((edge) => edge.outcome !== 'loop' && edge.outcome !== 'done')
      )
        issues.push({
          code: 'WORKFLOW_LOOP_EDGES_INVALID',
          path: `nodes.${node.nodeId}`,
          message:
            'Loop requires exactly one done edge and at most one loop edge matching its body.',
        });
    }
  }
  return issues;
}

export function analyzeWorkflowControlFlow(definition: WorkflowDefinition) {
  const analysis =
    definition.executionSemanticsVersion === '2.0'
      ? analyzeWorkflowRegions(definition)
      : { issues: [], routes: [], loops: [], parallels: [] };
  return { ...analysis, issues: [...validateControlRoutes(definition), ...analysis.issues] };
}

export function validateWorkflowControlFlow(
  definition: WorkflowDefinition,
): readonly WorkflowControlFlowIssue[] {
  return analyzeWorkflowControlFlow(definition).issues;
}
