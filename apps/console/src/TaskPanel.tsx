import { useState } from 'react';

import { managementRequest } from './api.js';

interface TaskRecord {
  readonly taskId: string;
  readonly contextId: string;
  readonly phase: string;
  readonly phaseMessage: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly selectedSkillId?: string;
  readonly selectedSkillVersion?: number;
  readonly temporarySkillId?: string;
  readonly errorCode?: string;
}
interface EvidenceItem {
  readonly key: string;
  readonly label: string;
  readonly endpoint: string;
  readonly value: unknown;
  readonly error?: string;
}

export function TaskPanel() {
  const [taskId, setTaskId] = useState('');
  const [task, setTask] = useState<TaskRecord>();
  const [evidence, setEvidence] = useState<readonly EvidenceItem[]>([]);
  const [message, setMessage] = useState<string>();
  const [action, setAction] = useState<'confirm_plan' | 'reject_plan' | 'revise_plan'>(
    'confirm_plan',
  );
  const [actionText, setActionText] = useState('Confirmed from the operational console.');

  async function load(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const loaded = await managementRequest<TaskRecord>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      );
      setTask(loaded);
      const links = taskEvidenceLinks(loaded);
      setEvidence(await Promise.all(links.map(loadEvidence)));
      setMessage(`${loaded.taskId}: ${String(links.length)} linked evidence queries completed.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Task trace lookup failed.');
    }
  }

  async function submitAction(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task === undefined) return;
    try {
      const updated = await managementRequest<TaskRecord>(
        `/api/v1/tasks/${encodeURIComponent(task.taskId)}/actions`,
        {
          method: 'POST',
          body: JSON.stringify({ action, messageText: actionText }),
        },
      );
      setTask(updated);
      setMessage(`${updated.taskId}: ${action} applied through the authoritative lifecycle.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Task action failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CORRELATED TRACE ROOT</span>
            <h2>Task / Goal Explorer</h2>
          </div>
          {task === undefined ? null : <span className="status ok">{task.phase}</span>}
        </div>
        <form className="lookup" onSubmit={(event) => void load(event)}>
          <label>
            Task ID
            <input
              required
              value={taskId}
              onChange={(event) => {
                setTaskId(event.target.value);
              }}
            />
          </label>
          <button type="submit">加载全链路证据</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      {task === undefined ? null : (
        <>
          <section className="trace-identity">
            <article>
              <span>TASK</span>
              <strong>{task.taskId}</strong>
              <small>{task.phaseMessage}</small>
            </article>
            <article>
              <span>CONTEXT</span>
              <strong>{task.contextId}</strong>
              <small>serialized task scope</small>
            </article>
            <article>
              <span>GOAL</span>
              <strong>{task.goalId ?? 'not bound'}</strong>
              <small>
                {task.goalVersion === undefined ? '—' : `version ${String(task.goalVersion)}`}
              </small>
            </article>
            <article>
              <span>SKILL</span>
              <strong>{task.selectedSkillId ?? task.temporarySkillId ?? 'not resolved'}</strong>
              <small>
                {task.selectedSkillVersion === undefined
                  ? '—'
                  : `version ${String(task.selectedSkillVersion)}`}
              </small>
            </article>
            <article>
              <span>PLAN</span>
              <strong>{task.planId ?? 'not planned'}</strong>
              <small>{task.errorCode ?? 'no Task error'}</small>
            </article>
          </section>
          <section className="panel">
            <span className="eyebrow">PLAN ACTION BOUNDARY</span>
            <form className="task-action" onSubmit={(event) => void submitAction(event)}>
              <label>
                Action
                <select
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as typeof action);
                  }}
                >
                  <option value="confirm_plan">Confirm plan</option>
                  <option value="reject_plan">Reject plan</option>
                  <option value="revise_plan">Revise plan</option>
                </select>
              </label>
              <label>
                Displayable instruction
                <input
                  required
                  value={actionText}
                  onChange={(event) => {
                    setActionText(event.target.value);
                  }}
                />
              </label>
              <button type="submit">提交 Task Action</button>
            </form>
          </section>
        </>
      )}
      <section className="evidence-grid">
        {evidence.map((item) => (
          <article
            key={item.key}
            className={item.error === undefined ? 'evidence-card' : 'evidence-card evidence-error'}
          >
            <header>
              <span>{item.label}</span>
              <code>{item.endpoint}</code>
            </header>
            {item.error === undefined ? (
              <pre>{JSON.stringify(item.value, null, 2)}</pre>
            ) : (
              <p>{item.error}</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function taskEvidenceLinks(task: TaskRecord): readonly Omit<EvidenceItem, 'value'>[] {
  const id = encodeURIComponent(task.taskId);
  const links: Omit<EvidenceItem, 'value'>[] = [
    { key: 'events', label: 'Task Events', endpoint: `/api/v1/tasks/${id}/events` },
    {
      key: 'results',
      label: 'Processed Results',
      endpoint: `/api/v1/tasks/${id}/processed-results`,
    },
    { key: 'quality', label: 'Quality Report', endpoint: `/api/v1/tasks/${id}/quality-report` },
    {
      key: 'feedback',
      label: 'Implicit Feedback',
      endpoint: `/api/v1/tasks/${id}/implicit-feedback`,
    },
    {
      key: 'inferences',
      label: 'Input Inferences',
      endpoint: `/api/v1/tasks/${id}/input-inferences`,
    },
    {
      key: 'models',
      label: 'Model Invocations',
      endpoint: `/api/v1/models/invocations?taskId=${id}`,
    },
    { key: 'mcp', label: 'MCP Invocations', endpoint: `/api/v1/mcp/invocations?taskId=${id}` },
  ];
  if (task.goalId !== undefined) {
    const goalId = encodeURIComponent(task.goalId);
    links.push({ key: 'goal', label: 'Goal', endpoint: `/api/v1/goals/${goalId}` });
    links.push({
      key: 'goal-patches',
      label: 'Goal Patches',
      endpoint: `/api/v1/goals/${goalId}/patches`,
    });
    links.push({
      key: 'goal-experiences',
      label: 'Goal Evolution',
      endpoint: `/api/v1/goals/${goalId}/evolution-experiences`,
    });
  }
  if (task.planId !== undefined) {
    const planId = encodeURIComponent(task.planId);
    links.push({
      key: 'plan',
      label: 'Workflow Plan',
      endpoint: `/api/v1/workflows/plans/${planId}`,
    });
    links.push({
      key: 'trace',
      label: 'Workflow Trace',
      endpoint: `/api/v1/workflows/plans/${planId}/trace`,
    });
  }
  return links;
}

async function loadEvidence(item: Omit<EvidenceItem, 'value'>): Promise<EvidenceItem> {
  try {
    return { ...item, value: await managementRequest(item.endpoint) };
  } catch (error: unknown) {
    return {
      ...item,
      value: undefined,
      error: error instanceof Error ? error.message : 'Evidence unavailable.',
    };
  }
}
