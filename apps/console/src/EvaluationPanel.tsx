import { useState } from 'react';

import { managementRequest } from './api.js';

interface AnalyticsSnapshot {
  readonly sampleCount: number;
  readonly successCount: number;
  readonly successRate: number;
  readonly averageDurationMs: number;
  readonly totalCost: number;
  readonly averageCost: number;
  readonly failureTypes: readonly Readonly<{ code: string; count: number }>[];
  readonly versionStability: readonly Readonly<{
    skillId: string;
    skillVersion: number;
    sampleCount: number;
    successRate: number;
    averageQuality: number;
    qualityDeviation: number;
    stabilityScore: number;
  }>[];
  readonly qualityTrend: readonly Readonly<{
    reportId: string;
    taskId: string;
    instanceId: string;
    score: number;
    status: string;
    createdAt: string;
  }>[];
}

export function EvaluationPanel() {
  const [filters, setFilters] = useState({
    skillId: '',
    skillVersion: '',
    providerId: '',
    model: '',
    serverId: '',
    toolName: '',
  });
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot>();
  const [warnings, setWarnings] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  async function load(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '') params.set(key, value);
      const [metrics, warningRecords] = await Promise.all([
        managementRequest<AnalyticsSnapshot>(`/api/v1/evaluation/analytics?${params.toString()}`),
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
      {analytics === undefined ? null : <OperationsDashboard analytics={analytics} />}
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

export function OperationsDashboard({ analytics }: { readonly analytics: AnalyticsSnapshot }) {
  const largestFailure = Math.max(1, ...analytics.failureTypes.map((item) => item.count));
  return (
    <>
      <section className="metric-grid" aria-label="Evaluation KPI summary">
        <Kpi
          label="Samples"
          value={String(analytics.sampleCount)}
          detail={`${String(analytics.successCount)} successful`}
        />
        <Kpi
          label="Success rate"
          value={percent(analytics.successRate)}
          detail="completed Experiences"
        />
        <Kpi
          label="Average duration"
          value={`${formatNumber(analytics.averageDurationMs)} ms`}
          detail="per Workflow"
        />
        <Kpi
          label="Total cost"
          value={formatNumber(analytics.totalCost)}
          detail={`avg ${formatNumber(analytics.averageCost)}`}
        />
      </section>
      <section className="analytics-grid operations-dashboard">
        <article>
          <span>FAILURE TYPES</span>
          {analytics.failureTypes.length === 0 ? (
            <p>No failures in the selected evidence.</p>
          ) : (
            analytics.failureTypes.map((item) => (
              <div className="metric-bar" key={item.code}>
                <div>
                  <strong>{item.code}</strong>
                  <span>{item.count}</span>
                </div>
                <meter min="0" max={largestFailure} value={item.count}>
                  {item.count}
                </meter>
              </div>
            ))
          )}
        </article>
        <article>
          <span>VERSION STABILITY</span>
          {analytics.versionStability.length === 0 ? (
            <p>No version samples.</p>
          ) : (
            <div className="data-table" role="table">
              <div className="data-row header" role="row">
                <span>Version</span>
                <span>Success</span>
                <span>Quality</span>
                <span>Stability</span>
              </div>
              {analytics.versionStability.map((item) => (
                <div
                  className="data-row"
                  role="row"
                  key={`${item.skillId}-${String(item.skillVersion)}`}
                >
                  <span>
                    {item.skillId} v{item.skillVersion}
                  </span>
                  <span>{percent(item.successRate)}</span>
                  <span>{percent(item.averageQuality)}</span>
                  <span>{percent(item.stabilityScore)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="wide-card">
          <span>QUALITY TREND</span>
          {analytics.qualityTrend.length === 0 ? (
            <p>No quality reports.</p>
          ) : (
            <ol className="quality-trend">
              {analytics.qualityTrend.map((item) => (
                <li key={item.reportId}>
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                  <meter min="0" max="1" value={item.score}>
                    {item.score}
                  </meter>
                  <strong>{percent(item.score)}</strong>
                  <span className={`status ${item.status === 'passed' ? 'ok' : 'bad'}`}>
                    {item.status}
                  </span>
                  <code>{item.taskId}</code>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>
      <details className="panel">
        <summary>Raw analytics evidence</summary>
        <pre>{JSON.stringify(analytics, null, 2)}</pre>
      </details>
    </>
  );
}

function Kpi({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function percent(value: number) {
  return `${formatNumber(value * 100)}%`;
}
function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}
