import { useState } from 'react';

import { managementRequest } from './api.js';

const memoryTypes = [
  'fact',
  'success_experience',
  'failure_experience',
  'workflow_pattern',
  'skill_learning',
  'prompt_learning',
] as const;

export function MemoryPanel() {
  const [query, setQuery] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [result, setResult] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  const [form, setForm] = useState({
    type: 'fact',
    summary: '',
    content: '{}',
    sourceRefs: '',
    confidence: '0.8',
  });

  async function search(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const value = await managementRequest(
        `/api/v1/memories/search?q=${encodeURIComponent(query)}&limit=20`,
      );
      setResult(value);
      return 'Global active Memory search completed.';
    });
  }
  async function create(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const value = await managementRequest('/api/v1/memories', {
        method: 'POST',
        body: JSON.stringify(memoryPayload(form)),
      });
      setResult(value);
      return 'Memory refined and persisted.';
    });
  }
  async function action(operation: 'get' | 'transitions' | 'invalidate' | 'supersede') {
    await run(async () => {
      const base = `/api/v1/memories/${encodeURIComponent(memoryId)}`;
      const path = operation === 'get' ? base : `${base}/${operation}`;
      const options =
        operation === 'get' || operation === 'transitions'
          ? undefined
          : {
              method: 'POST',
              body: JSON.stringify(
                operation === 'invalidate'
                  ? {
                      actor: 'anonymous-management',
                      reason: 'Invalidated from operational console.',
                    }
                  : {
                      ...memoryPayload(form),
                      actor: 'anonymous-management',
                      reason: 'Superseded from operational console.',
                    },
              ),
            };
      const value = await managementRequest(path, options);
      setResult(value);
      return `${memoryId}: ${operation} completed.`;
    });
  }
  async function run(operation: () => Promise<string>) {
    try {
      setMessage(await operation());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Memory operation failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">GLOBAL SHARED MEMORY</span>
            <h2>Memory Search & Lifecycle</h2>
          </div>
          <span className="status bad">anonymous shared</span>
        </div>
        <p className="risk-copy">
          V1 Memory is shared globally without user isolation. Only source-linked, displayable
          content is shown.
        </p>
        <form className="lookup" onSubmit={(event) => void search(event)}>
          <label>
            Semantic query
            <input
              required
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>
          <button type="submit">Search active Memory</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <section className="panel">
        <form className="admin-form" onSubmit={(event) => void create(event)}>
          <label>
            Type
            <select
              value={form.type}
              onChange={(event) => {
                setForm({ ...form, type: event.target.value });
              }}
            >
              {memoryTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            Confidence
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={form.confidence}
              onChange={(event) => {
                setForm({ ...form, confidence: event.target.value });
              }}
            />
          </label>
          <label>
            Summary
            <input
              required
              value={form.summary}
              onChange={(event) => {
                setForm({ ...form, summary: event.target.value });
              }}
            />
          </label>
          <label>
            Source refs (comma-separated)
            <input
              required
              value={form.sourceRefs}
              onChange={(event) => {
                setForm({ ...form, sourceRefs: event.target.value });
              }}
            />
          </label>
          <label className="wide-field">
            Structured content JSON
            <textarea
              required
              value={form.content}
              onChange={(event) => {
                setForm({ ...form, content: event.target.value });
              }}
            />
          </label>
          <button type="submit">Refine new Memory</button>
        </form>
      </section>
      <section className="panel">
        <div className="prompt-actions">
          <label>
            Memory ID
            <input
              value={memoryId}
              onChange={(event) => {
                setMemoryId(event.target.value);
              }}
            />
          </label>
          {(['get', 'transitions', 'supersede', 'invalidate'] as const).map((operation) => (
            <button
              key={operation}
              disabled={memoryId === ''}
              onClick={() => void action(operation)}
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

function memoryPayload(
  form: Readonly<{
    type: string;
    summary: string;
    content: string;
    sourceRefs: string;
    confidence: string;
  }>,
) {
  return {
    type: form.type,
    summary: form.summary,
    content: JSON.parse(form.content) as unknown,
    sourceRefs: form.sourceRefs
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== ''),
    confidence: Number(form.confidence),
  };
}
