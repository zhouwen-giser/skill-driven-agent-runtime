import { useCallback, useEffect, useState } from 'react';

import { managementRequest } from './api.js';

export interface TaskRecord {
  readonly taskId: string;
  readonly contextId: string;
  readonly phase: string;
  readonly phaseMessage: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly selectedSkillId?: string;
  readonly selectedSkillVersion?: number;
  readonly temporarySkillId?: string;
  readonly errorCode?: string;
}
export interface EvidenceItem {
  readonly key: string;
  readonly label: string;
  readonly endpoint: string;
  readonly value: unknown;
  readonly error?: string;
}
export type RelatedTarget = Readonly<{
  kind: 'evaluation' | 'mcp' | 'model' | 'skill' | 'workflow';
  id: string;
  secondary?: string;
}>;
type TaskFilters = Readonly<{
  contextId: string;
  goalId: string;
  skillId: string;
  phase: string;
}>;

export interface RemoteTaskLifecycleResponse {
  readonly warnings: readonly string[];
  readonly items: readonly Readonly<{
    binding: Readonly<{
      bindingId: string;
      serverId: string;
      operationName: string;
      remoteTaskId: string;
      protocolStatus: string;
      providerSubstate?: string;
      localState: string;
      requestedTiming?: unknown;
      nextPollAt?: string;
      pollAttempt: number;
      providerFailureCount: number;
      version: number;
      workflowInstanceId: string;
      workflowNodeRunId: string;
      mcpInvocationId: string;
    }>;
    capability: unknown;
    availability: readonly unknown[];
    observations: readonly unknown[];
    controls: readonly unknown[];
    protocolAttempts: readonly unknown[];
    protocol?: Readonly<{
      runtimeRevision?: string;
      providerRevision?: string;
      latestObservationSource?: string;
      notificationHealth: string;
      pollHealth: string;
      evidenceSummary: unknown;
    }>;
    continuations: readonly unknown[];
    inputRounds: readonly Readonly<{
      link: Readonly<{ inputRequestId: string; status: string }>;
      question: string;
      requestStatus: string;
      attempts: readonly unknown[];
    }>[];
    cancellations: readonly Readonly<{
      request: Readonly<{
        requestId: string;
        deliveryStatus: string;
        providerTerminalStatus?: string;
        lastSafeErrorCode?: string;
      }>;
      attempts: readonly unknown[];
    }>[];
    finalOutcome: unknown;
  }>[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function GoalTaskNavigation({
  goalId,
  onExploreGoal,
}: {
  readonly goalId: string;
  readonly onExploreGoal: (goalId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onExploreGoal(goalId);
      }}
    >
      Explore Goal Tasks · {goalId}
    </button>
  );
}

export function TaskPanel({
  initialTaskId,
  initialSkillId,
  onNavigate,
}: {
  readonly initialTaskId?: string;
  readonly initialSkillId?: string;
  readonly onNavigate?: (target: RelatedTarget) => void;
}) {
  const [taskId, setTaskId] = useState(initialTaskId ?? '');
  const [task, setTask] = useState<TaskRecord>();
  const [evidence, setEvidence] = useState<readonly EvidenceItem[]>([]);
  const [message, setMessage] = useState<string>();
  const [inventory, setInventory] = useState<readonly TaskRecord[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({
    contextId: '',
    goalId: '',
    skillId: initialSkillId ?? '',
    phase: '',
  });
  const [live, setLive] = useState(false);
  const [action, setAction] = useState<
    'confirm_plan' | 'reject_plan' | 'revise_plan' | 'provide_input' | 'cancel_goal'
  >('confirm_plan');
  const [actionText, setActionText] = useState('Confirmed from the operational console.');
  const [inputRequestId, setInputRequestId] = useState('');
  const [structuredInput, setStructuredInput] = useState('');

  const loadTask = useCallback(async (id: string, announce = true) => {
    try {
      const loaded = await managementRequest<TaskRecord>(`/api/v1/tasks/${encodeURIComponent(id)}`);
      setTask(loaded);
      const links = taskEvidenceLinks(loaded);
      setEvidence(await Promise.all(links.map(loadEvidence)));
      if (announce)
        setMessage(`${loaded.taskId}: ${String(links.length)} linked evidence queries completed.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Task trace lookup failed.');
    }
  }, []);

  async function load(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadTask(taskId);
  }

  async function loadInventory(nextFilters: TaskFilters = filters) {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (nextFilters.contextId !== '') params.set('contextId', nextFilters.contextId);
      if (nextFilters.goalId !== '') params.set('goalId', nextFilters.goalId);
      if (nextFilters.skillId !== '') params.set('skillId', nextFilters.skillId);
      if (nextFilters.phase !== '') params.set('phase', nextFilters.phase);
      const result = await managementRequest<{ readonly items: readonly TaskRecord[] }>(
        `/api/v1/tasks?${params.toString()}`,
      );
      setInventory(result.items);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Task inventory failed.');
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);
  useEffect(() => {
    if (initialTaskId !== undefined) void loadTask(initialTaskId);
  }, [initialTaskId, loadTask]);
  useEffect(() => {
    if (initialSkillId === undefined) return;
    const nextFilters = { contextId: '', goalId: '', skillId: initialSkillId, phase: '' };
    setFilters(nextFilters);
    void loadInventory(nextFilters);
  }, [initialSkillId]);
  useEffect(() => {
    if (!live || task === undefined) return;
    const timer = window.setInterval(() => void loadTask(task.taskId, false), 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [live, task?.taskId, loadTask]);

  async function submitAction(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (task === undefined) return;
    try {
      const inputContent: unknown =
        action === 'provide_input' && structuredInput.trim() !== ''
          ? JSON.parse(structuredInput)
          : undefined;
      const updated = await managementRequest<TaskRecord>(
        `/api/v1/tasks/${encodeURIComponent(task.taskId)}/actions`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            messageText: actionText,
            ...(inputRequestId.trim() === '' ? {} : { inputRequestId: inputRequestId.trim() }),
            ...(inputContent === undefined ? {} : { inputContent }),
          }),
        },
      );
      setTask(updated);
      setMessage(`${updated.taskId}: ${action} applied through the authoritative lifecycle.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Task action failed.');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CORRELATED TRACE ROOT</span>
            <h2>Task / Goal Explorer</h2>
          </div>
          {task === undefined ? null : <span className="status ok">{task.phase}</span>}
        </div>
        <form className="lookup" onSubmit={(event) => void load(event)}>
          <label>
            Task ID
            <input
              required
              value={taskId}
              onChange={(event) => {
                setTaskId(event.target.value);
              }}
            />
          </label>
          <button type="submit">加载全链路证据</button>
        </form>
        {message === undefined ? null : <p className="action-message">{message}</p>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">POSTGRESQL TASK INVENTORY</span>
            <h2>Recent Tasks</h2>
          </div>
          <button type="button" onClick={() => void loadInventory()}>
            Refresh inventory
          </button>
        </div>
        <form
          className="filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadInventory();
          }}
        >
          <label>
            contextId
            <input
              value={filters.contextId}
              onChange={(event) => {
                setFilters({ ...filters, contextId: event.target.value });
              }}
            />
          </label>
          <label>
            Goal ID
            <input
              value={filters.goalId}
              onChange={(event) => {
                setFilters({ ...filters, goalId: event.target.value });
              }}
            />
          </label>
          <label>
            Skill ID
            <input
              value={filters.skillId}
              onChange={(event) => {
                setFilters({ ...filters, skillId: event.target.value });
              }}
            />
          </label>
          <label>
            phase
            <input
              value={filters.phase}
              onChange={(event) => {
                setFilters({ ...filters, phase: event.target.value });
              }}
              placeholder="executing"
            />
          </label>
          <button type="submit">Apply filters</button>
        </form>
        <div className="version-list">
          {inventory.map((item) => (
            <button
              key={item.taskId}
              type="button"
              onClick={() => {
                setTaskId(item.taskId);
                void loadTask(item.taskId);
              }}
            >
              <strong>{item.taskId}</strong>
              <span>
                {item.phase} · {item.contextId}
              </span>
            </button>
          ))}
          {inventory.length === 0 ? <p>No matching Task records.</p> : null}
        </div>
      </section>
      {task === undefined ? null : (
        <>
          <section className="trace-identity">
            <article>
              <span>TASK</span>
              <strong>{task.taskId}</strong>
              <small>{task.phaseMessage}</small>
            </article>
            <article>
              <span>CONTEXT</span>
              <strong>{task.contextId}</strong>
              <small>serialized task scope</small>
            </article>
            <article>
              <span>GOAL</span>
              <strong>{task.goalId ?? 'not bound'}</strong>
              <small>
                {task.goalVersion === undefined ? '—' : `version ${String(task.goalVersion)}`}
              </small>
            </article>
            <article>
              <span>SKILL</span>
              <strong>{task.selectedSkillId ?? task.temporarySkillId ?? 'not resolved'}</strong>
              <small>
                {task.selectedSkillVersion === undefined
                  ? '—'
                  : `version ${String(task.selectedSkillVersion)}`}
              </small>
            </article>
            <article>
              <span>PLAN</span>
              <strong>{task.planId ?? 'not planned'}</strong>
              <small>{task.errorCode ?? 'no Task error'}</small>
            </article>
          </section>
          {task.goalId === undefined ? null : (
            <section className="panel">
              <GoalTaskNavigation
                goalId={task.goalId}
                onExploreGoal={(goalId) => {
                  const nextFilters = { contextId: '', goalId, skillId: '', phase: '' };
                  setFilters(nextFilters);
                  void loadInventory(nextFilters);
                }}
              />
            </section>
          )}
          <TaskRelatedNavigation task={task} onNavigate={onNavigate} />
          <TaskEvidenceNavigation task={task} evidence={evidence} onNavigate={onNavigate} />
          <UserGoalPlanPanel
            value={evidence.find((item) => item.key === 'user-goal-plan')?.value}
          />
          <InteractiveGoalPanel
            taskId={task.taskId}
            value={evidence.find((item) => item.key === 'goal-session')?.value}
            onApplied={() => loadTask(task.taskId)}
          />
          <InteractivePlanningPanel
            taskId={task.taskId}
            value={evidence.find((item) => item.key === 'planning-session')?.value}
            onApplied={() => loadTask(task.taskId)}
          />
          <RemoteTaskLifecyclePanel
            value={evidence.find((item) => item.key === 'remote-task-lifecycle')?.value}
            onRefresh={() => void loadTask(task.taskId)}
            onRefreshBinding={(bindingId, expectedVersion) => {
              void runRemoteBindingAction(
                bindingId,
                'refresh',
                { expectedVersion },
                loadTask,
                task.taskId,
                setMessage,
              );
            }}
            onCancelBinding={(bindingId, expectedVersion) => {
              void runRemoteBindingAction(
                bindingId,
                'cancel',
                {
                  idempotencyKey: `management:${task.taskId}:${bindingId}:${String(expectedVersion)}`,
                  reasonCode: 'MANAGEMENT_REQUESTED',
                  summary: actionText,
                },
                loadTask,
                task.taskId,
                setMessage,
              );
            }}
          />
          <section className="panel">
            <div className="panel-heading">
              <span className="eyebrow">PLAN ACTION BOUNDARY</span>
              <label>
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(event) => {
                    setLive(event.target.checked);
                  }}
                />{' '}
                Live trace · 2s
              </label>
            </div>
            <form className="task-action" onSubmit={(event) => void submitAction(event)}>
              <label>
                Action
                <select
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as typeof action);
                  }}
                >
                  <option value="confirm_plan">Confirm plan</option>
                  <option value="reject_plan">Reject plan</option>
                  <option value="revise_plan">Revise plan</option>
                  <option value="provide_input">Provide schema-validated input</option>
                  <option value="cancel_goal">Cancel Goal (cooperative remote request)</option>
                </select>
              </label>
              <label>
                Displayable instruction
                <input
                  required
                  value={actionText}
                  onChange={(event) => {
                    setActionText(event.target.value);
                  }}
                />
              </label>
              {action !== 'provide_input' ? null : (
                <>
                  <label>
                    Input request ID
                    <input
                      required
                      value={inputRequestId}
                      onChange={(event) => {
                        setInputRequestId(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Structured form response (JSON; empty uses displayable text)
                    <textarea
                      value={structuredInput}
                      onChange={(event) => {
                        setStructuredInput(event.target.value);
                      }}
                    />
                  </label>
                </>
              )}
              <button type="submit">提交 Task Action</button>
            </form>
          </section>
        </>
      )}
      <section className="evidence-grid">
        {evidence.map((item) => (
          <article
            key={item.key}
            className={item.error === undefined ? 'evidence-card' : 'evidence-card evidence-error'}
          >
            <header>
              <span>{item.label}</span>
              <code>{item.endpoint}</code>
            </header>
            {item.error === undefined ? (
              <pre>{JSON.stringify(item.value, null, 2)}</pre>
            ) : (
              <p>{item.error}</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export function UserGoalPlanPanel({ value }: { readonly value: unknown }) {
  if (!isRecord(value) || !isRecord(value.plan)) return null;
  const plan = value.plan;
  const goals = Array.isArray(plan.skillGoals) ? plan.skillGoals.filter(isRecord) : [];
  const dependencies = Array.isArray(plan.dependencies) ? plan.dependencies.filter(isRecord) : [];
  const outcomes = Array.isArray(value.outcomes) ? value.outcomes.filter(isRecord) : [];
  return (
    <section className="panel" aria-label="User Goal Plan DAG and judgments">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">USER GOAL RUNTIME AUTHORITY</span>
          <h2>Skill Goal DAG &amp; Layered Judgments</h2>
        </div>
        <span className="status">
          rev {displayPlanScalar(plan.revision, '—')} · {displayPlanScalar(plan.status, 'unknown')}
        </span>
      </div>
      <div className="dag-grid">
        {goals.map((goal) => {
          const goalId = displayPlanScalar(goal.skillGoalId, 'unknown');
          const judgment = outcomes.find((item) => item.subjectId === goalId);
          return (
            <article className="dag-node" key={goalId}>
              <span>{displayPlanScalar(goal.status, 'unknown')}</span>
              <strong>{goalId}</strong>
              <p>{displayPlanScalar(goal.requiredResult, '')}</p>
              <small>
                criteria{' '}
                {Array.isArray(goal.coveredCriterionIds)
                  ? goal.coveredCriterionIds.map(String).join(', ')
                  : '—'}
              </small>
              <code>
                judgment {displayPlanScalar(judgment?.status, 'pending')} /{' '}
                {displayPlanScalar(judgment?.confidence, '—')}
              </code>
            </article>
          );
        })}
      </div>
      <div className="dependency-strip">
        {dependencies.length === 0
          ? 'No dependency edges.'
          : dependencies
              .map(
                (edge) =>
                  `${String(edge.predecessorSkillGoalId)} → ${String(edge.successorSkillGoalId)}`,
              )
              .join(' · ')}
      </div>
    </section>
  );
}

export function InteractiveGoalPanel({
  taskId,
  value,
  onApplied,
}: {
  readonly taskId: string;
  readonly value: unknown;
  readonly onApplied: () => Promise<void>;
}) {
  const [action, setAction] = useState<
    'answer' | 'accept' | 'patch' | 'reject' | 'restart_understanding' | 'cancel'
  >('answer');
  const [payload, setPayload] = useState('{"answer":""}');
  const [message, setMessage] = useState<string>();
  if (!isRecord(value) || !isRecord(value.session)) return null;
  const session = value.session;
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : 'unknown';
  const version = typeof session.version === 'number' ? session.version : 0;
  const state = typeof session.state === 'string' ? session.state : 'unknown';

  async function apply(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await managementRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/goal-session/actions`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: version,
          idempotencyKey: `console:${sessionId}:${String(version)}:${action}`,
          actorId: 'console.operator',
          action,
          payload: JSON.parse(payload) as unknown,
        }),
      });
      setMessage(`${action} applied at session version ${String(version)}.`);
      await onApplied();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Interactive Goal action failed.');
    }
  }

  return (
    <section className="panel" aria-label="Interactive Goal session">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INTERACTIVE GOAL AUTHORITY</span>
          <h2>Goal Contract Review</h2>
        </div>
        <span className="status">
          {state} · v{String(version)}
        </span>
      </div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
      {['confirmed', 'rejected', 'canceled', 'budget_exhausted'].includes(state) ? null : (
        <form className="task-action" onSubmit={(event) => void apply(event)}>
          <label>
            Interaction action
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as typeof action);
              }}
            >
              <option value="answer">Answer clarification</option>
              <option value="accept">Accept Goal Contract</option>
              <option value="patch">Patch Goal Contract</option>
              <option value="reject">Reject candidate</option>
              <option value="restart_understanding">Restart understanding</option>
              <option value="cancel">Cancel session</option>
            </select>
          </label>
          <label>
            Action payload (JSON)
            <textarea
              required
              value={payload}
              onChange={(event) => {
                setPayload(event.target.value);
              }}
            />
          </label>
          <button type="submit">Apply CAS-protected action</button>
        </form>
      )}
      {message === undefined ? null : <p className="action-message">{message}</p>}
    </section>
  );
}

export function InteractivePlanningPanel({
  taskId,
  value,
  onApplied,
}: {
  readonly taskId: string;
  readonly value: unknown;
  readonly onApplied: () => Promise<void>;
}) {
  const [action, setAction] = useState<'accept' | 'patch' | 'reject' | 'cancel'>('accept');
  const [instruction, setInstruction] = useState('Prioritize the most direct verified result.');
  const [message, setMessage] = useState<string>();
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.candidate)) return null;
  const session = value.session;
  const candidate = value.candidate;
  const plan = isRecord(candidate.plan) ? candidate.plan : undefined;
  const goals = Array.isArray(plan?.skillGoals) ? plan.skillGoals.filter(isRecord) : [];
  const sessionId = displayPlanScalar(session.sessionId, 'unknown');
  const state = displayPlanScalar(session.state, 'unknown');
  const version = typeof session.version === 'number' ? session.version : 0;

  async function apply(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await managementRequest(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/planning-session/actions`,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion: version,
            idempotencyKey: `console:${sessionId}:${String(version)}:${action}`,
            actorId: 'console.operator',
            action,
            payload: action === 'patch' ? { instruction } : {},
          }),
        },
      );
      setMessage(`${action} applied at planning session version ${String(version)}.`);
      await onApplied();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Interactive planning action failed.');
    }
  }

  return (
    <section className="panel" aria-label="Interactive planning session">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CANDIDATE ONLY / CONFIRMATION BOUNDARY</span>
          <h2>Skill Goal DAG Review</h2>
        </div>
        <span className="status">
          {state} 路 v{String(version)} 路{' '}
          {displayPlanScalar(candidate.confirmationPolicy, 'unknown')}
        </span>
      </div>
      <div className="dag-grid">
        {goals.map((goal) => (
          <article className="dag-node" key={displayPlanScalar(goal.skillGoalId, 'unknown')}>
            <strong>{displayPlanScalar(goal.skillGoalId, 'unknown')}</strong>
            <p>{displayPlanScalar(goal.requiredResult, '')}</p>
            <small>
              capabilities{' '}
              {Array.isArray(goal.capabilityNeeds)
                ? goal.capabilityNeeds.map(String).join(', ')
                : '—'}
            </small>
          </article>
        ))}
      </div>
      <pre>
        {JSON.stringify(
          {
            validation: candidate.validation,
            diff: candidate.diff,
            experienceHints: candidate.experienceHints,
            planningMetadata: candidate.planningMetadata,
          },
          null,
          2,
        )}
      </pre>
      {state !== 'plan_review' ? null : (
        <form className="task-action" onSubmit={(event) => void apply(event)}>
          <label>
            Planning action
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as typeof action);
              }}
            >
              <option value="accept">Confirm candidate plan</option>
              <option value="patch">Compile natural-language patch</option>
              <option value="reject">Reject candidate</option>
              <option value="cancel">Cancel session</option>
            </select>
          </label>
          {action !== 'patch' ? null : (
            <label>
              Plan patch instruction
              <textarea
                required
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                }}
              />
            </label>
          )}
          <button type="submit">Apply CAS-protected planning action</button>
        </form>
      )}
      {message === undefined ? null : <p className="action-message">{message}</p>}
    </section>
  );
}

