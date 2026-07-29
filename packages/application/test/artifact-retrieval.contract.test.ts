import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { P07_REASON_CODES } from '../src/index.js';
import {
  ARTIFACT_RETRIEVAL_CONTRACT_VERSION,
  ARTIFACT_RETRIEVAL_SCHEMA_HASHES,
  FAST_GATEWAY_PATHS,
} from '../../domain/src/index.js';

interface P07ContractLock {
  readonly producedContracts: Readonly<Record<string, { readonly schemaHash: string }>>;
  readonly fastGatewayPaths: readonly string[];
}

let lock: P07ContractLock;

beforeAll(async () => {
  lock = JSON.parse(
    await readFile(
      new URL(
        '../../../docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P07_Codex_Goal_Package_V1.1/CONTRACT-LOCK.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as P07ContractLock;
});

describe('P07 frozen retrieval contracts', () => {
  it('exports every produced contract using the exact locked V1.1 schema hash', () => {
    expect(ARTIFACT_RETRIEVAL_CONTRACT_VERSION).toBe('1.1');
    expect(Object.keys(ARTIFACT_RETRIEVAL_SCHEMA_HASHES).sort()).toEqual(
      Object.keys(lock.producedContracts).sort(),
    );
    for (const [name, value] of Object.entries(ARTIFACT_RETRIEVAL_SCHEMA_HASHES)) {
      expect(lock.producedContracts[name]?.schemaHash).toBe(value);
    }
  });

  it('does not reinterpret Fast Gateway paths as an executable P07 runtime', () => {
    expect(FAST_GATEWAY_PATHS).toEqual(lock.fastGatewayPaths);
    expect(P07_REASON_CODES).toEqual(
      expect.arrayContaining([
        'ARTIFACT_NON_ACTIVE',
        'CAPABILITY_GAP',
        'PROVIDER_NOT_READY',
        'POLICY_DENY',
        'DECISION_FALLBACK',
      ]),
    );
  });
});
