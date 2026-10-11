import { useEffect, useMemo, useState } from 'react';

import { managementRequest } from './api.js';
import {
  WorkflowNodeParameters,
  workflowNodeFields,
  isEditableNodeType,
  type EditableNodeType,
} from './WorkflowNodeParameters.js';

interface WorkflowNodeRecord {
  readonly [key: string]: unknown;
  readonly nodeId: string;
  readonly name: string;
  readonly type: string;
  readonly tool?: Readonly<{ serverId: string; toolName: string }>;
}
interface WorkflowEdgeRecord {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly outcome?: string;
}
interface WorkflowDefinitionRecord {
  readonly workflowDefinitionId: string;
  readonly version: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly entryNodeId: string;
  readonly exitNodeIds: readonly string[];
  readonly nodes: readonly WorkflowNodeRecord[];
  readonly edges: readonly WorkflowEdgeRecord[];
}
interface WorkflowPlanRecord {
  readonly planId: string;
  readonly confirmationStatus: string;
  readonly sourcePlanId?: string;
  readonly revisionKind?: string;
  readonly definition?: WorkflowDefinitionRecord;
  readonly toolExecutionSemantics?: readonly Readonly<{
    reference: Readonly<{ serverId: string; toolName: string }>;
    executionSemantics: WorkflowToolSemanticsRecord['executionSemantics'];
  }>[];
}
interface WorkflowTraceRecord {
  readonly instance: Readonly<{
    instanceId: string;
    planId: string;
    status: string;
    result?: unknown;
    errors: unknown;
  }>;
  readonly events: readonly Readonly<{
    sequence: number;
    nodeId: string;
    eventType: string;
    timestamp: string;
    durationMs?: number;
    summary: string;
  }>[];
}
interface TaskReadinessResponse {
  readonly warning: string;
  readonly items: readonly Readonly<{
    readiness: Readonly<{
      readinessId: string;
      checkPhase: 'planning' | 'pre_invocation';
      disposition: string;
      guardAction: string;
      confirmationRequired: boolean;
      createdAt: string;
    }>;
    snapshots: readonly Readonly<{
      snapshotId: string;
      nodeId: string;
      operationName: string;
      argumentsHash: string;
      timing?: Readonly<{
        start: Readonly<{
          mode: 'immediate' | 'scheduled';
          scheduledAt?: string;
          startToleranceMs: number;
        }>;
        maxElapsedMs: number | null;
      }>;
      availability: string;
      riskLevel: string;
      validUntil?: string;
      earliestStartTime?: string;
      nextAvailableWindows: readonly Readonly<{ startTime: string; endTime: string }>[];
      estimatedDelayMs?: number;
      reservationMode: 'none' | 'best_effort' | 'guaranteed';
      reservationRef?: string;
      checkedAt: string;
    }>[];
  }>[];
}

