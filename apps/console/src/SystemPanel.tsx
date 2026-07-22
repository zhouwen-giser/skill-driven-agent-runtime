import { useEffect, useState } from 'react';

import { managementRequest } from './api.js';
import { TaskReferenceLinks } from './RelatedLinks.js';

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
interface Inventory<T> {
  readonly items: readonly T[];
}
interface Provider {
  readonly providerId: string;
  readonly name: string;
  readonly kind: string;
  readonly apiStyle: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly enabled: boolean;
  readonly timeoutMs: number;
}
interface TaskWaitPolicy {
  readonly timeoutSeconds: number;
  readonly updatedAt: string;
}
interface MemoryRetentionPolicy {
  readonly reviewAfterDays: number;
  readonly archiveAfterDays: number | null;
  readonly deleteAfterDays: number | null;
  readonly automaticArchiveEnabled: false;
  readonly automaticDeleteEnabled: false;
  readonly updatedAt: string;
}
interface EvolutionPolicy {
  readonly successThreshold: number;
  readonly updatedAt: string;
}

export function SystemPanel({
  focusProviderId,
  focusModel,
  onOpenTask,
}: {
  readonly focusProviderId?: string;
  readonly focusModel?: string;
  readonly onOpenTask?: (taskId: string) => void;
}) {
  const [providers, setProviders] = useState<readonly Provider[]>([]);
  const [routes, setRoutes] = useState<unknown[]>([]);
  const [invocations, setInvocations] = useState<unknown[]>([]);
  const [policies, setPolicies] = useState<Record<string, unknown>>({});
  const [triggers, setTriggers] = useState<unknown[]>([]);
  const [waitSeconds, setWaitSeconds] = useState('300');
  const [retention, setRetention] = useState({
    reviewAfterDays: '90',
    archiveAfterDays: '365',
    deleteAfterDays: '730',
  });
  const [successThreshold, setSuccessThreshold] = useState('2');
  const [message, setMessage] = useState('Loading authoritative configuration…');
  const [provider, setProvider] = useState({
    providerId: '',
    name: '',
    kind: 'openai_compatible',
    apiStyle: 'openai_chat_completions',
    baseUrl: '',
    model: '',
    timeoutMs: '30000',
    credentialHeaders: '{}',
  });
  const [route, setRoute] = useState({ stage: 'workflow_planning', providerId: '' });

  async function refresh() {
    try {
      const [providerData, routeData, invocationData, wait, retention, evolution, triggerData] =
        await Promise.all([
          managementRequest<Inventory<Provider>>('/api/v1/models/providers'),
          managementRequest<Inventory<unknown>>('/api/v1/models/routes'),
          managementRequest<Inventory<unknown>>('/api/v1/models/invocations'),
          managementRequest<TaskWaitPolicy>('/api/v1/system/task-wait-policy'),
          managementRequest<MemoryRetentionPolicy>('/api/v1/system/memory-retention-policy'),
          managementRequest<EvolutionPolicy>('/api/v1/system/evolution-policy'),
          managementRequest<Inventory<unknown>>('/api/v1/evolution-triggers'),
        ]);
      setProviders(providerData.items);
      setRoutes([...routeData.items]);
      setInvocations([...invocationData.items]);
      setPolicies({ taskWait: wait, memoryRetention: retention, evolution });
      setWaitSeconds(String(wait.timeoutSeconds));
      setRetention({
        reviewAfterDays: String(retention.reviewAfterDays),
        archiveAfterDays:
          retention.archiveAfterDays === null ? '' : String(retention.archiveAfterDays),
        deleteAfterDays:
          retention.deleteAfterDays === null ? '' : String(retention.deleteAfterDays),
      });
      setSuccessThreshold(String(evolution.successThreshold));
      setTriggers([...triggerData.items]);
      setMessage('PostgreSQL configuration and audit evidence loaded.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Configuration load failed.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function saveProvider(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const credentialHeaders: unknown = JSON.parse(provider.credentialHeaders);
      await managementRequest(
        `/api/v1/models/providers/${encodeURIComponent(provider.providerId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...provider,
            timeoutMs: Number(provider.timeoutMs),
            enabled: true,
            credentialHeaders,
          }),
        },
      );
      await refresh();
      setMessage('Provider encrypted and configured; credentials are never returned.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Provider update failed.');
    }
  }
  async function saveRoute(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await managementRequest(`/api/v1/models/routes/${route.stage}`, {
        method: 'PUT',
        body: JSON.stringify({ providerId: route.providerId }),
      });
      await refresh();
      setMessage('Fixed stage route updated. Runtime fallback remains disabled.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Route update failed.');
    }
  }

  async function savePolicy(kind: 'wait' | 'retention' | 'evolution') {
    try {
      if (kind === 'wait')
        await managementRequest('/api/v1/system/task-wait-policy', {
          method: 'PUT',
          body: JSON.stringify({ timeoutSeconds: Number(waitSeconds) }),
        });
      if (kind === 'retention')
        await managementRequest('/api/v1/system/memory-retention-policy', {
          method: 'PUT',
          body: JSON.stringify({
            reviewAfterDays: Number(retention.reviewAfterDays),
            archiveAfterDays:
              retention.archiveAfterDays === '' ? null : Number(retention.archiveAfterDays),
            deleteAfterDays:
              retention.deleteAfterDays === '' ? null : Number(retention.deleteAfterDays),
            automaticArchiveEnabled: false,
            automaticDeleteEnabled: false,
          }),
        });
      if (kind === 'evolution')
        await managementRequest('/api/v1/system/evolution-policy', {
          method: 'PUT',
          body: JSON.stringify({ successThreshold: Number(successThreshold) }),
        });
      await refresh();
      setMessage(`${kind} policy updated through the authoritative service.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Policy update failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel warning-panel">
        <span>SYSTEM CONFIGURATION</span>
        <strong>No authentication · one Provider per fixed stage · no fallback</strong>
        <p>Credentials are encrypted at rest. Read APIs and audits are credential-safe.</p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">MODEL OPERATIONS</span>
            <h2>Providers &amp; Stage Routes</h2>
          </div>
          <button type="button" onClick={() => void refresh()}>
            Refresh real data
          </button>
        </div>
        {focusProviderId === undefined ? null : (
          <p className="action-message">
            Linked model Provider: {focusProviderId}
            {focusModel === undefined ? '' : ` / ${focusModel}`}
          </p>
        )}
        <form className="filter-form" onSubmit={(event) => void saveProvider(event)}>
          {(['providerId', 'name', 'baseUrl', 'model', 'timeoutMs'] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                required
                value={provider[key]}
                onChange={(event) => {
                  setProvider({ ...provider, [key]: event.target.value });
                }}
              />
            </label>
          ))}
          <label>
            kind
            <select
              value={provider.kind}
              onChange={(event) => {
                setProvider({ ...provider, kind: event.target.value });
              }}
            >
              <option>openai_compatible</option>
              <option>local</option>
              <option>other_vendor</option>
            </select>
          </label>
          <label>
            apiStyle
            <select
              value={provider.apiStyle}
              onChange={(event) => {
                setProvider({ ...provider, apiStyle: event.target.value });
              }}
            >
              <option>openai_chat_completions</option>
              <option>anthropic_messages</option>
            </select>
          </label>
          <label>
            credentialHeaders (write-only JSON)
            <input
              value={provider.credentialHeaders}
              onChange={(event) => {
                setProvider({ ...provider, credentialHeaders: event.target.value });
              }}
            />
          </label>
          <button type="submit">Encrypt &amp; save Provider</button>
        </form>
        <form className="lookup" onSubmit={(event) => void saveRoute(event)}>
          <label>
            stage
            <select
              value={route.stage}
              onChange={(event) => {
                setRoute({ ...route, stage: event.target.value });
              }}
            >
              {stages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label>
            providerId
            <input
              required
              value={route.providerId}
              onChange={(event) => {
                setRoute({ ...route, providerId: event.target.value });
              }}
            />
          </label>
          <button type="submit">Route fixed stage</button>
        </form>
        <p className="action-message">{message}</p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RUNTIME POLICY CONTROLS</span>
            <h2>Wait, Retention &amp; Evolution</h2>
          </div>
        </div>
        <div className="analytics-grid">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void savePolicy('wait');
            }}
          >
            <label>
              Task wait timeout (seconds)
              <input
                type="number"
                min="1"
                required
                value={waitSeconds}
                onChange={(event) => {
                  setWaitSeconds(event.target.value);
                }}
              />
            </label>
            <button type="submit">Update wait policy</button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void savePolicy('retention');
            }}
          >
            <label>
              Review after days
              <input
                type="number"
                min="1"
                required
                value={retention.reviewAfterDays}
                onChange={(event) => {
                  setRetention({ ...retention, reviewAfterDays: event.target.value });
                }}
              />
            </label>
            <label>
              Archive after days
              <input
                type="number"
                min="1"
                value={retention.archiveAfterDays}
                onChange={(event) => {
                  setRetention({ ...retention, archiveAfterDays: event.target.value });
                }}
              />
            </label>
            <label>
              Delete after days
              <input
                type="number"
                min="1"
                value={retention.deleteAfterDays}
                onChange={(event) => {
                  setRetention({ ...retention, deleteAfterDays: event.target.value });
                }}
              />
            </label>
            <p>Automatic archive: OFF · Automatic delete: OFF</p>
            <button type="submit">Update retention values</button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void savePolicy('evolution');
            }}
          >
            <label>
              Successful experiences required
              <input
                type="number"
                min="2"
                required
                value={successThreshold}
                onChange={(event) => {
                  setSuccessThreshold(event.target.value);
                }}
              />
            </label>
            <button type="submit">Update evolution threshold</button>
          </form>
        </div>
      </section>
      <section className="analytics-grid">
        <article>
          <span>CREDENTIAL-SAFE PROVIDERS</span>
          <pre>{JSON.stringify(providers, null, 2)}</pre>
        </article>
        <article>
          <span>FIXED STAGE ROUTES</span>
          <pre>{JSON.stringify(routes, null, 2)}</pre>
        </article>
        <article>
          <span>WAIT / RETENTION / EVOLUTION POLICIES</span>
          <pre>{JSON.stringify(policies, null, 2)}</pre>
        </article>
        <article>
          <span>EVOLUTION TRIGGERS</span>
          <pre>{JSON.stringify(triggers, null, 2)}</pre>
        </article>
        <article>
          <span>SANITIZED MODEL INVOCATIONS</span>
          <TaskReferenceLinks value={invocations} onOpenTask={onOpenTask} />
          <pre>{JSON.stringify(invocations, null, 2)}</pre>
        </article>
      </section>
      <section className="panel warning-panel">
        <span>RETENTION SAFETY</span>
        <strong>Automatic archive and delete remain disabled in V1.</strong>
        <p>
          Retention values can be changed, but automatic lifecycle actions remain domain-disabled.
        </p>
      </section>
    </div>
  );
}
