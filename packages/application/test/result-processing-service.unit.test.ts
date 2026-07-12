import { describe, expect, it } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import type { ProcessedResultRecord } from '../../domain/src/index.js';
import { ResultProcessingService, ResultProcessor } from '../src/index.js';

describe('ResultProcessingService', () => {
  it('normalizes, trims context, validates final output, and persists facts and memory candidates', async () => {
    let persisted: ProcessedResultRecord | undefined;
    let instruction = '';
    const service = new ResultProcessingService({
      model: {
        generateStructured: (input) => {
          instruction = input.instruction;
          return Promise.resolve({
            text: 'Device 17 is online.',
            structured: { status: 'online' },
            keyFacts: [{ name: 'device_status', value: 'online', confidence: 0.99 }],
            valueAssessment: { valuable: true, summary: 'Current status is useful.' },
            memoryCandidates: [{ kind: 'fact', content: 'Device 17 was online.', confidence: 0.9 }],
          });
        },
      },
      processor: new ResultProcessor(new AjvJsonSchemaValidator()),
      repository: {
        save: (record) => {
          persisted = record;
          return Promise.resolve();
        },
        find: () => Promise.resolve(persisted),
        listByTask: () => Promise.resolve(persisted === undefined ? [] : [persisted]),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'processed-result-1',
      maxContextCharacters: 20,
    });

    await expect(
      service.process({
        taskId: 'task-1',
        skillId: 'skill-1',
        skillVersion: 2,
        outputInstruction: 'Return status in plain language and JSON.',
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { enum: ['online', 'offline'] } },
        },
        rawResult: { deviceId: 'device-17', status: 'online', details: 'long diagnostic' },
        errors: [{ code: 'NON_FATAL_WARNING', message: 'Cached observation.' }],
      }),
    ).resolves.toMatchObject({
      normalized: {
        errors: [{ code: 'NON_FATAL_WARNING', message: 'Cached observation.' }],
        contextTruncated: true,
      },
      output: { text: 'Device 17 is online.', structured: { status: 'online' } },
      facts: [{ name: 'device_status', confidence: 0.99 }],
      valuable: true,
      memoryCandidates: [{ kind: 'fact', confidence: 0.9 }],
    });
    expect(instruction).toContain('Return status in plain language and JSON.');
    expect(instruction).toContain('truncatedJson');
  });

  it('rejects model output that violates the Skill output Schema without persistence', async () => {
    let saves = 0;
    const service = new ResultProcessingService({
      model: {
        generateStructured: () =>
          Promise.resolve({
            text: 'Unknown.',
            structured: { status: 'unknown' },
            keyFacts: [],
            valueAssessment: { valuable: false, summary: 'Not useful.' },
            memoryCandidates: [],
          }),
      },
      processor: new ResultProcessor(new AjvJsonSchemaValidator()),
      repository: {
        save: () => {
          saves += 1;
          return Promise.resolve();
        },
        find: () => Promise.resolve(undefined),
        listByTask: () => Promise.resolve([]),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'processed-result-invalid',
    });
    await expect(
      service.process({
        taskId: 'task-1',
        skillId: 'skill-1',
        skillVersion: 1,
        outputInstruction: 'Return status.',
        outputSchema: { type: 'object', properties: { status: { enum: ['online'] } } },
        rawResult: {},
      }),
    ).rejects.toMatchObject({ code: 'RESULT_SCHEMA_MISMATCH' });
    expect(saves).toBe(0);
  });
});
