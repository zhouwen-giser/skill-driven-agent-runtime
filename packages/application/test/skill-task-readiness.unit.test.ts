import { describe, expect, it } from 'vitest';

import type {
  McpTaskOperationCandidate,
  SkillProviderPolicy,
  SkillTaskBinding,
  TaskAvailabilityCheckResult,
  TaskAvailabilityReadResult,
} from '../../domain/src/index.js';
import { V11SkillTaskReadinessAdapter } from '../src/index.js';
import type {
  SkillTaskOperationCandidateCatalog,
  TaskAvailabilityBatchReader,
} from '../src/ports.js';

const now = '2026-07-17T12:00:00.000Z';

describe('V11SkillTaskReadinessAdapter', () => {
  it('maps available and restricted candidates with earliest and multiple windows', async () => {
    const adapter = readiness(
      [candidate('provider.available'), candidate('provider.restricted')],
      new Map([
        ['provider.available', result('available', { reservationMode: 'none' })],
        [
          'provider.restricted',
          result('restricted', {
            riskLevel: 'high',
            validUntil: '2026-07-17T13:00:00.000Z',
            earliestStartTime: '2026-07-17T12:10:00.000Z',
            nextAvailableWindows: [
              { startTime: '2026-07-17T12:10:00.000Z', endTime: '2026-07-17T12:20:00.000Z' },
              { startTime: '2026-07-17T12:30:00.000Z', endTime: '2026-07-17T12:40:00.000Z' },
            ],
            reservationMode: 'best_effort',
          }),
        ],
      ]),
    );
    await expect(adapter.inspect(inspectInput(binding(dynamicPolicy())))).resolves.toMatchObject({
      overall: 'ready',
      bindings: [
        {
          selectedProviderId: 'provider.available',
          candidates: expect.arrayContaining([
            expect.objectContaining({
              providerId: 'provider.restricted',
              disposition: 'restricted',
              earliestStartTime: '2026-07-17T12:10:00.000Z',
              nextAvailableWindows: expect.arrayContaining([
                expect.objectContaining({ startTime: '2026-07-17T12:30:00.000Z' }),
              ]),
            }),
          ]),
        },
      ],
    });
  });

  it('maps disabled and Provider uncertainty without promoting either to available', async () => {
    const disabled = readiness(
      [candidate('provider.disabled')],
      new Map([['provider.disabled', result('disabled')]]),
    );
    await expect(disabled.inspect(inspectInput(binding(dynamicPolicy())))).resolves.toMatchObject({
      overall: 'unavailable',
    });
    const unknown = readiness(
      [candidate('provider.unknown')],
      new Map([
        [
          'provider.unknown',
          { kind: 'provider_unreachable', errorCode: 'PROVIDER_UNREACHABLE' } as const,
        ],
      ]),
    );
    await expect(unknown.inspect(inspectInput(binding(dynamicPolicy())))).resolves.toMatchObject({
      overall: 'unknown',
      bindings: [{ confirmationRequired: true }],
    });
  });

  it('hard-blocks required/forbidden/attribute-ineligible Providers', async () => {
    const candidates = [candidate('provider.one'), candidate('provider.two')];
    const outcomes = new Map([
      ['provider.one', result('available')],
      ['provider.two', result('available')],
    ]);
    await expect(
      readiness(candidates, outcomes).inspect(
        inspectInput(
          binding({
            selection: 'required',
            preferredProviderIds: [],
            requiredProviderId: 'provider.missing',
            forbiddenProviderIds: [],
            requiredAttributes: [],
          }),
        ),
      ),
    ).resolves.toMatchObject({
      overall: 'unavailable',
      bindings: [{ reasonCodes: ['SKILL_TASK_REQUIRED_PROVIDER_UNAVAILABLE'] }],
    });
    await expect(
      readiness(
        [candidate('provider.required')],
        new Map([['provider.required', result('disabled')]]),
      ).inspect(
        inspectInput(
          binding({
            selection: 'required',
            preferredProviderIds: [],
            requiredProviderId: 'provider.required',
            forbiddenProviderIds: [],
            requiredAttributes: [],
          }),
        ),
      ),
    ).resolves.toMatchObject({
      overall: 'unavailable',
      bindings: [
        {
          candidates: [
            expect.objectContaining({
              providerId: 'provider.required',
              disposition: 'unavailable',
            }),
          ],
        },
      ],
    });
    await expect(
      readiness(candidates, outcomes).inspect(
        inspectInput(
          binding({ ...dynamicPolicy(), forbiddenProviderIds: ['provider.one', 'provider.two'] }),
        ),
      ),
    ).resolves.toMatchObject({ overall: 'unavailable' });
    await expect(
      readiness(candidates, outcomes).inspect(
        inspectInput(binding({ ...dynamicPolicy(), requiredAttributes: ['certification:safety'] })),
      ),
    ).resolves.toMatchObject({
      bindings: [{ reasonCodes: ['SKILL_TASK_PROVIDER_ATTRIBUTES_UNSATISFIED'] }],
    });
  });

  it('uses non-preferred fallback only when the Skill permits it', async () => {
    const candidates = [candidate('provider.preferred'), candidate('provider.fallback')];
    const outcomes = new Map([
      ['provider.preferred', result('disabled')],
      ['provider.fallback', result('available')],
    ]);
    const policy: SkillProviderPolicy = {
      selection: 'preferred',
      preferredProviderIds: ['provider.preferred'],
      forbiddenProviderIds: [],
      requiredAttributes: [],
    };
    await expect(
      readiness(candidates, outcomes).inspect(inspectInput(binding(policy), false)),
    ).resolves.toMatchObject({ overall: 'unavailable' });
    await expect(
      readiness(candidates, outcomes).inspect(inspectInput(binding(policy), true)),
    ).resolves.toMatchObject({
      overall: 'ready',
      bindings: [{ selectedProviderId: 'provider.fallback' }],
    });
  });

  it('fails stale validUntil and inconsistent guaranteed reservations closed', async () => {
    const stale = readiness(
      [candidate('provider.stale')],
      new Map([
        ['provider.stale', result('available', { validUntil: '2026-07-17T11:59:59.000Z' })],
      ]),
    );
    await expect(stale.inspect(inspectInput(binding(dynamicPolicy())))).resolves.toMatchObject({
      overall: 'unknown',
      bindings: [
        {
          candidates: [expect.objectContaining({ reasonCodes: ['MCP_TASK_AVAILABILITY_EXPIRED'] })],
        },
      ],
    });
    const reservation = readiness(
      [candidate('provider.reservation')],
      new Map([['provider.reservation', result('available', { reservationMode: 'guaranteed' })]]),
    );
    await expect(
      reservation.inspect(inspectInput(binding(dynamicPolicy()))),
    ).resolves.toMatchObject({
      overall: 'unknown',
      bindings: [
        {
          candidates: [
            expect.objectContaining({
              reasonCodes: ['MCP_TASK_AVAILABILITY_RESERVATION_INVALID'],
            }),
          ],
        },
      ],
    });
  });
});

