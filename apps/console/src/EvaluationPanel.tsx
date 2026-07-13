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
  readonly mcpUsage: readonly Readonly<{
    serverId: string;
    toolName: string;
    invocationCount: number;
    successRate: number;
    averageDurationMs: number;
  }>[];
  readonly modelEffects: readonly Readonly<{
    providerId: string;
    model: string;
    invocationCount: number;
    successRate: number;
    averageDurationMs: number;
    averageTokens: number;
  }>[];
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
  readonly capabilityGrowth: readonly Readonly<{
    skillId: string;
    observedVersions: number;
    firstVersion: number;
    latestVersion: number;
    sampleCount: number;
    successfulSamples: number;
  }>[];
  readonly optimizationSuggestions: readonly Readonly<{
    code: string;
    severity: string;
    target: string;
    summary: string;
    evidenceCount: number;
  }>[];
}

export function EvaluationPanel({
  initialSkillId,
  onOpenTask,
}: {
  readonly initialSkillId?: string;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const [filters, setFilters] = useState({
    skillId: initialSkillId ?? '',
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
      {analytics === undefined ? null : (
        <OperationsDashboard
          analytics={analytics}
          {...(onOpenTask === undefined ? {} : { onOpenTask })}
        />
      )}
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

export function OperationsDashboard({
  analytics,
  onOpenTask,
}: {
  readonly analytics: AnalyticsSnapshot;
  readonly onOpenTask?: (taskId: string) => void;
}) {
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
                  {onOpenTask === undefined ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenTask(item.taskId);
                      }}
                    >
                      Open Task
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </article>
        <EvidenceTable
          title="MCP USAGE"
          empty="No MCP invocations."
          headers={['Tool', 'Calls', 'Success', 'Avg ms']}
          rows={analytics.mcpUsage.map((item) => [
            `${item.serverId}.${item.toolName}`,
            String(item.invocationCount),
            percent(item.successRate),
            formatNumber(item.averageDurationMs),
          ])}
        />
        <EvidenceTable
          title="MODEL EFFECTS"
          empty="No model invocations."
          headers={['Provider / Model', 'Calls', 'Success', 'Avg tokens']}
          rows={analytics.modelEffects.map((item) => [
            `${item.providerId} / ${item.model}`,
            String(item.invocationCount),
            percent(item.successRate),
            formatNumber(item.averageTokens),
          ])}
        />
        <EvidenceTable
          title="CAPABILITY GROWTH"
          empty="No Skill-version evidence."
          headers={['Skill', 'Versions', 'Latest', 'Successes']}
          rows={analytics.capabilityGrowth.map((item) => [
            item.skillId,
            String(item.observedVersions),
            `v${String(item.latestVersion)}`,
            `${String(item.successfulSamples)}/${String(item.sampleCount)}`,
          ])}
        />
        <article>
          <span>AUTOMATIC OPTIMIZATION SUGGESTIONS</span>
          {analytics.optimizationSuggestions.length === 0 ? (
            <p>No evidence-backed suggestions.</p>
          ) : (
            <ul className="suggestion-list">
              {analytics.optimizationSuggestions.map((item) => (
                <li key={`${item.code}-${item.target}`}>
                  <strong>{item.target}</strong>
                  <p>{item.summary}</p>
                  <small>
                    {item.code} · {item.evidenceCount} evidence records · advisory only
                  </small>
                </li>
              ))}
            </ul>
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

function EvidenceTable({
  title,
  empty,
  headers,
  rows,
}: {
  readonly title: string;
  readonly empty: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}) {
  return (
    <article>
      <span>{title}</span>
      {rows.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <div className="data-table" role="table">
          <div className="data-row header" role="row">
            {headers.map((header) => (
              <span key={header}>{header}</span>
            ))}
          </div>
          {rows.map((row) => (
            <div className="data-row" role="row" key={row.join('\0')}>
              {row.map((value, index) => (
                <span key={`${String(index)}-${value}`}>{value}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </article>
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
