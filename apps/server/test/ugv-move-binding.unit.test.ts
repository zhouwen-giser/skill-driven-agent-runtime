import { describe, expect, it, vi } from 'vitest';

import {
  McpRuntimeBindingAuthorityVerifier,
  type McpRegistryRepository,
  type McpServerRecord,
  type TaskAvailabilityBatchReader,
} from '../../../packages/application/src/index.js';
import {
  createSelectedTaskOperation,
  deriveFrozenMcpCatalogAuthority,
  frozenTaskReadinessAttributes,
  hashCanonicalEvidenceJson,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTaskExecutionProfile,
  type McpTaskOperationCandidate,
  type McpTool,
  type TaskAvailabilityCheckResult,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import type { CurrentMcpProviderBindingAuthoritySnapshot } from '../../../packages/runtime-control-application/src/index.js';
import {
  UgvMoveTaskBindingResolver,
  type UgvMoveReadinessRejectionDiagnostic,
} from '../src/ugv-move-binding.js';

import {
  InMemoryMutableSkillRepository,
  loadExactUgvProfileSkill,
} from './ugv-agent-profile-test-fixture.js';

const NOW = '2026-08-21T12:00:00.000Z';
const VALID_UNTIL = '2026-08-21T12:05:00.000Z';
const PACKAGE_CHECKSUM = '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c';
const MANIFEST_HASH = 'b'.repeat(64);
const REGISTRY_CHECKSUM = 'c'.repeat(64);

describe('UGV move governed Task binding', () => {
  it('resolves the profile-only alias to one authority-exact point-navigation operation', async () => {
    const runtimeFixture = await fixture();

    const resolved = await runtimeFixture.resolver.resolve(request());

    expect(runtimeFixture.listCandidates).toHaveBeenCalledTimes(1);
    expect(runtimeFixture.listCandidates).toHaveBeenCalledWith('vehicle_navigate');
    expect(runtimeFixture.availability).toHaveBeenCalledTimes(1);
    expect(runtimeFixture.availability).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'ugv-runtime-1',
        executionContext: { mode: 'simulation', simulationId: 'sim-uap-b02' },
        requests: [
          expect.objectContaining({
            nodeId: 'move-resource',
            operationName: 'vehicle_navigate',
            arguments: {
              unresolved: false,
              value: {
                resourceId: 'vehicle:ugv1',
                mission: {
                  type: 'point',
                  target: { longitude: 112, latitude: 28 },
                },
                stopOnObstacle: true,
              },
            },
          }),
        ],
      }),
    );
    expect(resolved.selected).toMatchObject({
      profileId: 'ugv-agent-profile',
      skill: {
        skillId: 'embodied.move_to',
        version: 1,
        packageChecksum: PACKAGE_CHECKSUM,
      },
      task: {
        semanticTaskType: 'embodied.move',
        operationAlias: 'vehicle_navigate',
        semanticBindingId: 'ugv-agent-profile/move-resource',
        skillBindingId: 'move-resource',
        bindingId: 'binding-ugv-runtime-1',
      },
      providerBinding: { bindingId: 'binding-ugv-runtime-1', revision: 7 },
      provider: {
        providerId: 'isr.vehicle.ugv.ugv1',
        providerType: 'isr.vehicle.ugv',
        providerVersion: '1.0.0',
        manifestHash: MANIFEST_HASH,
      },
      server: { serverId: 'ugv-runtime-1', protocolMode: 'frozen_v1' },
      resource: { resourceId: 'vehicle:ugv1', resourceType: 'vehicle' },
      operation: {
        operationName: 'vehicle_navigate',
        taskNotifications: true,
        taskExecutionProfile: {
          supportsCancellation: true,
          supportsPauseResume: true,
        },
      },
      finalStateRead: {
        operationName: 'vehicle_get_state',
        serverId: 'ugv-runtime-1',
        providerId: 'isr.vehicle.ugv.ugv1',
        resourceId: 'vehicle:ugv1',
        resolvedArguments: {
          resourceId: 'vehicle:ugv1',
          include: ['chassis', 'health'],
        },
        taskExecutionProfile: {
          taskBehavior: 'synchronous_only',
          availability: 'dynamic',
          supportsCancellation: false,
          supportsPauseResume: false,
          idempotency: 'server_managed',
        },
      },
      availability: {
        protocolRevision: 'smpp-task-execution/1.0',
        schemaRevision: 'smpp-availability/1.0',
        validUntil: VALID_UNTIL,
        disposition: 'ready',
        observedAvailability: 'available',
        policyDecision: 'provider_available',
        riskLevel: 'medium',
      },
      execution: {
        mode: 'simulation',
        simulationId: 'sim-uap-b02',
        confirmation: 'existing_outer_plan_confirmation',
        confirmationRequired: true,
      },
    });
    expect(resolved.selected.operation.inputSchemaHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(resolved.selected.operation.outputSchemaHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(resolved.selected.operation.outputSchema).toEqual(navigateOutputSchema());
    expect(resolved.selected.operation.outputSchemaHash).toBe(
      hashCanonicalEvidenceJson(navigateOutputSchema()),
    );
    expect(resolved.selected.finalStateRead.outputSchema).toEqual(stateOutputSchema());
    expect(resolved.selected.finalStateRead.outputSchemaHash).toBe(
      hashCanonicalEvidenceJson(stateOutputSchema()),
    );
    expect(resolved.selected.argumentsHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(resolved.selected.snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(resolved.selected.finalStateRead.catalogChecksum).toBe(
      resolved.selected.server.catalogChecksum,
    );

    const { snapshotHash, ...draft } = resolved.selected;
    expect(snapshotHash).toBe(hashCanonicalEvidenceJson(draft));
    expect(Object.isFrozen(resolved.selected)).toBe(true);
    expect(Object.isFrozen(resolved.selected.operation.taskExecutionProfile)).toBe(true);
    expect(Object.isFrozen(resolved.selected.finalStateRead.resolvedArguments)).toBe(true);
    const mutableArguments = resolved.selected.resolvedArguments as { resourceId: string };
    expect(() => {
      mutableArguments.resourceId = 'vehicle:forged';
    }).toThrow(TypeError);
    expect(resolved.selected.resolvedArguments['resourceId']).toBe('vehicle:ugv1');
    const tamperedRehydration = {
      ...resolved.selected,
      snapshotHash: `sha256:${'0'.repeat(64)}` as const,
    };
    expect(() => createSelectedTaskOperation(tamperedRehydration)).toThrow(
      expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }),
    );
    const lifecycleDriftDraft = {
      ...draft,
      operation: {
        ...draft.operation,
        taskExecutionProfile: {
          ...draft.operation.taskExecutionProfile,
          supportsPauseResume: false,
        },
      },
    };
    expect(hashCanonicalEvidenceJson(lifecycleDriftDraft)).not.toBe(resolved.selected.snapshotHash);
    expect(() => createSelectedTaskOperation(lifecycleDriftDraft)).toThrow(
      expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }),
    );
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        task: { ...draft.task, bindingId: 'caller-forged-binding' },
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        availability: { ...draft.availability, reservationMode: 'guaranteed' },
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        availability: { ...draft.availability, reservationRef: 'forged-reservation' },
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
    const forgedNavigationArguments = {
      resourceId: 'vehicle:ugv1',
      mission: { type: 'route', target: { longitude: 112, latitude: 28 } },
      stopOnObstacle: true,
    };
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        resolvedArguments: forgedNavigationArguments,
        argumentsHash: hashCanonicalEvidenceJson(forgedNavigationArguments),
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        operation: { ...draft.operation, inputSchema: { type: 'string' } },
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
    const reorderedFinalArguments = {
      resourceId: 'vehicle:ugv1',
      include: ['health', 'chassis'],
    };
    expect(() =>
      createSelectedTaskOperation({
        ...draft,
        finalStateRead: {
          ...draft.finalStateRead,
          resolvedArguments: reorderedFinalArguments,
          argumentsHash: hashCanonicalEvidenceJson(reorderedFinalArguments),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'SELECTED_TASK_OPERATION_INVALID' }));
  });

  it('resolves qualification authority through the production binding chain without Provider availability', async () => {
    const runtimeFixture = await fixture();

    await expect(runtimeFixture.resolver.resolveQualificationAuthority()).resolves.toEqual({
      serverId: 'ugv-runtime-1',
      providerBindingId: 'binding-ugv-runtime-1',
      providerId: 'isr.vehicle.ugv.ugv1',
    });
    expect(runtimeFixture.listCandidates).toHaveBeenCalledOnce();
    expect(runtimeFixture.listCandidates).toHaveBeenCalledWith('vehicle_navigate');
    expect(runtimeFixture.availability).not.toHaveBeenCalled();
  });

  it('selects one exact live candidate when Provider availability is unknown and preserves the decision', async () => {
    const item = await fixture({
      availability: 'unknown',
      mutateNavigate: (tool) => ({
        ...tool,
        executionSemantics: { ...tool.executionSemantics, replay: 'forbidden' },
      }),
    });

    const resolved = await item.resolver.resolve({
      ...request(),
      executionContext: { mode: 'live' },
    });

    expect(resolved.selected.availability).toEqual(
      expect.objectContaining({
        disposition: 'ready',
        observedAvailability: 'unknown',
        policyDecision: 'allowed_by_default',
        validUntil: VALID_UNTIL,
      }),
    );
    expect(item.listCandidates).toHaveBeenCalledOnce();
    expect(item.availability).toHaveBeenCalledOnce();
  });

  it('still rejects explicit unavailable and does not apply unknown-by-default outside live mode', async () => {
    const disabled = await fixture({
      availability: 'disabled',
      mutateNavigate: (tool) => ({
        ...tool,
        executionSemantics: { ...tool.executionSemantics, replay: 'forbidden' },
      }),
    });
    await expect(
      disabled.resolver.resolve({ ...request(), executionContext: { mode: 'live' } }),
    ).rejects.toMatchObject({ code: 'UGV_PROFILE_READINESS_NOT_ADMITTED' });

    const simulatedUnknown = await fixture({ availability: 'unknown' });
    await expect(simulatedUnknown.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });
  });

  it('rejects drifted Provider Binding authority on the qualification-only path', async () => {
    const runtimeFixture = await fixture({
      mutateBinding: (binding) => ({
        ...binding,
        binding: { ...binding.binding, providerId: 'isr.vehicle.ugv.other' },
      }),
    });

    await expect(runtimeFixture.resolver.resolveQualificationAuthority()).rejects.toMatchObject({
      code: 'UGV_PROFILE_BINDING_NOT_FOUND',
    });
    expect(runtimeFixture.availability).not.toHaveBeenCalled();
  });

  it('fails closed for zero and multiple exact candidates without changing generic matching', async () => {
    const none = await fixture({ serverIds: [] });
    await expect(none.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_BINDING_NOT_FOUND',
    });
    expect(none.listCandidates).toHaveBeenCalledWith('vehicle_navigate');
    expect(none.listCandidates).not.toHaveBeenCalledWith('embodied.move');

    const ambiguous = await fixture({ serverIds: ['ugv-runtime-1', 'ugv-runtime-2'] });
    await expect(ambiguous.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_BINDING_AMBIGUOUS',
    });
    expect(ambiguous.availability).not.toHaveBeenCalled();
  });

  it('rejects schema and lifecycle drift before availability or dispatch', async () => {
    const schemaDrift = await fixture({
      mutateNavigate: (tool) => ({
        ...tool,
        inputSchema: {
          ...(tool.inputSchema as Readonly<Record<string, unknown>>),
          properties: {
            ...(tool.inputSchema as { properties: Readonly<Record<string, unknown>> }).properties,
            resourceId: { const: 'vehicle:other' },
          },
        },
      }),
    });
    await expect(schemaDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(schemaDrift.availability).not.toHaveBeenCalled();

    const lifecycleDrift = await fixture({
      mutateNavigate: (tool) => ({
        ...tool,
        taskExecutionProfile: {
          ...required(tool.taskExecutionProfile),
          supportsPauseResume: false,
        },
      }),
    });
    await expect(lifecycleDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(lifecycleDrift.availability).not.toHaveBeenCalled();

    const readLifecycleDrift = await fixture({
      mutateGetState: (tool) => ({
        ...tool,
        taskExecutionProfile: {
          ...required(tool.taskExecutionProfile),
          supportsObservations: true,
        },
      }),
    });
    await expect(readLifecycleDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(readLifecycleDrift.availability).not.toHaveBeenCalled();

    const navigateOutputDrift = await fixture({
      mutateNavigate: (tool) => ({
        ...tool,
        outputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }),
    });
    await expect(navigateOutputDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(navigateOutputDrift.availability).not.toHaveBeenCalled();

    const stateOutputDrift = await fixture({
      mutateGetState: (tool) => ({
        ...tool,
        outputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }),
    });
    await expect(stateOutputDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(stateOutputDrift.availability).not.toHaveBeenCalled();
  });

  it('rejects Provider manifest lineage drift and expired readiness', async () => {
    const manifestDrift = await fixture({
      mutateBinding: (binding) => ({
        ...binding,
        binding: { ...binding.binding, catalogChecksum: 'd'.repeat(64) },
      }),
    });
    await expect(manifestDrift.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_BINDING_NOT_FOUND',
    });
    expect(manifestDrift.availability).not.toHaveBeenCalled();

    const expired = await fixture({ availabilityValidUntil: NOW });
    await expect(expired.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });

    const expiresDuringRead = await fixture({
      advanceClockDuringAvailabilityTo: '2026-08-21T12:05:00.001Z',
    });
    await expect(expiresDuringRead.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });

    const bindingExpiresDuringRead = await fixture({
      availabilityValidUntil: '2026-08-21T12:10:00.000Z',
      bindingAvailabilityValidUntil: VALID_UNTIL,
      advanceClockDuringAvailabilityTo: '2026-08-21T12:05:00.001Z',
    });
    await expect(bindingExpiresDuringRead.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });

    const restricted = await fixture({ availability: 'restricted' });
    await expect(restricted.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });
  });

  it('reports precise readiness rejection checks for an available result without a TTL', async () => {
    const reportReadinessRejection = vi.fn();
    const item = await fixture({
      reportReadinessRejection,
      mutateAvailabilityResult: (result) => ({ ...result, validUntil: undefined }),
    });

    await expect(item.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
      message: 'Exact UGV navigation readiness is unavailable, stale, or uncorrelated.',
    });

    expect(reportReadinessRejection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'ugv_profile.navigation_readiness_rejected',
        providerBindingId: 'binding-ugv-runtime-1',
        providerBindingRevision: 7,
        providerId: 'isr.vehicle.ugv.ugv1',
        runtimeServerId: 'ugv-runtime-1',
        selectedAt: NOW,
        readinessCheckedAt: NOW,
        bindingValidUntil: VALID_UNTIL,
        rejectedChecks: {
          bindingCountNotOne: false,
          selectedProviderMismatch: false,
          selectedOperationMismatch: false,
          dispositionNotReady: false,
          operationNotAvailable: false,
          resultValidUntilMissing: true,
          resultExpiredAtSelection: false,
          bindingExpiredAtSelection: false,
        },
        failedChecks: ['resultValidUntilMissing'],
        request: {
          serverId: 'ugv-runtime-1',
          nodeId: 'move-resource',
          operationName: 'vehicle_navigate',
        },
        result: expect.objectContaining({
          nodeId: 'move-resource',
          operationName: 'vehicle_navigate',
          nodeIdMatchesRequest: true,
          operationMatchesRequest: true,
          availability: 'available',
          validUntil: null,
        }),
        readiness: expect.objectContaining({
          selectedProviderId: 'ugv-runtime-1',
          selectedOperationName: 'vehicle_navigate',
          disposition: 'ready',
          reasonCodes: [],
        }),
      }),
    );
    expect(item.availability).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'operation expiry during the read',
      options: { advanceClockDuringAvailabilityTo: '2026-08-21T12:05:00.001Z' },
      failedCheck: 'resultExpiredAtSelection',
      reasonCode: 'MCP_TASK_AVAILABILITY_EXPIRED',
      nodeIdMatchesRequest: true,
    },
    {
      label: 'result node correlation',
      options: {
        mutateAvailabilityResult: (result: TaskAvailabilityCheckResult) => ({
          ...result,
          nodeId: 'different-node',
        }),
      },
      failedCheck: 'dispositionNotReady',
      reasonCode: 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID',
      nodeIdMatchesRequest: false,
    },
  ])(
    'reports original readiness rejection evidence for $label',
    async ({ options, failedCheck, reasonCode, nodeIdMatchesRequest }) => {
      const reportReadinessRejection = vi.fn();
      const item = await fixture({ ...options, reportReadinessRejection });

      await expect(item.resolver.resolve(request())).rejects.toMatchObject({
        code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
      });

      expect(reportReadinessRejection).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          selectedAt:
            'advanceClockDuringAvailabilityTo' in options
              ? options.advanceClockDuringAvailabilityTo
              : NOW,
          readinessCheckedAt:
            'advanceClockDuringAvailabilityTo' in options
              ? options.advanceClockDuringAvailabilityTo
              : NOW,
          failedChecks: expect.arrayContaining([failedCheck]),
          result: expect.objectContaining({
            availability: 'available',
            validUntil: VALID_UNTIL,
            nodeIdMatchesRequest,
          }),
          readiness: expect.objectContaining({
            candidates: [
              expect.objectContaining({ disposition: 'unknown', reasonCodes: [reasonCode] }),
            ],
          }),
        }),
      );
    },
  );

  it('excludes unknown fields and free-text secrets from readiness rejection diagnostics', async () => {
    const reportReadinessRejection =
      vi.fn<(diagnostic: UgvMoveReadinessRejectionDiagnostic) => void>();
    const secret = 'Bearer TOP_SECRET\nhttps://user:password@private.invalid/token';
    const item = await fixture({
      reportReadinessRejection,
      mutateAvailabilityResult: (result) => ({
        ...result,
        availability: 'disabled',
        reasonCode: secret,
        description: secret,
        reservationRef: secret,
        headers: { authorization: secret },
        unknownSecret: secret,
      }),
    });

    await expect(item.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
    });

    const diagnostic = required(reportReadinessRejection.mock.calls[0]?.[0]);
    expect(diagnostic.result).toMatchObject({
      availability: 'disabled',
      reasonCodes: ['REDACTED_REASON_CODE'],
    });
    expect(diagnostic.readiness.candidates[0]?.reasonCodes).toEqual(['REDACTED_REASON_CODE']);
    const serialized = JSON.stringify(diagnostic);
    for (const forbidden of [
      'TOP_SECRET',
      'Bearer',
      'https://',
      'password',
      'headers',
      'description',
      'unknownSecret',
      'arguments',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each(['throw', 'reject'] as const)(
    'preserves the original readiness rejection when the diagnostic logger fails with %s',
    async (failure) => {
      const reportReadinessRejection = vi.fn(() => {
        const error = new Error('SECRET_LOGGER_FAILURE');
        if (failure === 'throw') throw error;
        return Promise.reject(error);
      });
      const item = await fixture({ availabilityValidUntil: NOW, reportReadinessRejection });

      await expect(item.resolver.resolve(request())).rejects.toMatchObject({
        name: 'UgvMoveBindingError',
        code: 'UGV_PROFILE_READINESS_NOT_ADMITTED',
        message: 'Exact UGV navigation readiness is unavailable, stale, or uncorrelated.',
      });
      expect(reportReadinessRejection).toHaveBeenCalledTimes(1);
    },
  );

  it('does not report readiness rejection diagnostics for admitted navigation', async () => {
    const reportReadinessRejection = vi.fn();
    const item = await fixture({ reportReadinessRejection });

    await item.resolver.resolve(request());

    expect(reportReadinessRejection).not.toHaveBeenCalled();
    expect(item.availability).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'direct success Schema',
      mutateNavigate: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: navigateSuccessOutputSchema(),
      }),
    },
    {
      label: 'ambiguous duplicate business-result branches',
      mutateNavigate: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: providerOutputSchema(businessResultSchema()),
      }),
    },
    {
      label: 'weakened business-result authority',
      mutateNavigate: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: {
          type: 'object',
          anyOf: [
            navigateSuccessOutputSchema(),
            { ...businessResultSchema(), additionalProperties: false },
          ],
        },
      }),
    },
    {
      label: 'success branch drift',
      mutateGetState: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: providerOutputSchema({
          ...stateSuccessOutputSchema(),
          required: ['identity'],
        }),
      }),
    },
    {
      label: 'missing nested position-authority observedAt',
      mutateNavigate: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: providerOutputSchema(navigateSuccessOutputSchema(null)),
      }),
    },
    {
      label: 'non-string nested position-authority observedAt',
      mutateNavigate: (tool: McpTool): McpTool => ({
        ...tool,
        outputSchema: providerOutputSchema(navigateSuccessOutputSchema({ type: 'number' })),
      }),
    },
  ])('rejects formal Provider output wrapper drift: $label', async (options) => {
    const item = await fixture(options);

    await expect(item.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SCHEMA_DRIFT',
    });
    expect(item.availability).not.toHaveBeenCalled();
  });

  it('resolves a live execution context only against replay-forbidden Provider semantics', async () => {
    const item = await fixture({
      mutateNavigate: (tool) => ({
        ...tool,
        executionSemantics: { ...tool.executionSemantics, replay: 'forbidden' },
      }),
    });
    await expect(
      item.resolver.resolve({ ...request(), executionContext: { mode: 'live' } }),
    ).resolves.toMatchObject({
      selected: {
        execution: {
          mode: 'live',
          confirmation: 'existing_outer_plan_confirmation',
          confirmationRequired: true,
        },
        operation: { executionSemantics: { replay: 'forbidden' } },
      },
    });
    expect(item.listCandidates).toHaveBeenCalledOnce();
    expect(item.availability).toHaveBeenCalledWith(
      expect.objectContaining({ executionContext: { mode: 'live' } }),
    );
  });

  it.each([
    {
      label: 'forbidden Provider policy',
      mutate: (
        skill: Awaited<ReturnType<typeof loadExactUgvProfileSkill>>,
      ): Awaited<ReturnType<typeof loadExactUgvProfileSkill>> => ({
        ...skill,
        usageSpecification: {
          ...required(skill.usageSpecification),
          taskBindings: [
            {
              ...required(required(skill.usageSpecification).taskBindings[0]),
              providerPolicy: {
                ...required(required(skill.usageSpecification).taskBindings[0]).providerPolicy,
                forbiddenProviderIds: ['ugv-runtime-1'],
              },
            },
          ],
        },
      }),
    },
    {
      label: 'extra required Provider attribute',
      mutate: (
        skill: Awaited<ReturnType<typeof loadExactUgvProfileSkill>>,
      ): Awaited<ReturnType<typeof loadExactUgvProfileSkill>> => ({
        ...skill,
        usageSpecification: {
          ...required(skill.usageSpecification),
          taskBindings: [
            {
              ...required(required(skill.usageSpecification).taskBindings[0]),
              providerPolicy: {
                ...required(required(skill.usageSpecification).taskBindings[0]).providerPolicy,
                requiredAttributes: ['observations', 'task_notifications', 'unfrozen-extra'],
              },
            },
          ],
        },
      }),
    },
    {
      label: 'final-position hard gate drift',
      mutate: (
        skill: Awaited<ReturnType<typeof loadExactUgvProfileSkill>>,
      ): Awaited<ReturnType<typeof loadExactUgvProfileSkill>> => ({
        ...skill,
        usageSpecification: {
          ...required(skill.usageSpecification),
          evidencePolicy: {
            ...required(skill.usageSpecification).evidencePolicy,
            requirements: [
              {
                ...required(required(skill.usageSpecification).evidencePolicy.requirements[0]),
                hardGate: false,
              },
            ],
          },
        },
      }),
    },
  ])('rejects persisted Skill authority with $label before catalog reads', async ({ mutate }) => {
    const item = await fixture({ mutateSkill: mutate });

    await expect(item.resolver.resolve(request())).rejects.toMatchObject({
      code: 'UGV_PROFILE_SKILL_NOT_CURRENT',
    });
    expect(item.listCandidates).not.toHaveBeenCalled();
    expect(item.availability).not.toHaveBeenCalled();
  });
});

