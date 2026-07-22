import { useState } from 'react';

import { managementRequest } from './api.js';

const stages = [
  'intent',
  'goal',
  'tool_enhancement',
  'skill_authoring',
  'skill_selection',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'execution_decision',
  'goal_evaluation',
  'evaluation',
  'result_processing',
  'task_understanding',
  'task_clarification',
  'goal_contract_generation',
  'interactive_plan_patch',
  'experience_observation',
] as const;

export function PromptPanel() {
  const [form, setForm] = useState({
    promptId: '',
    stage: 'workflow_planning',
    content: '',
    source: 'admin',
    publish: false,
  });
  const [lookupId, setLookupId] = useState('');
  const [version, setVersion] = useState('1');
  const [result, setResult] = useState<unknown>();
  const [message, setMessage] = useState<string>();

  async function create(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const created = await managementRequest('/api/v1/prompts', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(created);
      setLookupId(form.promptId);
      return `${form.promptId}: immutable Prompt version created.`;
    });
  }
  async function inspect(operation: 'versions' | 'publish' | 'rollback' | 'disable' | 'effects') {
    await run(async () => {
      const base = `/api/v1/prompts/${encodeURIComponent(lookupId)}`;
      const path =
        operation === 'versions'
          ? `${base}/versions`
          : operation === 'disable'
            ? `${base}/disable`
            : `${base}/${operation}/${encodeURIComponent(version)}`;
      const value = await managementRequest(
        path,
        operation === 'versions' || operation === 'effects' ? undefined : { method: 'POST' },
      );
      setResult(value);
      return `${lookupId}: ${operation} completed.`;
    });
  }
  async function run(operation: () => Promise<string>) {
    try {
      setMessage(await operation());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Prompt operation failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">VERSIONED PROMPT AUTHORITY</span>
            <h2>Prompt Lifecycle</h2>
          </div>
        </div>
        <form className="admin-form" onSubmit={(event) => void create(event)}>
          <label>
            Prompt ID
            <input
              required
              value={form.promptId}
              onChange={(event) => {
                setForm({ ...form, promptId: event.target.value });
              }}
            />
          </label>
          <label>
            Fixed stage
            <select
              value={form.stage}
              onChange={(event) => {
                setForm({ ...form, stage: event.target.value });
              }}
            >
              {stages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select
              value={form.source}
              onChange={(event) => {
                setForm({ ...form, source: event.target.value });
              }}
            >
              <option value="admin">admin</option>
              <option value="manual_correction">manual_correction</option>
              <option value="auto_candidate">auto_candidate</option>
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(event) => {
                setForm({ ...form, publish: event.target.checked });
              }}
            />{' '}
            Publish immediately
          </label>
          <label className="wide-field">
            Prompt content
            <textarea
              required
              value={form.content}
              onChange={(event) => {
                setForm({ ...form, content: event.target.value });
              }}
            />
          </label>
          <button type="submit">Create immutable version</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <section className="panel">
        <div className="prompt-actions">
          <label>
            Prompt ID
            <input
              required
              value={lookupId}
              onChange={(event) => {
                setLookupId(event.target.value);
              }}
            />
          </label>
          <label>
            Version
            <input
              type="number"
              min="1"
              value={version}
              onChange={(event) => {
                setVersion(event.target.value);
              }}
            />
          </label>
          {(['versions', 'effects', 'publish', 'rollback', 'disable'] as const).map((operation) => (
            <button
              key={operation}
              disabled={lookupId === ''}
              onClick={() => void inspect(operation)}
            >
              {operation}
            </button>
          ))}
        </div>
        {result === undefined ? null : (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
