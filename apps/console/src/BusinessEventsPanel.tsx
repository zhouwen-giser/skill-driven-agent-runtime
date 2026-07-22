import { useEffect, useState } from 'react';

import { managementRequest } from './api.js';

interface Inventory {
  readonly items: readonly Readonly<Record<string, unknown>>[];
}

export function BusinessEventsPanel() {
  const [subscriptions, setSubscriptions] = useState<Inventory['items']>([]);
  const [inbox, setInbox] = useState<Inventory['items']>([]);
  const [assessments, setAssessments] = useState<Inventory['items']>([]);
  const [incidents, setIncidents] = useState<Inventory['items']>([]);
  const [providerId, setProviderId] = useState('');
  const [message, setMessage] = useState('Loading PostgreSQL Business Event authority…');

  async function refresh() {
    try {
      const [subscriptionData, inboxData, assessmentData, incidentData] = await Promise.all([
        managementRequest<Inventory>('/api/v1/business-events/subscriptions'),
        managementRequest<Inventory>('/api/v1/business-events/inbox'),
        managementRequest<Inventory>('/api/v1/business-events/impact-assessments'),
        managementRequest<Inventory>('/api/v1/business-events/incidents'),
      ]);
      setSubscriptions(subscriptionData.items);
      setInbox(inboxData.items);
      setAssessments(assessmentData.items);
      setIncidents(incidentData.items);
      setMessage('Durable Inbox, cursors, impact and incident projections loaded.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Business Event projection failed.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function reconnect(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await managementRequest<Readonly<{ disposition: string }>>(
        `/api/v1/business-events/providers/${encodeURIComponent(providerId)}/reconnect`,
        { method: 'POST' },
      );
      setMessage(`${providerId}: ${result.disposition}`);
      await refresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Reconnect failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel warning-panel">
        <span>FROZEN BUSINESS EVENTS PROFILE 1.0</span>
        <strong>Feature OFF by default · Provider relation is not impact authority</strong>
        <p>
          Acknowledged stream generation, durable admission cursor and processed cursor are isolated
          from Task Notifications.
        </p>
      </section>
      <section className="metric-grid">
        <Metric label="Generations" value={subscriptions.length} />
        <Metric label="Inbox records" value={inbox.length} />
        <Metric
          label="Impact / incidents"
          value={`${String(assessments.length)} / ${String(incidents.length)}`}
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">PROVIDER SUBSCRIPTION COORDINATOR</span>
            <h2>Generation &amp; dual cursors</h2>
          </div>
          <button type="button" onClick={() => void refresh()}>
            Refresh real data
          </button>
        </div>
        <form className="filter-form" onSubmit={(event) => void reconnect(event)}>
          <label>
            Provider / MCP Server ID
            <input
              required
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value);
              }}
            />
          </label>
          <button type="submit">Start / reconnect</button>
        </form>
        <div className="event-generation-grid">
          {subscriptions.map((subscription) => (
            <article className="evidence-card" key={String(subscription.subscriptionId)}>
              <header>
                <span>{String(subscription.providerId)}</span>
                <code>{String(subscription.status)}</code>
              </header>
              <strong>{String(subscription.streamId)}</strong>
              <p>generation {String(subscription.generation)}</p>
              <p>
                admitted {String(subscription.lastDurablyAdmittedSequence)} · processed{' '}
                {String(subscription.lastProcessedSequence)}
              </p>
            </article>
          ))}
        </div>
      </section>
      <Projection title="Durable Inbox" eyebrow="ADMISSION BEFORE ACK PROGRESS" items={inbox} />
      <Projection
        title="Impact → User Criterion"
        eyebrow="RULE FIRST · BOUNDED SEMANTIC"
        items={assessments}
      />
      <Projection
        title="Continuity & Cross-Goal Incidents"
        eyebrow="CONSERVATIVE RECOVERY"
        items={incidents}
      />
      <p className="action-message">{message}</p>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>PostgreSQL projection</small>
    </article>
  );
}

function Projection({
  title,
  eyebrow,
  items,
}: {
  readonly title: string;
  readonly eyebrow: string;
  readonly items: Inventory['items'];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className="status">{items.length} records</span>
      </div>
      <div className="evidence-grid">
        {items.length === 0 ? <p>No durable records.</p> : null}
        {items.map((item, index) => (
          <article className="evidence-card" key={stableKey(item, index)}>
            <header>
              <span>{summary(item)}</span>
              <code>
                {displayScalar(item.status ?? item.classification ?? item.incidentKind, '')}
              </code>
            </header>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function stableKey(item: Readonly<Record<string, unknown>>, index: number): string {
  return displayScalar(
    item.subscriptionId ?? item.inboxId ?? item.assessmentId ?? item.incidentId,
    String(index),
  );
}

function summary(item: Readonly<Record<string, unknown>>): string {
  return displayScalar(
    item.eventId ?? item.assessmentId ?? item.incidentId ?? item.subscriptionId,
    'record',
  );
}

function displayScalar(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}
