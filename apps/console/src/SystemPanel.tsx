import { useEffect, useState } from 'react';

import { managementRequest } from './api.js';

const stages = [
  'intent',
  'goal',
  'skill_authoring',
  'skill_selection',
  'workflow_planning',
  'execution_decision',
  'goal_evaluation',
  'evaluation',
  'result_processing',
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

export function SystemPanel() {
  const [providers, setProviders] = useState<readonly Provider[]>([]);
  const [routes, setRoutes] = useState<unknown[]>([]);
  const [invocations, setInvocations] = useState<unknown[]>([]);
  const [policies, setPolicies] = useState<Record<string, unknown>>({});
  const [triggers, setTriggers] = useState<unknown[]>([]);
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
          managementRequest<unknown>('/api/v1/system/task-wait-policy'),
          managementRequest<unknown>('/api/v1/system/memory-retention-policy'),
          managementRequest<unknown>('/api/v1/system/evolution-policy'),
          managementRequest<Inventory<unknown>>('/api/v1/evolution-triggers'),
        ]);
      setProviders(providerData.items);
      setRoutes([...routeData.items]);
      setInvocations([...invocationData.items]);
      setPolicies({ taskWait: wait, memoryRetention: retention, evolution });
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
          <pre>{JSON.stringify(invocations, null, 2)}</pre>
        </article>
      </section>
      <section className="panel warning-panel">
        <span>RETENTION SAFETY</span>
        <strong>Automatic archive and delete remain disabled in V1.</strong>
        <p>
          Policy values are visible here; lifecycle changes require the explicit management API.
        </p>
      </section>
    </div>
  );
}
