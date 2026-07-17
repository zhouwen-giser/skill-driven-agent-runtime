import { useState } from 'react';

import { managementRequest } from './api.js';

const emptyToolPolicy = '{"required":[],"optional":[],"forbidden":[]}';
const defaultRuntimePolicy = '{"autoConfirmPlan":false}';

export function SkillStudio({ onRegistryChanged }: { readonly onRegistryChanged: () => void }) {
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<unknown>();
  const [author, setAuthor] = useState({
    skillId: '',
    description: '',
    toolPolicy: emptyToolPolicy,
    runtimePolicy: defaultRuntimePolicy,
    status: 'draft',
    sourceKind: 'admin',
  });
  const [registration, setRegistration] = useState('');
  const [packageRoot, setPackageRoot] = useState('');
  const [draft, setDraft] = useState({
    draftId: '',
    skillId: '',
    actor: 'anonymous-management',
    status: 'enabled',
    toolPolicy: emptyToolPolicy,
    runtimePolicy: defaultRuntimePolicy,
  });
  const [candidateId, setCandidateId] = useState('');
  const [correction, setCorrection] = useState('');
  const [diff, setDiff] = useState({ skillId: '', from: '1', to: '2' });
  const [relation, setRelation] = useState({
    sourceSkillId: '',
    targetSkillId: '',
    relationType: 'depends_on',
    metadata: '{}',
  });
  const [relationId, setRelationId] = useState('');

  async function authorSkill(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const value = await managementRequest('/api/v1/skills/author', {
        method: 'POST',
        body: JSON.stringify({
          skillId: author.skillId,
          naturalLanguageDescription: author.description,
          toolPolicy: parseRecord(author.toolPolicy),
          runtimePolicy: parseRecord(author.runtimePolicy),
          status: author.status,
          sourceKind: author.sourceKind,
        }),
      });
      setResult(value);
      onRegistryChanged();
      return `${author.skillId}: constrained authoring completed.`;
    });
  }
  async function register(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const value = await managementRequest('/api/v1/skills', {
        method: 'POST',
        body: JSON.stringify(parseUnknown(registration)),
      });
      setResult(value);
      onRegistryChanged();
      return 'Validated Skill definition registered.';
    });
  }
  async function packageAction(operation: 'validate' | 'import') {
    await run(async () => {
      const value = await managementRequest(`/api/v1/skill-packages/${operation}`, {
        method: 'POST',
        body: JSON.stringify({ packageRoot }),
      });
      setResult(value);
      if (operation === 'import') onRegistryChanged();
      return `Skill Package ${operation} completed.`;
    });
  }
  async function draftAction(operation: 'get' | 'publish') {
    await run(async () => {
      const path = `/api/v1/skill-drafts/${encodeURIComponent(draft.draftId)}${operation === 'publish' ? '/publish' : ''}`;
      const value = await managementRequest(
        path,
        operation === 'get'
          ? undefined
          : {
              method: 'POST',
              body: JSON.stringify({
                actor: draft.actor,
                skillId: draft.skillId,
                toolPolicy: parseRecord(draft.toolPolicy),
                runtimePolicy: parseRecord(draft.runtimePolicy),
                status: draft.status,
              }),
            },
      );
      setResult(value);
      if (operation === 'publish') onRegistryChanged();
      return `${draft.draftId}: ${operation} completed.`;
    });
  }
  async function candidateAction(operation: 'get' | 'simulate' | 'corrections' | 'correct') {
    await run(async () => {
      const base = `/api/v1/skill-formalization-candidates/${encodeURIComponent(candidateId)}`;
      const path =
        operation === 'get'
          ? base
          : `${base}/${operation === 'correct' ? 'corrections' : operation}`;
      const value = await managementRequest(
        path,
        operation === 'simulate'
          ? { method: 'POST' }
          : operation === 'correct'
            ? { method: 'POST', body: JSON.stringify(parseUnknown(correction)) }
            : undefined,
      );
      setResult(value);
      if (operation === 'simulate' || operation === 'correct') onRegistryChanged();
      return `${candidateId}: ${operation} completed.`;
    });
  }
  async function diffVersions() {
    await run(async () => {
      const value = await managementRequest(
        `/api/v1/skills/${encodeURIComponent(diff.skillId)}/diff?from=${encodeURIComponent(diff.from)}&to=${encodeURIComponent(diff.to)}`,
      );
      setResult(value);
      return `${diff.skillId}: version diff loaded.`;
    });
  }
  async function graphAction(operation: 'list' | 'create' | 'delete') {
    await run(async () => {
      const value =
        operation === 'list'
          ? await managementRequest('/api/v1/skill-graph')
          : operation === 'create'
            ? await managementRequest('/api/v1/skill-graph/relations', {
                method: 'POST',
                body: JSON.stringify({ ...relation, metadata: parseRecord(relation.metadata) }),
              })
            : await managementRequest(
                `/api/v1/skill-graph/relations/${encodeURIComponent(relationId)}`,
                { method: 'DELETE' },
              );
      setResult(value);
      return `Skill graph: ${operation} completed.`;
    });
  }
  async function run(operation: () => Promise<string>) {
    try {
      setMessage(await operation());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Skill studio operation failed.');
    }
  }

  return (
    <div className="skill-studio">
      <section className="panel">
        <span className="eyebrow">SCHEMA-CONSTRAINED AUTHORING</span>
        <h2>Skill Draft Studio</h2>
        <form className="admin-form" onSubmit={(event) => void authorSkill(event)}>
          <label>
            Skill ID
            <input
              required
              value={author.skillId}
              onChange={(event) => {
                setAuthor({ ...author, skillId: event.target.value });
              }}
            />
          </label>
          <label>
            Status
            <select
              value={author.status}
              onChange={(event) => {
                setAuthor({ ...author, status: event.target.value });
              }}
            >
              <option>draft</option>
              <option>enabled</option>
              <option>disabled</option>
            </select>
          </label>
          <label className="wide-field">
            Natural-language description
            <textarea
              required
              value={author.description}
              onChange={(event) => {
                setAuthor({ ...author, description: event.target.value });
              }}
            />
          </label>
          <label>
            Tool policy JSON
            <textarea
              value={author.toolPolicy}
              onChange={(event) => {
                setAuthor({ ...author, toolPolicy: event.target.value });
              }}
            />
          </label>
          <label>
            Runtime policy JSON
            <textarea
              value={author.runtimePolicy}
              onChange={(event) => {
                setAuthor({ ...author, runtimePolicy: event.target.value });
              }}
            />
          </label>
          <button type="submit">Generate Schemas and validate</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <section className="studio-grid">
        <article className="panel">
          <span className="eyebrow">CHECKSUM-PINNED PACKAGE</span>
          <h3>Validate / Import</h3>
          <div className="mini-form">
            <label>
              Server-local package root
              <input
                value={packageRoot}
                onChange={(event) => {
                  setPackageRoot(event.target.value);
                }}
                placeholder="skills/embodied.move_to"
              />
            </label>
            <small>
              Validation is read-only. Import revalidates and atomically publishes the exact next
              version with checksum audit.
            </small>
            <div className="action-row">
              <button disabled={packageRoot === ''} onClick={() => void packageAction('validate')}>
                Validate package
              </button>
              <button disabled={packageRoot === ''} onClick={() => void packageAction('import')}>
                Import exact next version
              </button>
            </div>
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">DIRECT VALIDATED EDIT</span>
          <h3>Definition JSON</h3>
          <form onSubmit={(event) => void register(event)}>
            <textarea
              className="code-editor"
              required
              value={registration}
              onChange={(event) => {
                setRegistration(event.target.value);
              }}
              placeholder="Paste a complete Skill definition; the server validates both Schemas."
            />
            <button type="submit">Register definition</button>
          </form>
        </article>
        <article className="panel">
          <span className="eyebrow">PERSISTED DRAFT</span>
          <h3>Inspect / Publish</h3>
          <div className="mini-form">
            <label>
              Draft ID
              <input
                value={draft.draftId}
                onChange={(event) => {
                  setDraft({ ...draft, draftId: event.target.value });
                }}
              />
            </label>
            <label>
              Formal Skill ID
              <input
                value={draft.skillId}
                onChange={(event) => {
                  setDraft({ ...draft, skillId: event.target.value });
                }}
              />
            </label>
            <label>
              Tool policy JSON
              <textarea
                value={draft.toolPolicy}
                onChange={(event) => {
                  setDraft({ ...draft, toolPolicy: event.target.value });
                }}
              />
            </label>
            <label>
              Runtime policy JSON
              <textarea
                value={draft.runtimePolicy}
                onChange={(event) => {
                  setDraft({ ...draft, runtimePolicy: event.target.value });
                }}
              />
            </label>
            <div className="action-row">
              <button onClick={() => void draftAction('get')}>get</button>
              <button onClick={() => void draftAction('publish')}>publish</button>
            </div>
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">EVOLUTION GATE</span>
          <h3>Simulation / Correction</h3>
          <div className="mini-form">
            <label>
              Candidate ID
              <input
                value={candidateId}
                onChange={(event) => {
                  setCandidateId(event.target.value);
                }}
              />
            </label>
            <label>
              Correction request JSON
              <textarea
                value={correction}
                onChange={(event) => {
                  setCorrection(event.target.value);
                }}
              />
            </label>
            <div className="action-row">
              {(['get', 'simulate', 'corrections', 'correct'] as const).map((operation) => (
                <button
                  key={operation}
                  disabled={candidateId === ''}
                  onClick={() => void candidateAction(operation)}
                >
                  {operation}
                </button>
              ))}
            </div>
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">VERSION DIFF</span>
          <h3>Compare immutable versions</h3>
          <div className="mini-form">
            <label>
              Skill ID
              <input
                value={diff.skillId}
                onChange={(event) => {
                  setDiff({ ...diff, skillId: event.target.value });
                }}
              />
            </label>
            <label>
              From
              <input
                type="number"
                min="1"
                value={diff.from}
                onChange={(event) => {
                  setDiff({ ...diff, from: event.target.value });
                }}
              />
            </label>
            <label>
              To
              <input
                type="number"
                min="1"
                value={diff.to}
                onChange={(event) => {
                  setDiff({ ...diff, to: event.target.value });
                }}
              />
            </label>
            <button disabled={diff.skillId === ''} onClick={() => void diffVersions()}>
              diff
            </button>
          </div>
        </article>
        <article className="panel wide-card">
          <span className="eyebrow">SKILL GRAPH</span>
          <h3>Typed relations</h3>
          <div className="graph-form">
            <label>
              Source
              <input
                value={relation.sourceSkillId}
                onChange={(event) => {
                  setRelation({ ...relation, sourceSkillId: event.target.value });
                }}
              />
            </label>
            <label>
              Target
              <input
                value={relation.targetSkillId}
                onChange={(event) => {
                  setRelation({ ...relation, targetSkillId: event.target.value });
                }}
              />
            </label>
            <label>
              Type
              <select
                value={relation.relationType}
                onChange={(event) => {
                  setRelation({ ...relation, relationType: event.target.value });
                }}
              >
                {[
                  'parent_child',
                  'depends_on',
                  'input_output_match',
                  'alternative',
                  'composition',
                  'capability_coverage',
                ].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Delete relation ID
              <input
                value={relationId}
                onChange={(event) => {
                  setRelationId(event.target.value);
                }}
              />
            </label>
            <div className="action-row">
              <button onClick={() => void graphAction('list')}>list graph</button>
              <button onClick={() => void graphAction('create')}>create relation</button>
              <button disabled={relationId === ''} onClick={() => void graphAction('delete')}>
                delete relation
              </button>
            </div>
          </div>
        </article>
      </section>
      {result === undefined ? null : (
        <section className="panel">
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}

function parseUnknown(value: string): unknown {
  return JSON.parse(value) as unknown;
}
function parseRecord(value: string): Readonly<Record<string, unknown>> {
  const parsed = parseUnknown(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('JSON object required.');
  return parsed as Readonly<Record<string, unknown>>;
}
