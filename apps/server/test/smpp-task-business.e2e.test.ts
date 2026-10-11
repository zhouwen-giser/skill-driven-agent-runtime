import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { submitA2ATestMessageAtUrl } from '../../../packages/a2a-adapter/test-support/client.js';
import {
  deriveFrozenMcpCatalogAuthority,
  MODEL_STAGES,
  createAgentTask,
  type EvidenceJsonValue,
} from '../../../packages/domain/src/index.js';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import type {
  CapabilityAuthoritySnapshot,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../packages/runtime-control-application/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import { startSmppBusinessProvider } from '../test-support/smpp-business-provider.js';
import { startGowmModelProvider } from '../test-support/gowm-model-provider.js';
import { ConfiguredTrustedIntranetGovernedControlIdentity } from '../src/governed-control-management-identity.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';
import { businessMutationPolicy } from '../../../packages/domain/test/task-business-command-fixture.js';
import { gowmSharedPoolConfiguration } from '../../../packages/persistence-postgres/src/gowm-storage-contract.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
} from '../../../packages/persistence-postgres/src/repositories.js';

const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const rows = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
const text = (value: unknown) => z.string().min(1).parse(value);
const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const sharedStorage = isolatedGowmTestConfiguration();

describe('SMPP v1.3 formal Registry → Skill → Task → HTTP feedback → native business → Task result', () => {
  for (const operation of ['vehicle_navigate', 'vehicle_area_recon'] as const) {
    it(`${operation === 'vehicle_navigate' ? 'AC-042' : 'AC-043'}/038 ${operation} uses genuine authority, returns complete artifacts and judges the original Task after one dispatch`, async () => {
      const id = randomUUID();
      const databaseName = `sdar_smpp_e2e_${id.replaceAll('-', '')}`;
      const postgresUrl = sharedStorage?.consumerUrl ?? isolatedDatabaseUrl(adminUrl, databaseName);
      const serviceKey = `smpp-sdar-${id}`;
      const deviceId = `business-device-${id}`;
      const foreignDeviceId = `foreign-device-${id}`;
      const dataScopeKey = `TEST:SMPP:${id}`;
      const foreignTaskId = randomUUID();
      const serverId = `smpp-${id}`;
      const providerBindingId = `provider-${id}`;
      const skillId = `skill-${id}`;
      const capabilityId = `capability-${id}`;
      const taskTypeId = operation;
      const exposureId = `exposure-${id}`;
      const implementationBindingId = `implementation-${id}`;
      const provider = await startSmppBusinessProvider(operation);
      const model = await startGowmModelProvider({
        taskTypeId,
        capabilityId,
        skillId,
        serverId,
        toolName: operation,
        deviceIds: ['vehicle:ugv'],
        physicalControl: true,
        requiredEffectRef: 'effect.smpp.business',
        expectedBusinessIdentity: provider.identity,
        controlledToolArguments:
          operation === 'vehicle_navigate'
            ? {
                mission: { type: 'point', target: { longitude: 106.802, latitude: 29.7 } },
                stopOnObstacle: true,
              }
            : {
                scanMode: 'area',
                area: {
                  polygon: [
                    { longitude: 106.8, latitude: 29.7 },
                    { longitude: 106.801, latitude: 29.7 },
                    { longitude: 106.801, latitude: 29.701 },
                  ],
                },
              },
      });
      let runtime: ServerRuntimeHandle | undefined;
      let database: Pool | undefined;
      let directoryFixture: Pool | undefined;
      let created = false;
      let providerAuthority: CurrentMcpProviderBindingAuthoritySnapshot | undefined;
      let capabilityAuthority: CapabilityAuthoritySnapshot | undefined;
      let caseFailure: unknown;
      let cleanupFailure: AggregateError | undefined;
      let pinnedA2aPort = 0;
      const masterKeyBase64 = randomBytes(32).toString('base64');
      const oldAllow = process.env['ALLOW_REAL_UGV_SIDE_EFFECTS'];
      const oldRun = process.env['REAL_UGV_TEST_RUN_ID'];
      const start = (applyMigrations: boolean) =>
        startServerRuntime({
          postgresUrl:
            sharedStorage === undefined ? postgresUrl : 'postgresql://unused.invalid/no-fallback',
          ...(sharedStorage === undefined
            ? {}
            : {
                gowmStorage: {
                  databaseUrl: sharedStorage.consumerUrl,
                  serviceKey,
                  allowedDeviceIds: [deviceId],
                  dataScopeKey,
                  includeNonDevice: false,
                  contractDirectory: 'contracts/gowm-shared-storage/current',
                },
              }),
          redis: { host: '127.0.0.1', port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379') },
          masterKeyBase64,
          evidenceEnvironment: 'e2e',
          queueName: `smpp-context-${id}`,
          applyMigrations,
          a2aPort: pinnedA2aPort,
          managementPort: 0,
          outboundEndpointPolicy: {
            unsafeTestOpen: false,
            mcpAllowedAuthorities: [provider.endpoint.host],
            providerAllowedAuthorities: [new URL(model.baseUrl).host],
          },
          currentMcpProviderBindingAuthorityReader: {
            loadCurrentMcpProviderBinding(input) {
              if (
                providerAuthority === undefined ||
                input.localServerId !== serverId ||
                (input.bindingId !== undefined && input.bindingId !== providerBindingId)
              )
                throw new Error('FORMAL_PROVIDER_AUTHORITY_UNAVAILABLE');
              return Promise.resolve(providerAuthority);
            },
          },
          capabilityAuthorityReader: {
            load(requested, version) {
              if (capabilityAuthority === undefined || requested !== capabilityId || version !== 1)
                throw new Error('FORMAL_CAPABILITY_AUTHORITY_UNAVAILABLE');
              return Promise.resolve(capabilityAuthority);
            },
          },
          governedControlPrincipalResolver: new ConfiguredTrustedIntranetGovernedControlIdentity({
            actorId: 'human:isolated-business-operator',
            permissions: ['physical_control.confirm'],
          }),
          frozenMcpTasks: {
            isolationAcknowledged: true,
            queueName: `smpp-remote-${id}`,
            reconcileIntervalMs: 100,
            polling: {
              minimumPollIntervalMs: 100,
              maximumPollIntervalMs: 100,
              providerFailureBackoffBaseMs: 100,
              providerFailureBackoffMaximumMs: 100,
            },
          },
          a2aWaitTimeoutMs: 1000,
          a2aSafetyPollIntervalMs: 100,
        });
      try {
        process.env['ALLOW_REAL_UGV_SIDE_EFFECTS'] = 'YES';
        process.env['REAL_UGV_TEST_RUN_ID'] = `isolated:${id}`;
        if (sharedStorage === undefined) {
          await createIsolatedRuntimeDatabase(adminUrl, databaseName, { template: 'template0' });
          created = true;
        } else {
          directoryFixture = new Pool({ connectionString: sharedStorage.adminUrl, max: 2 });
          await seedDeviceDirectory(directoryFixture, {
            dataScopeKey,
            deviceIds: [deviceId, foreignDeviceId],
            serverId,
            providerId: provider.identity.providerId,
            serviceKey,
          });
        }
        runtime = await start(true);
        pinnedA2aPort = Number(new URL(runtime.a2a.baseUrl).port);
        database = new Pool(
          sharedStorage === undefined
            ? { connectionString: postgresUrl, max: 4 }
            : gowmSharedPoolConfiguration(postgresUrl),
        );
        if (sharedStorage !== undefined) {
          const binding = (
            await required(directoryFixture).query<{ binding_id: string }>(
              'SELECT binding_id FROM gowm_device.device_service_binding WHERE device_id=$1 AND sdar_service_key=$2',
              [foreignDeviceId, serviceKey],
            )
          ).rows[0];
          if (binding === undefined) throw new Error('FOREIGN_FIXTURE_BINDING_MISSING');
          const timestamp = new Date().toISOString();
          const contextId = `foreign-context-${id}`;
          await new PostgresConversationContextRepository(database).save({
            contextId,
            userId: 'fixture:foreign',
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          await new PostgresAgentTaskRepository(database, undefined, undefined, {
            allowedDeviceIds: [foreignDeviceId],
            sdarServiceKey: serviceKey,
            includeNonDevice: false,
          }).save(
            createAgentTask({
              taskId: foreignTaskId,
              contextId,
              userId: 'fixture:foreign',
              requestText: 'Existing foreign-device boundary fixture; no dispatch',
              requestMetadata: {},
              timestamp,
              deviceOwnership: {
                deviceId: foreignDeviceId,
                bindingId: binding.binding_id,
                sdarServiceKey: serviceKey,
              },
            }),
          );
        }
        const post = (path: string, body: unknown, method = 'POST') =>
          jsonRequest(required(runtime).management.baseUrl + path, body, method);
        if (sharedStorage !== undefined)
          await post('/api/v1/system/task-wait-policy', { timeoutSeconds: 300 }, 'PUT');
        const registered = await runtime.registerMcpServer({
          serverId,
          name: 'SMPP isolated business',
          endpoint: provider.endpoint.href,
          credentialHeaders: {},
        });
        const catalogAuthority = deriveFrozenMcpCatalogAuthority(
          registered.snapshot,
          registered.tools,
          registered.server.toolRevision,
        );
        const executionSemantics = registered.tools.find(
          (tool) => tool.toolName === operation,
        )?.executionSemantics;
        if (executionSemantics === undefined)
          throw new Error('FORMAL_EXECUTION_SEMANTICS_REQUIRED');
        providerAuthority = {
          observedAt: new Date().toISOString(),
          binding: {
            bindingId: providerBindingId,
            revision: 1,
            localServerId: serverId,
            originType: 'smpp_registry',
            providerId: provider.identity.providerId,
            externalProviderId: provider.identity.providerId,
            externalServerId: serverId,
            registryRevision: 1,
            registryChecksum: 'd'.repeat(64),
            catalogRevision: catalogAuthority.catalogRevision,
            catalogChecksum: catalogAuthority.catalogChecksum,
            endpointRef: provider.endpoint.href,
            availabilityStatus: 'available',
            availabilityValidUntil: new Date(Date.now() + 600_000).toISOString(),
            catalogObservedAt: new Date().toISOString(),
            operationCount: 1,
          },
          sourceCandidateLineage: {
            smppSourceId: 'isolated-source',
            externalProviderId: provider.identity.providerId,
            externalServerId: serverId,
            registryRevision: 1,
            registryChecksum: 'd'.repeat(64),
            nativeRevision: 1,
            nativeChecksum: 'e'.repeat(64),
            projectionContract: 'sdar-registry-v1',
            candidateEndpoint: provider.endpoint.href,
          },
        };
        const providerPolicyOverride = {
          selection: 'required',
          mcpProviderBindingId: providerBindingId,
          localServerId: serverId,
          mcpToolName: operation,
          allowedResourceIds: ['vehicle:ugv'],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        };
        const constraints = [
          {
            type: 'resource_policy',
            identifierAuthority: 'public_smpp_tool_schema',
            selection: 'exact_value',
            allowedResourceIds: ['vehicle:ugv'],
            downstreamResourceBinding: 'forbidden',
          },
          {
            type: 'provider_binding_policy',
            mcpProviderBindingId: providerBindingId,
            localServerId: serverId,
            mcpToolName: operation,
            allowedResourceIds: ['vehicle:ugv'],
            bindingRevision: 1,
            catalogRevision: catalogAuthority.catalogRevision,
            catalogChecksum: catalogAuthority.catalogChecksum,
            taskBehavior: 'task_required',
            executionSemantics,
            requiredStatus: 'active',
            requiredAvailabilityStatus: 'available',
            requiredFreshness: 'unexpired',
            fallback: 'deny',
          },
          { type: 'exact_skill_version', skillId, skillVersion: 1, taskType: taskTypeId },
          {
            type: 'confirmation_policy',
            required: true,
            stage: 'before_execution',
            autoConfirmPlan: false,
          },
          {
            type: 'physical_side_effect_policy',
            sideEffecting: true,
            allowEnvironment: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
            runIdEnvironment: 'REAL_UGV_TEST_RUN_ID',
            dispatchMaximum: 1,
            uncertainDispatchPolicy: 'reconcile_never_redispatch',
            remoteTaskTerminalEvidenceRequired: true,
          },
          businessMutationPolicy,
          { type: 'runtime_execution_mode_policy', mode: 'live' },
        ];
        capabilityAuthority = {
          definition: {
            capability_id: capabilityId,
            version: 1,
            status: 'published',
            risk_level: 'high',
            supported_modes: ['plan_confirmed', 'remote_task'],
            constraints: constraints as EvidenceJsonValue[],
          },
          implementationBindings: [
            {
              capability_id: capabilityId,
              capability_version: 1,
              implementation_type: 'skill',
              implementation_id: skillId,
              implementation_version: '1',
              role: 'primary',
              status: 'active',
              provider_policy_override: providerPolicyOverride,
            },
          ],
        };
        const outcomeSpecification = {
          schemaVersion: '1.0' as const,
          skillId,
          skillVersion: 1,
          effects: ['effect.smpp.business'],
          evidence: ['evidence.smpp.business'],
          artifacts: [],
          taskGoalPolicy: {},
          confidencePolicy: {},
          sideEffectPolicy: {
            sideEffecting: true,
            classification: 'physical_control',
            confirmation: 'required_before_execution',
            autoConfirmPlan: false,
            allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
            realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
            exactResourceRequired: true,
            remoteTaskIdentityRequired: true,
            terminalObservationRequired: true,
            redispatchAfterUncertain: false,
          },
        };
        await runtime.registerSkill({
          skillId,
          name: `Controlled ${operation}`,
          summary: `Execute one ${operation} and return original business evidence`,
          description: 'Isolated native formal path',
          capabilities: [capabilityId],
          workflowGuidance: `Call ${serverId}/${operation} exactly once`,
          outputInstruction: 'Return actual structuredContent with business evidence',
          inputSchema: provider.toolSchema,
          outputSchema: {
            type: 'object',
            required: ['resourceId', 'status', 'observedAt', 'businessSemantics'],
            properties: {
              resourceId: { const: 'vehicle:ugv' },
              status: { const: 'completed' },
              observedAt: { type: 'string' },
              businessSemantics: {
                type: 'object',
                required: ['missionTaskState'],
                properties: { missionTaskState: { const: 'succeeded' } },
                additionalProperties: true,
              },
            },
            additionalProperties: false,
          },
          toolPolicy: {
            required: [{ serverId, toolName: operation }],
            optional: [],
            forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
          },
          runtimePolicy: {
            autoConfirmPlan: false,
            maxMcpCalls: 1,
            taskBusinessMutationPolicy: {
              ...businessMutationPolicy,
              allowedOperations: [...businessMutationPolicy.allowedOperations],
            },
            taskBusinessEvidencePolicy: {
              schemaVersion: 'sdar.task-business-evidence-policy/v1',
              operationName: operation,
              providerSuccess: {
                jsonPointer: '/businessSemantics/missionTaskState',
                equals: 'succeeded',
              },
              skillSuccess: { jsonPointer: '/status', equals: 'completed' },
              requiredGeometryRoles: ['actual_trajectory'],
              requireHistoryContinuity: false,
              requireTrajectoryTime: false,
            },
          },
          usageSpecification: {
            apiVersion: 'sdar.io/v1alpha1',
            visibility: { userSelectable: true, composable: true, internalOnly: false },
            normative: {
              constraints: ['Use the original resource after explicit human confirmation'],
              forbiddenActions: ['Weapon operations'],
              requiredConfirmations: ['Human confirmation before execution'],
              noApplicableSkill: 'reject',
            },
            adaptive: {
              instructions: [`Call ${serverId}/${operation} once`],
              optimizationHints: [],
              allowPreferredProviderFallback: false,
            },
            contextRequirements: [],
            modes: {
              supported: ['guidance'],
              defaultMode: 'guidance',
              guidance: {
                summary: 'Controlled non-weapon task',
                instructions: ['Use explicit resourceId and preserve feedback'],
              },
            },
            taskBindings: [],
            evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
          },
          outcomeSpecification: {
            ...outcomeSpecification,
            specificationHash: `sha256:${canonicalHash(outcomeSpecification)}`,
          },
          status: 'enabled',
          sourceKind: 'admin',
          validationPassed: true,
        });
        await database.query(
          "INSERT INTO runtime_skill_version_governance(skill_id,skill_version,lifecycle_status,lock_version,updated_by,reason,created_at,updated_at) VALUES($1,1,'published',1,'isolated-human','Exact non-weapon fixture',clock_timestamp(),clock_timestamp())",
          [skillId],
        );
        await seedPublication(database, {
          a2aBaseUrl: runtime.a2a.baseUrl,
          capabilityId,
          exposureId,
          implementationBindingId,
          skillId,
          constraints,
          providerPolicyOverride,
          inputSchema: provider.toolSchema,
        });
        const modelId = `model-${id}`;
        await post(
          `/api/v1/models/providers/${modelId}`,
          {
            providerId: modelId,
            name: modelId,
            kind: 'openai_compatible',
            apiStyle: 'openai_chat_completions',
            baseUrl: model.baseUrl,
            model: 'isolated-business-model',
            enabled: true,
            timeoutMs: 30_000,
            credentialHeaders: {},
          },
          'PUT',
        );
        for (const stage of MODEL_STAGES) {
          await post(
            `/api/v1/models/routes/${stage}`,
            { providerId: modelId, operation: 'structured_generation' },
            'PUT',
          );
          await post(
            `/api/v1/models/routes/${stage}`,
            { providerId: modelId, operation: 'embedding' },
            'PUT',
          );
        }
        await post('/api/v1/task-types/configured', {
          actorId: 'isolated-human',
          idempotencyKey: id,
          reason: 'Isolated formal Task business fixture',
          humanApproved: true,
          policyAllowed: true,
          definition: {
            taskTypeId,
            version: 1,
            title: `Controlled ${operation}`,
            recognitionHints: ['vehicle:ugv'],
            requiredDimensions: ['target', 'criteria'],
            capabilityRequirements: [capabilityId],
            risks: ['physical_control'],
          },
        });
        const arguments_ =
          operation === 'vehicle_navigate'
            ? {
                resourceId: 'vehicle:ugv',
                mission: { type: 'point', target: { longitude: 106.802, latitude: 29.7 } },
                stopOnObstacle: true,
              }
            : {
                resourceId: 'vehicle:ugv',
                scanMode: 'area',
                area: {
                  polygon: [
                    { longitude: 106.8, latitude: 29.7 },
                    { longitude: 106.801, latitude: 29.7 },
                    { longitude: 106.801, latitude: 29.701 },
                  ],
                },
              };
        const task = await submitA2ATestMessageAtUrl(runtime.a2a.baseUrl, {
          message: {
            messageId: id,
            role: 'ROLE_USER',
            parts: [
              {
                text: `Execute ${operation} for original vehicle:ugv once with human confirmation`,
              },
              { data: arguments_, mediaType: 'application/json' },
            ],
            metadata: {
              ...(sharedStorage === undefined ? {} : { 'io.sdar/deviceId': deviceId }),
              idempotency_key: id,
              structured_input: arguments_,
              'io.sdar/requestedCapability': { exposureId, versionConstraint: '1', requestId: id },
            },
          },
          configuration: { returnImmediately: true },
        });
        const taskId = task.id;
        await eventually(async () => {
          const current = record(
            await jsonRequest(required(runtime).management.baseUrl + `/api/v1/tasks/${taskId}`),
          );
          if (current['phase'] === 'failed')
            throw new Error(`FORMAL_PREPARATION_FAILED:${JSON.stringify(current)}`);
          expect(current['phase']).toBe('awaiting_plan_confirmation');
        });
        expect(provider.calls.filter((call) => call.method === 'tools/call')).toHaveLength(0);
        await post(`/api/v1/tasks/${taskId}/governed-control-confirmations`, {
          reason: 'Approve this immutable original Task plan',
        });
        await post(`/api/v1/tasks/${taskId}/actions`, {
          action: 'confirm_plan',
          messageText: 'Confirm the exact non-weapon plan',
        });
        const projection = await eventually(async () => {
          const items = rows(
            record(
              await jsonRequest(
                required(runtime).management.baseUrl + `/api/v1/tasks/${taskId}/business`,
              ),
            )['items'],
          );
          expect(items).toHaveLength(1);
          expect(items[0]).toMatchObject({
            status: 'current',
            identity: provider.identity,
            quality: { currentStateComplete: true, historyContinuous: false },
          });
          return required(items[0]);
        });
        expect(provider.calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
        if (operation === 'vehicle_navigate') {
          expect(projection['allowedInterventions']).toHaveLength(1);
          const command = record(
            await post(`/api/v1/tasks/${taskId}/business/navigation/prepare`, {
              idempotencyKey: id,
              waypoints: [{ longitude: 106.802, latitude: 29.7 }],
              density: 'normal',
            }),
          );
          const intentId = text(record(command['intent'])['intentId']);
          expect(
            provider.calls.filter((call) => call.method.endsWith('/interventions/apply')),
          ).toHaveLength(0);
          const accepted = record(
            await post(`/api/v1/tasks/${taskId}/business/commands/${intentId}/confirm`, {
              reason: 'Approve displayed route revision exactly once',
            }),
          );
          expect(accepted['state']).toBe('accepted');
          expect(accepted['confirmationFact']).toBeDefined();
          expect(accepted['dispatchClaim']).toBeDefined();
          expect(
            provider.calls.filter((call) => call.method.endsWith('/interventions/apply')),
          ).toHaveLength(1);
          provider.applyAcceptedNavigation();
          await eventually(async () => {
            expect(
              record(
                await post(`/api/v1/tasks/${taskId}/business/commands/${intentId}/reconcile`, {}),
              )['state'],
            ).toBe('confirmed');
          });
        } else {
          const inputRequestId = await eventually(async () => {
            const result = await required(database).query<{ input_request_id: string }>(
              "SELECT input_request_id FROM remote_task_input_link WHERE binding_id=(SELECT binding_id FROM remote_task_binding WHERE agent_task_id=$1) AND status='waiting'",
              [taskId],
            );
            expect(result.rows).toHaveLength(1);
            return required(result.rows[0]).input_request_id;
          });
          await post(`/api/v1/tasks/${taskId}/actions`, {
            action: 'provide_input',
            inputRequestId,
            inputContent: {
              'input-key-1': { action: 'accept', content: { decision: 'continue_observation' } },
            },
            messageText: 'Continue this non-weapon observation',
          });
          await eventually(() => {
            expect(provider.calls.filter((call) => call.method === 'tasks/update')).toHaveLength(1);
            return Promise.resolve();
          });
          expect(
            (
              await database.query(
                'SELECT status FROM task_input_request WHERE input_request_id=$1',
                [inputRequestId],
              )
            ).rows,
          ).toEqual([{ status: 'answered' }]);
          await eventually(async () => {
            const commands = rows(
              record(
                await jsonRequest(
                  required(runtime).management.baseUrl +
                    `/api/v1/tasks/${taskId}/business/commands`,
                ),
              )['items'],
            );
            expect(commands).toHaveLength(1);
            const intent = record(required(commands[0])['intent']);
            expect(
              record(
                await post(
                  `/api/v1/tasks/${taskId}/business/commands/${text(intent['intentId'])}/reconcile`,
                  {},
                ),
              )['state'],
            ).toBe('confirmed');
          });
        }
        await runtime.close();
        runtime = undefined;
        runtime = await start(false);
        provider.release();
        await eventually(async () => {
          const current = record(
            await jsonRequest(required(runtime).management.baseUrl + `/api/v1/tasks/${taskId}`),
          );
          expect(current, JSON.stringify(current)).toMatchObject({ phase: 'completed' });
        }, 40_000);
        expect(model.failures).toEqual([]);
        expect(model.calls).toContain('result_processing');
        expect(provider.calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
        expect(provider.calls.filter((call) => call.method === 'tasks/cancel')).toHaveLength(0);
        const finalResponse = await fetch(`${runtime.a2a.baseUrl}/a2a/v1/tasks/${taskId}`, {
          headers: { 'A2A-Version': '1.0' },
        });
        expect(finalResponse.status).toBe(200);
        const finalTask = record(await finalResponse.json());
        const artifacts = rows(finalTask['artifacts']);
        const businessArtifacts = artifacts.filter(
          (a) => a['name'] === 'task_business.projection' || a['name'] === 'task_business.command',
        );
        expect(businessArtifacts.length).toBeGreaterThan(0);
        const data = record(
          rows(
            required(businessArtifacts.find((a) => a['name'] === 'task_business.projection'))[
              'parts'
            ],
          )[0]?.['data'],
        );
        const refs = rows(data['contents']);
        const commandArtifacts = businessArtifacts.filter(
          (a) => a['name'] === 'task_business.command',
        );
        expect(commandArtifacts).toHaveLength(1);
        const commandRefs = commandArtifacts.map((a) =>
          record(record(rows(a['parts'])[0]?.['data'])['completeEvidenceRef']),
        );
        let recoveredTrajectory = false;
        const sourceArtifacts: unknown[] = [];
        for (const sourceRef of [record(data['completeEvidenceRef']), ...refs, ...commandRefs]) {
          const query = new URLSearchParams(
            Object.entries(sourceRef).map(([k, v]) => [k, String(v)]),
          );
          const response = await fetch(
            runtime.management.baseUrl +
              `/api/v1/tasks/${taskId}/business/source-artifact?${query.toString()}`,
          );
          expect(response.status).toBe(200);
          const bytes = Buffer.from(await response.arrayBuffer());
          expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(
            sourceRef['sha256'],
          );
          expect(bytes.length).toBe(sourceRef['byteSize']);
          const full = record(JSON.parse(bytes.toString('utf8')));
          sourceArtifacts.push({ sourceRef, envelope: full });
          if (full['recordType'] === 'task_business.command') {
            const command = record(full['command']);
            const intent = record(command['intent']);
            const confirmation = record(command['confirmationFact']);
            const dispatch = record(command['dispatchClaim']);
            expect(command['state']).toBe('confirmed');
            expect(intent).toMatchObject({ taskId, identity: provider.identity });
            expect(dispatch['confirmationId']).toBe(confirmation['confirmationId']);
            expect(confirmation['contentHash']).toBe(intent['contentHash']);
            expect(command['receipt']).toBeDefined();
            expect(command['evidence']).toBeDefined();
          }
          if (
            full['rawSha256'] ===
            `sha256:${createHash('sha256').update(provider.trajectoryBytes).digest('hex')}`
          ) {
            expect(
              Buffer.from(text(full['bytes']), 'base64').equals(provider.trajectoryBytes),
            ).toBe(true);
            recoveredTrajectory = true;
          }
          const foreign = await fetch(
            runtime.management.baseUrl +
              `/api/v1/tasks/${sharedStorage === undefined ? randomUUID() : foreignTaskId}/business/source-artifact?${query.toString()}`,
          );
          expect(foreign.status).toBe(404);
        }
        expect(recoveredTrajectory).toBe(true);
        const reportRoot = `reports/sdar-smpp-v13-upgrade/20261010-local/formal-${operation}-${id}`;
        await mkdir(reportRoot, { recursive: true });
        await writeFile(
          `${reportRoot}/evidence.json`,
          JSON.stringify(
            {
              taskId,
              storageMode: sharedStorage === undefined ? 'standalone' : 'gowm_shared_business',
              ...(sharedStorage === undefined
                ? {}
                : { deviceId, serviceKey, foreignTaskId, foreignDeviceId }),
              identity: provider.identity,
              modelBoundary: 'local_protocol_fixture',
              modelCalls: model.calls,
              wireCalls: provider.calls,
              artifacts: businessArtifacts,
              sourceArtifacts,
              site: 'NOT_RUN',
            },
            null,
            2,
          ) + '\n',
        );
        if (operation === 'vehicle_navigate') {
          // Reuse the same enabled Skill/version and catalog. Only the next
          // original Provider Task's factual outcome changes.
          const firstIdentity = structuredClone(provider.identity);
          provider.nextTask();
          const nextId = randomUUID();
          const nextTask = await submitA2ATestMessageAtUrl(runtime.a2a.baseUrl, {
            message: {
              messageId: nextId,
              role: 'ROLE_USER',
              parts: [
                {
                  text: `Execute ${operation} for original vehicle:ugv once with human confirmation`,
                },
                { data: arguments_, mediaType: 'application/json' },
              ],
              metadata: {
                ...(sharedStorage === undefined ? {} : { 'io.sdar/deviceId': deviceId }),
                idempotency_key: nextId,
                structured_input: arguments_,
                'io.sdar/requestedCapability': {
                  exposureId,
                  versionConstraint: '1',
                  requestId: nextId,
                },
              },
            },
            configuration: { returnImmediately: true },
          });
          await eventually(async () => {
            expect(
              record(
                await jsonRequest(
                  required(runtime).management.baseUrl + `/api/v1/tasks/${nextTask.id}`,
                ),
              )['phase'],
            ).toBe('awaiting_plan_confirmation');
          });
          expect(provider.calls.filter((c) => c.method === 'tools/call')).toHaveLength(1);
          await post(`/api/v1/tasks/${nextTask.id}/governed-control-confirmations`, {
            reason: 'Approve the second original Task under the same published Skill',
          });
          await post(`/api/v1/tasks/${nextTask.id}/actions`, {
            action: 'confirm_plan',
            messageText: 'Confirm the second original Task plan',
          });
          await eventually(async () => {
            const p = rows(
              record(
                await jsonRequest(
                  required(runtime).management.baseUrl + `/api/v1/tasks/${nextTask.id}/business`,
                ),
              )['items'],
            );
            expect(p).toHaveLength(1);
            expect(p[0]).toMatchObject({ status: 'current', identity: provider.identity });
          });
          const prepared = record(
            await post(`/api/v1/tasks/${nextTask.id}/business/navigation/prepare`, {
              idempotencyKey: nextId,
              waypoints: [{ longitude: 106.802, latitude: 29.7 }],
              density: 'normal',
            }),
          );
          const nextIntent = text(record(prepared['intent'])['intentId']);
          expect(
            record(
              await post(`/api/v1/tasks/${nextTask.id}/business/commands/${nextIntent}/confirm`, {
                reason: 'Approve the exact second-Task adjustment',
              }),
            )['state'],
          ).toBe('accepted');
          provider.applyAcceptedNavigation();
          await eventually(async () => {
            expect(
              record(
                await post(
                  `/api/v1/tasks/${nextTask.id}/business/commands/${nextIntent}/reconcile`,
                  {},
                ),
              )['state'],
            ).toBe('confirmed');
          });
          provider.release('failed');
          await eventually(async () => {
            expect(
              record(
                await jsonRequest(
                  required(runtime).management.baseUrl + `/api/v1/tasks/${nextTask.id}`,
                ),
              )['phase'],
            ).toBe('failed');
          }, 40_000);
          const finalNegative = await eventually(async () => {
            const p = rows(
              record(
                await jsonRequest(
                  required(runtime).management.baseUrl + `/api/v1/tasks/${nextTask.id}/business`,
                ),
              )['items'],
            );
            expect(p).toHaveLength(1);
            expect(p[0]).toMatchObject({
              identity: provider.identity,
              businessOutcome: {
                protocolStatus: 'completed',
                businessStatus: 'unknown',
                policySatisfied: false,
              },
            });
            return p[0];
          });
          const bindingRows = (
            await database.query<{
              agent_task_id: string;
              remote_task_id: string;
              protocol_status: string;
            }>(
              'SELECT agent_task_id,remote_task_id,protocol_status FROM remote_task_binding WHERE agent_task_id=ANY($1::text[]) ORDER BY agent_task_id',
              [[taskId, nextTask.id]],
            )
          ).rows;
          expect(bindingRows).toHaveLength(2);
          expect(bindingRows.every((b) => b.protocol_status === 'completed')).toBe(true);
          expect(new Set(bindingRows.map((b) => b.remote_task_id)).size).toBe(2);
          expect(
            (
              await database.query(
                'SELECT selected_skill_id,selected_skill_version FROM agent_task WHERE task_id=ANY($1::text[])',
                [[taskId, nextTask.id]],
              )
            ).rows,
          ).toEqual([
            { selected_skill_id: skillId, selected_skill_version: 1 },
            { selected_skill_id: skillId, selected_skill_version: 1 },
          ]);
          expect(model.failures).toEqual([]);
          expect(model.businessDecisions).toHaveLength(2);
          const outputs = model.businessDecisions.map((d) =>
            record(record(d.output)['structured']),
          );
          expect(record(required(outputs[0])['businessSemantics'])['missionTaskState']).toBe(
            'succeeded',
          );
          expect(record(required(outputs[1])['businessSemantics'])['missionTaskState']).toBe(
            'failed',
          );
          expect(outputs[0]).not.toEqual(outputs[1]);
          for (const [i, d] of model.businessDecisions.entries()) {
            const facts = rows(record(d.input)['untrustedTaskBusiness']);
            expect(facts).toHaveLength(1);
            expect(facts[0]).toMatchObject({
              identity: i === 0 ? firstIdentity : provider.identity,
              quality: {
                currentStateComplete: true,
                requiredObjectsResolved: true,
                historyContinuous: false,
              },
            });
            expect(
              rows(required(facts[0])['objects']).every((o) => o['artifactRef'] !== undefined),
            ).toBe(true);
          }
          expect(provider.calls.filter((c) => c.method === 'tools/call')).toHaveLength(2);
          expect(provider.calls.filter((c) => c.method === 'tasks/cancel')).toHaveLength(0);
          expect(
            record(await jsonRequest(runtime.management.baseUrl + `/api/v1/tasks/${taskId}`))[
              'phase'
            ],
          ).toBe('completed');
          await writeFile(
            `${reportRoot}/same-skill-negative.json`,
            JSON.stringify(
              {
                cases: ['AC-017', 'AC-031'],
                skillId,
                skillVersion: 1,
                taskIds: [taskId, nextTask.id],
                identities: [firstIdentity, provider.identity],
                nativeBindings: bindingRows,
                businessDecisions: model.businessDecisions,
                finalNegativeProjection: finalNegative,
                wireCalls: provider.calls,
                site: 'NOT_RUN',
              },
              null,
              2,
            ) + '\n',
          );
        }
      } catch (error: unknown) {
        caseFailure = error;
        if (database !== undefined) {
          try {
            const diagnostics = {
              task: (
                await database.query(
                  'SELECT task_id,phase,phase_message,error_code FROM agent_task',
                )
              ).rows,
              binding: (
                await database.query(
                  'SELECT binding_id,protocol_status,local_state,version,last_safe_error_code FROM remote_task_binding',
                )
              ).rows,
              controls: (
                await database.query('SELECT event_type,status FROM remote_task_control_event')
              ).rows,
              continuationSnapshots: (
                await database.query(
                  'SELECT workflow_instance_id,lifecycle,state_version FROM workflow_continuation_snapshot',
                )
              ).rows,
              continuationWaits: (
                await database.query(
                  'SELECT snapshot_id,binding_id FROM workflow_continuation_wait_binding',
                )
              ).rows,
              instances: (
                await database.query('SELECT instance_id,status,errors_json FROM workflow_instance')
              ).rows,
              inputs: (
                await database.query('SELECT input_request_id,status FROM remote_task_input_link')
              ).rows,
              observations: (
                await database.query(
                  "SELECT payload_json->>'recordType' AS record_type,count(*)::integer FROM remote_task_observation GROUP BY 1",
                )
              ).rows,
              commands: (
                await database.query(
                  "SELECT DISTINCT ON (payload_json->'command'->'intent'->>'intentId') payload_json->'command'->'intent'->>'intentId' AS intent_id,payload_json->'command'->>'state' AS state,payload_json->'command'->>'errorCode' AS error_code FROM remote_task_observation WHERE payload_json->>'recordType'='task_business.command' ORDER BY payload_json->'command'->'intent'->>'intentId',sequence DESC",
                )
              ).rows,
              calls: provider.calls.map((call) => call.method),
            };
            process.stderr.write(
              `${JSON.stringify({ event: 'formal_native_diagnostics', operation, diagnostics })}\n`,
            );
          } catch (diagnosticError: unknown) {
            process.stderr.write(
              `${JSON.stringify({ event: 'formal_native_diagnostics_failed', message: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) })}\n`,
            );
          }
        }
        throw error;
      } finally {
        if (model.failures.length > 0)
          process.stderr.write(
            `${JSON.stringify({ event: 'formal_model_fixture_failure', operation, failures: model.failures })}\n`,
          );
        const cleanupFailures: unknown[] = [];
        for (const cleanup of [
          () => runtime?.close(),
          () => database?.end(),
          () => directoryFixture?.end(),
          () => provider.close(),
          () => model.close(),
          () => (created ? dropIsolatedRuntimeDatabase(adminUrl, databaseName) : undefined),
        ]) {
          try {
            await cleanup();
          } catch (error: unknown) {
            cleanupFailures.push(error);
          }
        }
        if (oldAllow === undefined) delete process.env['ALLOW_REAL_UGV_SIDE_EFFECTS'];
        else process.env['ALLOW_REAL_UGV_SIDE_EFFECTS'] = oldAllow;
        if (oldRun === undefined) delete process.env['REAL_UGV_TEST_RUN_ID'];
        else process.env['REAL_UGV_TEST_RUN_ID'] = oldRun;
        if (cleanupFailures.length > 0) {
          if (caseFailure === undefined)
            cleanupFailure = new AggregateError(cleanupFailures, 'FORMAL_FIXTURE_CLEANUP_FAILED');
          process.stderr.write(
            `${JSON.stringify({ event: 'formal_cleanup_failure', operation, errors: cleanupFailures.map((e) => (e instanceof Error ? e.message : String(e))) })}\n`,
          );
        }
      }
      if (cleanupFailure !== undefined) throw cleanupFailure;
    }, 120_000);
  }
});

async function jsonRequest(
  url: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const content = await response.text();
  const raw: unknown = content === '' ? undefined : JSON.parse(content);
  if (!response.ok)
    throw new Error(
      `FORMAL_HTTP_FAILURE:${new URL(url).pathname}:${String(response.status)}:${JSON.stringify(raw)}`,
    );
  return raw;
}
async function eventually<T>(action: () => Promise<T>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  let failure: unknown;
  while (Date.now() < end) {
    try {
      return await action();
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw failure;
}
async function seedPublication(
  pool: Pool,
  input: Readonly<{
    a2aBaseUrl: string;
    capabilityId: string;
    exposureId: string;
    implementationBindingId: string;
    skillId: string;
    constraints: readonly unknown[];
    providerPolicyOverride: unknown;
    inputSchema: unknown;
  }>,
): Promise<void> {
  const evaluationInput = {
    definition: {
      status: 'published',
      successCriteria: [{ type: 'output_schema_valid', required: true }],
      requiredEvidence: [
        {
          type: 'required_evidence',
          evidenceType: 'business.observation',
          required: true,
          hardGate: true,
        },
      ],
      constraints: input.constraints,
    },
    maintenanceMode: false,
    killSwitch: false,
    implementations: [
      {
        bindingId: input.implementationBindingId,
        implementationType: 'skill',
        implementationId: input.skillId,
        implementationVersion: '1',
        role: 'primary',
        status: 'active',
        providerPolicyOverride: input.providerPolicyOverride,
      },
    ],
  };
  const card = {
    name: 'Isolated business',
    description: 'Local formal capability fixture',
    supportedInterfaces: [
      {
        url: `${input.a2aBaseUrl}/a2a`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [],
    signatures: [],
  };
  await pool.query(
    "UPDATE runtime_agent_card_revision SET status='superseded' WHERE status='active'",
  );
  const revision = z.coerce
    .number()
    .int()
    .positive()
    .parse(
      (
        await pool.query<{ revision: string }>(
          'SELECT COALESCE(MAX(revision),0)+1 AS revision FROM runtime_agent_card_revision',
        )
      ).rows[0]?.revision,
    );
  await pool.query(
    "INSERT INTO runtime_agent_card_revision(revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,card,generated_at,activated_at) VALUES($5,'isolated-business',$1::jsonb,$2,$3,'active',$4::jsonb,clock_timestamp(),clock_timestamp())",
    [
      JSON.stringify([`${input.exposureId}:1`]),
      canonicalHash(card),
      canonicalHash(evaluationInput),
      JSON.stringify(card),
      revision,
    ],
  );
  await pool.query(
    'INSERT INTO runtime_agent_card_exposure_snapshot(revision,exposure_id,exposure_version,capability_id,capability_version,agent_skill_id,request_schema,result_schema,requester_policy,exposure_hash) VALUES($6,$1,1,$2,1,$3,$4::jsonb,\'{"type":"object"}\'::jsonb,\'{"allowAnonymous":true,"allowedRequesterIds":[]}\'::jsonb,$5)',
    [
      input.exposureId,
      input.capabilityId,
      input.skillId,
      JSON.stringify(input.inputSchema),
      canonicalHash(input),
      revision,
    ],
  );
  await pool.query(
    "INSERT INTO capability_readiness_snapshot(capability_id,capability_version,snapshot_version,status,raw_status,evaluated_at,valid_until,catalog_hash,policy_hash,snapshot_hash,reasons,available_implementations,unavailable_implementations,evaluation_input,trigger_reason) VALUES($1,1,1,'available','available',clock_timestamp(),clock_timestamp()+interval '10 minutes',$2,$3,$4,'[]'::jsonb,$5::jsonb,'[]'::jsonb,$6::jsonb,'integration')",
    [
      input.capabilityId,
      `sha256:${canonicalHash(card)}`,
      `sha256:${canonicalHash(input.constraints)}`,
      `sha256:${canonicalHash(evaluationInput)}`,
      JSON.stringify([input.implementationBindingId]),
      JSON.stringify(evaluationInput),
    ],
  );
}

function isolatedGowmTestConfiguration() {
  const mode = process.env['SDAR_SMPP_TEST_STORAGE_MODE'];
  if (mode === undefined || mode === 'standalone') return undefined;
  if (
    mode !== 'gowm_shared_business' ||
    process.env['GOWM_BUSINESS_SMOKE_ENABLE'] !== 'true' ||
    process.env['SDAR_VERIFY_ISOLATED'] !== 'true'
  )
    throw new Error('OWNED_GOWM_SMPP_TEST_CONFIGURATION_REQUIRED');
  const validate = (variable: string, role: string) => {
    const url = new URL(text(process.env[variable]));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.username !== role ||
      !/^\/sdar_smpp_gowm_test_[a-f0-9]{16}$/u.test(url.pathname) ||
      url.search !== ''
    )
      throw new Error('OWNED_GOWM_SMPP_TEST_URL_REQUIRED');
    return url;
  };
  const admin = validate('GOWM_BUSINESS_TEST_DATABASE_URL', 'sdar');
  const consumer = validate('GOWM_BUSINESS_CONSUMER_TEST_DATABASE_URL', 'sdar_gowm_consumer_test');
  if (admin.host !== consumer.host || admin.pathname !== consumer.pathname)
    throw new Error('OWNED_GOWM_SMPP_TEST_IDENTITY_CONFLICT');
  return { adminUrl: admin.href, consumerUrl: consumer.href };
}

async function seedDeviceDirectory(
  pool: Pool,
  input: Readonly<{
    dataScopeKey: string;
    deviceIds: readonly string[];
    serverId: string;
    providerId: string;
    serviceKey: string;
  }>,
) {
  await pool.query(
    "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','Owned SMPP TaskBusiness formal fixture')",
    [input.dataScopeKey],
  );
  for (const deviceId of input.deviceIds) {
    await pool.query(
      "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
      [deviceId, input.dataScopeKey],
    );
    await pool.query(
      "INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type) VALUES($1,$2,$3,$1,'Synthetic TaskBusiness fixture','UGV')",
      [deviceId, input.dataScopeKey, input.serviceKey],
    );
    await pool.query(
      'INSERT INTO gowm_device.device_service_binding(binding_id,data_scope_key,device_id,smpp_service_key,provider_id,resource_id,sdar_service_key,sdar_mcp_server_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        randomUUID(),
        input.dataScopeKey,
        deviceId,
        `smpp:${input.serviceKey}`,
        input.providerId,
        deviceId === input.deviceIds[0] ? 'vehicle:ugv' : `vehicle:foreign:${deviceId}`,
        input.serviceKey,
        input.serverId,
      ],
    );
  }
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('FORMAL_REQUIRED_RECORD_MISSING');
  return value;
}
