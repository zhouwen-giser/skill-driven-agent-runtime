import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  bootstrapUgvAgentProfileAuthority,
  type UgvAgentProfileAuthorityBootstrapReport,
  type UgvAgentProfileAuthorityBootstrapConfiguration,
  verifyUgvAgentProfileAuthority,
  verifyUgvAgentProfileAuthorityReadiness,
} from '../src/ugv-agent-profile-authority-bootstrap-driver.js';
import type { materializeSmppProviders } from '../src/smpp-provider-materializer.js';
import type { bootstrapUgvSmppSource } from '../src/ugv-smpp-source-bootstrap-driver.js';

const CONTROL = 'http://127.0.0.1:10091';
const RUNTIME = 'http://127.0.0.1:10998';

interface AuthorityProjectorModule {
  projectAuthorityReport(
    mode: string,
    inputPath: string,
    outputPath: string,
    options?: { readonly repositoryRoot?: string; readonly stateRoot?: string },
  ): Promise<Record<string, unknown>>;
}

describe('UGV Agent Profile authority bootstrap', () => {
  it('rejects rogue governance before Source or Provider mutation', async () => {
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
    const materializeProviders = vi.fn<typeof materializeSmppProviders>();
    const request = inventoryFetch({
      controlSkills: [
        {
          skillId: 'rogue.skill',
          version: '1',
          status: 'published',
          inputSchema: {},
          outputSchema: {},
        },
      ],
    });

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        fetch: request,
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'UAP_EXTRA_GOVERNANCE_AUTHORITY_FORBIDDEN',
    });
    expect(bootstrapSource).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('rejects a rogue active managed Card before Source or Provider mutation', async () => {
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
    const materializeProviders = vi.fn<typeof materializeSmppProviders>();
    const request = inventoryFetch({
      managedCards: [
        {
          revision: 1,
          exposureRefs: ['a2a.rogue:1'],
          contentHash: 'a'.repeat(64),
          capabilityCatalogHash: 'b'.repeat(64),
          status: 'active',
          generatedAt: '2026-08-21T00:00:00.000Z',
        },
      ],
    });

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        fetch: request,
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'UAP_EXPOSURE_DRIFT' });
    expect(bootstrapSource).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('rejects a rogue Source inventory before either delegated bootstrap can run', async () => {
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
    const materializeProviders = vi.fn<typeof materializeSmppProviders>();

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        fetch: inventoryFetch({
          sources: [
            {
              smppSourceId: 'rogue-source',
              registryEndpoint:
                'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
              credentialRef: 'unauthenticated://none',
              environment: 'simulation',
              syncMode: 'manual',
              snapshotTtlSeconds: 300,
              lkgPolicy: 'deny_when_unavailable',
              status: 'active',
              revision: 1,
            },
          ],
        }),
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'UAP_EXTRA_CONTROL_PLANE_AUTHORITY_FORBIDDEN',
    });
    expect(bootstrapSource).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
  });

  it('passes the Profile-specific simulation-only navigate policy to the generic materializer', async () => {
    const imported = await formalPackage();
    const profileConfiguration = configuration();
    const api = new AuthorityApis(
      imported.skillVersion as unknown as Readonly<Record<string, unknown>>,
    );
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>(() => {
      api.installSource();
      return Promise.resolve({ status: 'passed', sourceAction: 'created' } as never);
    });
    const materializeProviders = vi
      .fn<typeof materializeSmppProviders>()
      .mockResolvedValue({ status: 'passed', providers: [] } as never);

    await expect(
      bootstrapUgvAgentProfileAuthority(profileConfiguration, {
        fetch: api.fetch,
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'UAP_PROVIDER_MATERIALIZATION_RESULT_INVALID',
    });
    const materialization = materializeProviders.mock.calls[0]?.[0];
    expect(bootstrapSource.mock.calls[0]?.[0].runId).toBe(
      `uap-p3-b01-source-bootstrap-session-${createHash('sha256')
        .update(
          `${profileConfiguration.runId}\u0000source-bootstrap-session\u00002026-08-21T00:00:00.000Z`,
        )
        .digest('hex')
        .slice(0, 32)}`,
    );
    expect(bootstrapSource.mock.calls[0]?.[0].runId).not.toBe(profileConfiguration.runId);
    expect(materialization?.providers).toHaveLength(1);
    expect(materialization?.providers[0]?.tools['vehicle_navigate']).toMatchObject({
      taskBehavior: 'task_required',
      executionSemantics: {
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'task_cancel',
        idempotency: 'server_managed',
        replay: 'simulation_only',
      },
    });
    expect(materialization?.providers[0]?.tools['vehicle_fire_weapon']).toMatchObject({
      executionSemantics: { replay: 'forbidden' },
    });
  });

  it.each([
    ['navigate-status', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['navigate-position-authority', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['navigate-position-observed-at-missing', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['navigate-position-observed-at-nonstring', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['get-state-freshness', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
    ['get-state-cursor', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
    ['get-state-identity', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
  ] as const)(
    'rejects clean-inventory native schema drift %s before delegated mutation',
    async (drift, code) => {
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const request = inventoryFetch({ nativeSnapshot: nativeOutputDrift(drift) });

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          fetch: request,
          bootstrapSource,
          materializeProviders,
          now: () => '2026-08-21T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code });
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
      expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    },
  );

  it.each([
    ['vehicle_get_state', 'direct-success', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_navigate', 'direct-success', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_get_state', 'extra-branch', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_navigate', 'duplicate-success', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_get_state', 'duplicate-business', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_navigate', 'business-drift', 'UAP_NAVIGATE_OUTPUT_SCHEMA_INVALID'],
    ['vehicle_get_state', 'wrapper-extra-key', 'UAP_GET_STATE_OUTPUT_SCHEMA_INVALID'],
  ] as const)(
    'rejects %s output wrapper drift %s before delegated mutation',
    async (toolName, drift, code) => {
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const request = inventoryFetch({
        nativeSnapshot: nativeOutputWrapperDrift(toolName, drift),
      });

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          fetch: request,
          bootstrapSource,
          materializeProviders,
          now: () => '2026-08-21T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code });
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
      expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    },
  );

  it.each([
    ['profileVersion', 'vehicle_navigate', '2.0', false],
    ['taskBehavior', 'vehicle_navigate', 'server_directed', true],
    ['availability', 'vehicle_navigate', 'not_supported', true],
    ['supportsScheduling', 'vehicle_navigate', false, true],
    ['supportsMaxElapsed', 'vehicle_navigate', false, true],
    ['supportsCancellation', 'vehicle_navigate', false, true],
    ['supportsPauseResume', 'vehicle_navigate', false, true],
    ['supportsObservations', 'vehicle_navigate', false, true],
    ['supportsInputRequired', 'vehicle_navigate', true, true],
    ['idempotency', 'vehicle_navigate', 'none', true],
    ['supportsInputRequired', 'vehicle_fire_weapon', false, true],
    ['supportsCancellation', 'vehicle_emergency_stop', true, true],
  ] as const)(
    'rejects native %s drift on %s before delegated mutation',
    async (field, toolName, value, stableProfileError) => {
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const request = inventoryFetch({
        nativeSnapshot: nativeTaskExecutionDrift(toolName, field, value),
      });
      const attempt = bootstrapUgvAgentProfileAuthority(configuration(), {
        fetch: request,
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      });

      if (stableProfileError)
        await expect(attempt).rejects.toMatchObject({
          code: 'UAP_NATIVE_REGISTRY_TOOL_PROFILE_INVALID',
        });
      else await expect(attempt).rejects.toBeDefined();
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
      expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    },
  );

  it.each([
    ['vehicle_get_state', 'supportsCancellation'],
    ['vehicle_emergency_stop', 'supportsPauseResume'],
    ['vehicle_navigate', 'supportsCancellation'],
  ] as const)(
    'rejects native %s with missing explicit %s before delegated mutation',
    async (toolName, field) => {
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const request = inventoryFetch({
        nativeSnapshot: nativeTaskExecutionDrift(toolName, field, undefined, true),
      });

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          fetch: request,
          bootstrapSource,
          materializeProviders,
          now: () => '2026-08-21T00:00:00.000Z',
        }),
      ).rejects.toBeDefined();
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
      expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    },
  );

  it.each([
    {
      authorityDrift: 'extra optional vehicle_laser_range',
      tools: [
        ...toolNames().map((toolName) => nativeTool(toolName)),
        nativeTool('vehicle_laser_range'),
      ],
    },
    ...toolNames().map((missingToolName) => ({
      authorityDrift: `missing required ${missingToolName}`,
      tools: toolNames()
        .filter((toolName) => toolName !== missingToolName)
        .map((toolName) => nativeTool(toolName)),
    })),
  ])('rejects $authorityDrift before delegated mutation', async ({ tools }) => {
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
    const materializeProviders = vi.fn<typeof materializeSmppProviders>();
    const request = inventoryFetch({ nativeSnapshot: nativeRegistrySnapshot(tools) });

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        fetch: request,
        bootstrapSource,
        materializeProviders,
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'UAP_NATIVE_REGISTRY_PROVIDER_INVALID' });
    expect(bootstrapSource).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
    expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it.each([
    {
      timestampOrder: 'publishedAt before createdAt before observedAt',
      publishedAt: '2026-08-20T23:59:59.215Z',
      createdAt: '2026-08-20T23:59:59.225Z',
    },
    {
      timestampOrder: 'publishedAt equal to createdAt',
      publishedAt: '2026-08-20T23:59:59.225Z',
      createdAt: '2026-08-20T23:59:59.225Z',
    },
    {
      timestampOrder: 'createdAt equal to observedAt',
      publishedAt: '2026-08-20T23:59:59.225Z',
      createdAt: '2026-08-21T00:00:00.000Z',
    },
  ])(
    'accepts native $timestampOrder',
    async ({ publishedAt, createdAt }) => {
      const fixture = await authorityFixture({ publishedAt, createdAt });

      expect(fixture.api.sourceInstalls).toBe(1);
    },
    30_000,
  );

  it('accepts the exact success and business output branches independent of order', async () => {
    const fixture = await authorityFixture({ reverseOutputBranches: true });

    expect(fixture.api.sourceInstalls).toBe(1);
    expect(fixture.api.providerToolCallCount).toBe(0);
  }, 30_000);

  it.each([
    {
      timestampDrift: 'publishedAt later than createdAt',
      publishedAt: '2026-08-20T23:59:59.225Z',
      createdAt: '2026-08-20T23:59:59.215Z',
    },
    {
      timestampDrift: 'createdAt later than observedAt',
      publishedAt: '2026-08-20T23:59:59.215Z',
      createdAt: '2026-08-21T00:00:00.001Z',
    },
  ])(
    'rejects native $timestampDrift before delegated mutation',
    async ({ publishedAt, createdAt }) => {
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const request = inventoryFetch({
        nativeSnapshot: { ...nativeRegistrySnapshot(), publishedAt, createdAt },
      });

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          fetch: request,
          bootstrapSource,
          materializeProviders,
          now: () => '2026-08-21T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'UAP_NATIVE_REGISTRY_AUTHORITY_INVALID' });
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
      expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    },
  );

  it('bootstraps idempotently and proves the exact suspend-to-empty-to-same-v1 restore lifecycle', async () => {
    const imported = await formalPackage();
    const api = new AuthorityApis(
      imported.skillVersion as unknown as Readonly<Record<string, unknown>>,
    );
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>(() => {
      api.installSource();
      return Promise.resolve({
        status: 'passed',
        sourceAction: api.sourceInstalls === 1 ? 'created' : 'reused',
      } as never);
    });
    const materializeProviders = vi.fn<typeof materializeSmppProviders>(() => {
      api.installProvider();
      return Promise.resolve(api.materializationReport() as never);
    });
    const dependencies = {
      fetch: api.fetch,
      bootstrapSource,
      materializeProviders,
      now: () => '2026-08-21T00:00:00.000Z',
    };

    const first = await bootstrapUgvAgentProfileAuthority(configuration(), dependencies);
    const second = await bootstrapUgvAgentProfileAuthority(configuration(), dependencies);
    const verified = await verifyUgvAgentProfileAuthority(configuration(), dependencies);
    const readinessOne = await verifyUgvAgentProfileAuthorityReadiness(
      configuration(),
      dependencies,
    );
    const readinessTwo = await verifyUgvAgentProfileAuthorityReadiness(
      configuration(),
      dependencies,
    );

    expect(first).toMatchObject({
      status: 'passed',
      provider: { navigateReplay: 'simulation_only', toolCount: 10 },
      skill: { skillId: 'embodied.move_to', version: 1, exactVersionCount: 1 },
      capability: { implementationCount: 1, constraintCount: 7 },
      exposure: { agentSkillId: 'embodied.move_to', exactExposureCount: 1 },
      profilePublicCard: {
        authority: 'enabled_skill_version',
        managedCardUsed: false,
        sourceSkillRef: 'embodied.move_to:1',
      },
      driverActivity: {
        navigationDispatchCount: 0,
        modelInvocationCount: 0,
        providerToolCallCount: 0,
      },
    });
    expect(api.exposureRequesterPolicy()).toEqual({
      allowAnonymous: true,
      allowedRequesterIds: [],
    });
    expect(second.skill.exactVersionCount).toBe(1);
    expect(verified.status).toBe('passed');
    for (const readiness of [readinessOne, readinessTwo]) {
      expect(readiness.profilePublicCardLifecycle).toMatchObject({
        authority: 'CapabilityCardPublisher',
        managedCardUsed: false,
        before: { exactSkillCount: 1, totalSkillCount: 1, capabilityCount: 2 },
        suspended: { exactSkillCount: 0, totalSkillCount: 0, capabilityCount: 0 },
        restored: { exactSkillCount: 1, totalSkillCount: 1, capabilityCount: 2 },
        semanticRestored: true,
      });
      expect(readiness.skillLifecycle.suspendedRevision).toBe(
        readiness.skillLifecycle.beforeRevision + 1,
      );
      expect(readiness.skillLifecycle.restoredRevision).toBe(
        readiness.skillLifecycle.suspendedRevision + 1,
      );
      expect(readiness.managedCardSeparation.unchangedAcrossSkillLifecycle).toBe(true);
      expect(readiness.driverActivity).toEqual({
        navigationDispatchCount: 0,
        forbiddenOperationCallCount: 0,
        fireInvocationCount: 0,
        modelInvocationCount: 0,
        providerToolCallCount: 0,
      });
    }
    expect(api.authorityCounts()).toEqual({
      skills: 1,
      skillVersions: 1,
      capabilities: 1,
      implementations: 1,
      exposures: 1,
    });
    expect(api.providerToolCallCount).toBe(0);
    const serialized = JSON.stringify([first, second, verified, readinessOne, readinessTwo]);
    for (const forbidden of [
      'unit-secret-canary-never-report',
      CONTROL,
      RUNTIME,
      'http://127.0.0.1:10999',
      'unauthenticated://none',
    ])
      expect(serialized).not.toContain(forbidden);

    await expectProjectorAcceptsBootstrapReport(first);
  }, 30_000);

  it('validates evaluated readiness against a fresh observation and projects the final observation', async () => {
    const imported = await formalPackage();
    const api = new AuthorityApis(
      imported.skillVersion as unknown as Readonly<Record<string, unknown>>,
    );
    api.readinessEvaluatedAt = '2026-08-21T00:00:01.000Z';
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>(() => {
      api.installSource();
      return Promise.resolve({ status: 'passed', sourceAction: 'created' } as never);
    });
    const materializeProviders = vi.fn<typeof materializeSmppProviders>(() => {
      api.installProvider();
      return Promise.resolve(api.materializationReport() as never);
    });
    const timestamps = [
      '2026-08-21T00:00:00.000Z',
      '2026-08-21T00:00:02.000Z',
      '2026-08-21T00:00:03.000Z',
    ] as const;
    let timestampIndex = 0;
    const now = vi.fn(() => {
      const value = timestamps[timestampIndex];
      timestampIndex += 1;
      if (value === undefined) throw new Error('UNIT_CLOCK_EXHAUSTED');
      return value;
    });

    const result = await bootstrapUgvAgentProfileAuthority(configuration(), {
      fetch: api.fetch,
      bootstrapSource,
      materializeProviders,
      now,
    });

    expect(now).toHaveBeenCalledTimes(3);
    expect(result.observedAt).toBe('2026-08-21T00:00:03.000Z');
    await expectProjectorAcceptsBootstrapReport(result);
  }, 30_000);

  it('rejects a non-navigate Tool semantics drift before verify can accept authority', async () => {
    const fixture = await authorityFixture();
    fixture.api.driftToolReplay('vehicle_fire_weapon', 'allowed');

    await expect(
      verifyUgvAgentProfileAuthority(configuration(), fixture.dependencies),
    ).rejects.toMatchObject({
      code: 'UAP_RUNTIME_TOOL_SEMANTICS_DRIFT',
    });
  }, 30_000);

  it.each([
    ['vehicle_fire_weapon', 'supportsInputRequired', false],
    ['vehicle_emergency_stop', 'supportsCancellation', true],
    ['vehicle_navigate', 'supportsPauseResume', false],
  ] as const)(
    'rejects Runtime %s task profile drift in %s without another mutation',
    async (toolName, field, value) => {
      const fixture = await authorityFixture();
      const postsBefore = fixture.api.fetch.mock.calls.filter(
        ([, init]) => init?.method === 'POST',
      ).length;
      fixture.api.driftToolTaskExecution(toolName, field, value);

      await expect(
        verifyUgvAgentProfileAuthority(configuration(), fixture.dependencies),
      ).rejects.toMatchObject({ code: 'UAP_RUNTIME_TOOL_SEMANTICS_DRIFT' });
      expect(
        fixture.api.fetch.mock.calls.filter(([, init]) => init?.method === 'POST').length,
      ).toBe(postsBefore);
    },
    30_000,
  );

  it('accepts the formal prefixed readiness ETag and rejects bare or drifted authority', async () => {
    const formal = await authorityFixture();
    await expect(
      verifyUgvAgentProfileAuthority(configuration(), formal.dependencies),
    ).resolves.toMatchObject({
      readiness: { status: 'available', snapshotHash: /^[a-f0-9]{64}$/u },
    });

    formal.api.bareReadinessEtag = true;
    await expect(
      verifyUgvAgentProfileAuthority(configuration(), formal.dependencies),
    ).rejects.toMatchObject({
      code: 'UAP_ETAG_INVALID',
    });

    const policyDrift = await authorityFixture();
    policyDrift.api.tamperReadiness({ policyHash: `sha256:${'f'.repeat(64)}` }, false);
    await expect(
      verifyUgvAgentProfileAuthority(configuration(), policyDrift.dependencies),
    ).rejects.toMatchObject({
      code: 'UAP_CAPABILITY_READINESS_HASH_INVALID',
    });

    const reasonDrift = await authorityFixture();
    reasonDrift.api.tamperReadiness(
      { reasons: [{ code: 'UNIT_BLOCKING_DRIFT', severity: 'blocking' }] },
      true,
    );
    await expect(
      verifyUgvAgentProfileAuthority(configuration(), reasonDrift.dependencies),
    ).rejects.toMatchObject({
      code: 'UAP_CAPABILITY_READINESS_INVALID',
    });
  }, 30_000);

  it('recovers stability-window unavailable readiness and a stale same-Exposure managed Card', async () => {
    const fixture = await authorityFixture();
    const sourceInstallsBefore = fixture.api.sourceInstalls;
    const materializationsBefore = fixture.dependencies.materializeProviders.mock.calls.length;
    const managedCardRevisionBefore = fixture.api.managedCardRevision();
    fixture.api.tamperReadiness(
      {
        status: 'unavailable',
        evaluatedAt: '2026-08-20T23:58:00.000Z',
        validUntil: '2026-08-20T23:59:00.000Z',
        reasons: [{ code: 'READINESS_STABILITY_WINDOW', severity: 'info' }],
        availableImplementations: ['capability-binding-embodied.move-v2'],
        unavailableImplementations: [],
      },
      true,
    );
    fixture.api.tamperManagedCard({ capabilityCatalogHash: 'f'.repeat(64) });

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), fixture.dependencies),
    ).resolves.toMatchObject({
      status: 'passed',
      readiness: { status: 'available' },
    });
    expect(fixture.api.sourceInstalls).toBe(sourceInstallsBefore + 1);
    expect(fixture.dependencies.materializeProviders).toHaveBeenCalledTimes(
      materializationsBefore + 1,
    );
    expect(fixture.api.managedCardRevision()).toBe(managedCardRevisionBefore + 1);
  }, 30_000);

  it('reevaluates one bounded stability-window snapshot and accepts the fresh second result', async () => {
    const fixture = await authorityFixture();
    const evaluationsBefore = fixture.api.readinessEvaluationCount;
    fixture.api.readinessStabilityResponsesRemaining = 1;
    const delay = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        ...fixture.dependencies,
        delay,
      }),
    ).resolves.toMatchObject({
      status: 'passed',
      readiness: { status: 'available' },
    });
    expect(fixture.api.readinessEvaluationCount).toBe(evaluationsBefore + 2);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(10_250);
  }, 30_000);

  it('fails after the second exact stability-window evaluation', async () => {
    const fixture = await authorityFixture();
    const evaluationsBefore = fixture.api.readinessEvaluationCount;
    fixture.api.readinessStabilityResponsesRemaining = 2;
    const delay = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());

    await expect(
      bootstrapUgvAgentProfileAuthority(configuration(), {
        ...fixture.dependencies,
        delay,
      }),
    ).rejects.toMatchObject({ code: 'UAP_CAPABILITY_READINESS_STABILITY_TIMEOUT' });
    expect(fixture.api.readinessEvaluationCount).toBe(evaluationsBefore + 2);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(10_250);
  }, 30_000);

  it.each([
    {
      constraint: 'a blocking stability reason',
      code: 'READINESS_STABILITY_WINDOW',
      severity: 'blocking' as const,
    },
    {
      constraint: 'a missing stability-window reason',
      code: 'UNIT_PROVIDER_PENDING',
      severity: 'info' as const,
    },
  ])(
    'does not retry unavailable readiness with $constraint',
    async ({ code, severity }) => {
      const fixture = await authorityFixture();
      const evaluationsBefore = fixture.api.readinessEvaluationCount;
      fixture.api.readinessStabilityResponsesRemaining = 1;
      fixture.api.readinessStabilityReasonCode = code;
      fixture.api.readinessStabilityReasonSeverity = severity;
      const delay = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          ...fixture.dependencies,
          delay,
        }),
      ).rejects.toMatchObject({ code: 'UAP_CAPABILITY_READINESS_INVALID' });
      expect(fixture.api.readinessEvaluationCount).toBe(evaluationsBefore + 1);
      expect(delay).not.toHaveBeenCalled();
    },
    30_000,
  );

  it.each([
    {
      drift: 'a wrong capability identity',
      patch: { capabilityId: 'embodied.rogue' },
    },
    {
      drift: 'a future evaluation timestamp',
      patch: {
        evaluatedAt: '2026-08-21T00:00:01.000Z',
        validUntil: '2026-08-21T01:00:00.000Z',
      },
    },
  ])(
    'does not retry a stability snapshot with $drift',
    async ({ patch }) => {
      const fixture = await authorityFixture();
      const evaluationsBefore = fixture.api.readinessEvaluationCount;
      fixture.api.readinessStabilityResponsesRemaining = 1;
      fixture.api.readinessEvaluationPatch = patch;
      const delay = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve());

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), {
          ...fixture.dependencies,
          delay,
        }),
      ).rejects.toMatchObject({ code: 'UAP_CAPABILITY_READINESS_INVALID' });
      expect(fixture.api.readinessEvaluationCount).toBe(evaluationsBefore + 1);
      expect(delay).not.toHaveBeenCalled();
    },
    30_000,
  );

  it.each([
    {
      drift: 'a rogue unavailable implementation',
      patch: {
        status: 'unavailable',
        availableImplementations: [],
        unavailableImplementations: ['capability-binding-rogue'],
      },
    },
    {
      drift: 'a duplicated implementation partition',
      patch: {
        status: 'unavailable',
        availableImplementations: ['capability-binding-embodied.move-v2'],
        unavailableImplementations: ['capability-binding-embodied.move-v2'],
      },
    },
    {
      drift: 'a future evaluation timestamp',
      patch: {
        evaluatedAt: '2026-08-21T00:00:01.000Z',
        validUntil: '2026-08-21T01:00:00.000Z',
      },
    },
    {
      drift: 'a non-positive validity interval',
      patch: {
        evaluatedAt: '2026-08-20T23:59:00.000Z',
        validUntil: '2026-08-20T23:59:00.000Z',
      },
    },
    {
      drift: 'a suspended kill-switch snapshot',
      patch: {
        status: 'suspended',
        reasons: [{ code: 'UNIT_KILL_SWITCH', severity: 'blocking' }],
        availableImplementations: [],
        unavailableImplementations: ['capability-binding-embodied.move-v2'],
      },
    },
  ])(
    'rejects $drift before delegated recovery mutation',
    async ({ patch }) => {
      const fixture = await authorityFixture();
      const sourceInstallsBefore = fixture.api.sourceInstalls;
      const materializationsBefore = fixture.dependencies.materializeProviders.mock.calls.length;
      fixture.api.tamperReadiness(patch, true);

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), fixture.dependencies),
      ).rejects.toMatchObject({ code: 'UAP_CAPABILITY_READINESS_INVALID' });
      expect(fixture.api.sourceInstalls).toBe(sourceInstallsBefore);
      expect(fixture.dependencies.materializeProviders).toHaveBeenCalledTimes(
        materializationsBefore,
      );
    },
    30_000,
  );

  it.each([
    {
      drift: 'a rogue managed Card Exposure identity',
      arrange: (api: AuthorityApis) => {
        api.tamperManagedCard({ exposureRefs: ['a2a.rogue:1'] });
      },
    },
    {
      drift: 'managed Card list/direct drift',
      arrange: (api: AuthorityApis) => {
        api.driftManagedCardDirect({ contentHash: 'f'.repeat(64) });
      },
    },
    {
      drift: 'a future managed Card timestamp',
      arrange: (api: AuthorityApis) => {
        api.tamperManagedCard({ generatedAt: '2026-08-21T00:00:01.000Z' });
      },
    },
  ])(
    'rejects $drift before Source or Provider recovery',
    async ({ arrange }) => {
      const fixture = await authorityFixture();
      const sourceInstallsBefore = fixture.api.sourceInstalls;
      const materializationsBefore = fixture.dependencies.materializeProviders.mock.calls.length;
      arrange(fixture.api);

      await expect(
        bootstrapUgvAgentProfileAuthority(configuration(), fixture.dependencies),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^UAP_MANAGED_CARD_(?:AUTHORITY_INVALID|AUTHORITY_DRIFT)$/u),
      });
      expect(fixture.api.sourceInstalls).toBe(sourceInstallsBefore);
      expect(fixture.dependencies.materializeProviders).toHaveBeenCalledTimes(
        materializationsBefore,
      );
    },
    30_000,
  );

  it('recovers exact published v1 after a committed publish response is lost', async () => {
    const fixture = await authorityFixture();
    fixture.api.loseNextPublishResponse = true;

    await expect(
      verifyUgvAgentProfileAuthorityReadiness(configuration(), fixture.dependencies),
    ).rejects.toMatchObject({
      code: 'UNIT_LOST_PUBLISH_RESPONSE',
    });
    expect(fixture.api.skillGovernance()).toEqual({
      status: 'published',
      versionCount: 1,
    });

    await expect(
      verifyUgvAgentProfileAuthorityReadiness(configuration(), fixture.dependencies),
    ).resolves.toMatchObject({
      skillLifecycle: { finalGovernedStatus: 'published', exactVersionCount: 1 },
    });
    expect(fixture.api.skillGovernance()).toEqual({
      status: 'published',
      versionCount: 1,
    });
  }, 30_000);

  it('restores exact published v1 before surfacing a lifecycle termination signal', async () => {
    const fixture = await authorityFixture();
    const signals = new UnitLifecycleSignals();
    fixture.api.onSuspendedCardRead = () => {
      signals.emit('SIGTERM');
    };

    await expect(
      verifyUgvAgentProfileAuthorityReadiness(configuration(), {
        ...fixture.dependencies,
        lifecycleSignals: signals,
      }),
    ).rejects.toMatchObject({ code: 'UAP_READINESS_INTERRUPTED', exitCode: 143 });
    expect(fixture.api.skillGovernance()).toEqual({
      status: 'published',
      versionCount: 1,
    });
    await expect(
      verifyUgvAgentProfileAuthority(configuration(), fixture.dependencies),
    ).resolves.toMatchObject({ status: 'passed', skill: { exactVersionCount: 1 } });
  }, 30_000);

  it('rejects untrusted B01 origins before a bearer token can be sent', async () => {
    const request = vi.fn<typeof fetch>();
    const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
    const materializeProviders = vi.fn<typeof materializeSmppProviders>();

    await expect(
      bootstrapUgvAgentProfileAuthority(
        { ...configuration(), nodeControlBaseUrl: 'https://rogue.invalid' },
        { fetch: request, bootstrapSource, materializeProviders },
      ),
    ).rejects.toMatchObject({
      code: 'UAP_CONFIGURATION_INVALID',
    });
    expect(request).not.toHaveBeenCalled();
    expect(bootstrapSource).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
  });

  it.each(['source', 'source-endpoint', 'server', 'binding', 'display'] as const)(
    'rejects an alternate fixed B01 %s identity before any request',
    async (field) => {
      const request = vi.fn<typeof fetch>();
      const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>();
      const materializeProviders = vi.fn<typeof materializeSmppProviders>();
      const exact = configuration();
      const alternate: UgvAgentProfileAuthorityBootstrapConfiguration =
        field === 'source'
          ? { ...exact, source: { ...exact.source, smppSourceId: 'alternate-source' } }
          : field === 'source-endpoint'
            ? {
                ...exact,
                source: {
                  ...exact.source,
                  registryEndpoint:
                    'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/ugv-smpp/latest',
                },
              }
            : field === 'server'
              ? { ...exact, localServerId: 'alternate-server' }
              : field === 'binding'
                ? { ...exact, providerBindingId: 'alternate-binding' }
                : { ...exact, providerDisplayName: 'Alternate display name' };

      await expect(
        bootstrapUgvAgentProfileAuthority(alternate, {
          fetch: request,
          bootstrapSource,
          materializeProviders,
        }),
      ).rejects.toMatchObject({ code: 'UAP_CONFIGURATION_INVALID' });
      expect(request).not.toHaveBeenCalled();
      expect(bootstrapSource).not.toHaveBeenCalled();
      expect(materializeProviders).not.toHaveBeenCalled();
    },
  );
});

