import { useCallback, useEffect, useState } from 'react';

import { managementRequest } from './api.js';
import { TaskReferenceLinks } from './RelatedLinks.js';

type McpView = 'tools' | 'operations' | 'invocations' | 'warnings';
interface McpServerRecord extends Record<string, unknown> {
  readonly serverId: string;
  readonly name: string;
  readonly status: string;
  readonly endpoint: string;
  readonly toolRevision: number;
}

export function McpPanel({
  focusServerId,
  focusToolName,
  onOpenTask,
}: {
  readonly focusServerId?: string;
  readonly focusToolName?: string;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const [servers, setServers] = useState<readonly McpServerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [detail, setDetail] = useState<unknown>();
  const [selectedServer, setSelectedServer] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [toolMetadata, setToolMetadata] = useState({
    toolName: '',
    purpose: '',
    returnDescription: '',
    scenarios: '',
    constraints: '',
    commonErrors: '',
    tags: '',
  });
  const [toolSemantics, setToolSemantics] = useState({
    toolName: '',
    effect: 'unknown',
    execution: 'unknown',
    cancellation: 'unknown',
    idempotency: 'unknown',
    replay: 'unknown',
  });
  const [form, setForm] = useState({ serverId: '', name: '', endpoint: '', authorization: '' });
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await managementRequest<{ readonly items: readonly McpServerRecord[] }>(
        '/api/v1/mcp/servers',
      );
      setServers(payload.items);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  async function register(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await managementRequest('/api/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          serverId: form.serverId,
          name: form.name,
          endpoint: form.endpoint,
          credentialHeaders: form.authorization === '' ? {} : { Authorization: form.authorization },
        }),
      });
      setForm({ serverId: '', name: '', endpoint: '', authorization: '' });
      await reload();
      return 'MCP Server 已注册并完成 Tool 发现。';
    }, setMessage);
  }

  async function mutate(serverId: string, operation: 'refresh' | 'health' | 'delete') {
    await runAction(async () => {
      const suffix = operation === 'delete' ? '' : `/${operation}`;
      await managementRequest(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}${suffix}`, {
        method: operation === 'delete' ? 'DELETE' : 'POST',
      });
      setPendingDelete(undefined);
      await reload();
      return `${serverId}: ${operation} 完成。`;
    }, setMessage);
  }

  async function inspect(serverId: string, view: McpView) {
    await runAction(async () => {
      setSelectedServer(serverId);
      setDetail(
        await managementRequest(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/${view}`),
      );
      return `${serverId}: ${view}`;
    }, setMessage);
  }

  async function updateCredentials(serverId: string) {
    await runAction(async () => {
      await managementRequest(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ credentialHeaders: { Authorization: credentials[serverId] ?? '' } }),
      });
      setCredentials({ ...credentials, [serverId]: '' });
      return `${serverId}: credentials updated`;
    }, setMessage);
  }

  async function updateToolMetadata(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedServer === undefined) return;
    await runAction(async () => {
      await managementRequest(
        `/api/v1/mcp/servers/${encodeURIComponent(selectedServer)}/tools/${encodeURIComponent(toolMetadata.toolName)}/enhancement`,
        {
          method: 'PUT',
          body: JSON.stringify({
            purpose: toolMetadata.purpose,
            returnDescription: toolMetadata.returnDescription,
            scenarios: splitList(toolMetadata.scenarios),
            constraints: splitList(toolMetadata.constraints),
            commonErrors: splitList(toolMetadata.commonErrors),
            tags: splitList(toolMetadata.tags),
          }),
        },
      );
      return `${selectedServer}/${toolMetadata.toolName}: metadata updated`;
    }, setMessage);
  }

  async function updateToolSemantics(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedServer === undefined) return;
    await runAction(async () => {
      const { toolName, ...semantics } = toolSemantics;
      await managementRequest(
        `/api/v1/mcp/servers/${encodeURIComponent(selectedServer)}/tools/${encodeURIComponent(toolName)}/execution-semantics`,
        { method: 'PUT', body: JSON.stringify(semantics) },
      );
      await inspect(selectedServer, 'tools');
      return `${selectedServer}/${toolName}: execution semantics override retained`;
    }, setMessage);
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">REAL LIFECYCLE</span>
            <h2>MCP Server Registry</h2>
          </div>
          <span className={loading ? 'status' : 'status ok'}>
            {loading ? 'LOADING' : 'CONNECTED'}
          </span>
        </div>
        {focusServerId === undefined ? null : (
          <p className="action-message">
            Linked MCP {focusToolName === undefined ? 'Server' : 'Tool'}: {focusServerId}
            {focusToolName === undefined ? '' : ` / ${focusToolName}`}
          </p>
        )}
        <form className="admin-form" onSubmit={(event) => void register(event)}>
          <label>
            Server ID
            <input
              required
              value={form.serverId}
              onChange={(event) => {
                setForm({ ...form, serverId: event.target.value });
              }}
            />
          </label>
          <label>
            名称
            <input
              required
              value={form.name}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
            />
          </label>
          <label>
            Streamable HTTP Endpoint
            <input
              required
              type="url"
              value={form.endpoint}
              onChange={(event) => {
                setForm({ ...form, endpoint: event.target.value });
              }}
            />
          </label>
          <label>
            Authorization（加密保存）
            <input
              type="password"
              value={form.authorization}
              onChange={(event) => {
                setForm({ ...form, authorization: event.target.value });
              }}
            />
          </label>
          <button type="submit">注册并发现 Tools</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <div className="record-list">
        {servers.map((server) => (
          <article
            key={server.serverId}
            className={server.serverId === focusServerId ? 'linked-record' : undefined}
          >
            <div className="record-heading">
              <div>
                <strong>{server.name}</strong>
                <small>
                  {server.serverId} · revision {server.toolRevision}
                </small>
              </div>
              <span className="status ok">{server.status}</span>
            </div>
            <p className="endpoint">{server.endpoint}</p>
            <div className="credential-row">
              <label>
                New Authorization
                <input
                  type="password"
                  value={credentials[server.serverId] ?? ''}
                  onChange={(event) => {
                    setCredentials({ ...credentials, [server.serverId]: event.target.value });
                  }}
                />
              </label>
              <button
                disabled={!credentials[server.serverId]}
                onClick={() => void updateCredentials(server.serverId)}
              >
                Validate and rotate
              </button>
            </div>
            <div className="action-row">
              <button onClick={() => void mutate(server.serverId, 'refresh')}>刷新 Tools</button>
              <button onClick={() => void mutate(server.serverId, 'health')}>健康检查</button>
              {(['tools', 'operations', 'invocations', 'warnings'] as const).map((view) => (
                <button key={view} onClick={() => void inspect(server.serverId, view)}>
                  {view}
                </button>
              ))}
              {pendingDelete === server.serverId ? (
                <button className="danger" onClick={() => void mutate(server.serverId, 'delete')}>
                  确认删除
                </button>
              ) : (
                <button
                  onClick={() => {
                    setPendingDelete(server.serverId);
                  }}
                >
                  删除…
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {detail === undefined ? null : (
        <section className="panel">
          <TaskReferenceLinks value={detail} onOpenTask={onOpenTask} />
          <pre className="result">{JSON.stringify(detail, null, 2)}</pre>
          {selectedServer === undefined ? null : (
            <>
              <form
                className="admin-form tool-form"
                aria-label="MCP Tool execution semantics override"
                onSubmit={(event) => void updateToolSemantics(event)}
              >
                <h3>Execution semantics authority</h3>
                <p>
                  MCP declarations take priority. This administrator override is retained across
                  refreshes and is used when the Tool has no MCP declaration.
                </p>
                <label>
                  Tool name
                  <input
                    required
                    value={toolSemantics.toolName}
                    onChange={(event) => {
                      setToolSemantics({ ...toolSemantics, toolName: event.target.value });
                    }}
                  />
                </label>
                <SemanticsSelect
                  label="Effect"
                  value={toolSemantics.effect}
                  values={['read_only', 'side_effecting', 'unknown']}
                  onChange={(effect) => {
                    setToolSemantics({ ...toolSemantics, effect });
                  }}
                />
                <SemanticsSelect
                  label="Execution"
                  value={toolSemantics.execution}
                  values={['synchronous', 'task_capable', 'task_required', 'unknown']}
                  onChange={(execution) => {
                    setToolSemantics({ ...toolSemantics, execution });
                  }}
                />
                <SemanticsSelect
                  label="Cancellation"
                  value={toolSemantics.cancellation}
                  values={['unsupported', 'cooperative', 'task_cancel', 'unknown']}
                  onChange={(cancellation) => {
                    setToolSemantics({ ...toolSemantics, cancellation });
                  }}
                />
                <SemanticsSelect
                  label="Idempotency"
                  value={toolSemantics.idempotency}
                  values={['none', 'client_request_key', 'server_managed', 'unknown']}
                  onChange={(idempotency) => {
                    setToolSemantics({ ...toolSemantics, idempotency });
                  }}
                />
                <SemanticsSelect
                  label="Replay"
                  value={toolSemantics.replay}
                  values={['allowed', 'simulation_only', 'forbidden', 'unknown']}
                  onChange={(replay) => {
                    setToolSemantics({ ...toolSemantics, replay });
                  }}
                />
                <button type="submit">Save execution semantics override</button>
              </form>
              <form
                className="admin-form tool-form"
                onSubmit={(event) => void updateToolMetadata(event)}
              >
                <label>
                  Tool name
                  <input
                    required
                    value={toolMetadata.toolName}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, toolName: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Purpose
                  <input
                    required
                    value={toolMetadata.purpose}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, purpose: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Return description
                  <input
                    required
                    value={toolMetadata.returnDescription}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, returnDescription: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Scenarios (comma-separated)
                  <input
                    value={toolMetadata.scenarios}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, scenarios: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Constraints (comma-separated)
                  <input
                    value={toolMetadata.constraints}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, constraints: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Common errors (comma-separated)
                  <input
                    value={toolMetadata.commonErrors}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, commonErrors: event.target.value });
                    }}
                  />
                </label>
                <label>
                  Tags (comma-separated)
                  <input
                    value={toolMetadata.tags}
                    onChange={(event) => {
                      setToolMetadata({ ...toolMetadata, tags: event.target.value });
                    }}
                  />
                </label>
                <button type="submit">Save Tool metadata</button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function SemanticsSelect<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly values: readonly T[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
      >
        {values.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </label>
  );
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

async function runAction(action: () => Promise<string>, setMessage: (value: string) => void) {
  try {
    setMessage(await action());
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : '管理操作失败。');
  }
}