interface FixtureOptions {
  readonly serverIds?: readonly string[];
  readonly availabilityValidUntil?: string;
  readonly bindingAvailabilityValidUntil?: string;
  readonly advanceClockDuringAvailabilityTo?: string;
  readonly availability?: 'available' | 'restricted' | 'disabled' | 'unknown';
  readonly reportReadinessRejection?: (
    diagnostic: UgvMoveReadinessRejectionDiagnostic,
  ) => void | Promise<void>;
  readonly mutateAvailabilityResult?: (
    result: TaskAvailabilityCheckResult,
  ) => TaskAvailabilityCheckResult;
  readonly mutateNavigate?: (tool: McpTool) => McpTool;
  readonly mutateGetState?: (tool: McpTool) => McpTool;
  readonly mutateBinding?: (
    binding: CurrentMcpProviderBindingAuthoritySnapshot,
  ) => CurrentMcpProviderBindingAuthoritySnapshot;
  readonly mutateSkill?: (
    skill: Awaited<ReturnType<typeof loadExactUgvProfileSkill>>,
  ) => Awaited<ReturnType<typeof loadExactUgvProfileSkill>>;
}

async function fixture(options: FixtureOptions = {}) {
  let currentTime = NOW;
  const serverIds = options.serverIds ?? ['ugv-runtime-1'];
  const runtimes = new Map(
    serverIds.map((serverId) => runtime(serverId, options.mutateNavigate, options.mutateGetState)),
  );
  const bindings = new Map(
    [...runtimes.entries()].map(([serverId, value]) => {
      const binding = providerBinding(value.record.server, value.catalogAuthority);
      const withExpiry =
        options.bindingAvailabilityValidUntil === undefined
          ? binding
          : {
              ...binding,
              binding: {
                ...binding.binding,
                availabilityValidUntil: options.bindingAvailabilityValidUntil,
              },
            };
      return [serverId, options.mutateBinding?.(withExpiry) ?? withExpiry] as const;
    }),
  );
  const repository = new RuntimeRepository(runtimes);
  const runtimeBindings = new McpRuntimeBindingAuthorityVerifier({
    repository: repository as unknown as McpRegistryRepository,
    clock: { now: () => currentTime },
  });
  const listCandidates = vi.fn((taskType: string) =>
    Promise.resolve(
      taskType === 'vehicle_navigate'
        ? Object.freeze(
            [...runtimes.entries()].map(([serverId, value]) =>
              taskCandidate(serverId, required(value.tools[0])),
            ),
          )
        : Object.freeze([]),
    ),
  );
  const availability = vi.fn<
    Parameters<TaskAvailabilityBatchReader['checkTaskAvailability']>[0] extends never
      ? never
      : TaskAvailabilityBatchReader['checkTaskAvailability']
  >((input) => {
    currentTime = options.advanceClockDuringAvailabilityTo ?? currentTime;
    return Promise.resolve({
      kind: 'results' as const,
      protocolRevision: 'smpp-task-execution/1.0',
      availabilitySchemaRevision: 'smpp-availability/1.0',
      results: Object.freeze([
        mutateAvailabilityResult(
          {
            nodeId: required(input.requests[0]).nodeId,
            operationName: 'vehicle_navigate',
            availability: options.availability ?? ('available' as const),
            riskLevel: 'medium' as const,
            validUntil: options.availabilityValidUntil ?? VALID_UNTIL,
            ...(options.availability === 'restricted'
              ? { earliestStartTime: '2026-08-21T12:00:30.000Z' }
              : {}),
            nextAvailableWindows: Object.freeze([]),
            reservationMode: 'none' as const,
            possibleEffects: Object.freeze(['task_pause' as const]),
          },
          options,
        ),
      ]),
    });
  });
  const loadedSkill = await loadExactUgvProfileSkill();
  const skill = options.mutateSkill?.(loadedSkill) ?? loadedSkill;
  const resolver = new UgvMoveTaskBindingResolver({
    skills: new InMemoryMutableSkillRepository([skill]),
    packages: {
      loadExactSkillPackageAuthority: () =>
        Promise.resolve({
          skillId: 'embodied.move_to',
          skillVersion: 1,
          packageChecksum: PACKAGE_CHECKSUM,
          validatedAt: '2026-08-21T01:50:00.000Z',
          importedAt: '2026-08-21T01:51:00.000Z',
        }),
    },
    operations: { listTaskOperationCandidates: listCandidates },
    availability: { checkTaskAvailability: availability },
    providerBindings: {
      loadCurrentMcpProviderBinding: ({ localServerId }) => {
        const binding = bindings.get(localServerId);
        return binding === undefined
          ? Promise.reject(new Error('TEST_BINDING_NOT_FOUND'))
          : Promise.resolve(binding);
      },
    },
    runtimeBindings,
    schemas: new AjvJsonSchemaValidator(),
    clock: { now: () => currentTime },
    ...(options.reportReadinessRejection === undefined
      ? {}
      : { reportReadinessRejection: options.reportReadinessRejection }),
  });
  return { resolver, listCandidates, availability };
}

