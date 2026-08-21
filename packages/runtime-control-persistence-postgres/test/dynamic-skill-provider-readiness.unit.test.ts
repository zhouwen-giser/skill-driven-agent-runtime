import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type {
  RuntimeCapabilityReadinessInput,
  RuntimeSkillProviderDependencyAuthorization,
  RuntimeSkillProviderDependencyPolicyInput,
} from '../../runtime-control-application/src/index.js';
import { PostgresRuntimeCapabilityReadinessRepository } from '../src/index.js';

const BINDING_ID = 'mcp-binding-ugv1-profile';
const SERVER_ID = 'ugv1-profile-mcp';
const CATALOG_REVISION = 'catalog-ugv1-profile-v1';
const CATALOG_CHECKSUM = 'c'.repeat(64);

describe('dynamic Skill Provider dependency readiness', () => {
  it.each([
    ['current', true, undefined],
    ['binding-revision-drift', false, 'MCP_PROVIDER_BINDING_NOT_CURRENT'],
    ['catalog-revision-drift', false, 'MCP_PROVIDER_BINDING_CATALOG_DRIFT'],
    ['catalog-checksum-drift', false, 'MCP_PROVIDER_BINDING_CATALOG_DRIFT'],
  ] as const)(
    '%s compares the exact policy-frozen Binding and Catalog authority',
    async (state, expectedAvailable, expectedReason) => {
      const query = vi.fn((statement: string) => {
        if (statement.includes('FROM skill_version version'))
          return Promise.resolve({
            rows: [
              {
                exists: true,
                enabled: true,
                validation_passed: true,
                tool_policy: { required: [], optional: [], forbidden: [] },
                runtime_policy: { maxLlmCalls: 0 },
                usage_specification: { apiVersion: 'exact-usage' },
                package_checksum: 'a'.repeat(64),
              },
            ],
          });
        if (statement.includes('FROM stage_model_route'))
          return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
        throw new Error(`DYNAMIC_SKILL_READINESS_QUERY_UNEXPECTED:${statement}`);
      });
      const liveCatalogRevision =
        state === 'catalog-revision-drift' ? 'catalog-ugv1-profile-v2' : CATALOG_REVISION;
      const liveCatalogChecksum =
        state === 'catalog-checksum-drift' ? 'd'.repeat(64) : CATALOG_CHECKSUM;
      const findCurrentAuthority = vi.fn(() =>
        Promise.resolve({
          binding: {
            bindingId: BINDING_ID,
            revision: state === 'binding-revision-drift' ? 8 : 7,
            localServerId: SERVER_ID,
            endpointRef: 'https://ugv-profile.example.test/mcp',
            catalogRevision: liveCatalogRevision,
            catalogChecksum: liveCatalogChecksum,
            operationCount: 2,
            availabilityValidUntil: '2026-08-21T13:00:00.000Z',
          },
        }),
      );
      const loadCurrentAuthority = vi.fn(() =>
        Promise.resolve({
          endpoint: 'https://ugv-profile.example.test/mcp',
          status: 'enabled' as const,
          serverUpdatedAt: '2026-08-21T11:59:30.000Z',
          snapshotValidUntil: '2026-08-21T13:00:00.000Z',
          toolRevision: 12,
          protocolMode: 'frozen_v1' as const,
          snapshotToolRevision: 12,
          catalogRevision: liveCatalogRevision,
          catalogChecksum: liveCatalogChecksum,
          discoveredCatalogChecksum: liveCatalogChecksum,
          operationCount: 2,
          toolNames: ['vehicle_get_state', 'vehicle_navigate'],
        }),
      );
      const assess = vi.fn((input: RuntimeSkillProviderDependencyPolicyInput) => {
        void input;
        return {
          decision: 'authorized' as const,
          authorization: authorization(),
        };
      });
      const repository = new PostgresRuntimeCapabilityReadinessRepository(
        { query } as unknown as Pool,
        { findCurrentAuthority },
        { loadCurrentAuthority },
        { assess },
      );

      const [assessment] = await repository.assessImplementations(
        readinessInput(),
        '2026-08-21T12:00:00.000Z',
      );

      expect(assess).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: expect.objectContaining({
            packageChecksum: 'a'.repeat(64),
            usageSpecification: { apiVersion: 'exact-usage' },
          }),
        }),
      );
      expect(assessment?.available).toBe(expectedAvailable);
      expect(assessment?.policyParts).toContain('skill-package:exact');
      expect(assessment?.policyParts).toContain('skill-usage:exact');
      if (expectedReason === undefined) {
        expect(assessment?.reasons).toEqual([]);
        expect(loadCurrentAuthority).toHaveBeenCalledOnce();
      } else {
        expect(assessment?.reasons).toEqual([
          expect.objectContaining({ code: expectedReason, severity: 'blocking' }),
        ]);
        expect(loadCurrentAuthority).not.toHaveBeenCalled();
      }
      expect(query.mock.calls[0]?.[0]).toContain('skill_package_import_audit');
      expect(query.mock.calls[0]?.[0]).toContain('usage_specification_json');
    },
  );

  it('keeps an empty static required Tool set invalid when the UGV policy is not injected', async () => {
    const query = vi.fn((statement: string) => {
      if (statement.includes('FROM skill_version version'))
        return Promise.resolve({
          rows: [
            {
              exists: true,
              enabled: true,
              validation_passed: true,
              tool_policy: { required: [], optional: [], forbidden: [] },
              runtime_policy: { maxLlmCalls: 0 },
              usage_specification: { apiVersion: 'exact-usage' },
              package_checksum: 'a'.repeat(64),
            },
          ],
        });
      if (statement.includes('FROM stage_model_route'))
        return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
      throw new Error(`DYNAMIC_SKILL_READINESS_QUERY_UNEXPECTED:${statement}`);
    });
    const findCurrentAuthority = vi.fn();
    const loadCurrentAuthority = vi.fn();
    const repository = new PostgresRuntimeCapabilityReadinessRepository(
      { query } as unknown as Pool,
      { findCurrentAuthority },
      { loadCurrentAuthority },
    );

    const [assessment] = await repository.assessImplementations(
      readinessInput(),
      '2026-08-21T12:00:00.000Z',
    );

    expect(assessment).toEqual(
      expect.objectContaining({
        available: false,
        reasons: [
          expect.objectContaining({
            code: 'MCP_PROVIDER_BINDING_POLICY_INVALID',
            severity: 'blocking',
          }),
        ],
      }),
    );
    expect(findCurrentAuthority).not.toHaveBeenCalled();
    expect(loadCurrentAuthority).not.toHaveBeenCalled();
  });

  it.each([
    ['static required Tool tamper', true, 'a'.repeat(64)],
    ['missing package import audit', false, null],
  ] as const)(
    'does not fall back to generic static readiness after %s',
    async (_case, staticTool, packageChecksum) => {
      const query = vi.fn((statement: string) => {
        if (statement.includes('FROM skill_version version'))
          return Promise.resolve({
            rows: [
              {
                exists: true,
                enabled: true,
                validation_passed: true,
                tool_policy: {
                  required: staticTool
                    ? [{ serverId: SERVER_ID, toolName: 'vehicle_navigate' }]
                    : [],
                  optional: [],
                  forbidden: [],
                },
                runtime_policy: { maxLlmCalls: 0 },
                usage_specification: { apiVersion: 'exact-usage' },
                package_checksum: packageChecksum,
              },
            ],
          });
        if (statement.includes('FROM stage_model_route'))
          return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
        throw new Error(`DYNAMIC_SKILL_READINESS_QUERY_UNEXPECTED:${statement}`);
      });
      const findCurrentAuthority = vi.fn();
      const loadCurrentAuthority = vi.fn();
      const assess = vi.fn((input: RuntimeSkillProviderDependencyPolicyInput) => {
        void input;
        return { decision: 'denied' as const };
      });
      const repository = new PostgresRuntimeCapabilityReadinessRepository(
        { query } as unknown as Pool,
        { findCurrentAuthority },
        { loadCurrentAuthority },
        { assess },
      );

      const [assessment] = await repository.assessImplementations(
        readinessInput(),
        '2026-08-21T12:00:00.000Z',
      );

      expect(assess).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: expect.objectContaining(packageChecksum === null ? {} : { packageChecksum }),
        }),
      );
      if (packageChecksum === null)
        expect(assess.mock.calls[0]?.[0].skill).not.toHaveProperty('packageChecksum');
      expect(assessment).toEqual(
        expect.objectContaining({
          available: false,
          reasons: [
            expect.objectContaining({
              code: 'MCP_PROVIDER_BINDING_POLICY_INVALID',
              severity: 'blocking',
            }),
          ],
        }),
      );
      expect(findCurrentAuthority).not.toHaveBeenCalled();
      expect(loadCurrentAuthority).not.toHaveBeenCalled();
    },
  );
});