type VisualWorkflowEdit =
  | Readonly<{ kind: 'add_node'; nodeId: string; type: EditableNodeType }>
  | Readonly<{ kind: 'remove_node'; nodeId: string }>
  | Readonly<{ kind: 'change_type'; nodeId: string; type: EditableNodeType }>
  | Readonly<{
      kind: 'configure_node';
      nodeId: string;
      parameters: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{ kind: 'rename_node'; nodeId: string; name: string }>
  | Readonly<{ kind: 'set_entry'; nodeId: string }>
  | Readonly<{ kind: 'toggle_exit'; nodeId: string }>
  | Readonly<{
      kind: 'update_edge';
      edgeIndex: number;
      field: 'sourceNodeId' | 'targetNodeId' | 'outcome';
      value: string;
    }>
  | Readonly<{ kind: 'add_edge' }>
  | Readonly<{ kind: 'remove_edge'; edgeIndex: number }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseVisualWorkflowDefinition(
  editor: string,
): WorkflowDefinitionRecord | undefined {
  try {
    const value: unknown = JSON.parse(editor);
    if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges))
      return undefined;
    const nodes = value.nodes.filter(
      (node): node is Record<string, unknown> =>
        isObject(node) &&
        typeof node.nodeId === 'string' &&
        typeof node.name === 'string' &&
        typeof node.type === 'string',
    );
    const edges = value.edges.filter(
      (edge): edge is Record<string, unknown> =>
        isObject(edge) &&
        typeof edge.sourceNodeId === 'string' &&
        typeof edge.targetNodeId === 'string',
    );
    if (
      nodes.length !== value.nodes.length ||
      edges.length !== value.edges.length ||
      typeof value.workflowDefinitionId !== 'string' ||
      typeof value.version !== 'number' ||
      typeof value.goalId !== 'string' ||
      typeof value.goalVersion !== 'number' ||
      typeof value.entryNodeId !== 'string' ||
      !Array.isArray(value.exitNodeIds) ||
      !value.exitNodeIds.every((item) => typeof item === 'string')
    ) {
      return undefined;
    }
    return {
      workflowDefinitionId: value.workflowDefinitionId,
      version: value.version,
      goalId: value.goalId,
      goalVersion: value.goalVersion,
      entryNodeId: value.entryNodeId,
      exitNodeIds: value.exitNodeIds,
      nodes: nodes.map((node) => ({
        ...node,
        nodeId: String(node.nodeId),
        name: String(node.name),
        type: String(node.type),
        ...(isObject(node.tool) &&
        typeof node.tool.serverId === 'string' &&
        typeof node.tool.toolName === 'string'
          ? { tool: { serverId: node.tool.serverId, toolName: node.tool.toolName } }
          : {}),
      })),
      edges: edges.map((edge) => ({
        sourceNodeId: String(edge.sourceNodeId),
        targetNodeId: String(edge.targetNodeId),
        ...(typeof edge.outcome === 'string' ? { outcome: edge.outcome } : {}),
      })),
    };
  } catch {
    return undefined;
  }
}

