import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  hashConfigurationRequest,
  parseMcpProviderBindingPolicyOverride,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  governUgvSmppCapabilities,
  ugvSmppGovernanceConfigurationFromEnvironment,
  writeRedactedUgvSmppGovernanceReport,
  type UgvSmppCapabilityGovernanceConfiguration,
} from '../src/ugv-smpp-capability-governance-driver.js';

const NOW = '2026-08-12T04:00:00.000Z';
const VALID_UNTIL = '2026-08-12T05:00:00.000Z';
const CONTROL_TOKEN = 'control-token-never-report';
const RESOURCE_ID = 'vehicle:ugv1';
const SERVER_ID = 'ugv-smpp-runtime';
const REVISION = 7;
const roots: string[] = [];

const GOVERNED_TOOLS = Object.freeze([
  'vehicle_get_state',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_targets',
  'vehicle_laser_range',
  'vehicle_navigate',
  'vehicle_area_recon',
  'vehicle_track_target',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
]);
const READ_ONLY_TOOLS = Object.freeze(GOVERNED_TOOLS.slice(0, 5));
const CONTROL_TOOLS = Object.freeze(GOVERNED_TOOLS.slice(5));

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
});

describe('UGV SMPP Capability and Skill governance driver', () => {
  it('publishes only read authorities and persists controls as non-executable drafts', async () => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    const report = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report.skills.map(({ toolName }) => toolName)).toEqual(READ_ONLY_TOOLS);
    expect(report.capabilities.map(({ toolName }) => toolName)).toEqual(READ_ONLY_TOOLS);
    expect(report.stagedControls.map(({ toolName }) => toolName)).toEqual(CONTROL_TOOLS);
    expect(report.stagedControls).toHaveLength(CONTROL_TOOLS.length);
    for (const [index, toolName] of CONTROL_TOOLS.entries()) {
      expect(report.stagedControls[index]).toEqual(
        expect.objectContaining({
          toolName,
          runtimeSkillStatus: 'draft',
          governedSkillStatus: 'validated',
          capabilityStatus: 'draft',
          readiness: 'unavailable',
          lifecycle: 'staged_non_executable',
          persisted: true,
          implementationPersisted: false,
          selectable: false,
          executionAuthorized: false,
          blockingReasonCodes: [
            'CONTROL_TRANSPORT_GATE_NOT_IMPLEMENTED',
            'PHYSICAL_WRITE_ACCEPTANCE_NOT_RUN',
          ],
        }),
      );
    }
    expect(report.catalog).toEqual({
      discoveredToolCount: 12,
      governedToolCount: 5,
      stagedControlToolCount: 5,
      unmappedToolNames: ['vehicle_diagnostics_extension'],
    });
    expect(report.firePolicy).toEqual({
      toolName: 'vehicle_fire_weapon',
      discovered: true,
      forbidden: true,
      capabilityCreated: false,
      skillCreated: false,
    });
    expect(report.resourcePolicy).toEqual({
      identifierAuthority: 'public_smpp_tool_schema',
      resourceId: RESOURCE_ID,
      selection: 'single_schema_value',
    });
    expect(report.binding).toEqual(
      expect.objectContaining({
        bindingId: 'mcp-binding-ugv-smpp',
        localServerId: SERVER_ID,
        revision: REVISION,
        operationCount: 12,
      }),
    );
    expect(api.uniqueMutations('skill-import')).toBe(10);
    expect(api.uniqueMutations('skill-publish')).toBe(5);
    expect(api.uniqueMutations('capability-create')).toBe(10);
    expect(api.uniqueMutations('capability-implementation')).toBe(5);
    expect(api.uniqueMutations('capability-validate')).toBe(5);
    expect(api.uniqueMutations('capability-publish')).toBe(5);
    expect(api.uniqueMutations('capability-readiness')).toBe(5);

    const readSkill = api.runtimeSkill('ugv.get-state');
    expect(readSkill?.['inputSchema']).toEqual(api.tool('vehicle_get_state')?.inputSchema);
    expect(readSkill?.['outputSchema']).toEqual(api.tool('vehicle_get_state')?.outputSchema);
    expect(readSkill?.['runtimePolicy']).toEqual(
      expect.objectContaining({ autoConfirmPlan: false, maxLlmCalls: 0, maxMcpCalls: 1 }),
    );
    expect(readSkill?.['toolPolicy']).toEqual(
      expect.objectContaining({
        required: [{ serverId: SERVER_ID, toolName: 'vehicle_get_state' }],
        forbidden: [{ serverId: SERVER_ID, toolName: 'vehicle_fire_weapon' }],
      }),
    );
    expect(api.capability('vehicle.ugv.read-state')).toEqual(
      expect.objectContaining({ riskLevel: 'low', inputSchema: readSkill?.['inputSchema'] }),
    );
    const readImplementation = api.implementation('vehicle.ugv.read-state');
    expect(
      parseMcpProviderBindingPolicyOverride(readImplementation?.['providerPolicyOverride']),
    ).toEqual({
      mode: 'single',
      requirements: [
        {
          selection: 'required',
          mcpProviderBindingId: 'mcp-binding-ugv-smpp',
          localServerId: SERVER_ID,
          mcpToolName: 'vehicle_get_state',
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
      ],
    });

    const navigate = api.runtimeSkill('ugv.navigate');
    expect(navigate?.['runtimePolicy']).toEqual(
      expect.objectContaining({
        autoConfirmPlan: false,
        maxDurationSeconds: 1800,
        maxMcpCalls: 5,
      }),
    );
    expect(navigate?.['status']).toBe('draft');
    expect(navigate?.['outcomeSpecification']).toEqual(
      expect.objectContaining({
        evidence: [
          'vehicle.command.acceptance',
          'vehicle.remote-task.identity',
          'vehicle.task.progress',
          'vehicle.task.terminal',
        ],
        sideEffectPolicy: expect.objectContaining({
          confirmation: 'required_before_execution',
          redispatchAfterUncertain: false,
          terminalObservationRequired: true,
        }),
      }),
    );
    expect(api.capability('vehicle.ugv.navigate')).toEqual(
      expect.objectContaining({
        riskLevel: 'medium',
        status: 'draft',
        successCriteria: expect.arrayContaining([
          {
            type: 'external_command_dispatch_count',
            minimum: 5,
            maximum: 5,
          },
        ]),
        supportedModes: ['plan_confirmed', 'remote_task'],
        constraints: expect.arrayContaining([
          {
            type: 'bounded_movement_policy',
            constraintId: 'vehicle-navigate-distance-per-dispatch',
            toolName: 'vehicle_navigate',
            missionType: 'distance',
            missionTypeArgumentPath: ['mission', 'type'],
            directionArgumentPath: ['mission', 'direction'],
            distanceArgumentPath: ['mission', 'distanceM'],
            allowedDirections: ['backward', 'forward', 'left', 'right'],
            exclusiveMinimum: 0,
            maximumInclusive: 2,
            unit: 'm',
            scope: 'per_dispatch',
            exactDirection: 'forward',
            exactDistancePerDispatch: 2,
            exactDispatchCount: 5,
            exactTotalDistance: 10,
            strictSequential: true,
            terminalBeforeNext: true,
          },
        ]),
      }),
    );

    const emergency = api.runtimeSkill('ugv.emergency-stop');
    expect(emergency?.['status']).toBe('draft');
    expect(emergency?.['outcomeSpecification']).toEqual(
      expect.objectContaining({
        sideEffectPolicy: expect.objectContaining({
          safetyAction: 'emergency_stop',
          explicitUnambiguousIntentRequired: true,
          ambiguousModelOutput: 'forbidden',
        }),
      }),
    );
    expect(api.capability('vehicle.ugv.emergency-stop')).toEqual(
      expect.objectContaining({
        riskLevel: 'high',
        status: 'draft',
        constraints: expect.arrayContaining([
          expect.objectContaining({
            type: 'emergency_stop_policy',
            targetResourceId: RESOURCE_ID,
            ambiguousModelOutput: 'forbidden',
          }),
        ]),
      }),
    );
    expect(api.runtimeSkill('ugv.fire-weapon')).toBeUndefined();
    expect(api.capability('vehicle.ugv.fire-weapon')).toBeUndefined();

    const packageSchema = JSON.parse(
      await readFile('schemas/skill-package.schema.json', 'utf8'),
    ) as unknown;
    const importer = new SkillPackageImporter({
      reader: new NodeSkillPackageReader(),
      validator: new SkillPackageValidator({
        schemas: new AjvJsonSchemaValidator(),
        packageSchema,
      }),
      clock: { now: () => NOW },
    });
    for (const { skillId, packageChecksum } of report.skills) {
      const candidate = await importer.import(join(root, skillId, 'v1'));
      expect(candidate.skillVersion.skillId).toBe(skillId);
      expect(candidate.skillVersion.validationPassed).toBe(true);
      expect(packageChecksum).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(JSON.stringify(report)).not.toContain(CONTROL_TOKEN);
    expect(JSON.stringify(report)).not.toContain('https://runtime.local');
  });

  it('publishes only bounded vehicle_navigate behind its explicit activation', async () => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    const staged = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });
    expect(staged.stagedControls).toHaveLength(5);
    const report = await governUgvSmppCapabilities(
      { ...configuration(root), activateNavigateControl: true },
      { fetch: api.fetch, now: () => NOW },
    );

    expect(report.skills.map(({ toolName }) => toolName)).toEqual([
      ...READ_ONLY_TOOLS,
      'vehicle_navigate',
    ]);
    expect(report.capabilities.map(({ toolName }) => toolName)).toEqual([
      ...READ_ONLY_TOOLS,
      'vehicle_navigate',
    ]);
    expect(report.skills.find(({ toolName }) => toolName === 'vehicle_navigate')?.action).toBe(
      'reconciled',
    );
    expect(report.stagedControls.map(({ toolName }) => toolName)).toEqual(CONTROL_TOOLS.slice(1));
    expect(report.catalog).toEqual({
      discoveredToolCount: 12,
      governedToolCount: 6,
      stagedControlToolCount: 4,
      unmappedToolNames: ['vehicle_diagnostics_extension'],
    });
    expect(api.runtimeSkill('ugv.navigate')).toEqual(
      expect.objectContaining({
        status: 'enabled',
        runtimePolicy: expect.objectContaining({ maxMcpCalls: 5 }),
        usageSpecification: expect.objectContaining({
          taskBindings: [
            expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v1-dispatch-1' }),
            expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v1-dispatch-2' }),
            expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v1-dispatch-3' }),
            expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v1-dispatch-4' }),
            expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v1-dispatch-5' }),
          ],
        }),
      }),
    );
    expect(api.capability('vehicle.ugv.navigate')).toEqual(
      expect.objectContaining({
        status: 'published',
        successCriteria: expect.arrayContaining([
          {
            type: 'external_command_dispatch_count',
            minimum: 5,
            maximum: 5,
          },
        ]),
      }),
    );
    expect(api.implementation('vehicle.ugv.navigate')).toEqual(
      expect.objectContaining({
        implementationId: 'ugv.navigate',
        status: 'active',
      }),
    );
    for (const toolName of CONTROL_TOOLS.slice(1)) {
      const staged = report.stagedControls.find((item) => item.toolName === toolName);
      expect(staged).toEqual(
        expect.objectContaining({
          runtimeSkillStatus: 'draft',
          capabilityStatus: 'draft',
          implementationPersisted: false,
          executionAuthorized: false,
        }),
      );
    }
    expect(api.uniqueMutations('skill-publish')).toBe(6);
    expect(api.uniqueMutations('capability-implementation')).toBe(6);
    expect(api.uniqueMutations('capability-publish')).toBe(6);
    expect(api.uniqueMutations('capability-readiness')).toBe(6);
    expect(api.runtimeSkill('ugv.fire-weapon')).toBeUndefined();
    expect(api.capability('vehicle.ugv.fire-weapon')).toBeUndefined();
  });

  it('publishes a successor point-navigation authority with one obstacle-stopping dispatch', async () => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });

    const report = await governUgvSmppCapabilities(
      {
        ...configuration(root),
        activateNavigateControl: true,
        navigateControlMode: 'coordinate_point',
      },
      { fetch: api.fetch, now: () => NOW },
    );

    expect(report.navigateControl).toEqual({
      activated: true,
      mode: 'coordinate_point',
      dispatchMaximum: 1,
      stopOnObstacleRequired: true,
    });
    expect(api.runtimeSkill('ugv.navigate')).toEqual(
      expect.objectContaining({
        version: 2,
        status: 'enabled',
        runtimePolicy: expect.objectContaining({ maxMcpCalls: 1 }),
        inputSchema: expect.objectContaining({
          required: ['resourceId', 'mission', 'stopOnObstacle'],
          properties: expect.objectContaining({
            resourceId: expect.objectContaining({ const: RESOURCE_ID }),
            stopOnObstacle: { type: 'boolean', const: true },
            mission: expect.objectContaining({
              properties: expect.objectContaining({ type: { const: 'point' } }),
            }),
          }),
        }),
        usageSpecification: expect.objectContaining({
          taskBindings: [expect.objectContaining({ bindingId: 'task-binding-ugv.navigate-v2' })],
        }),
      }),
    );
    const capability = api.capability('vehicle.ugv.navigate');
    expect(capability).toEqual(
      expect.objectContaining({
        version: 2,
        status: 'published',
        successCriteria: expect.arrayContaining([
          {
            type: 'external_command_dispatch_count',
            minimum: 1,
            maximum: 1,
          },
        ]),
      }),
    );
    expect(
      Array.isArray(capability?.['constraints']) &&
        capability['constraints'].some(
          (constraint) => isRecord(constraint) && constraint['type'] === 'bounded_movement_policy',
        ),
    ).toBe(false);
    expect(api.implementation('vehicle.ugv.navigate')).toEqual(
      expect.objectContaining({
        implementationId: 'ugv.navigate',
        implementationVersion: '2',
        status: 'active',
      }),
    );
  });

  it('is idempotent for the same exact versions and fails closed on later exact-version drift', async () => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    const first = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });
    const uniqueAfterFirst = api.uniqueMutationCount;
    const callsAfterFirst = api.mutationCallCount;
    const second = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(second.skills.every(({ action }) => action === 'reconciled')).toBe(true);
    expect(second.skills.map(({ packageChecksum }) => packageChecksum)).toEqual(
      first.skills.map(({ packageChecksum }) => packageChecksum),
    );
    expect(api.uniqueMutationCount).toBe(uniqueAfterFirst);
    expect(api.mutationCallCount).toBe(callsAfterFirst + 5);
    const callsBeforeDrift = api.mutationCallCount;
    api.replaceOutputSchema('vehicle_get_state', {
      type: 'object',
      additionalProperties: false,
      properties: { resourceId: { const: RESOURCE_ID }, changed: { type: 'boolean' } },
      required: ['resourceId', 'changed'],
    });

    const upgraded = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });
    expect(upgraded.skills.find(({ skillId }) => skillId === 'ugv.get-state')).toEqual(
      expect.objectContaining({ skillVersion: 2, action: 'imported' }),
    );
    expect(
      upgraded.capabilities.find(({ capabilityId }) => capabilityId === 'vehicle.ugv.read-state'),
    ).toEqual(expect.objectContaining({ capabilityVersion: 2, skillVersion: 2 }));
    expect(api.mutationCallCount).toBeGreaterThan(callsBeforeDrift);
    expect(api.runtimeSkill('ugv.get-state')).toEqual(
      expect.objectContaining({ version: 2, previousVersion: 1, status: 'enabled' }),
    );
    expect(api.capability('vehicle.ugv.read-state')).toEqual(
      expect.objectContaining({ version: 2, previousVersion: 1, status: 'published' }),
    );
    expect(upgraded.firePolicy.capabilityCreated).toBe(false);
    expect(upgraded.firePolicy.skillCreated).toBe(false);

    const callsAfterUpgrade = api.mutationCallCount;
    const replay = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });
    expect(replay.skills.find(({ skillId }) => skillId === 'ugv.get-state')?.skillVersion).toBe(2);
    expect(
      replay.capabilities.find(({ capabilityId }) => capabilityId === 'vehicle.ugv.read-state')
        ?.capabilityVersion,
    ).toBe(2);
    expect(api.mutationCallCount).toBe(callsAfterUpgrade + 5);
  });

  it('requires explicit configuration for multi-resource schemas instead of choosing the first enum', async () => {
    const ambiguousRoot = workspaceRoot();
    const ambiguous = new FakeUgvGovernanceApis({
      resourceSchema: { type: 'string', enum: [RESOURCE_ID, 'vehicle:ugv2'] },
    });
    await expect(
      governUgvSmppCapabilities(configuration(ambiguousRoot), {
        fetch: ambiguous.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'MCP_TOOL_RESOURCE_AUTHORITY_AMBIGUOUS' });
    expect(ambiguous.mutationCallCount).toBe(0);

    const explicitRoot = workspaceRoot();
    const explicit = new FakeUgvGovernanceApis({
      resourceSchema: { type: 'string', enum: [RESOURCE_ID, 'vehicle:ugv2'] },
    });
    const report = await governUgvSmppCapabilities(
      { ...configuration(explicitRoot), resourceId: 'vehicle:ugv2' },
      { fetch: explicit.fetch, now: () => NOW },
    );
    expect(report.resourcePolicy).toEqual(
      expect.objectContaining({
        resourceId: 'vehicle:ugv2',
        selection: 'explicit_configured_value',
      }),
    );
  });

  it('governs only present standard Tools while keeping a discovered fire Tool forbidden', async () => {
    const completeRoot = workspaceRoot();
    const complete = new FakeUgvGovernanceApis({
      toolNames: [...GOVERNED_TOOLS, 'vehicle_fire_weapon'],
    });
    const completeReport = await governUgvSmppCapabilities(configuration(completeRoot), {
      fetch: complete.fetch,
      now: () => NOW,
    });
    expect(completeReport.catalog).toEqual({
      discoveredToolCount: 11,
      governedToolCount: 5,
      stagedControlToolCount: 5,
      unmappedToolNames: [],
    });

    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis({
      toolNames: ['vehicle_get_state', 'vehicle_fire_weapon'],
    });
    const report = await governUgvSmppCapabilities(configuration(root), {
      fetch: api.fetch,
      now: () => NOW,
    });
    expect(report.skills).toEqual([
      expect.objectContaining({ skillId: 'ugv.get-state', toolName: 'vehicle_get_state' }),
    ]);
    expect(report.capabilities).toHaveLength(1);
    expect(report.stagedControls).toHaveLength(0);
    expect(report.firePolicy).toEqual(
      expect.objectContaining({ discovered: true, forbidden: true }),
    );
  });

  it('rejects any pre-existing fire Skill or Capability before mutation', async () => {
    const skillRoot = workspaceRoot();
    const withSkill = new FakeUgvGovernanceApis();
    withSkill.injectFireSkill();
    await expect(
      governUgvSmppCapabilities(configuration(skillRoot), {
        fetch: withSkill.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'FIRE_GOVERNANCE_ALREADY_EXISTS' });
    expect(withSkill.mutationCallCount).toBe(0);

    const capabilityRoot = workspaceRoot();
    const withCapability = new FakeUgvGovernanceApis();
    withCapability.injectFireCapability();
    await expect(
      governUgvSmppCapabilities(configuration(capabilityRoot), {
        fetch: withCapability.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'FIRE_GOVERNANCE_ALREADY_EXISTS' });
    expect(withCapability.mutationCallCount).toBe(0);
  });

  it('rejects an already executable control authority before mutation', async () => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    api.injectExecutableControlSkill();
    await expect(
      governUgvSmppCapabilities(configuration(root), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'CONTROL_GOVERNANCE_EXECUTABLE' });
    expect(api.mutationCallCount).toBe(0);
  });

  it.each([
    {
      label: 'unknown semantics',
      mutate: (api: FakeUgvGovernanceApis) => {
        api.replaceExecutionSemantics('vehicle_get_state', {
          effect: 'unknown',
          execution: 'unknown',
          cancellation: 'unknown',
          idempotency: 'unknown',
          replay: 'unknown',
          source: 'default_unknown',
        });
      },
      code: 'MCP_TOOL_SEMANTICS_UNTRUSTED',
    },
    {
      label: 'read Tool classified as side effecting',
      mutate: (api: FakeUgvGovernanceApis) => {
        api.replaceExecutionSemantics('vehicle_get_state', controlSemantics());
      },
      code: 'MCP_TOOL_SEMANTICS_CONFLICT',
    },
  ])('fails closed before mutation for $label', async ({ mutate, code }) => {
    const root = workspaceRoot();
    const api = new FakeUgvGovernanceApis();
    mutate(api);
    await expect(
      governUgvSmppCapabilities(configuration(root), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code });
    expect(api.mutationCallCount).toBe(0);
  });

  it('rejects stale Binding freshness and mid-run Catalog authority changes', async () => {
    const staleRoot = workspaceRoot();
    const stale = new FakeUgvGovernanceApis({ availabilityValidUntil: NOW });
    await expect(
      governUgvSmppCapabilities(configuration(staleRoot), {
        fetch: stale.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_BINDING_FRESHNESS_EXPIRED' });
    expect(stale.mutationCallCount).toBe(0);

    const changingRoot = workspaceRoot();
    const changing = new FakeUgvGovernanceApis({ changeCatalogOnFinalRead: true });
    await expect(
      governUgvSmppCapabilities(configuration(changingRoot), {
        fetch: changing.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED_DURING_GOVERNANCE' });
  });

  it('loads the operator token from exactly one inline or file secret and writes a redacted report', async () => {
    const root = workspaceRoot();
    await mkdir(root, { recursive: true });
    const secretFile = join(root, 'operator-token');
    await writeFile(secretFile, ` ${CONTROL_TOKEN}\n`, { encoding: 'utf8', mode: 0o600 });
    const loaded = await ugvSmppGovernanceConfigurationFromEnvironment({
      SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
      SDAR_CONTROL_API_TOKEN_FILE: secretFile,
      SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
      SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
      SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-test-run',
    });
    expect(loaded.configuration.nodeControlBearerToken).toBe(CONTROL_TOKEN);
    expect(loaded.configuration.activateNavigateControl).toBe(false);

    const activated = await ugvSmppGovernanceConfigurationFromEnvironment({
      SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
      SDAR_CONTROL_API_TOKEN_FILE: secretFile,
      SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
      SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
      SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-test-run',
      SDAR_UGV_ACTIVATE_NAVIGATE_CONTROL: 'YES',
    });
    expect(activated.configuration.activateNavigateControl).toBe(true);
    expect(activated.configuration.navigateControlMode).toBe('distance_sequence');

    const coordinate = await ugvSmppGovernanceConfigurationFromEnvironment({
      SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
      SDAR_CONTROL_API_TOKEN_FILE: secretFile,
      SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
      SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
      SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-coordinate-run',
      SDAR_UGV_ACTIVATE_NAVIGATE_CONTROL: 'YES',
      ALLOW_UGV_COORDINATE_NAVIGATION: 'YES',
      UGV_TEST_SAFE_POINT_JSON: '{"longitude":106.81413978,"latitude":29.720426,"altitude":500}',
    });
    expect(coordinate.configuration.navigateControlMode).toBe('coordinate_point');

    await expect(
      ugvSmppGovernanceConfigurationFromEnvironment({
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
        SDAR_CONTROL_API_TOKEN_FILE: secretFile,
        SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
        SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
        SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-coordinate-invalid',
        SDAR_UGV_ACTIVATE_NAVIGATE_CONTROL: 'YES',
        ALLOW_UGV_COORDINATE_NAVIGATION: 'YES',
        UGV_TEST_SAFE_POINT_JSON: '{"longitude":106.81413978,"latitude":29.720426}',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_CONFIGURATION_INVALID' });

    const api = new FakeUgvGovernanceApis({ toolNames: ['vehicle_get_state'] });
    const report = await governUgvSmppCapabilities(loaded.configuration, {
      fetch: api.fetch,
      now: () => NOW,
    });
    const reportFile = join(root, 'report.json');
    await writeRedactedUgvSmppGovernanceReport(reportFile, report);
    const contents = await readFile(reportFile, 'utf8');
    expect(contents).not.toContain(CONTROL_TOKEN);
    expect(contents).not.toContain('http://');
    await expect(
      ugvSmppGovernanceConfigurationFromEnvironment({
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
        SDAR_CONTROL_API_TOKEN: CONTROL_TOKEN,
        SDAR_CONTROL_API_TOKEN_FILE: secretFile,
        SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
        SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
        SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-test-run',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_CONFIGURATION_INVALID' });
    await expect(
      ugvSmppGovernanceConfigurationFromEnvironment({
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
        SDAR_CONTROL_API_TOKEN_FILE: secretFile,
        SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL: 'http://127.0.0.1:9998',
        SDAR_UGV_GOVERNANCE_PACKAGE_ROOT: root,
        SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-bootstrap-test-run',
        SDAR_UGV_ACTIVATE_NAVIGATE_CONTROL: 'true',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_CONFIGURATION_INVALID' });
  });
});

interface FakeOptions {
  readonly toolNames?: readonly string[];
  readonly resourceSchema?: Record<string, unknown>;
  readonly availabilityValidUntil?: string;
  readonly changeCatalogOnFinalRead?: boolean;
}

class FakeUgvGovernanceApis {
  readonly #runtimeSkills = new Map<string, Record<string, unknown>>();
  readonly #governedSkills = new Set<string>();
  readonly #capabilities = new Map<string, Record<string, unknown>>();
  readonly #implementations = new Map<string, Record<string, unknown>[]>();
  readonly #receipts = new Map<string, unknown>();
  readonly #mutationCalls: string[] = [];
  readonly #options: FakeOptions;
  #tools: ToolFixture[];
  #bindingReads = 0;

  constructor(options: FakeOptions = {}) {
    this.#options = options;
    this.#tools = makeTools(
      options.toolNames ?? [
        ...GOVERNED_TOOLS,
        'vehicle_fire_weapon',
        'vehicle_diagnostics_extension',
      ],
      options.resourceSchema ?? { type: 'string', const: RESOURCE_ID },
    );
  }

  get uniqueMutationCount(): number {
    return this.#receipts.size;
  }

  get mutationCallCount(): number {
    return this.#mutationCalls.length;
  }

  uniqueMutations(scope: string): number {
    return [...this.#receipts.keys()].filter((key) => key.includes(scope)).length;
  }

  runtimeSkill(skillId: string): Record<string, unknown> | undefined {
    return latestVersioned(this.#runtimeSkills, skillId);
  }

  capability(capabilityId: string): Record<string, unknown> | undefined {
    return latestVersioned(this.#capabilities, capabilityId);
  }

  implementation(capabilityId: string): Record<string, unknown> | undefined {
    const capability = this.capability(capabilityId);
    const version = capability?.['version'];
    return typeof version === 'number'
      ? this.#implementations.get(versionedIdentity(capabilityId, version))?.[0]
      : undefined;
  }

  injectFireSkill(): void {
    this.#runtimeSkills.set(versionedIdentity('ugv.fire-weapon', 1), {
      skillId: 'ugv.fire-weapon',
      version: 1,
      status: 'enabled',
      usageSpecification: {},
    });
  }

  injectFireCapability(): void {
    this.#capabilities.set(versionedIdentity('vehicle.ugv.fire-weapon', 1), {
      capabilityId: 'vehicle.ugv.fire-weapon',
      version: 1,
      domain: 'vehicle.ugv',
      name: 'Forbidden fire capability',
      description: 'Forbidden existing test authority.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'forbidden' }],
      requiredEvidence: [{ type: 'forbidden' }],
      effects: ['effect.vehicle.ugv.fire'],
      artifacts: [],
      constraints: [{ type: 'forbidden' }],
      supportedModes: ['remote_task'],
      riskLevel: 'high',
      status: 'published',
      definitionHash: 'f'.repeat(64),
    });
  }

  injectExecutableControlSkill(): void {
    this.#runtimeSkills.set(versionedIdentity('ugv.navigate', 1), {
      skillId: 'ugv.navigate',
      version: 1,
      status: 'enabled',
      usageSpecification: {},
    });
  }

  tool(toolName: string): ToolFixture | undefined {
    return this.#tools.find((tool) => tool.toolName === toolName);
  }

  replaceExecutionSemantics(toolName: string, semantics: ToolFixture['executionSemantics']): void {
    this.#tools = this.#tools.map((tool) =>
      tool.toolName === toolName ? { ...tool, executionSemantics: semantics } : tool,
    );
  }

  replaceOutputSchema(toolName: string, outputSchema: Record<string, unknown>): void {
    this.#tools = this.#tools.map((tool) =>
      tool.toolName === toolName ? { ...tool, outputSchema } : tool,
    );
  }

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/api/v1/mcp-provider-bindings/mcp-binding-ugv-smpp') {
      this.#bindingReads += 1;
      if (this.#options.changeCatalogOnFinalRead === true && this.#bindingReads >= 2)
        this.replaceOutputSchema('vehicle_get_state', {
          type: 'object',
          properties: { resourceId: { const: RESOURCE_ID }, finalDrift: { type: 'boolean' } },
          required: ['resourceId'],
          additionalProperties: false,
        });
      return json(200, this.binding());
    }
    if (method === 'GET' && url.pathname === '/api/v1/mcp/servers') {
      return json(200, { items: [this.server()] });
    }
    if (method === 'GET' && url.pathname === `/api/v1/mcp/servers/${SERVER_ID}/tools`)
      return json(200, { items: this.#tools });

    const runtimeSkillList = /^\/api\/v1\/skills\/(.+)\/versions$/u.exec(url.pathname);
    if (method === 'GET' && runtimeSkillList !== null && url.port === '9998') {
      const skillId = decodeURIComponent(capture(runtimeSkillList, 1));
      return json(200, { items: versionedValues(this.#runtimeSkills, skillId) });
    }
    const runtimeSkill = /^\/api\/v1\/skills\/(.+)\/versions\/(\d+)$/u.exec(url.pathname);
    if (method === 'GET' && runtimeSkill !== null && url.port === '9998') {
      const skillId = decodeURIComponent(capture(runtimeSkill, 1));
      const version = Number(capture(runtimeSkill, 2));
      const skill = this.#runtimeSkills.get(versionedIdentity(skillId, version));
      return skill === undefined ? json(404, { code: 'SKILL_NOT_FOUND' }) : json(200, skill);
    }
    if (method === 'GET' && runtimeSkill !== null) {
      const skillId = decodeURIComponent(capture(runtimeSkill, 1));
      const version = Number(capture(runtimeSkill, 2));
      const identity = versionedIdentity(skillId, version);
      const skill = this.#runtimeSkills.get(identity);
      if (skill === undefined) return json(404, { code: 'SKILL_NOT_FOUND' });
      return json(200, governedSkill(skill, this.#governedSkills.has(identity)));
    }
    if (method === 'POST' && url.pathname === '/api/v1/skills/import') {
      return this.mutate(idempotencyKey(init), async () => {
        const body = parsedBody(init);
        const payload = body['payload'];
        if (!isRecord(payload) || typeof payload['packageRoot'] !== 'string')
          return { status: 'failed', errorCode: 'PACKAGE_ROOT_INVALID' };
        const manifest = parsedFile(join(payload['packageRoot'], 'manifest.json'));
        const normative = parsedFile(join(payload['packageRoot'], 'normative.json'));
        const adaptive = parsedFile(join(payload['packageRoot'], 'adaptive.json'));
        const modes = parsedFile(join(payload['packageRoot'], 'modes.json'));
        const evidence = parsedFile(join(payload['packageRoot'], 'evidence.json'));
        const [manifestValue, normativeValue, adaptiveValue, modesValue, evidenceValue] =
          await Promise.all([manifest, normative, adaptive, modes, evidence]);
        const skill = manifestValue['skill'];
        if (!isRecord(skill) || typeof skill['skillId'] !== 'string')
          return { status: 'failed', errorCode: 'SKILL_MANIFEST_INVALID' };
        if (typeof skill['version'] !== 'number')
          return { status: 'failed', errorCode: 'SKILL_MANIFEST_INVALID' };
        this.#runtimeSkills.set(versionedIdentity(skill['skillId'], skill['version']), {
          ...skill,
          usageSpecification: {
            apiVersion: 'sdar.io/v1alpha1',
            visibility: normativeValue['visibility'],
            normative: normativeValue['normative'],
            contextRequirements: normativeValue['contextRequirements'],
            taskBindings: normativeValue['taskBindings'],
            adaptive: adaptiveValue['adaptive'],
            modes: modesValue,
            evidencePolicy: evidenceValue,
          },
        });
        return { status: 'succeeded' };
      });
    }
    const runtimeSkillPublish = /^\/api\/v1\/skills\/(.+)\/versions\/(\d+)\/publish$/u.exec(
      url.pathname,
    );
    if (method === 'POST' && runtimeSkillPublish !== null) {
      const skillId = decodeURIComponent(capture(runtimeSkillPublish, 1));
      const version = Number(capture(runtimeSkillPublish, 2));
      const identity = versionedIdentity(skillId, version);
      return this.mutate(idempotencyKey(init), () => {
        this.#governedSkills.add(identity);
        const current = this.#runtimeSkills.get(identity);
        if (current !== undefined)
          this.#runtimeSkills.set(identity, { ...current, status: 'enabled' });
        return { status: 'succeeded' };
      });
    }

    if (method === 'GET' && url.pathname === '/api/v1/node-capabilities')
      return json(200, { items: [...this.#capabilities.values()] });
    const capability = /^\/api\/v1\/node-capabilities\/(.+)\/versions\/(\d+)$/u.exec(url.pathname);
    if (method === 'GET' && capability !== null) {
      const capabilityId = decodeURIComponent(capture(capability, 1));
      const version = Number(capture(capability, 2));
      const value = this.#capabilities.get(versionedIdentity(capabilityId, version));
      return value === undefined
        ? json(404, { code: 'NODE_CAPABILITY_NOT_FOUND' })
        : json(200, value);
    }
    const implementation =
      /^\/api\/v1\/node-capabilities\/(.+)\/versions\/(\d+)\/implementations$/u.exec(url.pathname);
    if (method === 'GET' && implementation !== null) {
      const capabilityId = decodeURIComponent(capture(implementation, 1));
      const version = Number(capture(implementation, 2));
      return json(200, {
        items: this.#implementations.get(versionedIdentity(capabilityId, version)) ?? [],
      });
    }
    if (method === 'POST' && url.pathname === '/api/v1/node-capabilities') {
      const body = parsedBody(init);
      const capabilityId = String(body['capabilityId']);
      const version = Number(body['version']);
      return this.mutate(
        idempotencyKey(init),
        () => {
          this.#capabilities.set(versionedIdentity(capabilityId, version), body);
          return body;
        },
        201,
      );
    }
    if (method === 'POST' && implementation !== null) {
      const capabilityId = decodeURIComponent(capture(implementation, 1));
      const version = Number(capture(implementation, 2));
      const body = parsedBody(init);
      return this.mutate(
        idempotencyKey(init),
        () => {
          this.#implementations.set(versionedIdentity(capabilityId, version), [body]);
          return body;
        },
        201,
      );
    }
    const transition =
      /^\/api\/v1\/node-capabilities\/(.+)\/versions\/(\d+)\/(validate|publish)$/u.exec(
        url.pathname,
      );
    if (method === 'POST' && transition !== null) {
      const capabilityId = decodeURIComponent(capture(transition, 1));
      const version = Number(capture(transition, 2));
      const action = capture(transition, 3);
      const identity = versionedIdentity(capabilityId, version);
      return this.mutate(
        idempotencyKey(init),
        () => {
          const current = this.#capabilities.get(identity);
          if (current === undefined) return { status: 'failed' };
          const next = { ...current, status: action === 'validate' ? 'validating' : 'published' };
          this.#capabilities.set(identity, next);
          return action === 'validate' ? next : { status: 'succeeded' };
        },
        action === 'validate' ? 200 : 202,
      );
    }
    const readiness = /^\/api\/v1\/capability-readiness\/(.+)\/(\d+)\/evaluate$/u.exec(
      url.pathname,
    );
    if (method === 'POST' && readiness !== null) {
      const capabilityId = decodeURIComponent(capture(readiness, 1));
      const version = Number(capture(readiness, 2));
      const implementation = this.#implementations.get(
        versionedIdentity(capabilityId, version),
      )?.[0];
      return this.mutate(idempotencyKey(init), () => ({
        status: 'succeeded',
        result: {
          capabilityId,
          capabilityVersion: version,
          status: 'available',
          validUntil: VALID_UNTIL,
          availableImplementations:
            typeof implementation?.['bindingId'] === 'string' ? [implementation['bindingId']] : [],
          unavailableImplementations: [],
        },
      }));
    }
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  private binding() {
    return {
      bindingId: 'mcp-binding-ugv-smpp',
      localServerId: SERVER_ID,
      originType: 'smpp_registry',
      smppSourceId: 'smpp-source-ugv',
      externalProviderId: 'external-ugv-provider',
      externalServerId: 'external-ugv-server',
      registryRevision: 4,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: `1.2.3:${String(REVISION)}`,
      catalogChecksum: catalogChecksum(this.server(), this.#tools),
      endpointRef: 'https://runtime.example.invalid/mcp',
      status: 'active',
      availabilityStatus: 'available',
      revision: REVISION,
      availabilityValidUntil: this.#options.availabilityValidUntil ?? VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: this.#tools.length,
    };
  }

  private server() {
    return {
      serverId: SERVER_ID,
      endpoint: 'https://runtime.example.invalid/mcp',
      protocolMode: 'frozen_v1',
      toolRevision: REVISION,
      currentDiscovery: {
        protocolVersion: '2026-07-28',
        serverInfo: { name: 'ugv-runtime', version: '1.2.3' },
        discoveredAt: NOW,
        validUntil: VALID_UNTIL,
        toolRevision: REVISION,
      },
    };
  }

  private async mutate(key: string, apply: () => unknown, status = 202): Promise<Response> {
    this.#mutationCalls.push(key);
    const replay = this.#receipts.get(key);
    if (replay !== undefined) return json(status, replay);
    const result = await apply();
    this.#receipts.set(key, result);
    return json(status, result);
  }
}

interface ToolFixture {
  readonly serverId: string;
  readonly toolName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly protocolMode: 'frozen_v1';
  readonly executionSemantics: Readonly<{
    effect: 'read_only' | 'side_effecting' | 'unknown';
    execution: 'synchronous' | 'task_required' | 'unknown';
    cancellation: 'unsupported' | 'task_cancel' | 'unknown';
    idempotency: 'client_request_key' | 'unknown';
    replay: 'allowed' | 'forbidden' | 'unknown';
    source: 'mcp_declared' | 'admin_override' | 'default_unknown';
  }>;
  readonly taskExecutionProfile: Readonly<{
    profileVersion: '1.0';
    taskBehavior: 'synchronous_only' | 'task_required';
  }>;
}

function makeTools(
  names: readonly string[],
  resourceSchema: Record<string, unknown>,
): ToolFixture[] {
  return names.map((toolName) => {
    const readOnly = toolName.startsWith('vehicle_get_') || toolName === 'vehicle_laser_range';
    return {
      serverId: SERVER_ID,
      toolName,
      title: toolName,
      description: `Public contract for ${toolName}`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resourceId: resourceSchema,
          ...(toolName === 'vehicle_navigate'
            ? {
                mission: {
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        type: { const: 'point' },
                        target: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            latitude: { type: 'number', minimum: -90, maximum: 90 },
                            longitude: { type: 'number', minimum: -180, maximum: 180 },
                            altitude: { type: 'number' },
                          },
                          required: ['latitude', 'longitude'],
                        },
                      },
                      required: ['type', 'target'],
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        type: { const: 'distance' },
                        direction: {
                          type: 'string',
                          enum: ['forward', 'backward', 'left', 'right'],
                        },
                        distanceM: { type: 'number', exclusiveMinimum: 0 },
                      },
                      required: ['type', 'direction', 'distanceM'],
                    },
                  ],
                },
                stopOnObstacle: { type: 'boolean' },
              }
            : {}),
        },
        required: ['resourceId', ...(toolName === 'vehicle_navigate' ? ['mission'] : [])],
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resourceId: resourceSchema,
          status: { type: 'string' },
        },
        required: ['resourceId', 'status'],
      },
      protocolMode: 'frozen_v1',
      executionSemantics: readOnly ? readSemantics() : controlSemantics(),
      taskExecutionProfile: {
        profileVersion: '1.0',
        taskBehavior: readOnly ? 'synchronous_only' : 'task_required',
      },
    };
  });
}

function readSemantics(): ToolFixture['executionSemantics'] {
  return {
    effect: 'read_only',
    execution: 'synchronous',
    cancellation: 'unsupported',
    idempotency: 'client_request_key',
    replay: 'allowed',
    source: 'mcp_declared',
  };
}

function controlSemantics(): ToolFixture['executionSemantics'] {
  return {
    effect: 'side_effecting',
    execution: 'task_required',
    cancellation: 'task_cancel',
    idempotency: 'client_request_key',
    replay: 'forbidden',
    source: 'admin_override',
  };
}

function catalogChecksum(
  server: ReturnType<FakeUgvGovernanceApis['server']>,
  tools: readonly ToolFixture[],
) {
  return hashConfigurationRequest(
    JSON.parse(
      JSON.stringify({
        protocolVersion: server.currentDiscovery.protocolVersion,
        serverInfo: server.currentDiscovery.serverInfo,
        tools: [...tools]
          .sort((left, right) => left.toolName.localeCompare(right.toolName))
          .map((tool) => ({
            name: tool.toolName,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            protocolMode: tool.protocolMode,
            executionSemantics: tool.executionSemantics,
            taskExecutionProfile: tool.taskExecutionProfile,
          })),
      }),
    ) as JsonValue,
  );
}

function configuration(packageWorkspaceRoot: string): UgvSmppCapabilityGovernanceConfiguration {
  return Object.freeze({
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    packageWorkspaceRoot,
    runId: 'ugv-smpp-governance-test-run',
  });
}

function governedSkill(skill: Record<string, unknown>, governed: boolean) {
  const toolPolicy = skill['toolPolicy'];
  const outcome = skill['outcomeSpecification'];
  return {
    skillId: skill['skillId'],
    version: String(skill['version']),
    status: governed ? 'published' : 'validated',
    inputSchema: skill['inputSchema'],
    outputSchema: skill['outputSchema'],
    usageSpecification: skill['usageSpecification'],
    outcomeSpecification: outcome,
    providerPolicy: {
      required: isRecord(toolPolicy) ? toolPolicy['required'] : [],
      optional: isRecord(toolPolicy) ? toolPolicy['optional'] : [],
      forbidden: isRecord(toolPolicy) ? toolPolicy['forbidden'] : [],
    },
    evidencePolicy: {
      requiredEvidence: isRecord(outcome) ? outcome['evidence'] : [],
    },
  };
}

async function parsedFile(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function capture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error('FAKE_ROUTE_CAPTURE_MISSING');
  return value;
}

function versionedIdentity(identity: string, version: number): string {
  return `${identity}@${String(version)}`;
}

function versionedValues(
  values: ReadonlyMap<string, Record<string, unknown>>,
  identity: string,
): readonly Record<string, unknown>[] {
  return [...values.entries()]
    .filter(([key]) => key.startsWith(`${identity}@`))
    .map(([, value]) => value)
    .sort((left, right) => Number(right['version']) - Number(left['version']));
}

function latestVersioned(
  values: ReadonlyMap<string, Record<string, unknown>>,
  identity: string,
): Record<string, unknown> | undefined {
  return versionedValues(values, identity)[0];
}

function idempotencyKey(init: RequestInit | undefined): string {
  const value = new Headers(init?.headers).get('idempotency-key');
  if (value === null) throw new Error('FAKE_IDEMPOTENCY_KEY_MISSING');
  return value;
}

function parsedBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('FAKE_REQUEST_BODY_MISSING');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workspaceRoot(): string {
  const root = join(tmpdir(), `sdar-ugv-governance-${randomUUID()}`);
  roots.push(root);
  void mkdir(root, { recursive: true });
  return root;
}
