import { describe, expect, it } from 'vitest';

import type { Skill, SkillDraft, SkillVersion } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  SkillAuthoringService,
  SkillRegistryService,
  type SkillRepository,
  type SkillDraftRepository,
  type StructuredModelProvider,
} from '../src/index.js';

describe('SkillAuthoringService', () => {
  it('corrects invalid structured output and registers only the validated model result', async () => {
    const repository = new MemorySkillRepository();
    const model = new SequenceModelProvider([
      { ...generated(), inputSchema: { type: 'not-a-json-schema-type' } },
      generated(),
    ]);
    const service = createService(repository, model);

    const result = await service.authorAndRegister(input());

    expect(result).toMatchObject({
      skillId: 'skill.device.inspect',
      version: 1,
      status: 'enabled',
    });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.correctionErrors.join(' ')).toContain('input');
    expect(repository.current?.inputSchema).toEqual(generated().inputSchema);
  });

  it('fails closed after bounded invalid generations and never persists a fallback Skill', async () => {
    const repository = new MemorySkillRepository();
    const model = new SequenceModelProvider([
      { answer: 'not structured metadata' },
      { ...generated(), outputSchema: {} },
    ]);
    const service = createService(repository, model);

    await expect(service.authorAndRegister(input())).rejects.toMatchObject({
      code: 'SKILL_SCHEMA_GENERATION_FAILED',
    });
    expect(model.calls).toHaveLength(2);
    expect(repository.current).toBeUndefined();
  });

  it('requires more detail before calling the model for an ambiguous description', async () => {
    const model = new SequenceModelProvider([generated()]);
    await expect(
      createService(new MemorySkillRepository(), model).authorAndRegister({
        ...input(),
        naturalLanguageDescription: 'Inspect it.',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_DESCRIPTION_INSUFFICIENT' });
    expect(model.calls).toHaveLength(0);
  });

  it('publishes a persisted A2A draft only through the management publication workflow', async () => {
    const skills = new MemorySkillRepository();
    const drafts = new MemoryDraftRepository();
    const service = createService(skills, new SequenceModelProvider([generated()]), drafts);

    await expect(
      service.authorAndRegister({ ...input(), sourceKind: 'a2a_draft' }),
    ).rejects.toMatchObject({ code: 'SKILL_A2A_DRAFT_MANAGEMENT_PUBLICATION_REQUIRED' });
    expect(skills.current).toBeUndefined();

    const result = await service.publishDraft('draft-1', {
      actor: 'operator@example.test',
      skillId: 'skill.device.inspect',
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
    });
    expect(result.skill).toMatchObject({ sourceKind: 'a2a_draft', status: 'enabled', version: 1 });
    expect(result.draft).toMatchObject({
      status: 'published',
      publishedBy: 'operator@example.test',
      publishedSkillId: 'skill.device.inspect',
      publishedSkillVersion: 1,
    });
  });
});

function createService(
  repository: SkillRepository,
  model: StructuredModelProvider,
  drafts: SkillDraftRepository = new MemoryDraftRepository(),
) {
  const schemas = new AjvJsonSchemaValidator();
  return new SkillAuthoringService({
    model,
    schemas,
    registry: new SkillRegistryService({
      skills: repository,
      validator: schemas,
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
    }),
    maxAttempts: 2,
    drafts,
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
  });
}

class MemoryDraftRepository implements SkillDraftRepository {
  draft: SkillDraft = {
    draftId: 'draft-1',
    taskId: 'task-1',
    contextId: 'context-1',
    requestedBy: 'a2a-user',
    intent: 'create',
    requestText:
      'Inspect a device by identifier and return its current status plus a displayable observation.',
    status: 'draft',
    createdAt: '2026-07-11T09:00:00.000Z',
    updatedAt: '2026-07-11T09:00:00.000Z',
  };
  findById(draftId: string) {
    return Promise.resolve(this.draft.draftId === draftId ? this.draft : undefined);
  }
  listByContextId(contextId: string) {
    return Promise.resolve(this.draft.contextId === contextId ? [this.draft] : []);
  }
  save(draft: SkillDraft) {
    this.draft = draft;
    return Promise.resolve();
  }
  markPublished(
    draftId: string,
    publication: Readonly<{
      skillId: string;
      version: number;
      publishedBy: string;
      publishedAt: string;
    }>,
  ) {
    if (draftId !== this.draft.draftId) throw new Error('SKILL_DRAFT_NOT_FOUND');
    this.draft = {
      ...this.draft,
      status: 'published',
      publishedSkillId: publication.skillId,
      publishedSkillVersion: publication.version,
      publishedBy: publication.publishedBy,
      publishedAt: publication.publishedAt,
      updatedAt: publication.publishedAt,
    };
    return Promise.resolve(this.draft);
  }
}

function input() {
  return {
    skillId: 'skill.device.inspect',
    naturalLanguageDescription:
      'Inspect a device by identifier and return its current status plus a displayable observation.',
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled' as const,
    sourceKind: 'admin' as const,
  };
}

function generated() {
  return {
    name: 'Device inspection',
    summary: 'Inspect one device.',
    description: 'Reads and reports current device state.',
    capabilities: ['device-inspection'],
    workflowGuidance: 'Read the device once and report the current state.',
    outputInstruction: 'Return status and observation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['deviceId'],
      properties: { deviceId: { type: 'string', minLength: 1 } },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string' }, observation: { type: 'string' } },
    },
  };
}

class SequenceModelProvider implements StructuredModelProvider {
  readonly calls: Parameters<StructuredModelProvider['generateStructured']>[0][] = [];
  readonly #outputs: readonly unknown[];
  constructor(outputs: readonly unknown[]) {
    this.#outputs = outputs;
  }
  generateStructured(input_: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.calls.push(input_);
    return Promise.resolve(this.#outputs[this.calls.length - 1]);
  }
}

class MemorySkillRepository implements SkillRepository {
  current: SkillVersion | undefined;
  find(skillId: string): Promise<Skill | undefined> {
    return Promise.resolve(
      this.current?.skillId === skillId
        ? {
            skillId,
            currentVersion: this.current.version,
            createdAt: this.current.createdAt,
            updatedAt: this.current.createdAt,
          }
        : undefined,
    );
  }
  findCurrentVersion(skillId: string) {
    return Promise.resolve(this.current?.skillId === skillId ? this.current : undefined);
  }
  findVersion(skillId: string, version: number) {
    return Promise.resolve(
      this.current?.skillId === skillId && this.current.version === version
        ? this.current
        : undefined,
    );
  }
  listVersions(skillId: string) {
    return Promise.resolve(this.current?.skillId === skillId ? [this.current] : []);
  }
  listEnabledVersions() {
    return Promise.resolve(this.current?.status === 'enabled' ? [this.current] : []);
  }
  listCurrentVersions() {
    return Promise.resolve(this.current === undefined ? [] : [this.current]);
  }
  saveVersionAndSetCurrent(version: SkillVersion) {
    this.current = version;
    return Promise.resolve();
  }
}
