import { useEffect, useMemo, useState } from 'react';
import {
  type EvaluationAnalytics,
  type HealthPayload,
  type McpServerSummary,
  ManagementApiError,
  managementRequest,
  type SkillSummary,
} from './api.js';
import { McpPanel } from './McpPanel.js';
import { SkillsPanel } from './SkillsPanel.js';
import { WorkflowPanel } from './WorkflowPanel.js';
import { TaskPanel } from './TaskPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { PromptPanel } from './PromptPanel.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import { SystemPanel } from './SystemPanel.js';
import { BusinessEventsPanel } from './BusinessEventsPanel.js';
import { CapabilitiesPanel } from './CapabilitiesPanel.js';

type Section =
  | 'overview'
  | 'skills'
  | 'capabilities'
  | 'mcp'
  | 'workflows'
  | 'tasks'
  | 'prompts'
  | 'memory'
  | 'evaluation'
  | 'business-events'
  | 'system';

const navigation: readonly {
  readonly id: Section;
  readonly label: string;
  readonly note: string;
}[] = [
  { id: 'overview', label: '运行概览', note: 'System' },
  { id: 'tasks', label: '任务与 Goal', note: 'Trace' },
  { id: 'skills', label: 'Skills', note: 'Lifecycle' },
  { id: 'capabilities', label: 'Capabilities', note: 'Public Card' },
  { id: 'workflows', label: 'Workflows', note: 'DAG' },
  { id: 'mcp', label: 'MCP Servers', note: 'Tools' },
  { id: 'business-events', label: 'Business Events', note: 'Inbox' },
  { id: 'prompts', label: 'Prompts', note: 'Versions' },
  { id: 'memory', label: '长期记忆', note: 'Recall' },
  { id: 'evaluation', label: '评估分析', note: 'Quality' },
  { id: 'system', label: 'System Config', note: 'Models' },
];

export function App() {
  const [section, setSection] = useState<Section>('overview');
  const [target, setTarget] = useState<
    Readonly<{
      taskId?: string;
      planId?: string;
      skillId?: string;
      serverId?: string;
      toolName?: string;
      providerId?: string;
      model?: string;
    }>
  >({});
  function navigate(
    next: Readonly<{
      section: Section;
      taskId?: string;
      planId?: string;
      skillId?: string;
      serverId?: string;
      toolName?: string;
      providerId?: string;
      model?: string;
    }>,
  ) {
    setTarget(next);
    setSection(next.section);
  }
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
                setTarget({});
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
          <SectionView section={section} target={target} onNavigate={navigate} />
        </section>
      </main>
    </div>
  );
}

function SectionView({
  section,
  target,
  onNavigate,
}: {
  readonly section: Section;
  readonly target: Readonly<{
    taskId?: string;
    planId?: string;
    skillId?: string;
    serverId?: string;
    toolName?: string;
    providerId?: string;
    model?: string;
  }>;
  readonly onNavigate: (
    target: Readonly<{
      section: Section;
      taskId?: string;
      planId?: string;
      skillId?: string;
      serverId?: string;
      toolName?: string;
      providerId?: string;
      model?: string;
    }>,
  ) => void;
}) {
  if (section === 'overview') return <Overview />;
  if (section === 'skills')
    return (
      <SkillsPanel
        {...(target.skillId === undefined ? {} : { focusSkillId: target.skillId })}
        onExploreTasks={(skillId) => {
          onNavigate({ section: 'tasks', skillId });
        }}
      />
    );
  if (section === 'capabilities') return <CapabilitiesPanel />;
  if (section === 'mcp')
    return (
      <McpPanel
        {...(target.serverId === undefined ? {} : { focusServerId: target.serverId })}
        {...(target.toolName === undefined ? {} : { focusToolName: target.toolName })}
        onOpenTask={(taskId) => {
          onNavigate({ section: 'tasks', taskId });
        }}
      />
    );
  if (section === 'evaluation')
    return (
      <EvaluationPanel
        {...(target.skillId === undefined ? {} : { initialSkillId: target.skillId })}
        onOpenTask={(taskId) => {
          onNavigate({ section: 'tasks', taskId });
        }}
      />
    );
  if (section === 'business-events') return <BusinessEventsPanel />;
  if (section === 'workflows')
    return (
      <WorkflowPanel
        {...(target.planId === undefined ? {} : { initialPlanId: target.planId })}
        onOpenTask={(taskId) => {
          onNavigate({ section: 'tasks', taskId });
        }}
      />
    );
  if (section === 'tasks')
    return (
      <TaskPanel
        {...(target.taskId === undefined ? {} : { initialTaskId: target.taskId })}
        {...(target.skillId === undefined ? {} : { initialSkillId: target.skillId })}
        onNavigate={(next) => {
          onNavigate(
            next.kind === 'workflow'
              ? { section: 'workflows', planId: next.id }
              : next.kind === 'skill'
                ? { section: 'skills', skillId: next.id }
                : next.kind === 'mcp'
                  ? {
                      section: 'mcp',
                      serverId: next.id,
                      ...(next.secondary === undefined ? {} : { toolName: next.secondary }),
                    }
                  : next.kind === 'model'
                    ? {
                        section: 'system',
                        providerId: next.id,
                        ...(next.secondary === undefined ? {} : { model: next.secondary }),
                      }
                    : { section: 'evaluation', skillId: next.id },
          );
        }}
      />
    );
  if (section === 'prompts') return <PromptPanel />;
  if (section === 'system')
    return (
      <SystemPanel
        {...(target.providerId === undefined ? {} : { focusProviderId: target.providerId })}
        {...(target.model === undefined ? {} : { focusModel: target.model })}
        onOpenTask={(taskId) => {
          onNavigate({ section: 'tasks', taskId });
        }}
      />
    );
  return (
    <MemoryPanel
      onOpenTask={(taskId) => {
        onNavigate({ section: 'tasks', taskId });
      }}
    />
  );
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
      <div className="panel warning-panel">
        <span>DATA RETENTION BASELINE</span>
        <strong>
          Historical data: {health.data?.historicalDataRetention?.default ?? 'indefinite'}
        </strong>
        <p>
          Automatic archive and deletion are OFF. Retention-day fields are advisory only; V1 runs no
          cleanup scheduler.
        </p>
      </div>
    </>
  );
}

export function Analytics() {
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

export function Lookup({
  section,
}: {
  readonly section: Exclude<
    Section,
    | 'overview'
    | 'skills'
    | 'capabilities'
    | 'mcp'
    | 'evaluation'
    | 'prompts'
    | 'system'
    | 'business-events'
  >;
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
  if (Array.isArray(value)) return value.length;
  if (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray(value.items)
  ) {
    return value.items.length;
  }
  return '—';
}
function humanize(value: string) {
  return value.replaceAll(/([A-Z])/g, ' $1').toUpperCase();
}
function formatError(reason: unknown) {
  if (reason instanceof ManagementApiError)
    return `${reason.message}: ${JSON.stringify(reason.payload)}`;
  return reason instanceof Error ? reason.message : 'Unknown management API error';
}
