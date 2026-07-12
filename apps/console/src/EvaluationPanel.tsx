import { useState } from 'react';

import { managementRequest } from './api.js';

export function EvaluationPanel() {
  const [filters, setFilters] = useState({
    skillId: '',
    skillVersion: '',
    providerId: '',
    model: '',
    serverId: '',
    toolName: '',
  });
  const [analytics, setAnalytics] = useState<unknown>();
  const [warnings, setWarnings] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  async function load(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '') params.set(key, value);
      const [metrics, warningRecords] = await Promise.all([
        managementRequest(`/api/v1/evaluation/analytics?${params.toString()}`),
        managementRequest(
          `/api/v1/skill-quality-warnings${filters.skillId === '' ? '' : `?skillId=${encodeURIComponent(filters.skillId)}`}`,
        ),
      ]);
      setAnalytics(metrics);
      setWarnings(warningRecords);
      setMessage('PostgreSQL evaluation evidence loaded.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Evaluation query failed.');
    }
  }
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FILTERED OPERATING METRICS</span>
            <h2>Evaluation & Quality</h2>
          </div>
          <span className="status ok">warning-only policy</span>
        </div>
        <form className="filter-form" onSubmit={(event) => void load(event)}>
          {Object.entries(filters).map(([key, value]) => (
            <label key={key}>
              {key}
              <input
                type={key === 'skillVersion' ? 'number' : 'text'}
                value={value}
                onChange={(event) => {
                  setFilters({ ...filters, [key]: event.target.value });
                }}
              />
            </label>
          ))}
          <button type="submit">Apply filters</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <section className="analytics-grid">
        <article>
          <span>ANALYTICS</span>
          <pre>{JSON.stringify(analytics ?? { status: 'Run a real query.' }, null, 2)}</pre>
        </article>
        <article>
          <span>SKILL WARNINGS</span>
          <pre>{JSON.stringify(warnings ?? { status: 'Run a real query.' }, null, 2)}</pre>
        </article>
      </section>
      <section className="panel warning-panel">
        <span>QUALITY POLICY</span>
        <strong>Warnings never disable Skills automatically.</strong>
        <p>
          Use the Skill lifecycle page for explicit administrator disable, rollback, or correction.
        </p>
      </section>
    </div>
  );
}
