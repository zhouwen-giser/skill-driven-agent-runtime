import { useEffect, useState } from 'react';
import { managementRequest } from './api.js';

function display(value: unknown): string {
  return value === undefined
    ? 'unavailable'
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);
}
function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
function items(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const rows = record(value)?.items;
  return Array.isArray(rows)
    ? rows.flatMap((row: unknown) => {
        const parsed = record(row);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

export function TaskBusinessPanel({
  taskId,
  phase,
  value,
  commands,
  onRefresh,
}: {
  readonly taskId: string;
  readonly phase: string;
  readonly value: unknown;
  readonly commands: unknown;
  readonly onRefresh: () => Promise<void>;
}) {
  const [waypoints, setWaypoints] = useState('[]');
  const [density, setDensity] = useState('normal');
  const [prepared, setPrepared] = useState<Readonly<Record<string, unknown>>>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPrepared(undefined);
    setMessage(undefined);
  }, [taskId]);
  const projections = items(value);
  const base = `/api/v1/tasks/${encodeURIComponent(taskId)}/business`;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await operation();
      setMessage(JSON.stringify(result));
      await onRefresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : display(error));
    } finally {
      setBusy(false);
    }
  };
  const available =
    phase === 'executing' &&
    projections.some(
      (projection) =>
        projection.status === 'current' &&
        Array.isArray(projection.allowedInterventions) &&
        projection.allowedInterventions.length > 0,
    );
  return (
    <section className="panel" aria-label="Task business">
      <h3>Task business</h3>
      <p>
        Business data comes from the original remote Task. An accepted command still requires
        evidence of application.
      </p>
      {projections.length === 0 ? (
        <p>No business snapshot is available.</p>
      ) : (
        projections.map((projection) => (
          <article key={display(projection.bindingId)}>
            <strong>
              {display(projection.status)} · revision {display(projection.contextRevision)}
            </strong>
            <pre>{JSON.stringify(projection.identity, null, 2)}</pre>
            <pre>{JSON.stringify(projection.executionSummary, null, 2)}</pre>
            <p>
              Provider receive time: {display(projection.sourceTime ?? 'unavailable')} · SDAR
              receive time: {display(projection.sdarReceivedAt)}
            </p>
            <pre>{JSON.stringify(projection.quality, null, 2)}</pre>
            <p>
              Business outcome:{' '}
              {display(record(projection.businessOutcome)?.businessStatus ?? 'unknown')}
            </p>
            <pre>{JSON.stringify(projection.businessOutcome, null, 2)}</pre>
            <details>
              <summary>Geometry roles and retained samples</summary>
              <pre>{JSON.stringify(projection.geometry, null, 2)}</pre>
            </details>
            <details>
              <summary>Business requests and interventions</summary>
              <pre>
                {JSON.stringify(
                  {
                    inputRequests: projection.interactionRequests,
                    interventions: projection.allowedInterventions,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <ul>
              {(Array.isArray(projection.objects) ? projection.objects : []).map(
                (raw: unknown, index: number) => {
                  const object = record(raw);
                  const ref = record(object?.ref);
                  const digest = object?.digest;
                  return (
                    <li key={index}>
                      {display(ref?.kind)} · {display(ref?.id)} @ {display(ref?.revision)} ·{' '}
                      {display(object?.resolution)}
                      {typeof digest === 'string' ? (
                        <>
                          {' '}
                          ·{' '}
                          <a
                            href={`${base}/content/${encodeURIComponent(display(projection.bindingId))}/${encodeURIComponent(digest)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open complete retained JSON
                          </a>
                        </>
                      ) : null}
                    </li>
                  );
                },
              )}
            </ul>
          </article>
        ))
      )}
      {available ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const parsed: unknown = JSON.parse(waypoints);
              const result = await managementRequest<Readonly<Record<string, unknown>>>(
                `${base}/navigation/prepare`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    idempotencyKey: crypto.randomUUID(),
                    waypoints: parsed,
                    density,
                  }),
                },
              );
              setPrepared(result);
              return result;
            });
          }}
        >
          <h4>Adjust the running navigation plan</h4>
          <label>
            Waypoints (longitude / latitude JSON)
            <textarea
              value={waypoints}
              onChange={(event) => {
                setWaypoints(event.target.value);
              }}
            />
          </label>
          <label>
            Density
            <input
              value={density}
              onChange={(event) => {
                setDensity(event.target.value);
              }}
            />
          </label>
          <button disabled={busy} type="submit">
            Prepare adjustment for review
          </button>
        </form>
      ) : null}
      {prepared === undefined ? null : (
        <div>
          <h4>Review navigation adjustment</h4>
          <pre>{JSON.stringify(prepared, null, 2)}</pre>
          <button
            disabled={busy || prepared.state !== 'prepared'}
            onClick={() => {
              const intent = record(prepared.intent);
              void run(async () => {
                const result = await managementRequest<Readonly<Record<string, unknown>>>(
                  `${base}/commands/${encodeURIComponent(display(intent?.intentId))}/confirm`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      reason:
                        'Confirmed the displayed navigation adjustment from the operational console.',
                    }),
                  },
                );
                setPrepared(result);
                return result;
              });
            }}
          >
            Confirm and submit this adjustment
          </button>
        </div>
      )}
      <h4>Command evidence</h4>
      {items(commands).map((command) => {
        const intent = record(command.intent);
        return (
          <article key={display(intent?.intentId)}>
            <pre>{JSON.stringify(command, null, 2)}</pre>
            {['dispatching', 'accepted', 'uncertain'].includes(display(command.state)) ? (
              <button
                disabled={busy}
                onClick={() => {
                  void run(() =>
                    managementRequest(
                      `${base}/commands/${encodeURIComponent(display(intent?.intentId))}/reconcile`,
                      { method: 'POST', body: '{}' },
                    ),
                  );
                }}
              >
                Read business application evidence
              </button>
            ) : null}
          </article>
        );
      })}
      {message === undefined ? null : <output>{message}</output>}
    </section>
  );
}