function readiness(
  candidates: readonly McpTaskOperationCandidate[],
  outcomes: ReadonlyMap<string, TaskAvailabilityReadResult>,
) {
  const operations: SkillTaskOperationCandidateCatalog = {
    listTaskOperationCandidates: () => Promise.resolve(candidates),
  };
  const availability: TaskAvailabilityBatchReader = {
    checkTaskAvailability: (input) =>
      Promise.resolve(
        outcomes.get(input.serverId) ?? {
          kind: 'provider_unreachable',
          errorCode: 'PROVIDER_UNREACHABLE',
        },
      ),
  };
  return new V11SkillTaskReadinessAdapter({
    operations,
    availability,
    clock: { now: () => now },
  });
}

function candidate(providerId: string): McpTaskOperationCandidate {
  return {
    providerId,
    operationName: 'embodied.move',
    attributes: ['availability:dynamic', 'mcp_task', 'scheduling'],
    semantics: {
      execution: 'task_required',
      availability: 'dynamic',
      supportsScheduling: true,
      supportsMaxElapsed: false,
      supportsObservations: false,
      cancellation: 'cooperative',
      revision: '1.0',
    },
  };
}

function result(
  availability: TaskAvailabilityCheckResult['availability'],
  overrides: Partial<TaskAvailabilityCheckResult> = {},
): TaskAvailabilityReadResult {
  return {
    kind: 'results',
    protocolRevision: '2026-01-26',
    availabilitySchemaRevision: '1.0',
    results: [
      {
        nodeId: 'move',
        operationName: 'embodied.move',
        availability,
        riskLevel: 'low',
        nextAvailableWindows: [],
        reservationMode: 'none',
        possibleEffects: [],
        ...overrides,
      },
    ],
  };
}

function binding(providerPolicy: SkillProviderPolicy): SkillTaskBinding {
  return { bindingId: 'move', taskType: 'embodied.move', providerPolicy };
}

function dynamicPolicy(): SkillProviderPolicy {
  return {
    selection: 'dynamic',
    preferredProviderIds: [],
    forbiddenProviderIds: [],
    requiredAttributes: [],
  };
}

function inspectInput(taskBinding: SkillTaskBinding, allowPreferredProviderFallback = false) {
  return {
    skillId: 'embodied.move_to',
    skillVersion: 1,
    taskBindings: [taskBinding],
    allowPreferredProviderFallback,
  };
}