function displayPlanScalar(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

export function RemoteTaskLifecyclePanel({
  value,
  onRefresh,
  onRefreshBinding,
  onCancelBinding,
}: {
  readonly value: unknown;
  readonly onRefresh?: () => void;
  readonly onRefreshBinding?: (bindingId: string, expectedVersion: number) => void;
  readonly onCancelBinding?: (bindingId: string, expectedVersion: number) => void;
}) {
  if (!isRemoteTaskLifecycleResponse(value)) return null;
  return (
    <section className="panel" aria-label="Remote Task lifecycle">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">POSTGRESQL REMOTE TASK AUTHORITY</span>
          <h2>MCP Task lifecycle</h2>
        </div>
        {onRefresh === undefined ? null : (
          <button type="button" onClick={onRefresh}>
            Refresh authoritative evidence
          </button>
        )}
      </div>
      <div className="risk-banner">
        {value.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      {value.items.map((item) => (
        <article className="evidence-card" key={item.binding.bindingId}>
          <header>
            <span>
              {item.binding.serverId} / {item.binding.operationName}
            </span>
            <code>{item.binding.remoteTaskId}</code>
          </header>
          <p>
            Provider {item.binding.protocolStatus}
            {item.binding.providerSubstate === undefined
              ? ''
              : ` / ${item.binding.providerSubstate}`}{' '}
            · local {item.binding.localState}
          </p>
          <div className="action-row" aria-label="Frozen Task protocol evidence">
            <span className="status">
              revision {item.protocol?.runtimeRevision ?? 'not observed'}
            </span>
            <span className="status">
              observation {item.protocol?.latestObservationSource ?? 'not observed'}
            </span>
            <span
              className={item.protocol?.notificationHealth === 'observed' ? 'status ok' : 'status'}
            >
              notifications {item.protocol?.notificationHealth ?? 'not_observed'}
            </span>
          </div>
          <p>
            Poll attempt {item.binding.pollAttempt}; Provider failures{' '}
            {item.binding.providerFailureCount}; next {item.binding.nextPollAt ?? 'not scheduled'}
          </p>
          <p>
            Observations {item.observations.length} · controls {item.controls.length} · protocol
            attempts {item.protocolAttempts.length} · continuations {item.continuations.length}
          </p>
          <div className="action-row">
            {onRefreshBinding === undefined ? null : (
              <button
                type="button"
                onClick={() => {
                  onRefreshBinding(item.binding.bindingId, item.binding.version);
                }}
              >
                Observe Provider once (version-CAS)
              </button>
            )}
            {onCancelBinding === undefined ? null : (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onCancelBinding(item.binding.bindingId, item.binding.version);
                }}
              >
                Request cooperative Provider cancellation
              </button>
            )}
          </div>
          <details>
            <summary>Capability, availability, timing and correlation</summary>
            <pre>
              {JSON.stringify(
                {
                  capability: item.capability,
                  availability: item.availability,
                  timing: item.binding.requestedTiming ?? null,
                  workflowInstanceId: item.binding.workflowInstanceId,
                  workflowNodeRunId: item.binding.workflowNodeRunId,
                  mcpInvocationId: item.binding.mcpInvocationId,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {item.inputRounds.map((round) => (
            <p key={round.link.inputRequestId}>
              Input {round.link.inputRequestId}: {round.question} · {round.requestStatus} /{' '}
              {round.link.status} · update attempts {round.attempts.length}
            </p>
          ))}
          {item.cancellations.map(({ request, attempts }) => (
            <p key={request.requestId} className="action-message">
              Cancellation {request.requestId}: delivery {request.deliveryStatus}; Provider terminal{' '}
              {request.providerTerminalStatus ?? 'not observed'}; attempts {attempts.length}
              {request.lastSafeErrorCode === undefined ? '' : `; ${request.lastSafeErrorCode}`}
            </p>
          ))}
          <details>
            <summary>Provider-authoritative final result / error</summary>
            <pre>{JSON.stringify(item.finalOutcome, null, 2)}</pre>
          </details>
        </article>
      ))}
      {value.items.length === 0 ? (
        <p>No remote Task binding is associated with this Task.</p>
      ) : null}
    </section>
  );
}

async function runRemoteBindingAction(
  bindingId: string,
  action: 'refresh' | 'cancel',
  body: unknown,
  reload: (taskId: string, announce?: boolean) => Promise<void>,
  taskId: string,
  setMessage: (message: string) => void,
) {
  try {
    await managementRequest(
      `/api/v1/remote-task-bindings/${encodeURIComponent(bindingId)}/${action}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    await reload(taskId, false);
    setMessage(
      action === 'refresh'
        ? `${bindingId}: one Provider observation completed; PostgreSQL evidence reloaded.`
        : `${bindingId}: cooperative cancellation requested; Provider terminal status remains separate.`,
    );
  } catch (error: unknown) {
    setMessage(error instanceof Error ? error.message : `Remote Task ${action} failed.`);
  }
}

function isRemoteTaskLifecycleResponse(value: unknown): value is RemoteTaskLifecycleResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'warnings' in value &&
    Array.isArray(value.warnings) &&
    'items' in value &&
    Array.isArray(value.items)
  );
}

export function TaskRelatedNavigation({
  task,
  onNavigate,
}: {
  readonly task: TaskRecord;
  readonly onNavigate: ((target: RelatedTarget) => void) | undefined;
}) {
  const planId = task.planId;
  const skillId = task.selectedSkillId;
  return (
    <section className="action-row" aria-label="Task related objects">
      {planId === undefined || onNavigate === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onNavigate({ kind: 'workflow', id: planId });
          }}
        >
          Open Workflow · {task.planId}
        </button>
      )}
      {skillId === undefined || onNavigate === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onNavigate({ kind: 'skill', id: skillId });
          }}
        >
          Open Skill · {task.selectedSkillId}
        </button>
      )}
    </section>
  );
}

export function TaskEvidenceNavigation({
  task,
  evidence,
  onNavigate,
}: {
  readonly task: TaskRecord;
  readonly evidence: readonly EvidenceItem[];
  readonly onNavigate: ((target: RelatedTarget) => void) | undefined;
}) {
  if (onNavigate === undefined) return null;
  const mcp = firstEvidenceIdentity(evidence, 'mcp', ['serverId', 'toolName']);
  const model = firstEvidenceIdentity(evidence, 'models', ['providerId', 'model']);
  const skillId = task.selectedSkillId;
  return (
    <section className="action-row" aria-label="Task evidence navigation">
      {mcp === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onNavigate({
              kind: 'mcp',
              id: mcp[0],
              ...(mcp[1] === undefined ? {} : { secondary: mcp[1] }),
            });
          }}
        >
          Open MCP Tool · {mcp.join(' / ')}
        </button>
      )}
      {model === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onNavigate({
              kind: 'model',
              id: model[0],
              ...(model[1] === undefined ? {} : { secondary: model[1] }),
            });
          }}
        >
          Open Model · {model.join(' / ')}
        </button>
      )}
      {skillId === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onNavigate({ kind: 'evaluation', id: skillId });
          }}
        >
          Open Evaluation · {skillId}
        </button>
      )}
    </section>
  );
}

function firstEvidenceIdentity(
  evidence: readonly EvidenceItem[],
  key: string,
  fields: readonly string[],
): readonly [string, ...string[]] | undefined {
  const value = evidence.find((item) => item.key === key)?.value;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  )
    return undefined;
  const first: unknown = value.items[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const record = first as Readonly<Record<string, unknown>>;
  const values = fields.flatMap((field) =>
    typeof record[field] === 'string' ? [record[field]] : [],
  );
  return values.length === 0 ? undefined : (values as [string, ...string[]]);
}

function taskEvidenceLinks(task: TaskRecord): readonly Omit<EvidenceItem, 'value'>[] {
  const id = encodeURIComponent(task.taskId);
  const links: Omit<EvidenceItem, 'value'>[] = [
    {
      key: 'understanding',
      label: 'Task Understanding',
      endpoint: `/api/v1/tasks/${id}/understanding`,
    },
    {
      key: 'understanding-revisions',
      label: 'Task Understanding Revisions',
      endpoint: `/api/v1/tasks/${id}/understanding/revisions`,
    },
    {
      key: 'goal-session',
      label: 'Interactive Goal Session',
      endpoint: `/api/v1/tasks/${id}/goal-session`,
    },
    {
      key: 'planning-session',
      label: 'Interactive Planning Session',
      endpoint: `/api/v1/tasks/${id}/planning-session`,
    },
    {
      key: 'planning-interactions',
      label: 'Planning Corrections and Interaction Episodes',
      endpoint: `/api/v1/tasks/${id}/planning-interactions`,
    },
    { key: 'events', label: 'Task Events', endpoint: `/api/v1/tasks/${id}/events` },
    {
      key: 'remote-task-lifecycle',
      label: 'MCP Task Lifecycle',
      endpoint: `/api/v1/tasks/${id}/remote-task-lifecycle`,
    },
    {
      key: 'results',
      label: 'Processed Results',
      endpoint: `/api/v1/tasks/${id}/processed-results`,
    },
    { key: 'quality', label: 'Quality Report', endpoint: `/api/v1/tasks/${id}/quality-report` },
    {
      key: 'feedback',
      label: 'Implicit Feedback',
      endpoint: `/api/v1/tasks/${id}/implicit-feedback`,
    },
    {
      key: 'inferences',
      label: 'Input Inferences',
      endpoint: `/api/v1/tasks/${id}/input-inferences`,
    },
    {
      key: 'skill-input-resolutions',
      label: 'Skill Input Resolutions',
      endpoint: `/api/v1/tasks/${id}/skill-input-resolutions`,
    },
    {
      key: 'models',
      label: 'Model Invocations',
      endpoint: `/api/v1/models/invocations?taskId=${id}`,
    },
    { key: 'mcp', label: 'MCP Invocations', endpoint: `/api/v1/mcp/invocations?taskId=${id}` },
  ];
  if (task.goalId !== undefined) {
    const goalId = encodeURIComponent(task.goalId);
    links.push({ key: 'goal', label: 'Goal', endpoint: `/api/v1/goals/${goalId}` });
    links.push({
      key: 'goal-experience-episodes',
      label: 'Goal Experience Episodes',
      endpoint: `/api/v1/experience/episodes?goalId=${goalId}`,
    });
    links.push({
      key: 'goal-patches',
      label: 'Goal Patches',
      endpoint: `/api/v1/goals/${goalId}/patches`,
    });
    if (task.goalVersion !== undefined)
      links.push({
        key: 'user-goal-plan',
        label: 'User Goal Plan · DAG · Judgments',
        endpoint: `/api/v1/goals/${goalId}/user-goal-plan?goalVersion=${String(task.goalVersion)}`,
      });
    links.push({
      key: 'goal-experiences',
      label: 'Goal Evolution',
      endpoint: `/api/v1/goals/${goalId}/evolution-experiences`,
    });
  }
  if (task.planId !== undefined) {
    const planId = encodeURIComponent(task.planId);
    links.push({
      key: 'plan',
      label: 'Workflow Plan',
      endpoint: `/api/v1/workflows/plans/${planId}`,
    });
    links.push({
      key: 'trace',
      label: 'Workflow Trace',
      endpoint: `/api/v1/workflows/plans/${planId}/trace`,
    });
  }
  return links;
}

async function loadEvidence(item: Omit<EvidenceItem, 'value'>): Promise<EvidenceItem> {
  try {
    return { ...item, value: await managementRequest(item.endpoint) };
  } catch (error: unknown) {
    return {
      ...item,
      value: undefined,
      error: error instanceof Error ? error.message : 'Evidence unavailable.',
    };
  }
}