function configuration(): UgvAgentProfileAuthorityBootstrapConfiguration {
  return {
    mode: 'bootstrap',
    nodeControlBaseUrl: CONTROL,
    nodeControlBearerToken: 'unit-secret-canary-never-report',
    runtimeManagementBaseUrl: RUNTIME,
    profileA2aBaseUrl: 'http://127.0.0.1:10999',
    skillPackageRoot: resolve('skills/embodied.move_to'),
    runId: 'uap-p3-b01-unit-run',
    simulationRunId: 'uap-p3-b02-unit-simulation',
    source: {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      smppEnvironment: 'simulation',
      registryEndpoint:
        'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'manual',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'deny_when_unavailable',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
    },
    localServerId: 'ugv-smpp-uap-p3-b01',
    providerBindingId: 'ugv-smpp-uap-p3-b01-binding',
    providerDisplayName: 'UGV Agent Profile external simulation',
    runtimeCredentialRef: 'unauthenticated://none',
  };
}

function inventoryFetch(
  values: Readonly<{
    sources?: readonly unknown[];
    candidates?: readonly unknown[];
    bindings?: readonly unknown[];
    servers?: readonly unknown[];
    controlSkills?: readonly unknown[];
    runtimeSkills?: readonly unknown[];
    capabilities?: readonly unknown[];
    exposures?: readonly unknown[];
    managedCards?: readonly unknown[];
    nativeSnapshot?: Readonly<Record<string, unknown>>;
  }> = {},
) {
  return vi.fn<typeof fetch>((input) => {
    const target =
      input instanceof Request ? input.url : typeof input === 'string' ? input : input.toString();
    const url = new URL(target);
    if (
      url.origin === 'http://127.0.0.1:18092' &&
      url.pathname === '/api/v1/registry/simulation/latest'
    ) {
      const snapshot = values.nativeSnapshot ?? nativeRegistrySnapshot();
      return Promise.resolve(
        json(snapshot, 200, {
          etag: `"${String(snapshot['checksum'])}"`,
          'cache-control': 'private, no-cache',
        }),
      );
    }
    const items =
      url.origin === CONTROL
        ? url.pathname === '/api/v1/smpp-sources'
          ? (values.sources ?? [])
          : url.pathname === '/api/v1/mcp-provider-candidates'
            ? (values.candidates ?? [])
            : url.pathname === '/api/v1/mcp-provider-bindings'
              ? (values.bindings ?? [])
              : url.pathname === '/api/v1/skills'
                ? (values.controlSkills ?? [])
                : url.pathname === '/api/v1/node-capabilities'
                  ? (values.capabilities ?? [])
                  : url.pathname === '/api/v1/a2a-exposures'
                    ? (values.exposures ?? [])
                    : url.pathname === '/api/v1/a2a-agent-card-revisions'
                      ? (values.managedCards ?? [])
                      : undefined
        : url.origin === RUNTIME && url.pathname === '/api/v1/mcp/servers'
          ? (values.servers ?? [])
          : url.origin === RUNTIME && url.pathname === '/api/v1/skills'
            ? (values.runtimeSkills ?? [])
            : undefined;
    if (items === undefined)
      return Promise.resolve(json({ code: 'UNIT_UNEXPECTED_PATH', path: url.pathname }, 500));
    return Promise.resolve(
      json({ items, totalEstimate: items.length, asOf: '2026-08-21T00:00:00.000Z' }),
    );
  });
}

