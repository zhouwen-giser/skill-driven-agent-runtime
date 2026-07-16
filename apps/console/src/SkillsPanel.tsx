import { useCallback, useEffect, useMemo, useState } from 'react';

import { managementRequest } from './api.js';
import { SkillStudio } from './SkillStudio.js';

interface SkillRecord extends Record<string, unknown> {
  readonly skillId: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly toolPolicy?: Readonly<{
    required: readonly SkillToolReference[];
    optional: readonly SkillToolReference[];
    forbidden: readonly SkillToolReference[];
  }>;
}

interface SkillToolReference {
  readonly serverId: string;
  readonly toolName: string;
}

interface SkillToolSemanticsRecord {
  readonly serverId: string;
  readonly toolName: string;
  readonly executionSemantics: Readonly<{
    effect: string;
    execution: string;
    replay: string;
    source: string;
  }>;
}

export function SkillsPanel({
  focusSkillId,
  onExploreTasks,
}: {
  readonly focusSkillId?: string;
  readonly onExploreTasks?: (skillId: string) => void;
}) {
  const [skills, setSkills] = useState<readonly SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [detail, setDetail] = useState<unknown>();
  const [rollback, setRollback] = useState<Record<string, string>>({});
  const [toolSemantics, setToolSemantics] = useState<readonly SkillToolSemanticsRecord[]>([]);
  const toolReferences = useMemo(
    () =>
      skills.flatMap((skill) =>
        skill.toolPolicy === undefined
          ? []
          : [
              ...skill.toolPolicy.required,
              ...skill.toolPolicy.optional,
              ...skill.toolPolicy.forbidden,
            ],
      ),
    [skills],
  );
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await managementRequest<{ readonly items: readonly SkillRecord[] }>(
        '/api/v1/skills',
      );
      setSkills(payload.items);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    let active = true;
    const serverIds = [...new Set(toolReferences.map((reference) => reference.serverId))];
    if (serverIds.length === 0) {
      setToolSemantics([]);
      return () => {
        active = false;
      };
    }
    void Promise.all(
      serverIds.map((serverId) =>
        managementRequest<{ readonly items: readonly SkillToolSemanticsRecord[] }>(
          `/api/v1/mcp/servers/${encodeURIComponent(serverId)}/tools`,
        ),
      ),
    )
      .then((responses) => {
        if (active) setToolSemantics(responses.flatMap((response) => response.items));
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : 'Skill Tool semantics could not load.',
          );
      });
    return () => {
      active = false;
    };
  }, [toolReferences]);

  async function action(
    skillId: string,
    operation: 'enable' | 'disable' | 'versions' | 'warnings' | 'rollback',
  ) {
    try {
      const path =
        operation === 'versions'
          ? `/api/v1/skills/${encodeURIComponent(skillId)}/versions`
          : operation === 'warnings'
            ? `/api/v1/skill-quality-warnings?skillId=${encodeURIComponent(skillId)}`
            : operation === 'rollback'
              ? `/api/v1/skills/${encodeURIComponent(skillId)}/rollback/${encodeURIComponent(rollback[skillId] ?? '')}`
              : `/api/v1/skills/${encodeURIComponent(skillId)}/${operation}`;
      const readOnly = operation === 'versions' || operation === 'warnings';
      setDetail(await managementRequest(path, readOnly ? undefined : { method: 'POST' }));
      if (!readOnly) await reload();
      setMessage(`${skillId}: ${operation} 完成。`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Skill 管理操作失败。');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">AUTHORITATIVE REGISTRY</span>
            <h2>Skill 生命周期</h2>
          </div>
          <span className={loading ? 'status' : 'status ok'}>
            {loading ? 'LOADING' : 'CONNECTED'}
          </span>
        </div>
        <p>所有操作都创建或读取后端权威版本；不会绕过 Schema 验证、发布或告警规则。</p>
        {message === undefined ? null : <p className="action-message">{message}</p>}
        {focusSkillId === undefined ? null : (
          <div className="action-row">
            <p className="action-message">Linked Skill: {focusSkillId}</p>
            <SkillTaskNavigation skillId={focusSkillId} onExploreTasks={onExploreTasks} />
          </div>
        )}
      </section>
      <div className="record-list">
        {skills.map((skill) => (
          <article
            key={skill.skillId}
            className={skill.skillId === focusSkillId ? 'linked-record' : undefined}
          >
            <div className="record-heading">
              <div>
                <strong>{skill.name}</strong>
                <small>
                  {skill.skillId} · version {skill.version}
                </small>
              </div>
              <span className="status ok">{skill.status}</span>
            </div>
            <div className="action-row">
              <button onClick={() => void action(skill.skillId, 'enable')}>启用</button>
              <button onClick={() => void action(skill.skillId, 'disable')}>停用</button>
              <button onClick={() => void action(skill.skillId, 'versions')}>版本历史</button>
              <button onClick={() => void action(skill.skillId, 'warnings')}>质量告警</button>
              <label className="inline-field">
                回滚版本
                <input
                  type="number"
                  min="1"
                  value={rollback[skill.skillId] ?? ''}
                  onChange={(event) => {
                    setRollback({ ...rollback, [skill.skillId]: event.target.value });
                  }}
                />
              </label>
              <button
                disabled={!rollback[skill.skillId]}
                onClick={() => void action(skill.skillId, 'rollback')}
              >
                回滚
              </button>
            </div>
            <SkillToolPolicySemantics policy={skill.toolPolicy} tools={toolSemantics} />
          </article>
        ))}
      </div>
      {detail === undefined ? null : (
        <section className="panel">
          <pre className="result">{JSON.stringify(detail, null, 2)}</pre>
        </section>
      )}
      <SkillStudio onRegistryChanged={() => void reload()} />
    </div>
  );
}

export function SkillToolPolicySemantics({
  policy,
  tools,
}: {
  readonly policy: SkillRecord['toolPolicy'];
  readonly tools: readonly SkillToolSemanticsRecord[];
}) {
  if (policy === undefined) return null;
  const entries = (
    [
      ['required', policy.required],
      ['optional', policy.optional],
      ['forbidden', policy.forbidden],
    ] as const
  ).flatMap(([kind, references]) => references.map((reference) => ({ kind, reference })));
  if (entries.length === 0) return null;
  return (
    <div className="record-list" aria-label="Skill Tool Policy execution semantics">
      {entries.map(({ kind, reference }) => {
        const tool = tools.find(
          (candidate) =>
            candidate.serverId === reference.serverId && candidate.toolName === reference.toolName,
        );
        return (
          <small key={`${kind}/${reference.serverId}/${reference.toolName}`}>
            {kind}: {reference.serverId}/{reference.toolName} ·{' '}
            {tool === undefined
              ? 'semantics unavailable'
              : `${tool.executionSemantics.effect}, ${tool.executionSemantics.execution}, replay ${tool.executionSemantics.replay}, source ${tool.executionSemantics.source}`}
          </small>
        );
      })}
    </div>
  );
}

export function SkillTaskNavigation({
  skillId,
  onExploreTasks,
}: {
  readonly skillId: string;
  readonly onExploreTasks: ((skillId: string) => void) | undefined;
}) {
  return onExploreTasks === undefined ? null : (
    <button
      type="button"
      onClick={() => {
        openRelatedSkillTasks(skillId, onExploreTasks);
      }}
    >
      Open related Tasks · {skillId}
    </button>
  );
}

export function openRelatedSkillTasks(
  skillId: string,
  onExploreTasks: (skillId: string) => void,
): void {
  onExploreTasks(skillId);
}
