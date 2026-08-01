import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  FAST_GATEWAY_CONTRACT_VERSION,
  FAST_GATEWAY_SCHEMA_HASHES,
  GATEWAY_REASON_CODES,
} from '../../domain/src/index.js';
import { FastGatewayService } from '../src/index.js';

const packageRoot = new URL(
  '../../../docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P10_Codex_Goal_Package_V1.1/',
  import.meta.url,
);

describe('P10 frozen contracts and architecture boundaries', () => {
  it('matches every produced contract hash in the P10 lock', async () => {
    const lock = JSON.parse(await readFile(new URL('CONTRACT-LOCK.json', packageRoot), 'utf8')) as {
      producedContracts: Readonly<
        Record<string, Readonly<{ version: string; schemaHash: string }>>
      >;
    };
    expect(FAST_GATEWAY_CONTRACT_VERSION).toBe('1.1');
    for (const [name, schemaHash] of Object.entries(FAST_GATEWAY_SCHEMA_HASHES)) {
      expect(lock.producedContracts[name]).toMatchObject({ version: '1.1', schemaHash });
    }
  });

  it('publishes the exact frozen field sets in a portable JSON Schema', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL('../../../schemas/v1.3/fast-gateway.schema.json', import.meta.url),
        'utf8',
      ),
    ) as {
      readonly ['x-sdar-schema-hashes']: unknown;
      readonly $defs: Readonly<
        Record<string, Readonly<{ required?: readonly string[]; properties?: unknown }>>
      >;
    };
    expect(schema['x-sdar-schema-hashes']).toEqual(FAST_GATEWAY_SCHEMA_HASHES);
    expect(schema.$defs['RuntimeRequestContext']?.required).toEqual([
      'requestId',
      'taskId',
      'contextId',
      'rawText',
      'normalizedText',
      'actor',
      'extractedFeatures',
      'worldStateRef',
      'capabilitySummaryRef',
      'policySnapshotRef',
      'deadlineAt',
      'cancellationRef',
      'idempotencyKey',
      'createdAt',
    ]);
    expect(schema.$defs['GatewayDecisionRecord']?.required).toEqual([
      'gatewayDecisionId',
      'requestId',
      'runtimeDecisionRef',
      'stageResults',
      'reasonCodes',
      'runtimeSnapshotHash',
      'decisionHash',
      'createdAt',
    ]);
  });

  it('exposes one evaluate operation and stable public reason codes', () => {
    expect(Object.hasOwn(FastGatewayService.prototype, 'evaluate')).toBe(true);
    expect(Object.hasOwn(FastGatewayService.prototype, 'evaluateDetailed')).toBe(true);
    expect(GATEWAY_REASON_CODES).toContain('GATEWAY_COGNITIVE_FALLBACK');
    expect(GATEWAY_REASON_CODES).toContain('GATEWAY_FORMAL_HANDOFF_COMMITTED');
  });

  it('does not introduce a second planner, policy engine or direct execution seam', async () => {
    const source = await readFile(
      new URL('../src/compiler/fast-gateway.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      'executeSkill(',
      'callMcp(',
      'runWorkflow(',
      'createGoal(',
      'saveOutcome(',
      'activateArtifact(',
      ['ev', 'al('].join(''),
      ['new ', 'Function('].join(''),
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps PostgreSQL as authority and Redis out of Gateway persistence', async () => {
    const source = await readFile(
      new URL(
        '../../persistence-postgres/src/compiler/fast-gateway-repository.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).toContain('fast_gateway_request');
    expect(source).toContain('cognitive_runtime_outbox');
    expect(source).not.toContain('Redis');
    expect(source).not.toContain('BullMQ');
  });
});