export function applyVisualWorkflowEdit(editor: string, edit: VisualWorkflowEdit): string {
  const value: unknown = JSON.parse(editor);
  if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('WORKFLOW_VISUAL_EDITOR_INVALID_DSL');
  }
  const rawNodes = value.nodes as unknown[];
  const rawEdges = value.edges as unknown[];
  const nodes: unknown[] = rawNodes.map((node) => (isObject(node) ? { ...node } : node));
  let edges: unknown[] = rawEdges.map((edge) => (isObject(edge) ? { ...edge } : edge));
  const result: Record<string, unknown> = { ...value, nodes, edges };

  if (
    'nodeId' in edit &&
    edit.kind !== 'add_node' &&
    !nodes.some((node) => isObject(node) && node.nodeId === edit.nodeId)
  )
    throw new Error('Node does not exist in this draft');
  if (edit.kind === 'add_node') {
    if (
      !/^[A-Za-z0-9_.:-]+$/u.test(edit.nodeId) ||
      nodes.some((node) => isObject(node) && node.nodeId === edit.nodeId)
    )
      throw new Error(
        'Provide a unique node ID using letters, numbers, dots, colons, underscores or hyphens',
      );
    result.nodes = [...nodes, { nodeId: edit.nodeId, name: edit.nodeId, type: edit.type }];
    if (nodes.length === 0) result.entryNodeId = edit.nodeId;
  } else if (edit.kind === 'remove_node') {
    if (nodes.length <= 1) throw new Error('Keep at least one Workflow node');
    const referenced = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(referenced);
      if (!isObject(value)) return false;
      for (const [key, child] of Object.entries(value)) {
        if (
          ['bodyEntryNodeId', 'joinNodeId', 'handledNodeId', 'gotoNodeId', 'targetNodeId'].includes(
            key,
          ) &&
          child === edit.nodeId
        )
          return true;
        if (key === 'branchEntryNodeIds' && Array.isArray(child) && child.includes(edit.nodeId))
          return true;
        if (key === 'path' && Array.isArray(child) && child.includes(edit.nodeId)) return true;
        if (referenced(child)) return true;
      }
      return false;
    };
    if (nodes.some((node) => isObject(node) && node.nodeId !== edit.nodeId && referenced(node)))
      throw new Error('Update node expressions and control references before removing this node');
    result.nodes = nodes.filter((node) => !isObject(node) || node.nodeId !== edit.nodeId);
    result.edges = edges.filter(
      (edge) =>
        !isObject(edge) || (edge.sourceNodeId !== edit.nodeId && edge.targetNodeId !== edit.nodeId),
    );
    if (value.entryNodeId === edit.nodeId)
      result.entryNodeId = nodes
        .filter(isObject)
        .find((node) => node.nodeId !== edit.nodeId)?.nodeId;
    result.exitNodeIds = Array.isArray(value.exitNodeIds)
      ? value.exitNodeIds.filter((id) => id !== edit.nodeId)
      : [];
  } else if (edit.kind === 'change_type') {
    result.nodes = nodes.map((node) =>
      isObject(node) && node.nodeId === edit.nodeId
        ? { nodeId: node.nodeId, name: node.name, type: edit.type }
        : node,
    );
  } else if (edit.kind === 'configure_node') {
    result.nodes = nodes.map((node) => {
      if (!isObject(node) || node.nodeId !== edit.nodeId) return node;
      if (typeof node.type !== 'string' || !isEditableNodeType(node.type))
        throw new Error('Unknown node type');
      const keys = workflowNodeFields[node.type].map((field) => field.key);
      if (Object.keys(edit.parameters).some((key) => !keys.includes(key as (typeof keys)[number])))
        throw new Error('Parameter does not belong to this node type');
      const updated = Object.fromEntries(
        Object.entries(node).filter(([key]) => !keys.includes(key as (typeof keys)[number])),
      );
      return { ...updated, ...edit.parameters };
    });
  } else if (edit.kind === 'rename_node') {
    result.nodes = nodes.map((node) =>
      isObject(node) && node.nodeId === edit.nodeId ? { ...node, name: edit.name } : node,
    );
  } else if (edit.kind === 'set_entry') {
    result.entryNodeId = edit.nodeId;
  } else if (edit.kind === 'toggle_exit') {
    const exits = Array.isArray(value.exitNodeIds)
      ? (value.exitNodeIds as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];
    result.exitNodeIds = exits.includes(edit.nodeId)
      ? exits.filter((nodeId) => nodeId !== edit.nodeId)
      : [...exits, edit.nodeId];
  } else if (edit.kind === 'update_edge') {
    edges = edges.map((edge, index) => {
      if (index !== edit.edgeIndex || !isObject(edge)) return edge;
      if (edit.field === 'outcome' && edit.value === '') {
        const remaining = { ...edge };
        delete remaining.outcome;
        return remaining;
      }
      return { ...edge, [edit.field]: edit.value };
    });
    result.edges = edges;
  } else if (edit.kind === 'remove_edge') {
    result.edges = edges.filter((_edge, index) => index !== edit.edgeIndex);
  } else {
    const nodeIds = nodes
      .filter(isObject)
      .map((node) => node.nodeId)
      .filter((nodeId): nodeId is string => typeof nodeId === 'string');
    if (nodeIds.length < 2) throw new Error('WORKFLOW_VISUAL_EDITOR_REQUIRES_TWO_NODES');
    result.edges = [...edges, { sourceNodeId: nodeIds[0], targetNodeId: nodeIds[1] }];
  }
  return JSON.stringify(result, null, 2);
}

export function WorkflowEventDuration({ durationMs }: { readonly durationMs: number | undefined }) {
  return durationMs === undefined ? null : <small>Node duration · {durationMs} ms</small>;
}

interface WorkflowToolSemanticsRecord {
  readonly serverId: string;
  readonly toolName: string;
  readonly executionSemantics: Readonly<{
    effect: string;
    execution: string;
    cancellation: string;
    idempotency: string;
    replay: string;
    source: string;
  }>;
}

