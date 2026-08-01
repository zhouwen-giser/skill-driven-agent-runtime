import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  DECISION_RULE_RUNTIME_CONTRACT_VERSION,
  DECISION_RULE_RUNTIME_SCHEMA_HASHES,
  RULE_ACTIONS,
  RULE_OPERAND_SOURCES,
  RULE_OPERATORS,
} from '../../domain/src/index.js';
import {
  DecisionRuleRuntimeService,
  ExistingRulePlanValidatorAdapter,
  ExistingRulePlanningAuthorityAdapter,
  RULE_RUNTIME_REASON_CODE_VERSION,
} from '../src/index.js';

const packageRoot = new URL(
  '../../../docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P09_Codex_Goal_Package_V1.1/',
  import.meta.url,
);

describe('P09 frozen contracts and architecture boundaries', () => {
  it('matches every produced contract hash in the P09 lock', async () => {
    const lock = JSON.parse(await readFile(new URL('CONTRACT-LOCK.json', packageRoot), 'utf8')) as {
      producedContracts: Readonly<
        Record<string, Readonly<{ version: string; schemaHash: string }>>
      >;
    };
    expect(DECISION_RULE_RUNTIME_CONTRACT_VERSION).toBe('1.1');
    for (const [name, schemaHash] of Object.entries(DECISION_RULE_RUNTIME_SCHEMA_HASHES)) {
      expect(lock.producedContracts[name]).toMatchObject({
        version: '1.1',
        schemaHash,
      });
    }
  });

  it('publishes a portable strict schema with exactly the runtime catalogs', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL('../../../schemas/v1.3/decision-rule-runtime.schema.json', import.meta.url),
        'utf8',
      ),
    ) as {
      readonly ['x-sdar-schema-hashes']: unknown;
      readonly $defs: Readonly<
        Record<
          string,
          Readonly<{
            properties?: Readonly<Record<string, Readonly<{ enum?: readonly string[] }>>>;
          }>
        >
      >;
    };
    expect(schema['x-sdar-schema-hashes']).toEqual(DECISION_RULE_RUNTIME_SCHEMA_HASHES);
    expect(schema.$defs['RuleAtomicCondition']?.properties?.['source']?.enum).toEqual(
      RULE_OPERAND_SOURCES,
    );
    expect(schema.$defs['RuleAtomicCondition']?.properties?.['operator']?.enum).toEqual(
      RULE_OPERATORS,
    );
    expect(schema.$defs['RuleRuntimeDsl']?.properties?.['action']).toBeDefined();
    expect(RULE_ACTIONS).not.toContain('execute_skill');
  });

  it('exposes only internal runtime and existing-authority adapters', () => {
    expect(Object.hasOwn(DecisionRuleRuntimeService.prototype, 'evaluate')).toBe(true);
    expect(Object.hasOwn(ExistingRulePlanValidatorAdapter.prototype, 'validate')).toBe(true);
    expect(Object.hasOwn(ExistingRulePlanningAuthorityAdapter.prototype, 'submit')).toBe(true);
    expect(RULE_RUNTIME_REASON_CODE_VERSION).toBe('decision-rule-runtime/1.1');
  });

  it('contains no dynamic code execution or direct Skill/MCP invocation seam', async () => {
    const domainSource = await readFile(
      new URL('../../domain/src/compiler/decision-rule-runtime.ts', import.meta.url),
      'utf8',
    );
    const applicationSource = await readFile(
      new URL('../src/compiler/decision-rule-runtime.ts', import.meta.url),
      'utf8',
    );
    const executable = [
      ['ev', 'al('].join(''),
      ['new ', 'Function('].join(''),
      'executeSkill(',
      'callMcp(',
      'runWorkflow(',
    ];
    for (const forbidden of executable) {
      expect(domainSource).not.toContain(forbidden);
      expect(applicationSource).not.toContain(forbidden);
    }
  });
});
