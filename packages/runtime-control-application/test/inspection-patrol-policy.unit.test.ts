import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from './fixtures/inspection-patrol-authority.json' with { type: 'json' };
import { SkillPackageImporter, SkillPackageValidator } from '../../application/src/index.js';
import type { SkillPackageImportCandidate } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../skill-package-adapter/src/index.js';
import {
  createNodeCapabilityDefinition,
  type NodeCapabilityDefinitionVersion,
  type CapabilityImplementationBinding,
  type JsonObject,
} from '../../node-control-domain/src/index.js';
import {
  UgvAgentProfileSkillProviderDependencyPolicy,
  type RuntimeSkillProviderDependencyPolicyInput,
} from '../src/index.js';

let imported: SkillPackageImportCandidate;
beforeAll(async () => {
  const packageSchema: unknown = JSON.parse(
    await readFile(new URL('../../../schemas/skill-package.schema.json', import.meta.url), 'utf8'),
  );
  imported = await new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({ schemas: new AjvJsonSchemaValidator(), packageSchema }),
    clock: { now: () => '2026-10-14T00:00:00Z' },
  }).import(fileURLToPath(new URL('../../../skills/embodied.area_patrol.v2/', import.meta.url)));
});
function input(): RuntimeSkillProviderDependencyPolicyInput {
  const skill = imported.skillVersion;
  const resource = 'vehicle:ugv1';
  const bind = (schema: unknown): JsonObject => {
    // The official importer has validated this JSON package boundary.
    const value = structuredClone(schema) as JsonObject;
    return {
      ...value,
      properties: {
        ...(value['properties'] as JsonObject),
        resourceId: { type: 'string', const: resource },
      },
    };
  };
  const definition = createNodeCapabilityDefinition({
    ...(fixture.definition as NodeCapabilityDefinitionVersion),
    inputSchema: bind(skill.inputSchema),
    outputSchema: bind(skill.outputSchema),
  });
  const implementation = fixture.implementation as CapabilityImplementationBinding;
  const provider = definition.constraints?.find((c) => c['type'] === 'provider_binding_policy');
  const children = definition.constraints?.find(
    (c) => c['type'] === 'composition_authority_policy',
  )?.['children'];
  return {
    definition,
    implementation,
    implementations: [implementation],
    skill: {
      packageChecksum: imported.packageChecksum,
      toolPolicy: skill.toolPolicy,
      runtimePolicy: skill.runtimePolicy,
      usageSpecification: skill.usageSpecification,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      outcomeSpecification: {
        ...skill.outcomeSpecification,
        taskGoalPolicy: {
          requestedCapabilityId: 'embodied.area_patrol',
          resourceId: resource,
          providerBinding: provider,
          children,
          subregions: 'one_legal_requested_region',
          maximumInspectionElapsedMs: 300000,
        },
      },
    },
  };
}
describe('Governed patrol dependency authority', () => {
  it('accepts the imported reviewed package and exact independently bound children', () => {
    const assessed = new UgvAgentProfileSkillProviderDependencyPolicy().assess(input());
    expect(assessed.decision).toBe('authorized');
    if (assessed.decision !== 'authorized') throw Error('PATROL_NOT_AUTHORIZED');
    expect(assessed.authorization.childDependencies).toEqual([
      {
        skillId: 'embodied.move_to',
        skillVersion: 1,
        capabilityId: 'embodied.move',
        capabilityVersion: 1,
      },
      {
        skillId: 'embodied.inspect_area',
        skillVersion: 1,
        capabilityId: 'embodied.inspect_area',
        capabilityVersion: 1,
      },
    ]);
  });
  it.each(['usage', 'schema', 'automatic-confirmation', 'catalog', 'children', 'replay'] as const)(
    'rejects %s drift before composition admission',
    (kind) => {
      const original = input();
      const constraints = (original.definition.constraints ?? []).map((c) => {
        if (kind === 'automatic-confirmation' && c['type'] === 'confirmation_policy')
          return { ...c, autoConfirmPlan: true };
        if (kind === 'catalog' && c['type'] === 'provider_binding_policy')
          return { ...c, catalogChecksum: 'e'.repeat(64) };
        if (kind === 'children' && c['type'] === 'composition_authority_policy')
          return { ...c, children: [] };
        if (kind === 'replay' && c['type'] === 'composed_side_effect_policy')
          return { ...c, replay: 'allowed' };
        return c;
      });
      const changed = {
        ...original,
        definition: { ...original.definition, constraints },
        skill: {
          ...original.skill,
          ...(kind === 'usage' ? { usageSpecification: { apiVersion: 'unreviewed' } } : {}),
          ...(kind === 'schema'
            ? { inputSchema: { type: 'object', additionalProperties: true } }
            : {}),
        },
      };
      expect(new UgvAgentProfileSkillProviderDependencyPolicy().assess(changed).decision).toBe(
        'denied',
      );
    },
  );
});
