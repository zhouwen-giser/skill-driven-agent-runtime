import { useEffect, useState } from 'react';

import {
  artifactCommand,
  getArtifact,
  getArtifactRuntimeView,
  getArtifactView,
  listArtifacts,
  type ArtifactManagementItem,
} from './api.js';

const views = [
  'versions',
  'diff',
  'lineage',
  'validation',
  'shadow',
  'promotion',
  'approvals',
  'activations',
  'usage',
  'outcomes',
  'drift',
  'audit',
] as const;

export function ArtifactPanel() {
  const [items, setItems] = useState<readonly ArtifactManagementItem[]>([]);
  const [selected, setSelected] = useState<ArtifactManagementItem>();
  const [detail, setDetail] = useState<unknown>();
  const [view, setView] = useState<(typeof views)[number]>('validation');
  const [viewData, setViewData] = useState<unknown>();
  const [detailStatus, setDetailStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error' | 'permission'
  >('idle');
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error' | 'permission'>(
    'loading',
  );
  const [message, setMessage] = useState('');
  const [sort, setSort] = useState<'created_desc' | 'created_asc' | 'key_asc'>('created_desc');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [nextCursor, setNextCursor] = useState<string>();
  const [runtime, setRuntime] = useState<readonly unknown[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<
    'loading' | 'ready' | 'empty' | 'error' | 'permission'
  >('loading');

  async function refresh(cursor?: string, append = false) {
    setStatus('loading');
    try {
      const result = await listArtifacts({
        limit: 50,
        sort,
        ...(cursor === undefined ? {} : { cursor }),
        ...(statusFilter === '' ? {} : { status: statusFilter }),
        ...(typeFilter === '' ? {} : { type: typeFilter }),
        ...(riskFilter === '' ? {} : { risk: riskFilter }),
      });
      const merged = append ? [...items, ...result.items] : result.items;
      setItems(merged);
      setNextCursor(result.nextCursor);
      setStatus(merged.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Artifact registry unavailable.';
      setMessage(text);
      setStatus(text.includes('403') ? 'permission' : 'error');
    }
    try {
      const [decisions, cases, models] = await Promise.all([
        getArtifactRuntimeView('decisions'),
        getArtifactRuntimeView('case-usage'),
        getArtifactRuntimeView('model-usage'),
      ]);
      const timeline = [...decisions.items, ...cases.items, ...models.items];
      setRuntime(timeline);
      setRuntimeStatus(timeline.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Runtime timeline unavailable.';
      setRuntimeStatus(text.includes('403') ? 'permission' : 'error');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function select(item: ArtifactManagementItem) {
    setSelected(item);
    setDetailStatus('loading');
    try {
      const [nextDetail, nextView] = await Promise.all([
        getArtifact(item.artifact_id),
        getArtifactView(item.artifact_id, view),
      ]);
      setDetail(nextDetail);
      setViewData(nextView);
      setDetailStatus('ready');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Artifact detail unavailable.';
      setMessage(text);
      setDetailStatus(text.includes('403') ? 'permission' : 'error');
    }
  }

  async function changeView(next: (typeof views)[number]) {
    setView(next);
    if (selected === undefined) return;
    setDetailStatus('loading');
    try {
      setViewData(await getArtifactView(selected.artifact_id, next));
      setDetailStatus('ready');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Artifact evidence unavailable.';
      setMessage(text);
      setDetailStatus(text.includes('403') ? 'permission' : 'error');
    }
  }

  return (
    <div className="artifact-workspace">
      <section className="panel" aria-labelledby="artifact-registry-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">P12 MANAGEMENT PROJECTION</span>
            <h2 id="artifact-registry-title">Artifact Registry</h2>
          </div>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <form
          className="lookup"
          aria-label="Artifact registry filters"
          onSubmit={(event) => {
            event.preventDefault();
            void refresh();
          }}
        >
          <label>
            Status filter
            <input
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
              }}
            />
          </label>
          <label>
            Artifact type filter
            <input
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
              }}
            />
          </label>
          <label>
            Risk filter
            <input
              value={riskFilter}
              onChange={(event) => {
                setRiskFilter(event.target.value);
              }}
            />
          </label>
          <label>
            Sort order
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
              }}
            >
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="key_asc">Artifact key</option>
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>
        <p className="sr-status" role="status" aria-live="polite">
          {status === 'loading'
            ? 'Loading Artifact registry.'
            : status === 'empty'
              ? 'No Artifacts match this scope.'
              : status === 'permission'
                ? 'Permission denied.'
                : status === 'error'
                  ? message
                  : `${String(items.length)} Artifacts loaded.`}
        </p>
        {status === 'ready' ? (
          <div className="table-scroll">
            <table>
              <caption>Tenant-authorized compiled Artifacts</caption>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Type</th>
                  <th scope="col">Version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Validation</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.artifact_id}>
                    <th scope="row">
                      <button type="button" onClick={() => void select(item)}>
                        {item.artifact_key}
                      </button>
                    </th>
                    <td>{item.artifact_type}</td>
                    <td>{item.version}</td>
                    <td>{item.status}</td>
                    <td>{item.risk_level}</td>
                    <td>{item.validation_status ?? 'not run'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {status === 'ready' && nextCursor !== undefined ? (
          <button
            type="button"
            onClick={() => {
              void refresh(nextCursor, true);
            }}
          >
            Load more Artifacts
          </button>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="artifact-runtime-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FORMAL RUNTIME EVIDENCE</span>
            <h2 id="artifact-runtime-title">Runtime decision timeline</h2>
          </div>
        </div>
        <p className="sr-status" role="status" aria-live="polite">
          {runtimeStatus === 'loading'
            ? 'Loading Runtime evidence.'
            : runtimeStatus === 'empty'
              ? 'No Runtime evidence matches this scope.'
              : runtimeStatus === 'permission'
                ? 'Permission denied for Runtime evidence.'
                : runtimeStatus === 'error'
                  ? 'Runtime evidence unavailable.'
                  : `${String(runtime.length)} Runtime evidence records loaded.`}
        </p>
        {runtimeStatus === 'ready' ? (
          <ol
            className="artifact-timeline"
            aria-label="Gateway, Rule, Template, Case and Model events"
          >
            {runtime.map((entry, index) => (
              <li key={runtimeKey(entry, index)}>
                <pre className="result">{JSON.stringify(entry, null, 2)}</pre>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {selected === undefined ? null : (
        <section className="panel" aria-labelledby="artifact-detail-title">
          <h2 id="artifact-detail-title">{selected.artifact_key}</h2>
          <p>
            Version {selected.version}; expected version and active-pointer lock are required for
            governance commands.
          </p>
          <div role="tablist" aria-label="Artifact evidence views" className="artifact-tabs">
            {views.map((candidate) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === candidate}
                key={candidate}
                onClick={() => void changeView(candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
          <p role="status" aria-live="polite">
            {detailStatus === 'loading'
              ? 'Loading Artifact evidence.'
              : detailStatus === 'permission'
                ? 'Permission denied for this evidence view.'
                : detailStatus === 'error'
                  ? message
                  : 'Artifact evidence ready.'}
          </p>
          {detailStatus === 'ready' ? (
            <pre className="result" tabIndex={0} aria-label={`${view} evidence`}>
              {JSON.stringify(viewData ?? detail, null, 2)}
            </pre>
          ) : null}
          <GovernanceForm item={selected} onComplete={refresh} />
        </section>
      )}
    </div>
  );
}

function GovernanceForm({
  item,
  onComplete,
}: {
  readonly item: ArtifactManagementItem;
  readonly onComplete: () => Promise<void>;
}) {
  const [operation, setOperation] = useState('revalidate');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [targetArtifactId, setTargetArtifactId] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [promotionPackageJson, setPromotionPackageJson] = useState('');

  async function execute() {
    setConfirming(false);
    try {
      await artifactCommand(item.artifact_id, operation, {
        version: item.version,
        expectedVersion: operation.startsWith('kill-switch')
          ? (item.active_pointer_version ?? 0)
          : item.version,
        expectedLockVersion: item.active_pointer_version ?? 0,
        artifactKey: item.artifact_key,
        validationRunId: `console-${operation}-${crypto.randomUUID()}`,
        validationType: operation === 'revalidate' ? 'revalidation' : 'static',
        datasetRef: 'console-operator-request',
        idempotencyKey: crypto.randomUUID(),
        reason,
        ...(approvalId === '' ? {} : { approvalId }),
        ...(evidenceHash === '' ? {} : { validationSummaryHash: evidenceHash }),
        ...(targetArtifactId === '' ? {} : { targetArtifactId }),
        ...(targetVersion === '' ? {} : { targetVersion: Number(targetVersion) }),
        ...(operation === 'build-promotion-package'
          ? { promotionPackage: JSON.parse(promotionPackageJson) as unknown }
          : {}),
      });
      setResult('Command accepted and audited.');
      await onComplete();
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Command failed.';
      setResult(
        text.includes('409') || text.includes('412')
          ? `${text} Refresh the Artifact before retrying; the expected version or pointer lock is stale.`
          : text,
      );
    }
  }

  return (
    <form
      className="lookup"
      onSubmit={(event) => {
        event.preventDefault();
        setConfirming(true);
      }}
    >
      <label>
        Governance operation
        <select
          value={operation}
          onChange={(event) => {
            setOperation(event.target.value);
          }}
        >
          {[
            'validate',
            'shadow',
            'build-promotion-package',
            'approve',
            'reject',
            'activate',
            'revalidate',
            'deprecate',
            'rollback',
            'kill-switch-enable',
            'kill-switch-disable',
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Required reason
        <textarea
          value={reason}
          required
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      <label>
        Approval ID when required
        <input
          value={approvalId}
          onChange={(event) => {
            setApprovalId(event.target.value);
          }}
        />
      </label>
      <label>
        Validation evidence hash when required
        <input
          value={evidenceHash}
          pattern="sha256:[0-9a-f]{64}"
          placeholder="sha256:..."
          onChange={(event) => {
            setEvidenceHash(event.target.value);
          }}
        />
      </label>
      <label>
        Governed rollback target Artifact ID
        <input
          value={targetArtifactId}
          onChange={(event) => {
            setTargetArtifactId(event.target.value);
          }}
        />
      </label>
      <label>
        Governed rollback target version
        <input
          type="number"
          min="1"
          value={targetVersion}
          onChange={(event) => {
            setTargetVersion(event.target.value);
          }}
        />
      </label>
      <label>
        Promotion package evidence JSON
        <textarea
          value={promotionPackageJson}
          placeholder='{"promotionPackageId":"...","artifactRef":"artifact-id:1", "...":"sha256:..."}'
          onChange={(event) => {
            setPromotionPackageJson(event.target.value);
          }}
        />
      </label>
      <button type="submit">Review command</button>
      {confirming ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="artifact-confirm-title">
          <h3 id="artifact-confirm-title">Confirm {operation}</h3>
          <p>This sends a version-bound, idempotent, audited command. It never auto-approves.</p>
          <button type="button" onClick={() => void execute()} autoFocus>
            Confirm
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
      <p role="status" aria-live="polite">
        {result}
      </p>
    </form>
  );
}

function runtimeKey(value: unknown, index: number): string {
  if (typeof value !== 'object' || value === null) return `runtime-${String(index)}`;
  const record = value as Readonly<Record<string, unknown>>;
  const candidate =
    record.gateway_decision_id ?? record.route_decision_ref ?? record.runtime_request_ref;
  return typeof candidate === 'string' ? candidate : `runtime-${String(index)}`;
}