export function WorkflowToolSemanticsSummary({
  items,
}: {
  readonly items: readonly WorkflowToolSemanticsRecord[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="panel" aria-label="Plan confirmation Tool execution semantics">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CONFIRMATION AUTHORITY</span>
          <h2>Tool execution semantics</h2>
        </div>
      </div>
      <div className="record-list">
        {items.map((item) => (
          <article key={`${item.serverId}/${item.toolName}`}>
            <strong>
              {item.serverId} / {item.toolName}
            </strong>
            <small>
              {item.executionSemantics.effect} · {item.executionSemantics.execution} · replay{' '}
              {item.executionSemantics.replay} · source {item.executionSemantics.source}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowPanel({
  initialPlanId,
  onOpenTask,
}: {
  readonly initialPlanId?: string;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const [planId, setPlanId] = useState(initialPlanId ?? '');
  const [instanceId, setInstanceId] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [plan, setPlan] = useState<WorkflowPlanRecord>();
  const [trace, setTrace] = useState<WorkflowTraceRecord>();
  const [editor, setEditor] = useState('');
  const [validation, setValidation] = useState<unknown>();
  const [pendingNodes, setPendingNodes] = useState<readonly string[]>([]);
  const [newNodeId, setNewNodeId] = useState('');
  const [newNodeType, setNewNodeType] = useState<EditableNodeType>('result');
  const [message, setMessage] = useState<string>();
  const [replayIndex, setReplayIndex] = useState(0);
  const [linkedTaskId, setLinkedTaskId] = useState<string>();
  const [taskReadiness, setTaskReadiness] = useState<TaskReadinessResponse>();
  const replayEvents = trace?.events.slice(0, replayIndex) ?? [];
  const nodeStates = useMemo(
    () => new Map(replayEvents.map((event) => [event.nodeId, event.eventType])),
    [replayEvents],
  );
  const visualDefinition = useMemo(() => parseVisualWorkflowDefinition(editor), [editor]);
  const definition = visualDefinition ?? plan?.definition;

  async function loadPlanById(id: string) {
    await run(async () => {
      const loaded = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(id)}`,
      );
      const linked = await managementRequest<{
        readonly items: readonly Readonly<{ taskId: string }>[];
      }>(`/api/v1/tasks?planId=${encodeURIComponent(id)}&limit=1`);
      const readiness = await managementRequest<TaskReadinessResponse>(
        `/api/v1/workflows/plans/${encodeURIComponent(id)}/task-readiness?limit=100`,
      );
      setPendingNodes([]);
      setValidation(undefined);
      setPlan(loaded);
      setTaskReadiness(readiness);
      setLinkedTaskId(linked.items[0]?.taskId);
      setEditor(loaded.definition === undefined ? '' : JSON.stringify(loaded.definition, null, 2));
      return `${loaded.planId}: plan loaded`;
    });
  }
  async function loadPlan(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadPlanById(planId);
  }
  useEffect(() => {
    if (initialPlanId !== undefined) void loadPlanById(initialPlanId);
  }, [initialPlanId]);
  async function validate() {
    await run(async () => {
      const result = await managementRequest('/api/v1/workflows/validate', {
        method: 'POST',
        body: editor,
      });
      setValidation(result);
      return 'DSL validation completed without execution.';
    });
  }
  async function revise() {
    await run(async () => {
      if (plan?.definition === undefined) throw new Error('Load a plan before creating a revision');
      const definition = prepareWorkflowRevision(editor, plan.definition);
      const revised = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(plan.planId)}/revisions`,
        { method: 'POST', body: JSON.stringify({ newPlanId, format: 'dag', definition }) },
      );
      setValidation(undefined);
      setPendingNodes([]);
      setPlan(revised);
      setPlanId(revised.planId);
      setEditor(JSON.stringify(revised.definition, null, 2));
      return `${revised.planId}: immutable revision created; confirmation required.`;
    });
  }
  async function confirm() {
    await run(async () => {
      const confirmed = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(plan?.planId ?? '')}/confirm`,
        { method: 'POST' },
      );
      setPlan(confirmed);
      return `${confirmed.planId}: confirmed.`;
    });
  }
  async function loadTrace(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const loaded = await managementRequest<WorkflowTraceRecord>(
        `/api/v1/workflows/instances/${encodeURIComponent(instanceId)}`,
      );
      setTrace(loaded);
      setReplayIndex(loaded.events.length);
      return `${loaded.instance.instanceId}: ${String(loaded.events.length)} node events loaded.`;
    });
  }
  async function run(operation: () => Promise<string>) {
    try {
      setMessage(await operation());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Workflow operation failed.');
    }
  }

  const visualEditingEnabled = visualDefinition !== undefined && pendingNodes.length === 0;
  const draftChanged = workflowDraftChanged(editor, plan?.definition);
  function editGraph(edit: VisualWorkflowEdit) {
    try {
      setEditor(applyVisualWorkflowEdit(editor, edit));
      setValidation(undefined);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workflow edit failed');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">IMMUTABLE PLAN WORKBENCH</span>
            <h2>Workflow DAG & Replay</h2>
          </div>
          {plan === undefined ? null : <span className="status ok">{plan.confirmationStatus}</span>}
        </div>
        <div className="split-lookup">
          <form className="lookup" onSubmit={(event) => void loadPlan(event)}>
            <label>
              Plan ID
              <input
                required
                value={planId}
                onChange={(event) => {
                  setPlanId(event.target.value);
                }}
              />
            </label>
            <button type="submit">载入计划</button>
          </form>
          <form className="lookup" onSubmit={(event) => void loadTrace(event)}>
            <label>
              Instance ID
              <input
                required
                value={instanceId}
                onChange={(event) => {
                  setInstanceId(event.target.value);
                }}
              />
            </label>
            <button type="submit">载入轨迹</button>
          </form>
        </div>
        {message === undefined ? null : <p className="action-message">{message}</p>}
        <WorkflowTaskLink taskId={linkedTaskId} onOpenTask={onOpenTask} />
      </section>
      <WorkflowToolSemanticsSummary
        items={(plan?.toolExecutionSemantics ?? []).map((snapshot) => ({
          ...snapshot.reference,
          executionSemantics: snapshot.executionSemantics,
        }))}
      />
      <TaskReadinessPanel evidence={taskReadiness} />
      {definition === undefined ? null : (
        <section className="workflow-grid">
          <div className="panel dag-board">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  {definition.workflowDefinitionId} · V{definition.version}
                </span>
                <h2>Workflow draft</h2>
              </div>
              <span>
                {definition.nodes.length} nodes / {definition.edges.length} edges
              </span>
            </div>
            <div className="visual-editor-note">
              Visual edits update the restricted DSL draft only. Validate and create an immutable
              revision before confirmation.
            </div>
            <form
              className="action-row"
              onSubmit={(event) => {
                event.preventDefault();
                editGraph({ kind: 'add_node', nodeId: newNodeId.trim(), type: newNodeType });
              }}
            >
              <label>
                New node ID
                <input
                  required
                  value={newNodeId}
                  disabled={!visualEditingEnabled}
                  onChange={(event) => {
                    setNewNodeId(event.target.value);
                  }}
                />
              </label>
              <label>
                Node type
                <select
                  value={newNodeType}
                  disabled={!visualEditingEnabled}
                  onChange={(event) => {
                    if (isEditableNodeType(event.target.value)) setNewNodeType(event.target.value);
                  }}
                >
                  {Object.keys(workflowNodeFields).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!visualEditingEnabled} type="submit">
                Add node
              </button>
            </form>
            <div className="dag-nodes" aria-label="Visual Workflow editor">
              {definition.nodes.map((node, index) => (
                <article
                  key={node.nodeId}
                  className={`dag-node ${nodeStates.get(node.nodeId) ?? ''}`}
                  style={{ '--node-order': index } as React.CSSProperties}
                >
                  <label>
                    Type (changing type clears parameters)
                    <select
                      aria-label={`Node ${node.nodeId} type`}
                      value={node.type}
                      disabled={!visualEditingEnabled}
                      onChange={(event) => {
                        if (isEditableNodeType(event.target.value))
                          editGraph({
                            kind: 'change_type',
                            nodeId: node.nodeId,
                            type: event.target.value,
                          });
                      }}
                    >
                      {!isEditableNodeType(node.type) ? (
                        <option value={node.type}>{node.type}</option>
                      ) : null}
                      {Object.keys(workflowNodeFields).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Node name
                    <input
                      aria-label={`Node ${node.nodeId} name`}
                      disabled={!visualEditingEnabled}
                      value={node.name}
                      onChange={(event) => {
                        setEditor(
                          applyVisualWorkflowEdit(editor, {
                            kind: 'rename_node',
                            nodeId: node.nodeId,
                            name: event.target.value,
                          }),
                        );
                      }}
                    />
                  </label>
                  <code>{node.nodeId}</code>
                  <WorkflowNodeParameters
                    key={`${plan?.planId ?? ''}:${JSON.stringify(node)}`}
                    node={node}
                    disabled={
                      visualDefinition === undefined ||
                      pendingNodes.some((id) => id !== node.nodeId)
                    }
                    onApply={(parameters) => {
                      editGraph({ kind: 'configure_node', nodeId: node.nodeId, parameters });
                    }}
                    onPending={(pending) => {
                      setPendingNodes((ids) =>
                        pending
                          ? [...new Set([...ids, node.nodeId])]
                          : ids.filter((id) => id !== node.nodeId),
                      );
                    }}
                  />
                  <button
                    type="button"
                    disabled={!visualEditingEnabled || definition.nodes.length <= 1}
                    aria-label={`Remove node ${node.nodeId}`}
                    onClick={() => {
                      editGraph({ kind: 'remove_node', nodeId: node.nodeId });
                    }}
                  >
                    Remove node
                  </button>

                  <label className="node-marker">
                    <input
                      type="radio"
                      disabled={!visualEditingEnabled}
                      name="workflow-entry"
                      checked={definition.entryNodeId === node.nodeId}
                      onChange={() => {
                        setEditor(
                          applyVisualWorkflowEdit(editor, {
                            kind: 'set_entry',
                            nodeId: node.nodeId,
                          }),
                        );
                      }}
                    />
                    ENTRY
                  </label>
                  <label className="node-marker">
                    <input
                      type="checkbox"
                      disabled={!visualEditingEnabled}
                      checked={definition.exitNodeIds.includes(node.nodeId)}
                      onChange={() => {
                        setEditor(
                          applyVisualWorkflowEdit(editor, {
                            kind: 'toggle_exit',
                            nodeId: node.nodeId,
                          }),
                        );
                      }}
                    />
                    EXIT
                  </label>
                </article>
              ))}
            </div>
            <div className="edge-list" aria-label="Workflow edges">
              {definition.edges.map((edge, index) => (
                <div key={`${edge.sourceNodeId}-${edge.targetNodeId}-${String(index)}`}>
                  <select
                    aria-label={`Edge ${String(index + 1)} source`}
                    disabled={!visualEditingEnabled}
                    value={edge.sourceNodeId}
                    onChange={(event) => {
                      setEditor(
                        applyVisualWorkflowEdit(editor, {
                          kind: 'update_edge',
                          edgeIndex: index,
                          field: 'sourceNodeId',
                          value: event.target.value,
                        }),
                      );
                    }}
                  >
                    {definition.nodes.map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>
                        {node.nodeId}
                      </option>
                    ))}
                  </select>
                  <b>→</b>
                  <select
                    aria-label={`Edge ${String(index + 1)} target`}
                    disabled={!visualEditingEnabled}
                    value={edge.targetNodeId}
                    onChange={(event) => {
                      setEditor(
                        applyVisualWorkflowEdit(editor, {
                          kind: 'update_edge',
                          edgeIndex: index,
                          field: 'targetNodeId',
                          value: event.target.value,
                        }),
                      );
                    }}
                  >
                    {definition.nodes.map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>
                        {node.nodeId}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Edge ${String(index + 1)} outcome`}
                    disabled={!visualEditingEnabled}
                    placeholder="default outcome"
                    value={edge.outcome ?? ''}
                    onChange={(event) => {
                      setEditor(
                        applyVisualWorkflowEdit(editor, {
                          kind: 'update_edge',
                          edgeIndex: index,
                          field: 'outcome',
                          value: event.target.value,
                        }),
                      );
                    }}
                  />
                  <button
                    type="button"
                    disabled={!visualEditingEnabled}
                    aria-label={`Remove edge ${String(index + 1)}`}
                    onClick={() => {
                      setEditor(
                        applyVisualWorkflowEdit(editor, { kind: 'remove_edge', edgeIndex: index }),
                      );
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={!visualEditingEnabled || definition.nodes.length < 2}
              onClick={() => {
                setEditor(applyVisualWorkflowEdit(editor, { kind: 'add_edge' }));
              }}
            >
              Add edge
            </button>
          </div>
          <div className="panel editor-panel">
            <span className="eyebrow">RESTRICTED JSON DSL</span>
            <textarea
              aria-label="Workflow DSL editor"
              disabled={pendingNodes.length > 0}
              spellCheck="false"
              value={editor}
              onChange={(event) => {
                setEditor(event.target.value);
              }}
            />
            {pendingNodes.length > 0 ? (
              <p role="status">
                Apply or discard node parameter edits before validating or submitting this draft.
              </p>
            ) : null}
            {draftChanged ? (
              <p role="status">Create a revision to confirm these draft changes.</p>
            ) : null}
            <div className="action-row">
              <button disabled={pendingNodes.length > 0} onClick={() => void validate()}>
                仅校验
              </button>
              <label className="inline-field">
                New Plan ID
                <input
                  value={newPlanId}
                  onChange={(event) => {
                    setNewPlanId(event.target.value);
                  }}
                />
              </label>
              <button
                disabled={newPlanId.trim() === '' || pendingNodes.length > 0}
                onClick={() => void revise()}
              >
                创建不可变修订
              </button>
              <button
                disabled={
                  plan?.confirmationStatus !== 'awaiting_confirmation' ||
                  pendingNodes.length > 0 ||
                  draftChanged
                }
                onClick={() => void confirm()}
              >
                确认计划
              </button>
            </div>
            {validation === undefined ? null : (
              <pre className="validation-result">{JSON.stringify(validation, null, 2)}</pre>
            )}
          </div>
        </section>
      )}
      {trace === undefined ? null : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{trace.instance.instanceId}</span>
              <h2>Execution Replay</h2>
            </div>
            <span className="status ok">{trace.instance.status}</span>
          </div>
          <label className="replay-control">
            Replay position{' '}
            <input
              type="range"
              min="0"
              max={trace.events.length}
              value={replayIndex}
              onChange={(event) => {
                setReplayIndex(Number(event.target.value));
              }}
            />
            <strong>
              {replayIndex}/{trace.events.length}
            </strong>
          </label>
          <ol className="timeline">
            {trace.events.map((event, index) => (
              <li
                key={`${String(event.sequence)}-${event.nodeId}`}
                className={index < replayIndex ? 'visible' : ''}
              >
                <span>{event.sequence}</span>
                <div>
                  <strong>
                    {event.nodeId} · {event.eventType}
                  </strong>
                  <small>{event.timestamp}</small>
                  <WorkflowEventDuration durationMs={event.durationMs} />
                  <p>{event.summary}</p>
                </div>
              </li>
            ))}
          </ol>
          <details>
            <summary>Terminal result and errors</summary>
            <pre className="result">
              {JSON.stringify(
                { result: trace.instance.result, errors: trace.instance.errors },
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}

export function TaskReadinessPanel({
  evidence,
}: {
  readonly evidence: TaskReadinessResponse | undefined;
}) {
  if (evidence === undefined || evidence.items.length === 0) return null;
  return (
    <section className="panel" aria-label="MCP Task readiness evidence">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TIME-BOUNDED PROVIDER FORECAST</span>
          <h2>Task Availability & Guard</h2>
        </div>
      </div>
      <p className="risk-banner">{evidence.warning}</p>
      <ol className="timeline">
        {evidence.items.flatMap((item) =>
          item.snapshots.map((snapshot) => (
            <li key={snapshot.snapshotId} className="visible">
              <span>{item.readiness.checkPhase}</span>
              <div>
                <strong>
                  {snapshot.nodeId} · {snapshot.availability} / {snapshot.riskLevel}
                </strong>
                <small>
                  checked {snapshot.checkedAt}
                  {snapshot.validUntil === undefined ? '' : ` · valid until ${snapshot.validUntil}`}
                </small>
                <p>
                  Guard: {item.readiness.guardAction} ({item.readiness.disposition})
                  {item.readiness.confirmationRequired ? ' · confirmation required' : ''}
                </p>
                {snapshot.earliestStartTime === undefined ? null : (
                  <p>Earliest start: {snapshot.earliestStartTime}</p>
                )}
                {snapshot.nextAvailableWindows.length === 0 ? null : (
                  <ul>
                    {snapshot.nextAvailableWindows.map((window) => (
                      <li key={`${window.startTime}-${window.endTime}`}>
                        {window.startTime} → {window.endTime}
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  Reservation: {snapshot.reservationMode}
                  {snapshot.reservationMode === 'guaranteed' &&
                  snapshot.reservationRef !== undefined
                    ? ` · ${snapshot.reservationRef}`
                    : ' · forecast only'}
                  {snapshot.estimatedDelayMs === undefined
                    ? ''
                    : ` · estimated delay ${String(snapshot.estimatedDelayMs)} ms`}
                </p>
                {snapshot.timing === undefined ? null : (
                  <p>
                    Timing: {snapshot.timing.start.mode}
                    {snapshot.timing.start.scheduledAt === undefined
                      ? ''
                      : ` at ${snapshot.timing.start.scheduledAt}`}
                    {' · tolerance '}
                    {snapshot.timing.start.startToleranceMs} ms · max elapsed{' '}
                    {snapshot.timing.maxElapsedMs === null
                      ? 'Provider default/unbounded request'
                      : `${String(snapshot.timing.maxElapsedMs)} ms`}
                  </p>
                )}
                <small>Arguments hash: {snapshot.argumentsHash}</small>
              </div>
            </li>
          )),
        )}
      </ol>
    </section>
  );
}

export function WorkflowTaskLink({
  taskId,
  onOpenTask,
}: {
  readonly taskId: string | undefined;
  readonly onOpenTask: ((taskId: string) => void) | undefined;
}) {
  return taskId === undefined || onOpenTask === undefined ? null : (
    <button
      type="button"
      onClick={() => {
        onOpenTask(taskId);
      }}
    >
      Open owning Task · {taskId}
    </button>
  );
}

export function workflowDraftChanged(editor: string, definition: unknown): boolean {
  try {
    return (
      JSON.stringify(orderedJson(JSON.parse(editor) as unknown)) !==
      JSON.stringify(orderedJson(definition))
    );
  } catch {
    return true;
  }
}

function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, orderedJson(entry)]),
  );
}

export function prepareWorkflowRevision(
  editor: string,
  source: WorkflowDefinitionRecord,
): Record<string, unknown> {
  const draft: unknown = JSON.parse(editor);
  if (
    !isObject(draft) ||
    draft.workflowDefinitionId !== source.workflowDefinitionId ||
    draft.goalId !== source.goalId ||
    draft.goalVersion !== source.goalVersion ||
    (draft.version !== source.version && draft.version !== source.version + 1)
  )
    throw new Error('Revision must preserve the loaded Workflow and Goal identity');
  return { ...draft, version: source.version + 1 };
}
