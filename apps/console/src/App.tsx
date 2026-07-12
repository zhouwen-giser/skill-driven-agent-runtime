import { useEffect, useMemo, useState } from 'react';
import {
  type EvaluationAnalytics,
  type HealthPayload,
  type McpServerSummary,
  ManagementApiError,
  managementRequest,
  type SkillSummary,
} from './api.js';

type Section = 'overview' | 'skills' | 'mcp' | 'workflows' | 'tasks' | 'memory' | 'evaluation';

const navigation: readonly {
  readonly id: Section;
  readonly label: string;
  readonly note: string;
}[] = [
  { id: 'overview', label: '运行概览', note: 'System' },
  { id: 'tasks', label: '任务与 Goal', note: 'Trace' },
  { id: 'skills', label: 'Skills', note: 'Lifecycle' },
  { id: 'workflows', label: 'Workflows', note: 'DAG' },
  { id: 'mcp', label: 'MCP Servers', note: 'Tools' },
  { id: 'memory', label: '长期记忆', note: 'Recall' },
  { id: 'evaluation', label: '评估分析', note: 'Quality' },
];

export function App() {
  const [section, setSection] = useState<Section>('overview');
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <strong>SDAR</strong>
            <small>OPERATIONS CONSOLE</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setSection(item.id);
              }}
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </nav>
        <p className="network-warning">
          无认证 · 仅限可信内网
          <br />
          <span>Do not expose publicly</span>
        </p>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">SKILL-DRIVEN AGENT RUNTIME</span>
            <h1>{navigation.find((item) => item.id === section)?.label}</h1>
          </div>
          <span className="live-pill">
            <i /> LIVE API
          </span>
        </header>
        <section className="content" aria-live="polite">
          <SectionView section={section} />
        </section>
      </main>
    </div>
  );
}

function SectionView({ section }: { readonly section: Section }) {
  if (section === 'overview') return <Overview />;
  if (section === 'skills')
    return <ResourceList title="Skill Registry" endpoint="/api/v1/skills" />;
  if (section === 'mcp')
    return <ResourceList title="MCP Server Registry" endpoint="/api/v1/mcp/servers" />;
  if (section === 'evaluation') return <Analytics />;
  return <Lookup section={section} />;
}

function Overview() {
  const health = useResource<HealthPayload>('/api/v1/health');
  const skills = useResource<SkillSummary[]>('/api/v1/skills');
  const servers = useResource<McpServerSummary[]>('/api/v1/mcp/servers');
  return (
    <>
      <div className="hero">
        <div>
          <span className="eyebrow">RUNTIME POSTURE</span>
          <h2>系统事实，一屏可见。</h2>
          <p>控制台直接读取管理 API；不保存业务真相，也不使用静态运营数据。</p>
        </div>
        <Status state={health} />
      </div>
      <div className="metric-grid">
        <Metric label="已注册 Skills" value={arrayCount(skills.data)} detail="领域注册表" />
        <Metric label="MCP Servers" value={arrayCount(servers.data)} detail="实时注册表" />
        <Metric label="Runtime" value={health.data?.status ?? '—'} detail="管理边界健康状态" />
      </div>
      <div className="panel warning-panel">
        <span>SECURITY BASELINE</span>
        <strong>{health.data?.warning ?? 'trusted-intranet-only-no-auth'}</strong>
        <p>V1 不提供认证、授权或租户隔离。部署必须实施网络隔离。</p>
      </div>
    </>
  );
}

function ResourceList({ title, endpoint }: { readonly title: string; readonly endpoint: string }) {
  const resource = useResource<unknown>(endpoint);
  const records = normalizeRecords(resource.data);
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">REAL API DATA</span>
          <h2>{title}</h2>
        </div>
        <Status state={resource} />
      </div>
      {records.length === 0 ? (
        <Empty loading={resource.loading} error={resource.error} />
      ) : (
        <div className="record-list">
          {records.map((record, index) => (
            <article key={recordKey(record, index)}>
              <strong>{recordTitle(record, index)}</strong>
              <pre>{JSON.stringify(record, null, 2)}</pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Analytics() {
  const resource = useResource<EvaluationAnalytics>('/api/v1/evaluation/analytics');
  const entries = Object.entries(resource.data ?? {});
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">QUALITY SIGNALS</span>
          <h2>Evaluation Analytics</h2>
        </div>
        <Status state={resource} />
      </div>
      {entries.length === 0 ? (
        <Empty loading={resource.loading} error={resource.error} />
      ) : (
        <div className="analytics-grid">
          {entries.map(([key, value]) => (
            <article key={key}>
              <span>{humanize(key)}</span>
              <pre>{JSON.stringify(value, null, 2)}</pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Lookup({
  section,
}: {
  readonly section: Exclude<Section, 'overview' | 'skills' | 'mcp' | 'evaluation'>;
}) {
  const config = useMemo(
    () =>
      ({
        tasks: {
          label: 'Task ID',
          path: (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`,
        },
        workflows: {
          label: 'Plan ID',
          path: (id: string) => `/api/v1/workflows/plans/${encodeURIComponent(id)}`,
        },
        memory: {
          label: 'Memory ID',
          path: (id: string) => `/api/v1/memories/${encodeURIComponent(id)}`,
        },
      })[section],
    [section],
  );
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await managementRequest<unknown>(config.path(identifier.trim())));
    } catch (reason) {
      setError(formatError(reason));
    }
  }
  return (
    <div className="panel">
      <span className="eyebrow">ASSOCIATED RECORD LOOKUP</span>
      <h2>{config.label} 查询</h2>
      <form className="lookup" onSubmit={(event) => void submit(event)}>
        <label>
          {config.label}
          <input
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
            }}
            required
          />
        </label>
        <button type="submit">读取真实记录</button>
      </form>
      {error === undefined ? null : <p className="error">{error}</p>}
      {result === undefined ? null : (
        <pre className="result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

interface ResourceState<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
}

function useResource<T>(path: string): ResourceState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    managementRequest<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(formatError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [path]);
  return { data, error, loading } as const;
}

function Status({
  state,
}: {
  readonly state: { readonly loading: boolean; readonly error: string | undefined };
}) {
  return (
    <span className={state.error === undefined ? 'status ok' : 'status bad'}>
      {state.loading ? 'LOADING' : state.error === undefined ? 'CONNECTED' : 'UNAVAILABLE'}
    </span>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string | number;
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
function Empty({
  loading,
  error,
}: {
  readonly loading: boolean;
  readonly error: string | undefined;
}) {
  return <div className="empty">{loading ? '正在读取管理 API…' : (error ?? '当前没有记录。')}</div>;
}
function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : '—';
}
function normalizeRecords(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    for (const candidate of Object.values(value))
      if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function recordKey(record: Record<string, unknown>, index: number) {
  return firstDisplayString(record.id, record.skillId, record.serverId) ?? String(index);
}
function recordTitle(record: Record<string, unknown>, index: number) {
  return (
    firstDisplayString(record.name, record.skillId, record.serverId) ??
    `Record ${String(index + 1)}`
  );
}
function firstDisplayString(...values: readonly unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return undefined;
}
function humanize(value: string) {
  return value.replaceAll(/([A-Z])/g, ' $1').toUpperCase();
}
function formatError(reason: unknown) {
  if (reason instanceof ManagementApiError)
    return `${reason.message}: ${JSON.stringify(reason.payload)}`;
  return reason instanceof Error ? reason.message : 'Unknown management API error';
}
