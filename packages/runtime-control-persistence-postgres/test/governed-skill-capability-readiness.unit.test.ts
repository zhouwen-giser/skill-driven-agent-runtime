import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeCapabilityReadinessInput } from '../../runtime-control-application/src/index.js';
import {
  deriveFrozenMcpCatalogAuthority,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
} from '../../domain/src/index.js';
import { PostgresRuntimeCapabilityReadinessRepository } from '../src/index.js';

describe('governed Skill Capability readiness', () => {
  it('uses published governance and does not require a model for a zero-LLM Skill', async () => {
    const statements: string[] = [];
    const query = vi.fn((statement: string) => {
      statements.push(statement);
      if (statement.includes('FROM skill_version version'))
        return Promise.resolve({
          rows: [
            {
              exists: true,
              enabled:
                statement.includes('runtime_skill_version_governance') &&
                statement.includes('governance.lifecycle_status'),
              validation_passed: true,
              tool_policy: { required: [], optional: [] },
              runtime_policy: { autoConfirmPlan: false, maxLlmCalls: 0 },
            },
          ],
        });
      if (statement.includes('FROM stage_model_route'))
        return Promise.resolve({
          rows: [{ available: false, fingerprint: 'none' }],
        });
      return Promise.resolve({ rows: [] });
    });
    const repository = new PostgresRuntimeCapabilityReadinessRepository({
      query,
    } as unknown as Pool);
    const input = {
      definition: {
        capabilityId: 'home.light.read-state',
        version: 1,
        domain: 'home.light',
        name: 'Read light state',
        description: 'Read an allowlisted light.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        successCriteria: [{ type: 'completed' }],
        requiredEvidence: [{ type: 'provider_result' }],
        riskLevel: 'low',
        status: 'published',
        definitionHash: 'a'.repeat(64),
      },
      implementations: [
        {
          bindingId: 'capability-binding-home.light.read-state-v1',
          capabilityId: 'home.light.read-state',
          capabilityVersion: 1,
          implementationType: 'skill',
          implementationId: 'home.light.get-state',
          implementationVersion: '1',
          role: 'primary',
          priority: 0,
          status: 'active',
          revision: 1,
        },
      ],
      maintenanceMode: false,
      killSwitch: false,
      ttlMs: 60_000,
      minimumStableWindowMs: 0,
      trigger: 'focused governed Skill readiness regression',
    } as const satisfies RuntimeCapabilityReadinessInput;

    const assessments = await repository.assessImplementations(input, '2026-08-10T12:00:00.000Z');

    expect(assessments).toEqual([
      expect.objectContaining({
        bindingId: 'capability-binding-home.light.read-state-v1',
        available: true,
        degraded: false,
        reasons: [],
      }),
    ]);
    expect(statements[0]).toContain('LEFT JOIN runtime_skill_version_governance governance');
    expect(statements[0]).toContain("='published' AS enabled");
  });

  it.each([
    ['absent', undefined, true],
    ['null', null, false],
    ['malformed', { selection: 'required' }, false],
  ] as const)(
    'distinguishes a %s Binding policy override from legacy MCP readiness',
    async (_case, providerPolicyOverride, expectedAvailable) => {
      const query = vi.fn((statement: string) => {
        if (statement.includes('FROM skill_version version'))
          return Promise.resolve({
            rows: [
              {
                exists: true,
                enabled: true,
                validation_passed: true,
                tool_policy: {
                  required: [{ serverId: 'legacy-mcp', toolName: 'legacy_read' }],
                  optional: [],
                },
                runtime_policy: { maxLlmCalls: 0 },
              },
            ],
          });
        if (statement.includes('FROM mcp_server server'))
          return Promise.resolve({
            rows: [
              {
                status: 'enabled',
                tool_revision: 1,
                updated_at: new Date('2026-08-10T11:59:30.000Z'),
                tool_exists: true,
              },
            ],
          });
        if (statement.includes('FROM stage_model_route'))
          return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
        return Promise.resolve({ rows: [] });
      });
      const findCurrentAuthority = vi.fn();
      const loadCurrentAuthority = vi.fn();
      const repository = new PostgresRuntimeCapabilityReadinessRepository(
        { query } as unknown as Pool,
        { findCurrentAuthority },
        { loadCurrentAuthority },
      );
      const input = {
        definition: {
          capabilityId: 'legacy.read-state',
          version: 1,
          domain: 'legacy',
          name: 'Legacy read state',
          description: 'Exercises legacy MCP readiness compatibility.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [{ type: 'completed' }],
          requiredEvidence: [{ type: 'provider_result' }],
          riskLevel: 'low',
          status: 'published',
          definitionHash: 'a'.repeat(64),
        },
        implementations: [
          {
            bindingId: 'legacy-binding',
            capabilityId: 'legacy.read-state',
            capabilityVersion: 1,
            implementationType: 'skill',
            implementationId: 'legacy.read-state',
            implementationVersion: '1',
            role: 'primary',
            priority: 0,
            ...(providerPolicyOverride === undefined ? {} : { providerPolicyOverride }),
            status: 'active',
            revision: 1,
          },
        ],
        maintenanceMode: false,
        killSwitch: false,
        ttlMs: 60_000,
        minimumStableWindowMs: 0,
        trigger: 'legacy MCP compatibility regression',
      } as const satisfies RuntimeCapabilityReadinessInput;

      const [assessment] = await repository.assessImplementations(
        input,
        '2026-08-10T12:00:00.000Z',
      );

      expect(assessment?.available).toBe(expectedAvailable);
      expect(assessment?.reasons).toEqual(
        expectedAvailable
          ? []
          : [
              expect.objectContaining({
                code: 'MCP_PROVIDER_BINDING_POLICY_INVALID',
                severity: 'blocking',
              }),
            ],
      );
      expect(findCurrentAuthority).not.toHaveBeenCalled();
      expect(loadCurrentAuthority).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['absent', undefined, true],
    ['null', null, false],
    ['object', { selection: 'required' }, false],
  ] as const)(
    'fails closed for a plan template whose Binding policy override is %s',
    async (_case, providerPolicyOverride, expectedAvailable) => {
      const query = vi.fn((statement: string) => {
        if (!statement.includes('FROM compiled_artifact artifact'))
          throw new Error('PLAN_TEMPLATE_READINESS_QUERY_UNEXPECTED');
        return Promise.resolve({
          rows: [{ content_hash: 'b'.repeat(64), dependency_snapshot: { resources: [] } }],
        });
      });
      const repository = new PostgresRuntimeCapabilityReadinessRepository({
        query,
      } as unknown as Pool);
      const input = {
        definition: {
          capabilityId: 'plan-template.capability',
          version: 1,
          domain: 'plan-template',
          name: 'Plan template capability',
          description: 'Exercises plan template Binding policy fail-closed behavior.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [{ type: 'completed' }],
          requiredEvidence: [{ type: 'provider_result' }],
          riskLevel: 'low',
          status: 'published',
          definitionHash: 'a'.repeat(64),
        },
        implementations: [
          {
            bindingId: 'plan-template-binding',
            capabilityId: 'plan-template.capability',
            capabilityVersion: 1,
            implementationType: 'plan_template',
            implementationId: 'plan-template.persistence',
            implementationVersion: '1',
            role: 'primary',
            priority: 0,
            ...(providerPolicyOverride === undefined ? {} : { providerPolicyOverride }),
            status: 'active',
            revision: 1,
          },
        ],
        maintenanceMode: false,
        killSwitch: false,
        ttlMs: 60_000,
        minimumStableWindowMs: 0,
        trigger: 'plan template Binding policy regression',
      } as const satisfies RuntimeCapabilityReadinessInput;

      const [assessment] = await repository.assessImplementations(
        input,
        '2026-08-10T12:00:00.000Z',
      );

      expect(assessment?.available).toBe(expectedAvailable);
      expect(assessment?.reasons).toEqual(
        expectedAvailable
          ? []
          : [
              expect.objectContaining({
                code: 'MCP_PROVIDER_BINDING_POLICY_INVALID',
                severity: 'blocking',
              }),
            ],
      );
      expect(query).toHaveBeenCalledTimes(expectedAvailable ? 1 : 0);
    },
  );

  it.each([
    ['current', 'current'],
    ['suspended-or-expired', 'missing'],
    ['endpoint-drifted', 'endpoint-drift'],
    ['catalog-drifted', 'catalog-drift'],
    ['revision-drifted', 'revision-drift'],
    ['required-tool-missing', 'tool-missing'],
    ['healthy-with-old-discovery-snapshot', 'stale'],
    ['Provider health unavailable', 'health-unavailable'],
    ['Provider health expired', 'health-expired'],
    ['Binding reader unconfigured', 'binding-reader-unconfigured'],
    ['Runtime reader unconfigured', 'runtime-reader-unconfigured'],
    ['Runtime reader throws', 'runtime-reader-error'],
  ] as const)(
    'uses Node Control Binding authority and fails closed when it is %s',
    async (_case, state) => {
      const query = vi.fn((statement: string) => {
        if (statement.includes('FROM skill_version version'))
          return Promise.resolve({
            rows: [
              {
                exists: true,
                enabled: true,
                validation_passed: true,
                tool_policy: {
                  required: [{ serverId: 'home-lab-light-mcp', toolName: 'light_get_state' }],
                  optional: [],
                },
                runtime_policy: { maxLlmCalls: 0 },
              },
            ],
          });
        if (statement.includes('FROM mcp_server server'))
          throw new Error('EXACT_BINDING_AUTHORITY_MUST_USE_SINGLE_SNAPSHOT');
        if (statement.includes('FROM stage_model_route'))
          return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
        return Promise.resolve({ rows: [] });
      });
      const runtimeServer = currentRuntimeServer();
      const runtimeTool = currentRuntimeTool();
      const runtimeSnapshot = currentRuntimeSnapshot();
      const runtimeCatalog = deriveFrozenMcpCatalogAuthority(
        runtimeSnapshot,
        [runtimeTool],
        runtimeServer.toolRevision,
      );
      const findCurrentAuthority = vi.fn(() =>
        Promise.resolve(
          state === 'missing'
            ? undefined
            : {
                binding: {
                  bindingId: 'mcp-binding-ha-light-lab',
                  revision: 11,
                  localServerId: 'home-lab-light-mcp',
                  endpointRef:
                    state === 'endpoint-drift'
                      ? 'https://stale-provider.example.test/mcp'
                      : runtimeServer.endpoint,
                  catalogRevision: runtimeCatalog.catalogRevision,
                  catalogChecksum:
                    state === 'catalog-drift' ? 'b'.repeat(64) : runtimeCatalog.catalogChecksum,
                  operationCount: runtimeCatalog.operationCount,
                  availabilityStatus:
                    state === 'health-unavailable'
                      ? ('unavailable' as const)
                      : ('available' as const),
                  availabilityValidUntil:
                    state === 'health-expired'
                      ? '2026-08-10T11:00:00.000Z'
                      : '2026-08-10T13:00:00.000Z',
                },
              },
        ),
      );
      const loadCurrentAuthority = vi.fn(() =>
        state === 'runtime-reader-error'
          ? Promise.reject(new Error('RUNTIME_AUTHORITY_READ_FAILED'))
          : Promise.resolve({
              endpoint: runtimeServer.endpoint,
              status: runtimeServer.status,
              serverUpdatedAt:
                state === 'current' ? '2026-08-10T00:00:00.000Z' : runtimeServer.updatedAt,
              snapshotValidUntil:
                state === 'stale' ? '2026-08-10T11:59:59.999Z' : '2026-08-10T13:00:00.000Z',
              toolRevision: runtimeServer.toolRevision,
              protocolMode: runtimeSnapshot.protocolMode,
              snapshotToolRevision:
                state === 'revision-drift'
                  ? runtimeSnapshot.toolRevision - 1
                  : runtimeSnapshot.toolRevision,
              catalogRevision: runtimeCatalog.catalogRevision,
              catalogChecksum: runtimeCatalog.catalogChecksum,
              discoveredCatalogChecksum: runtimeCatalog.catalogChecksum,
              operationCount: runtimeCatalog.operationCount,
              toolNames: state === 'tool-missing' ? [] : [runtimeTool.toolName],
            }),
      );
      const repository = new PostgresRuntimeCapabilityReadinessRepository(
        { query } as unknown as Pool,
        state === 'binding-reader-unconfigured' ? undefined : { findCurrentAuthority },
        state === 'runtime-reader-unconfigured' ? undefined : { loadCurrentAuthority },
      );
      const implementation = {
        bindingId: 'capability-binding-home.light.read-state-v1',
        capabilityId: 'home.light.read-state',
        capabilityVersion: 1,
        implementationType: 'skill' as const,
        implementationId: 'home.light.get-state',
        implementationVersion: '1',
        role: 'primary' as const,
        priority: 0,
        providerPolicyOverride: {
          selection: 'required',
          mcpProviderBindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
          mcpToolName: 'light_get_state',
          allowedResourceIds: ['living-room-main-light'],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
        status: 'active' as const,
        revision: 1,
      };
      const baseDefinition = {
        capabilityId: 'home.light.read-state',
        version: 1,
        domain: 'home.light',
        name: 'Read light state',
        description: 'Read an allowlisted light.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        successCriteria: [{ type: 'completed' }],
        requiredEvidence: [{ type: 'provider_result' }],
        riskLevel: 'low' as const,
        status: 'published' as const,
        definitionHash: 'a'.repeat(64),
      };
      const input = {
        definition: baseDefinition,
        implementations: [implementation],
        maintenanceMode: false,
        killSwitch: false,
        ttlMs: 60_000,
        minimumStableWindowMs: 0,
        trigger: 'current Binding authority regression',
      } satisfies RuntimeCapabilityReadinessInput;

      const [assessment] = await repository.assessImplementations(
        input,
        '2026-08-10T12:00:00.000Z',
      );

      if (state === 'binding-reader-unconfigured')
        expect(findCurrentAuthority).not.toHaveBeenCalled();
      else
        expect(findCurrentAuthority).toHaveBeenCalledWith({
          bindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
          observedAt: '2026-08-10T12:00:00.000Z',
        });
      if (
        state === 'missing' ||
        state === 'health-unavailable' ||
        state === 'health-expired' ||
        state === 'binding-reader-unconfigured' ||
        state === 'runtime-reader-unconfigured'
      )
        expect(loadCurrentAuthority).not.toHaveBeenCalled();
      else expect(loadCurrentAuthority).toHaveBeenCalledOnce();
      expect(assessment?.available).toBe(state === 'current' || state === 'stale');
      if (state === 'current' || state === 'stale')
        expect(assessment?.catalogParts.join('|')).toContain('mcp-binding-ha-light-lab:11');
      else
        expect(assessment?.reasons).toEqual([
          expect.objectContaining({
            code:
              state === 'missing' || state === 'binding-reader-unconfigured'
                ? 'MCP_PROVIDER_BINDING_NOT_CURRENT'
                : state === 'endpoint-drift'
                  ? 'MCP_PROVIDER_BINDING_ENDPOINT_DRIFT'
                  : state === 'catalog-drift'
                    ? 'MCP_PROVIDER_BINDING_CATALOG_DRIFT'
                    : state === 'tool-missing'
                      ? 'MCP_TOOL_UNAVAILABLE'
                      : state === 'health-unavailable'
                        ? 'MCP_PROVIDER_UNAVAILABLE'
                        : state === 'health-expired'
                          ? 'PROVIDER_AVAILABILITY_EXPIRED'
                          : 'MCP_PROVIDER_BINDING_RUNTIME_AUTHORITY_UNAVAILABLE',
            severity: 'blocking',
          }),
        ]);
    },
  );

  it.each([
    ['both-current', false, true],
    ['second-missing', true, false],
  ] as const)(
    'requires every Binding in an exact-two required_all policy when %s',
    async (_case, secondMissing, expectedAvailable) => {
      const required = [
        { serverId: 'home-lab-light-mcp', toolName: 'light_get_state' },
        { serverId: 'home-lab-climate-mcp', toolName: 'climate_get_state' },
      ];
      const query = vi.fn((statement: string) => {
        if (statement.includes('FROM skill_version version'))
          return Promise.resolve({
            rows: [
              {
                exists: true,
                enabled: true,
                validation_passed: true,
                tool_policy: { required, optional: [] },
                runtime_policy: { maxLlmCalls: 0 },
              },
            ],
          });
        if (statement.includes('FROM stage_model_route'))
          return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
        throw new Error('COMPOSITE_READINESS_QUERY_UNEXPECTED');
      });
      const findCurrentAuthority = vi.fn(
        (request: Readonly<{ bindingId?: string; localServerId: string }>) =>
          Promise.resolve(
            secondMissing && request.localServerId === 'home-lab-climate-mcp'
              ? undefined
              : {
                  binding: {
                    bindingId: request.bindingId ?? '',
                    revision: 7,
                    localServerId: request.localServerId,
                    endpointRef: `https://${request.localServerId}.example.test/mcp`,
                    catalogRevision: `revision-${request.localServerId}`,
                    catalogChecksum: request.localServerId.includes('light')
                      ? 'a'.repeat(64)
                      : 'b'.repeat(64),
                    operationCount: 1,
                    availabilityStatus: 'available' as const,
                    availabilityValidUntil: '2026-08-10T13:00:00.000Z',
                  },
                },
          ),
      );
      const loadCurrentAuthority = vi.fn((localServerId: string) =>
        Promise.resolve({
          endpoint: `https://${localServerId}.example.test/mcp`,
          status: 'enabled' as const,
          serverUpdatedAt: '2026-08-10T11:59:30.000Z',
          snapshotValidUntil: '2026-08-10T13:00:00.000Z',
          toolRevision: 7,
          protocolMode: 'frozen_v1' as const,
          snapshotToolRevision: 7,
          catalogRevision: `revision-${localServerId}`,
          catalogChecksum: localServerId.includes('light') ? 'a'.repeat(64) : 'b'.repeat(64),
          discoveredCatalogChecksum: localServerId.includes('light')
            ? 'a'.repeat(64)
            : 'b'.repeat(64),
          operationCount: 1,
          toolNames: [localServerId.includes('light') ? 'light_get_state' : 'climate_get_state'],
        }),
      );
      const repository = new PostgresRuntimeCapabilityReadinessRepository(
        { query } as unknown as Pool,
        { findCurrentAuthority },
        { loadCurrentAuthority },
      );
      const exactRequirement = (bindingId: string, localServerId: string, mcpToolName: string) => ({
        selection: 'required' as const,
        mcpProviderBindingId: bindingId,
        localServerId,
        mcpToolName,
        requireActive: true as const,
        requireAvailable: true as const,
        requireUnexpiredFreshness: true as const,
        denyFallback: true as const,
      });
      const input = {
        definition: {
          capabilityId: 'home.living-room.read-state',
          version: 1,
          domain: 'home.living-room',
          name: 'Read living room state',
          description: 'Read two allowlisted resources.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [{ type: 'completed' }],
          requiredEvidence: [],
          riskLevel: 'low' as const,
          status: 'published' as const,
          definitionHash: 'c'.repeat(64),
        },
        implementations: [
          {
            bindingId: 'capability-binding-home.living-room.read-state-v1',
            capabilityId: 'home.living-room.read-state',
            capabilityVersion: 1,
            implementationType: 'skill' as const,
            implementationId: 'home.living-room.get-state',
            implementationVersion: '1',
            role: 'primary' as const,
            priority: 0,
            providerPolicyOverride: {
              selection: 'required_all',
              requirements: [
                exactRequirement(
                  'mcp-binding-ha-light-lab',
                  'home-lab-light-mcp',
                  'light_get_state',
                ),
                exactRequirement(
                  'mcp-binding-ha-climate-lab',
                  'home-lab-climate-mcp',
                  'climate_get_state',
                ),
              ],
            },
            status: 'active' as const,
            revision: 1,
          },
        ],
        maintenanceMode: false,
        killSwitch: false,
        ttlMs: 60_000,
        minimumStableWindowMs: 0,
        trigger: 'exact-two Provider Binding readiness regression',
      } satisfies RuntimeCapabilityReadinessInput;

      const [assessment] = await repository.assessImplementations(
        input,
        '2026-08-10T12:00:00.000Z',
      );

      expect(assessment?.available).toBe(expectedAvailable);
      expect(findCurrentAuthority).toHaveBeenCalledTimes(2);
      expect(loadCurrentAuthority).toHaveBeenCalledTimes(secondMissing ? 1 : 2);
      expect(assessment?.reasons).toEqual(
        expectedAvailable
          ? []
          : [
              expect.objectContaining({
                code: 'MCP_PROVIDER_BINDING_NOT_CURRENT',
                dependencyRef: 'mcp-binding-ha-climate-lab',
                severity: 'blocking',
              }),
            ],
      );
    },
  );

  it('rejects required_all when the Skill required tool set is not exactly one-to-one', async () => {
    const query = vi.fn((statement: string) => {
      if (statement.includes('FROM skill_version version'))
        return Promise.resolve({
          rows: [
            {
              exists: true,
              enabled: true,
              validation_passed: true,
              tool_policy: {
                required: [{ serverId: 'home-lab-light-mcp', toolName: 'light_get_state' }],
                optional: [],
              },
              runtime_policy: { maxLlmCalls: 0 },
            },
          ],
        });
      if (statement.includes('FROM stage_model_route'))
        return Promise.resolve({ rows: [{ available: false, fingerprint: 'none' }] });
      throw new Error('COMPOSITE_READINESS_QUERY_UNEXPECTED');
    });
    const findCurrentAuthority = vi.fn();
    const loadCurrentAuthority = vi.fn();
    const repository = new PostgresRuntimeCapabilityReadinessRepository(
      { query } as unknown as Pool,
      { findCurrentAuthority },
      { loadCurrentAuthority },
    );
    const hard = {
      selection: 'required' as const,
      requireActive: true as const,
      requireAvailable: true as const,
      requireUnexpiredFreshness: true as const,
      denyFallback: true as const,
    };
    const input = {
      definition: {
        capabilityId: 'home.living-room.read-state',
        version: 1,
        domain: 'home.living-room',
        name: 'Read living room state',
        description: 'Read two allowlisted resources.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        successCriteria: [],
        requiredEvidence: [],
        riskLevel: 'low' as const,
        status: 'published' as const,
        definitionHash: 'c'.repeat(64),
      },
      implementations: [
        {
          bindingId: 'composite-binding',
          capabilityId: 'home.living-room.read-state',
          capabilityVersion: 1,
          implementationType: 'skill' as const,
          implementationId: 'home.living-room.get-state',
          implementationVersion: '1',
          role: 'primary' as const,
          priority: 0,
          providerPolicyOverride: {
            selection: 'required_all',
            requirements: [
              {
                ...hard,
                mcpProviderBindingId: 'mcp-binding-ha-light-lab',
                localServerId: 'home-lab-light-mcp',
                mcpToolName: 'light_get_state',
              },
              {
                ...hard,
                mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
                localServerId: 'home-lab-climate-mcp',
                mcpToolName: 'climate_get_state',
              },
            ],
          },
          status: 'active' as const,
          revision: 1,
        },
      ],
      maintenanceMode: false,
      killSwitch: false,
      ttlMs: 60_000,
      minimumStableWindowMs: 0,
      trigger: 'required tool mismatch regression',
    } satisfies RuntimeCapabilityReadinessInput;

    const [assessment] = await repository.assessImplementations(input, '2026-08-10T12:00:00.000Z');

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
});

function currentRuntimeServer(): McpServer {
  return {
    serverId: 'home-lab-light-mcp',
    name: 'Home Lab Light',
    endpoint: 'https://provider.example.test/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 11,
    protocolMode: 'frozen_v1',
    currentProtocolSnapshotId: 'snapshot-light-11',
    createdAt: '2026-08-10T11:59:30.000Z',
    updatedAt: '2026-08-10T11:59:30.000Z',
  };
}

function currentRuntimeTool(): McpTool {
  return {
    serverId: 'home-lab-light-mcp',
    toolName: 'light_get_state',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior: 'synchronous_only',
      availability: 'not_supported',
      supportsScheduling: false,
      supportsMaxElapsed: false,
      supportsObservations: false,
      supportsInputRequired: false,
      idempotency: 'none',
    },
    discoveredAt: '2026-08-10T11:59:30.000Z',
  };
}

function currentRuntimeSnapshot(): McpProtocolDiscoverySnapshot {
  return {
    snapshotId: 'snapshot-light-11',
    serverId: 'home-lab-light-mcp',
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'Home Lab Light', version: '2.0.0' },
    taskNotifications: false,
    discoveredAt: '2026-08-10T11:59:30.000Z',
    toolRevision: 11,
  };
}