function authorization(): RuntimeSkillProviderDependencyAuthorization {
  return {
    requirements: [
      {
        selection: 'required',
        mcpProviderBindingId: BINDING_ID,
        localServerId: SERVER_ID,
        mcpToolName: 'vehicle_navigate',
        requireActive: true,
        requireAvailable: true,
        requireUnexpiredFreshness: true,
        denyFallback: true,
      },
    ],
    expectedBindings: [
      {
        mcpProviderBindingId: BINDING_ID,
        localServerId: SERVER_ID,
        bindingRevision: 7,
        catalogRevision: CATALOG_REVISION,
        catalogChecksum: CATALOG_CHECKSUM,
      },
    ],
    policyParts: ['skill-package:exact', 'skill-usage:exact'],
  };
}

function readinessInput(): RuntimeCapabilityReadinessInput {
  const implementation = {
    bindingId: 'capability-binding-embodied.move-v1',
    capabilityId: 'embodied.move',
    capabilityVersion: 1,
    implementationType: 'skill' as const,
    implementationId: 'embodied.move_to',
    implementationVersion: '1',
    role: 'primary' as const,
    priority: 0,
    providerPolicyOverride: {
      selection: 'required',
      mcpProviderBindingId: BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: 'vehicle_navigate',
      allowedResourceIds: ['vehicle:ugv1'],
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    },
    status: 'active' as const,
    revision: 1,
  };
  return {
    definition: {
      capabilityId: 'embodied.move',
      version: 1,
      domain: 'embodied',
      name: 'Move UGV',
      description: 'Move one exact UGV.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'target_reached' }],
      requiredEvidence: [{ type: 'position.observation' }],
      riskLevel: 'high',
      status: 'published',
      definitionHash: 'a'.repeat(64),
    },
    implementations: [implementation],
    maintenanceMode: false,
    killSwitch: false,
    ttlMs: 60_000,
    minimumStableWindowMs: 0,
    trigger: 'UGV dynamic Skill readiness regression',
  };
}
