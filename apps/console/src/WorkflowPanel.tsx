import { useMemo, useState } from 'react';

import { managementRequest } from './api.js';

interface WorkflowNodeRecord {
  readonly nodeId: string;
  readonly name: string;
  readonly type: string;
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
    summary: string;
  }>[];
}

export function WorkflowPanel() {
  const [planId, setPlanId] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [plan, setPlan] = useState<WorkflowPlanRecord>();
  const [trace, setTrace] = useState<WorkflowTraceRecord>();
  const [editor, setEditor] = useState('');
  const [validation, setValidation] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  const [replayIndex, setReplayIndex] = useState(0);
  const replayEvents = trace?.events.slice(0, replayIndex) ?? [];
  const nodeStates = useMemo(
    () => new Map(replayEvents.map((event) => [event.nodeId, event.eventType])),
    [replayEvents],
  );

  async function loadPlan(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const loaded = await managementRequest<WorkflowPlanRecord>(
        `/api/v1/workflows/plans/${encodeURIComponent(planId)}`,
      );
      setPlan(loaded);
      setEditor(loaded.definition === undefined ? '' : JSON.stringify(loaded.definition, null, 2));
      return `${loaded.planId}: plan loaded`;
    });
  }
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

  const definition = plan?.definition;
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
      </section>
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
            <div className="dag-nodes">
              {definition.nodes.map((node, index) => (
                <article
                  key={node.nodeId}
                  className={`dag-node ${nodeStates.get(node.nodeId) ?? ''}`}
                  style={{ '--node-order': index } as React.CSSProperties}
                >
                  <small>{node.type}</small>
                  <strong>{node.name}</strong>
                  <code>{node.nodeId}</code>
                  {definition.entryNodeId === node.nodeId ? <span>ENTRY</span> : null}
                  {definition.exitNodeIds.includes(node.nodeId) ? <span>EXIT</span> : null}
                </article>
              ))}
            </div>
            <div className="edge-list" aria-label="Workflow edges">
              {definition.edges.map((edge, index) => (
                <div key={`${edge.sourceNodeId}-${edge.targetNodeId}-${String(index)}`}>
                  <code>{edge.sourceNodeId}</code>
                  <b>→</b>
                  <code>{edge.targetNodeId}</code>
                  <span>{edge.outcome ?? 'default'}</span>
                </div>
              ))}
            </div>
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
