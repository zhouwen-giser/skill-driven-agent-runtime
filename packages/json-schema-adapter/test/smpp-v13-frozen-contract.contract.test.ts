import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { AjvJsonSchemaValidator } from '../src/index.js';

const root = new URL('../../../contracts/smpp-task-business/v1.3/', import.meta.url);
const json = async (name: string) =>
  JSON.parse(await readFile(new URL(name, root), 'utf8')) as Record<string, unknown>;

describe('SMPP v1.3 pinned public contract (W0)', () => {
  it('AC-001/002 retains the exact upstream blobs at the compatibility commit', async () => {
    const manifest = await json('SOURCE.lock.json');
    expect(manifest['commit']).toBe('0a4a7c36865d4c9920a4e65857c0903e9ef12533');
    const files = manifest['files'] as { localPath: string; sha256: string; gitBlob: string }[];
    expect(files).toHaveLength(5);
    for (const file of files) {
      const bytes = await readFile(new URL(file.localPath, root));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(
        createHash('sha1')
          .update(`blob ${String(bytes.length)}\0`)
          .update(bytes)
          .digest('hex'),
      ).toBe(file.gitBlob);
    }
  });

  it('AC-002 validates all upstream positive objects without opening their schemas', async () => {
    const core = (await json('core.schema.json'))['schemas'] as Record<string, unknown>;
    const interaction = (await json('interaction.schema.json'))['schemas'] as Record<
      string,
      unknown
    >;
    const artifact = (await json('artifact.schema.json'))['schema'];
    const examples = await json('positive-catalog.json');
    const validator = new AjvJsonSchemaValidator({ strict: false });
    for (const [key, schema] of Object.entries({
      context: core['context'],
      optionalExtension: core['optionalExtension'],
      cursor: core['runtimeCursor'],
      action: interaction['action'],
      requiredInput: interaction['requiredInput'],
      answeredInput: interaction['requiredInput'],
      intervention: interaction['intervention'],
      inputCommand: interaction['inputCommand'],
      interventionCommand: interaction['interventionCommand'],
    })) {
      expect(validator.validate(schema, examples[key]), key).toEqual({ valid: true, errors: [] });
    }
    for (const item of examples['artifacts'] as unknown[])
      expect(validator.validate(artifact, item)).toEqual({ valid: true, errors: [] });
    for (const item of examples['feedback'] as unknown[])
      expect(validator.validate(core['feedbackBody'], item)).toEqual({ valid: true, errors: [] });
  });

  it('AC-003/023 rejects invented identity and mutation wire fields', async () => {
    const core = (await json('core.schema.json'))['schemas'] as Record<string, unknown>;
    const interaction = (await json('interaction.schema.json'))['schemas'] as Record<
      string,
      unknown
    >;
    const examples = await json('positive-catalog.json');
    const validator = new AjvJsonSchemaValidator({ strict: false });
    const command = examples['interventionCommand'] as Record<string, unknown>;
    expect(
      validator.validate(interaction['interventionCommand'], { ...command, actorId: 'model' })
        .valid,
    ).toBe(false);
    const input = examples['inputCommand'] as Record<string, unknown>;
    expect(
      validator.validate(interaction['inputCommand'], { ...input, expectedRequestRevision: 1 })
        .valid,
    ).toBe(false);
    const context = examples['context'] as Record<string, unknown>;
    expect(validator.validate(core['context'], { ...context, sourceTime: 'invented' }).valid).toBe(
      false,
    );
  });

  it('AC-005 preserves published time fields and detects missing per-sample provenance', async () => {
    const core = (await json('core.schema.json'))['schemas'] as Record<string, unknown>;
    const examples = await json('positive-catalog.json');
    const feedback = (examples['feedback'] as Record<string, unknown>[])[0];
    if (feedback === undefined) throw new Error('PINNED_FEEDBACK_EXAMPLE_MISSING');
    expect(typeof feedback['providerRecordedAt']).toBe('string');
    expect(feedback).not.toHaveProperty('providerReceivedAt');
    const validator = new AjvJsonSchemaValidator({ strict: false });
    expect(
      validator.validate(core['feedbackBody'], { ...feedback, providerRecordedAt: '2026-10-10' })
        .valid,
    ).toBe(false);
    expect(
      validator.validate(core['feedbackBody'], { ...feedback, providerRecordedAt: undefined })
        .valid,
    ).toBe(false);
  });
});
