import { useEffect, useState } from 'react';

import { managementRequest } from './api.js';

export interface PublicCapabilityCardView {
  readonly cardId: string;
  readonly revision: number;
  readonly catalogHash: string;
  readonly generationPolicyVersion: string;
  readonly profileVersion: string;
  readonly status: string;
  readonly description: string;
  readonly generationMode: string;
  readonly generatedAt: string;
  readonly profile: Readonly<{
    profileVersion: string;
    catalogHash: string;
    capabilities: readonly Readonly<{
      capabilityId: string;
      title: string;
      description: string;
      domain: string;
      effects: readonly string[];
      modes: readonly string[];
      taskTypes: readonly string[];
      limitations: readonly Readonly<{ code: string; message: string }>[];
    }>[];
  }>;
  readonly publicSkills: readonly Readonly<{
    id: string;
    name: string;
    description: string;
    tags: readonly string[];
    inputModes: readonly string[];
    outputModes: readonly string[];
  }>[];
}

export function CapabilitiesPanel() {
  const [card, setCard] = useState<PublicCapabilityCardView>();
  const [message, setMessage] = useState('Loading the active PostgreSQL snapshot.');

  async function refresh(path = '/api/v1/capabilities/card', method = 'GET') {
    try {
      const next = await managementRequest<PublicCapabilityCardView>(path, {
        method,
        ...(method === 'POST'
          ? {
              body: JSON.stringify({
                expectedVersion: card?.revision ?? 0,
                idempotencyKey: `console:capability-card:${String(card?.revision ?? 0)}`,
                actorId: 'console.operator',
                reason: 'Rebuild the reviewed public Capability Card projection.',
              }),
            }
          : {}),
      });
      setCard(next);
      setMessage('Active Public Capability Card loaded from the management API.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Capability Card request failed.');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="stack">
      <section className="panel warning-panel">
        <span>PUBLIC PROJECTION BOUNDARY</span>
        <strong>Allowlisted snapshot only</strong>
        <p>
          The A2A Agent Card reads this activated snapshot. Tools, Providers, credentials,
          Workflows, internal Skills, user data and live resources are excluded.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">PUBLIC CAPABILITY CARD</span>
            <h2>Activated A2A projection</h2>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void refresh()}>
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void refresh('/api/v1/capabilities/card/rebuild', 'POST')}
            >
              Rebuild &amp; activate
            </button>
          </div>
        </div>
        <p className="action-message">{message}</p>
        {card === undefined ? null : <CapabilityCardDetails card={card} />}
      </section>
    </div>
  );
}

export function CapabilityCardDetails({ card }: { readonly card: PublicCapabilityCardView }) {
  return (
    <div className="stack">
      <div className="analytics-grid">
        <article>
          <span>ACTIVE REVISION</span>
          <strong>
            {card.cardId} / {card.revision}
          </strong>
          <p>{card.status}</p>
        </article>
        <article>
          <span>CATALOG BINDING</span>
          <strong>{card.catalogHash}</strong>
          <p>Policy {card.generationPolicyVersion}</p>
        </article>
        <article>
          <span>GENERATION</span>
          <strong>{card.generationMode}</strong>
          <p>{card.generatedAt}</p>
        </article>
      </div>
      <article className="panel">
        <span className="eyebrow">STABLE PUBLIC DESCRIPTION</span>
        <h3>{card.description}</h3>
      </article>
      <section className="analytics-grid" aria-label="Public capabilities">
        {card.profile.capabilities.map((capability) => (
          <article key={capability.capabilityId}>
            <span>{capability.capabilityId}</span>
            <h3>{capability.title}</h3>
            <p>{capability.description}</p>
            <small>
              domain {capability.domain} · effects {capability.effects.join(', ') || 'none'} · modes{' '}
              {capability.modes.join(', ') || 'none'}
            </small>
            {capability.limitations.map((limitation) => (
              <p key={limitation.code} className="action-message">
                {limitation.code}: {limitation.message}
              </p>
            ))}
          </article>
        ))}
      </section>
      <section className="panel">
        <span className="eyebrow">ENABLED PUBLIC A2A SKILLS</span>
        {card.publicSkills.length === 0 ? (
          <p>No user-selectable public Skill is active.</p>
        ) : (
          <div className="analytics-grid">
            {card.publicSkills.map((skill) => (
              <article key={skill.id}>
                <span>{skill.id}</span>
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
                <small>
                  {skill.tags.join(', ')} · {skill.inputModes.join(', ')} →{' '}
                  {skill.outputModes.join(', ')}
                </small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