function json(
  value: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function formalPackage() {
  const packageSchema = JSON.parse(
    await readFile(resolve('schemas/skill-package.schema.json'), 'utf8'),
  ) as unknown;
  return new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: new AjvJsonSchemaValidator(),
      packageSchema,
    }),
    clock: { now: () => '2026-08-21T00:00:00.000Z' },
  }).import(resolve('skills/embodied.move_to'));
}

async function expectProjectorAcceptsBootstrapReport(
  report: UgvAgentProfileAuthorityBootstrapReport,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'uap-authority-driver-projector-'));
  try {
    const input = join(root, 'bootstrap-private.json');
    const output = join(root, 'reports/ugv-agent-profile-simulation/bootstrap.redacted.json');
    await writeFile(input, `${JSON.stringify(report)}\n`, { encoding: 'utf8', mode: 0o600 });
    const projector = (await import(
      pathToFileURL(resolve('scripts/ugv-agent-profile-simulation/project-authority-report.mjs'))
        .href
    )) as AuthorityProjectorModule;
    await expect(
      projector.projectAuthorityReport('bootstrap', input, output, {
        repositoryRoot: root,
        stateRoot: join(root, 'state'),
      }),
    ).resolves.toMatchObject({
      authorityMode: 'bootstrap',
      profilePublicCard: {
        authority: 'enabled_skill_version',
        managedCardUsed: false,
        sourceSkillRef: 'embodied.move_to:1',
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function authorityFixture(
  options: Readonly<{
    publishedAt?: string;
    createdAt?: string;
    reverseOutputBranches?: boolean;
  }> = {},
) {
  const imported = await formalPackage();
  const api = new AuthorityApis(
    imported.skillVersion as unknown as Readonly<Record<string, unknown>>,
    options.reverseOutputBranches,
  );
  api.nativePublishedAt = options.publishedAt ?? '2026-08-20T23:59:59.215Z';
  api.nativeCreatedAt = options.createdAt ?? '2026-08-20T23:59:59.225Z';
  const bootstrapSource = vi.fn<typeof bootstrapUgvSmppSource>(() => {
    api.installSource();
    return Promise.resolve({
      status: 'passed',
      sourceAction: api.sourceInstalls === 1 ? 'created' : 'reused',
    } as never);
  });
  const materializeProviders = vi.fn<typeof materializeSmppProviders>(() => {
    api.installProvider();
    return Promise.resolve(api.materializationReport() as never);
  });
  const dependencies = {
    fetch: api.fetch,
    bootstrapSource,
    materializeProviders,
    now: () => '2026-08-21T00:00:00.000Z',
  };
  await bootstrapUgvAgentProfileAuthority(configuration(), dependencies);
  return { api, dependencies };
}

class AuthorityApis {
  readonly fetch = vi.fn<typeof fetch>((input, init) => this.request(input, init));
  readonly #skill: Readonly<Record<string, unknown>>;
  readonly #operations: Readonly<Record<string, unknown>>[] = [];
  readonly #nativeTools: readonly Readonly<Record<string, unknown>>[];
  readonly #reverseOutputBranches: boolean;
  #source: Readonly<Record<string, unknown>> | undefined;
  #candidate: Readonly<Record<string, unknown>> | undefined;
  #binding: Readonly<Record<string, unknown>> | undefined;
  #server: Readonly<Record<string, unknown>> | undefined;
  #tools: readonly Readonly<Record<string, unknown>>[] = [];
  #controlSkill: Readonly<Record<string, unknown>> | undefined;
  #governanceStatus: 'validated' | 'published' | 'suspended' = 'validated';
  #governanceRevision = 0;
  #importOperation: Readonly<Record<string, unknown>> | undefined;
  #capability: Readonly<Record<string, unknown>> | undefined;
  #implementation: Readonly<Record<string, unknown>> | undefined;
  #readiness: Readonly<Record<string, unknown>> | undefined;
  #readinessHash: string | undefined;
  #exposure: Readonly<Record<string, unknown>> | undefined;
  #managedCard: Readonly<Record<string, unknown>> | undefined;
  #directManagedCard: Readonly<Record<string, unknown>> | undefined;
  #profileCardGeneration = 0;
  bareReadinessEtag = false;
  nativePublishedAt = '2026-08-20T23:59:59.215Z';
  nativeCreatedAt = '2026-08-20T23:59:59.225Z';
  readinessEvaluatedAt = '2026-08-21T00:00:00.000Z';
  readinessEvaluationCount = 0;
  readinessStabilityResponsesRemaining = 0;
  readinessStabilityReasonCode = 'READINESS_STABILITY_WINDOW';
  readinessStabilityReasonSeverity: 'info' | 'blocking' = 'info';
  readinessEvaluationPatch: Readonly<Record<string, unknown>> = {};
  loseNextPublishResponse = false;
  onSuspendedCardRead: (() => void) | undefined;
  sourceInstalls = 0;
  providerToolCallCount = 0;

  constructor(skill: Readonly<Record<string, unknown>>, reverseOutputBranches = false) {
    this.#skill = skill;
    this.#reverseOutputBranches = reverseOutputBranches;
    this.#nativeTools = toolNames().map((toolName) => nativeTool(toolName, reverseOutputBranches));
  }

  installSource(): void {
    this.sourceInstalls += 1;
    this.#source = {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      registryEndpoint:
        'http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest',
      credentialRef: 'unauthenticated://none',
      environment: 'simulation',
      syncMode: 'manual',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'deny_when_unavailable',
      status: 'active',
      activeSnapshotRevision: 9,
      activeSnapshotChecksum: 'a'.repeat(64),
      activeSnapshotValidUntil: '2026-08-21T01:00:00.000Z',
      revision: 1,
    };
    this.#candidate = {
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
      serverEndpoint: 'http://127.0.0.1:19131/mcp',
      labels: { environment: 'simulation', protocolMode: 'frozen_v1' },
      registryRevision: 9,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: '9',
      registryValidUntil: '2026-08-21T01:00:00.000Z',
      nativeRegistryRevision: 9,
      nativeRegistryChecksum: String(nativeRegistrySnapshot(this.#nativeTools)['checksum']),
      registryProjectionContract: 'sdar-registry-v1',
    };
  }

  installProvider(): void {
    this.#tools = toolNames().map((toolName) => runtimeTool(toolName, this.#reverseOutputBranches));
    this.#binding = {
      bindingId: 'ugv-smpp-uap-p3-b01-binding',
      localServerId: 'ugv-smpp-uap-p3-b01',
      originType: 'smpp_registry',
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'uap-p3-b01-runtime-1',
      registryRevision: 9,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: '1.0.0:1',
      catalogChecksum: 'c'.repeat(64),
      endpointRef: 'http://127.0.0.1:19131/mcp',
      status: 'active',
      availabilityStatus: 'available',
      revision: 1,
      availabilityValidUntil: '2026-08-21T01:00:00.000Z',
      catalogObservedAt: '2026-08-21T00:00:00.000Z',
      operationCount: toolNames().length,
    };
    this.#server = {
      serverId: 'ugv-smpp-uap-p3-b01',
      endpoint: 'http://127.0.0.1:19131/mcp',
      protocolMode: 'frozen_v1',
      toolRevision: 1,
      currentDiscovery: {
        validUntil: '2026-08-21T01:00:00.000Z',
        toolRevision: 1,
        serverInfo: { name: 'UGV Agent Profile', version: '1.0.0' },
      },
    };
  }

  materializationReport(): Readonly<Record<string, unknown>> {
    return {
      schemaVersion: 'sdar.smpp-provider-materialization/v1',
      status: 'passed',
      observedAt: '2026-08-21T00:00:00.000Z',
      smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
      providers: [
        {
          providerKey: 'ugv-agent-profile',
          bindingId: 'ugv-smpp-uap-p3-b01-binding',
          action: this.sourceInstalls === 1 ? 'created' : 'reconciled',
          runtimeAction: this.sourceInstalls === 1 ? 'registered' : 'reused',
          externalProviderId: 'isr.vehicle.ugv.ugv1',
          externalServerId: 'uap-p3-b01-runtime-1',
          bindingRevision: 1,
          catalogRevision: '1.0.0:1',
          catalogChecksum: 'c'.repeat(64),
          runtimeToolRevision: 1,
          tools: toolNames().map((toolName) => ({ toolName })),
        },
      ],
    };
  }

  authorityCounts() {
    return {
      skills: this.#controlSkill === undefined ? 0 : 1,
      skillVersions: this.#controlSkill === undefined ? 0 : 1,
      capabilities: this.#capability === undefined ? 0 : 1,
      implementations: this.#implementation === undefined ? 0 : 1,
      exposures: this.#exposure === undefined ? 0 : 1,
    };
  }

  exposureRequesterPolicy(): unknown {
    return requiredRecord(required(this.#exposure)['requesterPolicy']);
  }

  driftToolReplay(toolName: string, replay: string): void {
    this.#tools = this.#tools.map((tool) =>
      tool['toolName'] === toolName
        ? {
            ...tool,
            executionSemantics: {
              ...requiredRecord(tool['executionSemantics']),
              replay,
            },
          }
        : tool,
    );
  }

  driftToolTaskExecution(toolName: string, field: string, value: unknown): void {
    this.#tools = this.#tools.map((tool) =>
      tool['toolName'] === toolName
        ? {
            ...tool,
            taskExecutionProfile: {
              ...requiredRecord(tool['taskExecutionProfile']),
              [field]: value,
            },
          }
        : tool,
    );
  }

  tamperReadiness(patch: Readonly<Record<string, unknown>>, recomputeSnapshotHash: boolean): void {
    this.#readiness = { ...required(this.#readiness), ...patch };
    if (recomputeSnapshotHash)
      this.#readinessHash = `sha256:${sha(JSON.stringify(this.#readiness))}`;
  }

  tamperManagedCard(patch: Readonly<Record<string, unknown>>): void {
    this.#managedCard = { ...required(this.#managedCard), ...patch };
    this.#directManagedCard = undefined;
  }

  driftManagedCardDirect(patch: Readonly<Record<string, unknown>>): void {
    this.#directManagedCard = { ...required(this.#managedCard), ...patch };
  }

  managedCardRevision(): number {
    return Number(required(this.#managedCard)['revision']);
  }

  skillGovernance(): Readonly<{ status: string; versionCount: number }> {
    return {
      status: this.#governanceStatus,
      versionCount: this.#controlSkill === undefined ? 0 : 1,
    };
  }

  private request(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const target =
      input instanceof Request ? input.url : typeof input === 'string' ? input : input.toString();
    const url = new URL(target);
    const method = init?.method ?? 'GET';
    if (
      url.origin === 'http://127.0.0.1:18092' &&
      url.pathname === '/api/v1/registry/simulation/latest'
    ) {
      const authority = nativeRegistrySnapshot(this.#nativeTools);
      const snapshot = {
        ...authority,
        publishedAt: this.nativePublishedAt,
        createdAt: this.nativeCreatedAt,
      };
      return Promise.resolve(
        json(snapshot, 200, {
          etag: `"${String(authority['checksum'])}"`,
          'cache-control': 'private, no-cache',
        }),
      );
    }
    if (url.origin === CONTROL) return Promise.resolve(this.control(url, method, init));
    if (url.origin === RUNTIME) return Promise.resolve(this.runtime(url, method));
    if (url.origin === 'http://127.0.0.1:10999') return Promise.resolve(this.a2a(url, method));
    return Promise.resolve(json({ code: 'UNIT_UNEXPECTED_ORIGIN' }, 500));
  }

  private control(url: URL, method: string, init: RequestInit | undefined): Response {
    const path = url.pathname;
    if (method === 'GET' && path === '/api/v1/smpp-sources') return page(this.#source);
    if (method === 'GET' && path === '/api/v1/mcp-provider-candidates')
      return page(this.#candidate);
    if (method === 'GET' && path === '/api/v1/mcp-provider-bindings')
      return page(bindingInventory(this.#binding));
    if (method === 'GET' && path === '/api/v1/mcp-provider-bindings/ugv-smpp-uap-p3-b01-binding')
      return optionalJson(this.#binding);
    if (method === 'GET' && path === '/api/v1/skills') return page(this.controlSkill());
    if (method === 'GET' && path === '/api/v1/skills/embodied.move_to/versions')
      return page(this.controlSkill());
    if (method === 'GET' && path === '/api/v1/skills/embodied.move_to/versions/1')
      return optionalJson(this.controlSkill());
    if (method === 'GET' && path === '/api/v1/management-operations')
      return pageItems(this.#operations);
    if (method === 'POST' && path === '/api/v1/skills/import') return this.importSkill();
    if (
      method === 'POST' &&
      (path === '/api/v1/skills/embodied.move_to/versions/1/publish' ||
        path === '/api/v1/skills/embodied.move_to/versions/1/suspend')
    )
      return this.transitionSkill(path.endsWith('/publish') ? 'publish' : 'suspend', init);
    if (method === 'GET' && path === '/api/v1/node-capabilities') return page(this.#capability);
    if (method === 'POST' && path === '/api/v1/node-capabilities') {
      this.#capability = body(init);
      return json(this.#capability, 201);
    }
    if (method === 'GET' && path === '/api/v1/node-capabilities/embodied.move/versions/2')
      return optionalJson(this.#capability);
    if (
      method === 'GET' &&
      path === '/api/v1/node-capabilities/embodied.move/versions/2/implementations'
    )
      return page(this.#implementation);
    if (
      method === 'POST' &&
      path === '/api/v1/node-capabilities/embodied.move/versions/2/implementations'
    ) {
      this.#implementation = body(init);
      return json(this.#implementation, 201);
    }
    if (method === 'POST' && path.endsWith('/embodied.move/versions/2/validate')) {
      this.#capability = { ...required(this.#capability), status: 'validating' };
      return json(this.#capability);
    }
    if (method === 'POST' && path.endsWith('/embodied.move/versions/2/publish')) {
      this.#capability = { ...required(this.#capability), status: 'published' };
      return json(operation('capability.publish', this.#capability), 202);
    }
    if (method === 'GET' && path === '/api/v1/capability-readiness/embodied.move/2')
      return this.#readiness === undefined
        ? json({ code: 'CAPABILITY_READINESS_NOT_FOUND' }, 404)
        : json(this.#readiness, 200, {
            etag: `"${
              this.bareReadinessEtag
                ? String(this.#readinessHash).replace(/^sha256:/u, '')
                : String(this.#readinessHash)
            }"`,
          });
    if (method === 'POST' && path.endsWith('/capability-readiness/embodied.move/2/evaluate'))
      return this.evaluateReadiness();
    if (method === 'GET' && path === '/api/v1/a2a-exposures') return page(this.#exposure);
    if (method === 'POST' && path === '/api/v1/a2a-exposures') {
      this.#exposure = body(init);
      return json(this.#exposure, 201);
    }
    if (method === 'GET' && path === '/api/v1/a2a-exposures/a2a.embodied.move/versions/2')
      return optionalJson(this.#exposure);
    if (method === 'POST' && path.endsWith('/a2a.embodied.move/versions/2/publish')) {
      this.#exposure = { ...required(this.#exposure), status: 'published' };
      return json(operation('a2a-exposure.publish', this.#exposure), 202);
    }
    if (method === 'GET' && path === '/api/v1/a2a-agent-card-revisions')
      return page(this.#managedCard);
    if (
      method === 'GET' &&
      path === `/api/v1/a2a-agent-card-revisions/${String(this.#managedCard?.['revision'])}`
    )
      return optionalJson(this.#directManagedCard ?? this.#managedCard);
    if (method === 'POST' && path === '/api/v1/a2a-agent-card-revisions/rebuild')
      return this.rebuildManagedCard();
    return json({ code: 'UNIT_UNEXPECTED_CONTROL_PATH', path, method }, 500);
  }

  private runtime(url: URL, method: string): Response {
    const path = url.pathname;
    if (method === 'GET' && path === '/api/v1/mcp/servers') return page(this.#server);
    if (method === 'GET' && path === '/api/v1/mcp/servers/ugv-smpp-uap-p3-b01/tools')
      return pageItems(this.#tools);
    if (method === 'GET' && path === '/api/v1/skills') return page(this.runtimeSkill());
    if (method === 'GET' && path === '/api/v1/skills/embodied.move_to/versions/1')
      return optionalJson(this.runtimeSkill());
    if (method === 'GET' && path === '/api/v1/capabilities/card') {
      if (this.#governanceStatus === 'suspended' && this.onSuspendedCardRead !== undefined) {
        const stale = this.profileCards(true).management;
        const notify = this.onSuspendedCardRead;
        this.onSuspendedCardRead = undefined;
        notify();
        return json(stale);
      }
      return json(this.profileCards().management);
    }
    return json({ code: 'UNIT_UNEXPECTED_RUNTIME_PATH', path, method }, 500);
  }

  private a2a(url: URL, method: string): Response {
    if (method === 'GET' && url.pathname === '/.well-known/agent-card.json')
      return json(this.profileCards().a2a);
    return json({ code: 'UNIT_UNEXPECTED_A2A_PATH' }, 500);
  }

  private importSkill(): Response {
    if (this.#importOperation !== undefined) return json(this.#importOperation, 202);
    this.#controlSkill = this.controlSkillValue();
    this.#governanceStatus = 'validated';
    this.#governanceRevision = 0;
    this.#importOperation = this.skillOperation('skill.import');
    this.#operations.push(this.#importOperation);
    return json(this.#importOperation, 202);
  }

  private transitionSkill(action: 'publish' | 'suspend', init: RequestInit | undefined): Response {
    const input = body(init);
    if (input['expectedRevision'] !== this.#governanceRevision)
      return json({ code: 'SKILL_GOVERNANCE_REVISION_CONFLICT' }, 409);
    this.#governanceRevision += 1;
    this.#governanceStatus = action === 'publish' ? 'published' : 'suspended';
    this.#profileCardGeneration += 1;
    const current = this.skillOperation(`skill.${action}`);
    this.#operations.push(current);
    if (action === 'publish' && this.loseNextPublishResponse) {
      this.loseNextPublishResponse = false;
      return json({ code: 'UNIT_LOST_PUBLISH_RESPONSE' }, 503);
    }
    return json(current, 202);
  }

  private skillOperation(operationType: string): Readonly<Record<string, unknown>> {
    const result = {
      skillId: 'embodied.move_to',
      version: 1,
      status: this.#governanceStatus,
      governanceRevision: this.#governanceRevision,
    };
    return {
      operationId: `${operationType}-${String(this.#governanceRevision)}`,
      operationType,
      target: { type: 'skill_version', id: 'embodied.move_to', version: '1' },
      status: 'succeeded',
      completedAt: `2026-08-21T00:00:${String(this.#governanceRevision).padStart(2, '0')}.000Z`,
      result: {
        runtimeOperation: {
          operationType,
          target: { type: 'skill_version', id: 'embodied.move_to', version: 1 },
          status: 'succeeded',
          result,
        },
      },
    };
  }

  private controlSkill(): Readonly<Record<string, unknown>> | undefined {
    return this.#controlSkill === undefined
      ? undefined
      : { ...this.#controlSkill, status: this.#governanceStatus };
  }

  private controlSkillValue(): Readonly<Record<string, unknown>> {
    return {
      skillId: this.#skill['skillId'],
      version: String(this.#skill['version']),
      status: this.#governanceStatus,
      inputSchema: this.#skill['inputSchema'],
      outputSchema: this.#skill['outputSchema'],
      usageSpecification: this.#skill['usageSpecification'],
    };
  }

  private runtimeSkill(): Readonly<Record<string, unknown>> | undefined {
    if (this.#controlSkill === undefined) return undefined;
    return {
      ...this.#skill,
      status: this.#governanceStatus === 'published' ? 'enabled' : 'disabled',
    };
  }

  private evaluateReadiness(): Response {
    this.readinessEvaluationCount += 1;
    const stabilityWindow = this.readinessStabilityResponsesRemaining > 0;
    if (stabilityWindow) this.readinessStabilityResponsesRemaining -= 1;
    const snapshot = {
      capabilityId: 'embodied.move',
      capabilityVersion: 2,
      snapshotVersion: Number(this.#readiness?.['snapshotVersion'] ?? 0) + 1,
      status: stabilityWindow ? 'unavailable' : 'available',
      evaluatedAt: this.readinessEvaluatedAt,
      validUntil: '2026-08-21T01:00:00.000Z',
      catalogHash: `sha256:${'d'.repeat(64)}`,
      policyHash: `sha256:${'e'.repeat(64)}`,
      reasons: stabilityWindow
        ? [
            {
              code: this.readinessStabilityReasonCode,
              severity: this.readinessStabilityReasonSeverity,
            },
          ]
        : [],
      availableImplementations: ['capability-binding-embodied.move-v2'],
      unavailableImplementations: [],
      ...this.readinessEvaluationPatch,
    };
    this.#readiness = snapshot;
    this.#readinessHash = `sha256:${sha(JSON.stringify(snapshot))}`;
    return json(operation('capability-readiness.evaluate', snapshot), 202);
  }

  private rebuildManagedCard(): Response {
    const exposureHash = String(required(this.#exposure)['exposureHash']);
    const capabilityCatalogHash = sha(
      stable({
        values: [
          {
            capabilityId: 'embodied.move',
            capabilityVersion: 2,
            exposureHash,
            readinessHash: this.#readinessHash,
          },
        ],
      }).slice('{"values":'.length, -1),
    );
    this.#managedCard = {
      revision: Number(this.#managedCard?.['revision'] ?? 0) + 1,
      exposureRefs: ['a2a.embodied.move:2'],
      contentHash: sha(`managed:${capabilityCatalogHash}`),
      capabilityCatalogHash,
      status: 'active',
      generatedAt: '2026-08-21T00:00:00.000Z',
    };
    this.#directManagedCard = undefined;
    return json(operation('agent-card.rebuild', this.#managedCard), 202);
  }

  private profileCards(enabledOverride?: boolean): Readonly<{
    management: Readonly<Record<string, unknown>>;
    a2a: Readonly<Record<string, unknown>>;
  }> {
    const enabled = enabledOverride ?? this.#governanceStatus === 'published';
    const generatedAt = `2026-08-21T00:10:${String(this.#profileCardGeneration).padStart(2, '0')}.000Z`;
    const catalogHash = `sha256:${sha(enabled ? 'enabled-catalog' : 'empty-catalog')}`;
    const publicSkills = enabled
      ? [
          {
            id: 'embodied.move_to',
            name: 'Move to',
            description: 'Move the exact simulated vehicle.',
            tags: ['embodied', 'move'],
          },
        ]
      : [];
    const capabilities = enabled
      ? [
          { capabilityId: 'embodied.move', domain: 'embodied' },
          { capabilityId: 'embodied.navigation', domain: 'embodied' },
        ]
      : [];
    const profile = {
      profileVersion: '1.0',
      catalogHash,
      domains: enabled ? ['embodied'] : [],
      capabilities,
      limitations: [],
      generatedAt,
    };
    const description = 'UGV Agent Profile capabilities.';
    const management = {
      cardId: `profile-card-${String(this.#profileCardGeneration)}`,
      revision: this.#profileCardGeneration + 1,
      catalogHash,
      generationPolicyVersion: 'capability-policy-v1:ugv-agent-profile-v1',
      profileVersion: '1.0',
      status: 'active',
      agentName: 'ugv-agent-profile',
      description,
      profile,
      publicSkills,
      sourceSkillRefs: enabled ? ['embodied.move_to:1'] : [],
      generationMode: 'deterministic',
      cardContentHash: `sha256:${sha(`card:${String(this.#profileCardGeneration)}`)}`,
      generatedAt,
    };
    const a2a = {
      name: 'ugv-agent-profile',
      description,
      supportedInterfaces: [
        {
          url: 'http://127.0.0.1:10999/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ],
      version: '0.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: false,
        extensions: [
          {
            uri: 'io.sdar/capabilityProfile',
            description: 'Versioned public SDAR capability profile.',
            required: false,
            params: profile,
          },
        ],
      },
      skills: publicSkills.map((skill) => ({
        ...skill,
        examples: [],
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'application/json'],
        securityRequirements: [],
      })),
    };
    return { management, a2a };
  }
}

class UnitLifecycleSignals {
  #listener: ((signal: 'SIGINT' | 'SIGTERM') => void) | undefined;

  subscribe(listener: (signal: 'SIGINT' | 'SIGTERM') => void): () => void {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) this.#listener = undefined;
    };
  }

  emit(signal: 'SIGINT' | 'SIGTERM'): void {
    this.#listener?.(signal);
  }
}

function runtimeTool(
  toolName: string,
  reverseOutputBranches = false,
): Readonly<Record<string, unknown>> {
  const taskExecutionProfile = pinnedTaskExecutionProfile(toolName);
  const readOnly = taskExecutionProfile['taskBehavior'] === 'synchronous_only';
  const successOutputSchema =
    toolName === 'vehicle_navigate'
      ? navigateOutputSchema()
      : toolName === 'vehicle_get_state'
        ? getStateOutputSchema()
        : {
            type: 'object',
            additionalProperties: false,
            required: ['resourceId'],
            properties: { resourceId: { const: 'vehicle:ugv1' } },
          };
  return {
    serverId: 'ugv-smpp-uap-p3-b01',
    toolName,
    inputSchema:
      toolName === 'vehicle_navigate'
        ? navigateInputSchema()
        : toolName === 'vehicle_get_state'
          ? getStateInputSchema()
          : { type: 'object', properties: { resourceId: { const: 'vehicle:ugv1' } } },
    outputSchema: operationOutputSchema(successOutputSchema, reverseOutputBranches),
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: readOnly ? 'read_only' : 'side_effecting',
      execution: readOnly ? 'synchronous' : 'task_required',
      cancellation: readOnly ? 'unsupported' : 'task_cancel',
      idempotency: 'server_managed',
      replay: readOnly
        ? 'allowed'
        : toolName === 'vehicle_navigate'
          ? 'simulation_only'
          : 'forbidden',
      source: toolName === 'vehicle_navigate' ? 'admin_override' : 'mcp_declared',
    },
    taskExecutionProfile,
  };
}

function pinnedTaskExecutionProfile(toolName: string): Readonly<Record<string, unknown>> {
  const readOnly = toolName.startsWith('vehicle_get_') || toolName === 'vehicle_laser_range';
  const flags = readOnly
    ? [false, false, false, false, false, false]
    : toolName === 'vehicle_navigate' || toolName === 'vehicle_area_recon'
      ? [true, true, true, true, true, false]
      : toolName === 'vehicle_track_target' || toolName === 'vehicle_control_gimbal'
        ? [false, true, true, false, true, false]
        : toolName === 'vehicle_fire_weapon'
          ? [false, true, true, false, true, true]
          : toolName === 'vehicle_emergency_stop'
            ? [false, true, false, false, true, false]
            : undefined;
  if (flags === undefined) throw new Error('UNIT_TASK_EXECUTION_PROFILE_REQUIRED');
  const [
    supportsScheduling,
    supportsMaxElapsed,
    supportsCancellation,
    supportsPauseResume,
    supportsObservations,
    supportsInputRequired,
  ] = flags;
  return {
    profileVersion: '1.0',
    taskBehavior: readOnly ? 'synchronous_only' : 'task_required',
    availability: 'dynamic',
    supportsScheduling,
    supportsMaxElapsed,
    supportsCancellation,
    supportsPauseResume,
    supportsObservations,
    supportsInputRequired,
    idempotency: 'server_managed',
  };
}

function nativeTool(
  toolName: string,
  reverseOutputBranches = false,
): Readonly<Record<string, unknown>> {
  const runtime = runtimeTool(toolName, reverseOutputBranches);
  return {
    name: toolName,
    description: `${toolName} operation`,
    inputSchema: runtime['inputSchema'],
    outputSchema: runtime['outputSchema'],
    taskExecution: runtime['taskExecutionProfile'],
  };
}

function operationOutputSchema(
  success: Readonly<Record<string, unknown>>,
  reverseBranches = false,
): Readonly<Record<string, unknown>> {
  const business = businessResultSchema();
  return {
    type: 'object',
    anyOf: reverseBranches ? [business, success] : [success, business],
  };
}

function businessResultSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      outcome: { type: 'string', minLength: 1 },
      reasonCode: { type: 'string', minLength: 1 },
      retryable: { type: 'boolean' },
      completedAt: { type: 'string', format: 'date-time' },
    },
    required: ['outcome', 'reasonCode', 'retryable', 'completedAt'],
    additionalProperties: true,
  };
}

function nativeRegistrySnapshot(
  tools: readonly Readonly<Record<string, unknown>>[] = toolNames().map((toolName) =>
    nativeTool(toolName),
  ),
): Readonly<Record<string, unknown>> {
  const document = {
    environment: 'simulation',
    providers: [
      {
        providerId: 'isr.vehicle.ugv.ugv1',
        serverId: 'uap-p3-b01-runtime-1',
        protocolMode: 'frozen_v1',
        effectiveEndpoint: 'http://127.0.0.1:19131/mcp',
        catalogRevision: 9,
        tools,
      },
    ],
  };
  return {
    environment: 'simulation',
    revision: 9,
    checksum: sha(stable(document)),
    document,
    publishedAt: '2026-08-20T23:59:59.215Z',
    createdAt: '2026-08-20T23:59:59.225Z',
  };
}

function nativeOutputDrift(
  drift:
    | 'navigate-status'
    | 'navigate-position-authority'
    | 'navigate-position-observed-at-missing'
    | 'navigate-position-observed-at-nonstring'
    | 'get-state-freshness'
    | 'get-state-cursor'
    | 'get-state-identity',
): Readonly<Record<string, unknown>> {
  const targetName = drift.startsWith('navigate') ? 'vehicle_navigate' : 'vehicle_get_state';
  const tools = toolNames().map((toolName) => {
    const tool = nativeTool(toolName);
    if (toolName !== targetName) return tool;
    const wrapper = structuredClone(requiredRecord(tool['outputSchema']));
    const branches = wrapper['anyOf'];
    if (!Array.isArray(branches)) throw new Error('UNIT_OUTPUT_BRANCHES_REQUIRED');
    const output = requiredRecord(branches[0]) as Record<string, unknown>;
    const properties = requiredRecord(output['properties']) as Record<string, unknown>;
    if (drift === 'navigate-status') {
      const status = requiredRecord(properties['status']) as Record<string, unknown>;
      status['enum'] = ['failed', 'cancelled', 'timeout'];
    } else if (drift === 'navigate-position-authority') {
      delete properties['positionAuthority'];
    } else if (drift === 'navigate-position-observed-at-missing') {
      const positionAuthority = requiredRecord(properties['positionAuthority']);
      const positionProperties = requiredRecord(positionAuthority['properties']) as Record<
        string,
        unknown
      >;
      delete positionProperties['observedAt'];
    } else if (drift === 'navigate-position-observed-at-nonstring') {
      const positionAuthority = requiredRecord(properties['positionAuthority']);
      const positionProperties = requiredRecord(positionAuthority['properties']) as Record<
        string,
        unknown
      >;
      positionProperties['observedAt'] = { type: 'number' };
    } else if (drift === 'get-state-freshness') {
      delete properties['freshness'];
    } else if (drift === 'get-state-cursor') {
      delete properties['mqttIngressSequence'];
    } else {
      delete properties['identity'];
    }
    return { ...tool, outputSchema: wrapper };
  });
  return nativeRegistrySnapshot(tools);
}

function nativeOutputWrapperDrift(
  targetToolName: 'vehicle_navigate' | 'vehicle_get_state',
  drift:
    | 'direct-success'
    | 'extra-branch'
    | 'duplicate-success'
    | 'duplicate-business'
    | 'business-drift'
    | 'wrapper-extra-key',
): Readonly<Record<string, unknown>> {
  const tools = toolNames().map((toolName) => {
    const tool = nativeTool(toolName);
    if (toolName !== targetToolName) return tool;
    const wrapper = structuredClone(requiredRecord(tool['outputSchema'])) as Record<
      string,
      unknown
    >;
    const branches = wrapper['anyOf'];
    if (!Array.isArray(branches) || branches.length !== 2)
      throw new Error('UNIT_OUTPUT_BRANCHES_REQUIRED');
    const success = requiredRecord(branches[0]);
    const business = requiredRecord(branches[1]);
    if (drift === 'direct-success') return { ...tool, outputSchema: success };
    if (drift === 'extra-branch') wrapper['anyOf'] = [...branches, { type: 'null' }];
    else if (drift === 'duplicate-success') wrapper['anyOf'] = [success, structuredClone(success)];
    else if (drift === 'duplicate-business')
      wrapper['anyOf'] = [business, structuredClone(business)];
    else if (drift === 'wrapper-extra-key') wrapper['title'] = 'ambiguous-wrapper';
    else {
      const changedBusiness = structuredClone(business) as Record<string, unknown>;
      const properties = requiredRecord(changedBusiness['properties']) as Record<string, unknown>;
      properties['reasonCode'] = { type: 'string', minLength: 2 };
      wrapper['anyOf'] = [success, changedBusiness];
    }
    return { ...tool, outputSchema: wrapper };
  });
  return nativeRegistrySnapshot(tools);
}

function nativeTaskExecutionDrift(
  targetToolName: string,
  field: string,
  value: unknown,
  remove = false,
): Readonly<Record<string, unknown>> {
  const tools = toolNames().map((toolName) => {
    const tool = nativeTool(toolName);
    if (toolName !== targetToolName) return tool;
    const current = requiredRecord(tool['taskExecution']);
    const taskExecution = remove
      ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== field))
      : { ...current, [field]: value };
    return { ...tool, taskExecution };
  });
  return nativeRegistrySnapshot(tools);
}

function navigateInputSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'mission', 'stopOnObstacle'],
    properties: {
      resourceId: { const: 'vehicle:ugv1' },
      mission: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target'],
            properties: {
              type: { const: 'point' },
              target: {
                type: 'object',
                additionalProperties: false,
                required: ['longitude', 'latitude'],
                properties: {
                  longitude: { type: 'number', minimum: -180, maximum: 180 },
                  latitude: { type: 'number', minimum: -90, maximum: 90 },
                },
              },
            },
          },
        ],
      },
      stopOnObstacle: { type: 'boolean' },
    },
  };
}

function navigateOutputSchema(): Readonly<Record<string, unknown>> {
  return {
    title: 'VehicleTaskResultV1',
    type: 'object',
    properties: {
      resourceId: { const: 'vehicle:ugv1' },
      status: { type: 'string', enum: ['completed', 'failed', 'cancelled', 'timeout'] },
      observedAt: { type: 'string', format: 'date-time' },
      positionAuthority: {
        type: 'object',
        properties: {
          field: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          topic: { type: 'string' },
          observedAt: { type: 'string' },
          timeAuthority: { type: 'string', enum: ['source', 'ingest'] },
          cursor: { type: 'string' },
        },
        required: ['field', 'topic', 'observedAt', 'timeAuthority', 'cursor'],
        additionalProperties: false,
      },
      snapshotRevision: { type: 'string' },
      correlationStrength: {
        type: 'string',
        enum: ['STRICT_CORRELATED', 'WEAK_UNCORRELATED', 'MISMATCH', 'UNKNOWN'],
      },
      observationAuthority: { type: 'string' },
    },
    required: ['resourceId', 'status', 'observedAt'],
    additionalProperties: false,
  };
}

function getStateInputSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId'],
    properties: {
      resourceId: { const: 'vehicle:ugv1' },
      include: {
        type: 'array',
        items: { enum: ['chassis', 'health'] },
        uniqueItems: true,
      },
    },
  };
}

function getStateOutputSchema(): Readonly<Record<string, unknown>> {
  return {
    title: 'VehicleStateV1',
    type: 'object',
    properties: {
      identity: {
        type: 'object',
        properties: {
          providerId: { type: 'string', minLength: 1 },
          resourceId: { const: 'vehicle:ugv1' },
          vehicleType: { type: 'string', minLength: 1 },
          executionMode: { type: 'string', enum: ['simulation', 'live'] },
        },
        required: ['providerId', 'resourceId', 'vehicleType', 'executionMode'],
        additionalProperties: false,
      },
      connectivity: {
        type: 'object',
        properties: {
          mqttConnected: { type: 'boolean' },
          deviceMcpConnected: { type: 'boolean' },
        },
        required: ['mqttConnected', 'deviceMcpConnected'],
        additionalProperties: false,
      },
      freshness: {
        type: 'object',
        properties: { chassisObservedAt: { type: 'string', format: 'date-time' } },
        additionalProperties: false,
      },
      chassis: { type: 'object', additionalProperties: true },
      revision: { type: 'string', minLength: 1 },
      observedAt: { type: 'string', format: 'date-time' },
      mqttIngressSequence: { type: 'integer', minimum: 0 },
    },
    required: [
      'identity',
      'connectivity',
      'freshness',
      'revision',
      'observedAt',
      'mqttIngressSequence',
    ],
    additionalProperties: false,
  };
}

function toolNames(): readonly string[] {
  return [
    'vehicle_area_recon',
    'vehicle_control_gimbal',
    'vehicle_emergency_stop',
    'vehicle_fire_weapon',
    'vehicle_get_capabilities',
    'vehicle_get_payload_status',
    'vehicle_get_state',
    'vehicle_get_targets',
    'vehicle_navigate',
    'vehicle_track_target',
  ];
}

function body(init: RequestInit | undefined): Readonly<Record<string, unknown>> {
  if (typeof init?.body !== 'string') throw new Error('UNIT_BODY_REQUIRED');
  return JSON.parse(init.body) as Readonly<Record<string, unknown>>;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('UNIT_AUTHORITY_REQUIRED');
  return value;
}

function requiredRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('UNIT_RECORD_REQUIRED');
  return value as Readonly<Record<string, unknown>>;
}

function optionalJson(value: unknown): Response {
  return value === undefined ? json({ code: 'NOT_FOUND' }, 404) : json(value);
}

function page(value: unknown): Response {
  return pageItems(value === undefined ? [] : [value]);
}

function bindingInventory(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  const { availabilityValidUntil, catalogObservedAt, operationCount, ...inventory } = value;
  void availabilityValidUntil;
  void catalogObservedAt;
  void operationCount;
  return inventory;
}

function pageItems(items: readonly unknown[]): Response {
  return json({ items, totalEstimate: items.length, asOf: '2026-08-21T00:00:00.000Z' });
}

function operation(operationType: string, result: unknown): Readonly<Record<string, unknown>> {
  return {
    operationId: `unit-${operationType}`,
    operationType,
    target: { type: 'unit', id: 'unit' },
    status: 'succeeded',
    result,
    completedAt: '2026-08-21T00:00:00.000Z',
  };
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const item = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(item)
    .filter((key) => item[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stable(item[key])}`)
    .join(',')}}`;
}