function mutateAvailabilityResult(result: TaskAvailabilityCheckResult, options: FixtureOptions) {
  return options.mutateAvailabilityResult?.(result) ?? result;
}

function runtime(
  serverId: string,
  mutateNavigate?: (tool: McpTool) => McpTool,
  mutateGetState?: (tool: McpTool) => McpTool,
) {
  const snapshot: McpProtocolDiscoverySnapshot = {
    snapshotId: `snapshot-${serverId}`,
    serverId,
    protocolMode: 'frozen_v1',
    protocolVersion: '2025-03-26',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: Object.freeze(['2025-03-26']),
    capabilities: Object.freeze({
      extensions: Object.freeze({
        'io.sdar/providerCatalog': Object.freeze({
          providerId: 'isr.vehicle.ugv.ugv1',
          providerType: 'isr.vehicle.ugv',
          providerVersion: '1.0.0',
          manifestHash: MANIFEST_HASH,
        }),
      }),
    }),
    serverInfo: Object.freeze({ name: 'ugv-smpp', version: '1.0.0' }),
    providerCatalog: Object.freeze({
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: MANIFEST_HASH,
    }),
    taskNotifications: true,
    discoveredAt: NOW,
    validUntil: VALID_UNTIL,
    toolRevision: 9,
  };
  const navigate = mutateNavigate?.(navigateTool(serverId)) ?? navigateTool(serverId);
  const getState = mutateGetState?.(stateTool(serverId)) ?? stateTool(serverId);
  const tools = Object.freeze([navigate, getState]);
  const catalogAuthority = deriveFrozenMcpCatalogAuthority(snapshot, tools, 9);
  const server: McpServer = {
    serverId,
    name: 'UGV SMPP',
    endpoint: `https://${serverId}.example.test/mcp`,
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 9,
    protocolMode: 'frozen_v1',
    currentProtocolSnapshotId: snapshot.snapshotId,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return [
    serverId,
    Object.freeze({
      record: { server, encryptedCredential: '' },
      snapshot,
      tools,
      catalogAuthority,
    }),
  ] as const;
}

function providerBinding(
  server: McpServer,
  catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>,
): CurrentMcpProviderBindingAuthoritySnapshot {
  return {
    observedAt: NOW,
    binding: {
      bindingId: `binding-${server.serverId}`,
      revision: 7,
      localServerId: server.serverId,
      originType: 'smpp_registry',
      providerId: 'isr.vehicle.ugv.ugv1',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'ugv-provider-server',
      registryRevision: 11,
      registryChecksum: REGISTRY_CHECKSUM,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      endpointRef: server.endpoint,
      availabilityStatus: 'available' as const,
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: catalog.operationCount,
    },
    sourceCandidateLineage: {
      smppSourceId: 'smpp-source-1',
      externalProviderId: 'isr.vehicle.ugv.ugv1',
      externalServerId: 'ugv-provider-server',
      registryRevision: 11,
      registryChecksum: REGISTRY_CHECKSUM,
      nativeRevision: 3,
      nativeChecksum: 'd'.repeat(64),
      projectionContract: 'sdar-registry-v1',
      candidateEndpoint: server.endpoint,
    },
  };
}

function taskCandidate(serverId: string, tool: McpTool): McpTaskOperationCandidate {
  const profile = required(tool.taskExecutionProfile);
  return Object.freeze({
    providerId: serverId,
    operationName: 'vehicle_navigate',
    attributes: frozenTaskReadinessAttributes(profile, true),
    protocolMode: 'frozen_v1',
    taskExecutionProfile: profile,
    taskNotifications: true,
  });
}

function navigateTool(serverId: string): McpTool {
  const profile: McpTaskExecutionProfile = {
    profileVersion: '1.0',
    taskBehavior: 'task_required',
    availability: 'dynamic',
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsCancellation: true,
    supportsPauseResume: true,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: 'server_managed',
  };
  const semantics = {
    effect: 'side_effecting' as const,
    execution: 'task_required' as const,
    cancellation: 'task_cancel' as const,
    idempotency: 'server_managed' as const,
    replay: 'simulation_only' as const,
    source: 'mcp_declared' as const,
  };
  return Object.freeze({
    serverId,
    toolName: 'vehicle_navigate',
    inputSchema: navigateInputSchema(),
    outputSchema: navigateOutputSchema(),
    protocolMode: 'frozen_v1',
    executionSemantics: semantics,
    declaredExecutionSemantics: semantics,
    taskExecutionProfile: profile,
    discoveredAt: NOW,
  });
}

function navigateInputSchema() {
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

function navigateOutputSchema() {
  return providerOutputSchema(navigateSuccessOutputSchema());
}

function navigateSuccessOutputSchema(
  nestedObservedAtSchema: Readonly<Record<string, unknown>> | null = { type: 'string' },
) {
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
          ...(nestedObservedAtSchema === null ? {} : { observedAt: nestedObservedAtSchema }),
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

function stateTool(serverId: string): McpTool {
  const profile: McpTaskExecutionProfile = {
    profileVersion: '1.0',
    taskBehavior: 'synchronous_only',
    availability: 'dynamic',
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsCancellation: false,
    supportsPauseResume: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: 'server_managed',
  };
  const semantics = {
    effect: 'read_only' as const,
    execution: 'synchronous' as const,
    cancellation: 'unsupported' as const,
    idempotency: 'server_managed' as const,
    replay: 'allowed' as const,
    source: 'mcp_declared' as const,
  };
  return Object.freeze({
    serverId,
    toolName: 'vehicle_get_state',
    inputSchema: {
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
    },
    outputSchema: stateOutputSchema(),
    protocolMode: 'frozen_v1',
    executionSemantics: semantics,
    declaredExecutionSemantics: semantics,
    taskExecutionProfile: profile,
    discoveredAt: NOW,
  });
}

function stateOutputSchema() {
  return providerOutputSchema(stateSuccessOutputSchema());
}

function stateSuccessOutputSchema() {
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
        properties: {
          chassisObservedAt: { type: 'string', format: 'date-time' },
        },
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

function providerOutputSchema(success: Readonly<Record<string, unknown>>) {
  return {
    type: 'object',
    anyOf: [success, businessResultSchema()],
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

class RuntimeRepository {
  constructor(
    private readonly runtimes: ReadonlyMap<
      string,
      Readonly<{
        record: McpServerRecord;
        snapshot: McpProtocolDiscoverySnapshot;
        tools: readonly McpTool[];
      }>
    >,
  ) {}

  findServer(serverId: string): Promise<McpServerRecord | undefined> {
    return Promise.resolve(this.runtimes.get(serverId)?.record);
  }

  listServers(): Promise<readonly McpServer[]> {
    return Promise.resolve([...this.runtimes.values()].map((value) => value.record.server));
  }

  listTools(serverId: string): Promise<readonly McpTool[]> {
    return Promise.resolve(this.runtimes.get(serverId)?.tools ?? []);
  }

  findCurrentProtocolSnapshot(serverId: string): Promise<McpProtocolDiscoverySnapshot | undefined> {
    return Promise.resolve(this.runtimes.get(serverId)?.snapshot);
  }

  saveServerAndReplaceTools(): Promise<void> {
    return Promise.reject(new Error('TEST_READ_ONLY'));
  }

  deleteServer(): Promise<void> {
    return Promise.reject(new Error('TEST_READ_ONLY'));
  }

  saveInvocation(): Promise<void> {
    return Promise.reject(new Error('TEST_READ_ONLY'));
  }
}

function request() {
  return {
    skillInput: {
      resourceId: 'vehicle:ugv1',
      target: { x: 112, y: 28, frame: 'EPSG:4326' },
    },
    executionContext: { mode: 'simulation' as const, simulationId: 'sim-uap-b02' },
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('TEST_FIXTURE_VALUE_REQUIRED');
  return value;
}
