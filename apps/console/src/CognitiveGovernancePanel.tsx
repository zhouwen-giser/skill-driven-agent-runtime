import { useEffect, useState } from 'react';

import { managementRequest } from './api.js';

type GovernanceInventory = Readonly<{
  episodes: unknown;
  observations: unknown;
  reflections: unknown;
  deadLetters: unknown;
  heuristics: unknown;
  taskTypes: unknown;
  capabilityPatterns: unknown;
  managementAudit: unknown;
}>;

type KnowledgeAction = 'promote' | 'reject' | 'revalidate' | 'deprecate';

export function CognitiveGovernancePanel() {
  const [inventory, setInventory] = useState<GovernanceInventory>();
  const [message, setMessage] = useState('Loading PostgreSQL-authoritative cognitive evidence.');
  const [kind, setKind] = useState<'planning_heuristic' | 'task_type' | 'capability_pattern'>(
    'planning_heuristic',
  );
  const [knowledgeId, setKnowledgeId] = useState('');
  const [version, setVersion] = useState(1);
  const [action, setAction] = useState<KnowledgeAction>('promote');
  const [reason, setReason] = useState('Reviewed through the SDAR cognitive governance console.');
  const [deadLetterId, setDeadLetterId] = useState('');

  async function load() {
    try {
      const [
        episodes,
        observations,
        reflections,
        deadLetters,
        heuristics,
        taskTypes,
        capabilityPatterns,
        managementAudit,
      ] = await Promise.all([
        managementRequest('/api/v1/experience/episodes?limit=50'),
        managementRequest('/api/v1/experience/observations?limit=50'),
        managementRequest('/api/v1/experience/reflections?limit=50'),
        managementRequest('/api/v1/experience/dead-letters?limit=50'),
        managementRequest('/api/v1/knowledge/heuristics?limit=50'),
        managementRequest('/api/v1/task-types?limit=50'),
        managementRequest('/api/v1/capability-patterns?limit=50'),
        managementRequest('/api/v1/cognitive-management/actions?limit=50'),
      ]);
      setInventory({
        episodes,
        observations,
        reflections,
        deadLetters,
        heuristics,
        taskTypes,
        capabilityPatterns,
        managementAudit,
      });
      setMessage('Cognitive governance evidence refreshed from the management API.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Cognitive governance query failed.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function applyKnowledgeAction(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const idempotencyKey = `console:${kind}:${knowledgeId}:${String(version)}:${action}`;
    const common = {
      expectedVersion: version,
      idempotencyKey,
      actorId: 'console.operator',
      reason: action === 'revalidate' ? ('policy_changed' as const) : reason,
    };
    try {
      await managementRequest(
        `/api/v1/knowledge/${kind}/${encodeURIComponent(knowledgeId)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...common,
            ...(action === 'promote' ? { humanApproved: true, policyAllowed: true } : {}),
          }),
        },
      );
      setMessage(`${action} recorded for ${kind}/${knowledgeId} at version ${String(version)}.`);
      await load();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Knowledge governance action failed.');
    }
  }

  async function replayDeadLetter(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await managementRequest(
        `/api/v1/experience/dead-letters/${encodeURIComponent(deadLetterId)}/replay`,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion: 0,
            idempotencyKey: `console:dead-letter:${deadLetterId}:0`,
            actorId: 'console.operator',
            reason,
          }),
        },
      );
      setMessage(`Replay requested for dead letter ${deadLetterId}.`);
      await load();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Dead-letter replay failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel warning-panel">
        <span>CANDIDATE GOVERNANCE BOUNDARY</span>
        <strong>Review and Promotion only</strong>
        <p>
          These controls transition Candidate knowledge through audited APIs. They cannot mutate
          Provider state, final Outcomes, or the active execution plan.
        </p>
      </section>
      <section className="panel" aria-label="Experience Governance">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EXPERIENCE GOVERNANCE</span>
            <h2>Episodes · Observations · Reflections · Replay</h2>
          </div>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <p className="action-message">{message}</p>
        <GovernanceEvidence title="Goal Episodes" value={inventory?.episodes} />
        <GovernanceEvidence title="Observations / Lessons" value={inventory?.observations} />
        <GovernanceEvidence title="Reflections / Contradictions" value={inventory?.reflections} />
        <GovernanceEvidence title="Dead Letters" value={inventory?.deadLetters} />
        <GovernanceEvidence title="Management Audit" value={inventory?.managementAudit} />
        <form className="task-action" onSubmit={(event) => void replayDeadLetter(event)}>
          <label>
            Dead Letter ID
            <input
              required
              value={deadLetterId}
              onChange={(event) => {
                setDeadLetterId(event.target.value);
              }}
            />
          </label>
          <label>
            Expected version
            <input
              required
              min={0}
              type="number"
              value={version}
              onChange={(event) => {
                setVersion(Number(event.target.value));
              }}
            />
          </label>
          <label>
            Audit reason
            <input
              required
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <button type="submit">Replay through governed queue</button>
        </form>
      </section>
      <section className="panel" aria-label="Task Type Governance">
        <span className="eyebrow">TASK TYPE GOVERNANCE</span>
        <h2>Recognition · Dimensions · Evidence · Status</h2>
        <GovernanceEvidence title="Task Type Candidates" value={inventory?.taskTypes} />
        <GovernanceEvidence title="Planning Heuristics" value={inventory?.heuristics} />
        <GovernanceEvidence
          title="Capability Patterns & Gaps"
          value={inventory?.capabilityPatterns}
        />
        <form className="task-action" onSubmit={(event) => void applyKnowledgeAction(event)}>
          <label>
            Knowledge kind
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
              }}
            >
              <option value="planning_heuristic">Planning heuristic</option>
              <option value="task_type">Task type</option>
              <option value="capability_pattern">Capability pattern</option>
            </select>
          </label>
          <label>
            Knowledge ID
            <input
              required
              value={knowledgeId}
              onChange={(event) => {
                setKnowledgeId(event.target.value);
              }}
            />
          </label>
          <label>
            Expected version
            <input
              required
              min={1}
              type="number"
              value={version}
              onChange={(event) => {
                setVersion(Number(event.target.value));
              }}
            />
          </label>
          <label>
            Governance action
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as KnowledgeAction);
              }}
            >
              <option value="promote">Promote</option>
              <option value="reject">Reject</option>
              <option value="revalidate">Revalidate</option>
              <option value="deprecate">Deprecate</option>
            </select>
          </label>
          <label>
            Audit reason
            <input
              required
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <button type="submit">Apply CAS-protected transition</button>
        </form>
      </section>
    </div>
  );
}

function GovernanceEvidence({ title, value }: { readonly title: string; readonly value: unknown }) {
  return (
    <details>
      <summary>{title}</summary>
      <pre>{JSON.stringify(value ?? { status: 'loading' }, null, 2)}</pre>
    </details>
  );
}
