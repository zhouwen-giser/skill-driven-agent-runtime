import { useEffect, useMemo, useState } from 'react';

import { managementRequest } from './api.js';

interface WorkflowNodeRecord {
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

type VisualWorkflowEdit =
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

  if (edit.kind === 'rename_node') {
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
  const [message, setMessage] = useState<string>();
  const [replayIndex, setReplayIndex] = useState(0);
  const [linkedTaskId, setLinkedTaskId] = useState<string>();
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
      setPlan(loaded);
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
      const definition: unknown = JSON.parse(editor);
      const revised = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(planId)}/revisions`,
        { method: 'POST', body: JSON.stringify({ newPlanId, format: 'dag', definition }) },
      );
      setPlan(revised);
      setPlanId(revised.planId);
      setEditor(JSON.stringify(revised.definition, null, 2));
      return `${revised.planId}: immutable revision created; confirmation required.`;
    });
  }
  async function confirm() {
    await run(async () => {
      const confirmed = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(planId)}/confirm`,
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

  const visualEditingEnabled = visualDefinition !== undefined;
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
      {definition === undefined ? null : (
        <section className="workflow-grid">
          <div className="panel dag-board">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  {definition.workflowDefinitionId} · V{definition.version}
                </span>
                <h2>Validated Graph</h2>
              </div>
              <span>
                {definition.nodes.length} nodes / {definition.edges.length} edges
              </span>
            </div>
            <div className="visual-editor-note">
              Visual edits update the restricted DSL draft only. Validate and create an immutable
              revision before confirmation.
            </div>
            <div className="dag-nodes" aria-label="Visual Workflow editor">
              {definition.nodes.map((node, index) => (
                <article
                  key={node.nodeId}
                  className={`dag-node ${nodeStates.get(node.nodeId) ?? ''}`}
                  style={{ '--node-order': index } as React.CSSProperties}
                >
                  <small>{node.type}</small>
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
              spellCheck="false"
              value={editor}
              onChange={(event) => {
                setEditor(event.target.value);
              }}
            />
            <div className="action-row">
              <button onClick={() => void validate()}>仅校验</button>
              <label className="inline-field">
                New Plan ID
                <input
                  value={newPlanId}
                  onChange={(event) => {
                    setNewPlanId(event.target.value);
                  }}
                />
              </label>
              <button disabled={newPlanId === ''} onClick={() => void revise()}>
                创建不可变修订
              </button>
              <button
                disabled={plan?.confirmationStatus !== 'awaiting_confirmation'}
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
