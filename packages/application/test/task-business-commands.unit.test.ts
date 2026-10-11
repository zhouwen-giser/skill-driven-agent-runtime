import { describe, expect, it } from 'vitest';
import {
  observeTaskBusinessCommand,
  assertTaskBusinessCurrentCapability,
} from '../src/task-business-commands.js';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import {
  businessCommandFixture,
  businessControlScope,
  businessMutationPolicy,
} from '../../domain/test/task-business-command-fixture.js';
import type { TaskBusinessView } from '../../domain/src/task-business.js';

describe('governed business evidence correlation', () => {
  it('keeps acknowledgment accepted until its own command is applied with the exact adopted route', () => {
    const command = businessCommandFixture();
    const before = taskBusinessFixture();
    expect(observeTaskBusinessCommand(command, before).state).toBe('accepted');
    const routeRef = { kind: 'artifact' as const, id: 'route-line', revision: 1 };
    const view: TaskBusinessView = {
      ...before,
      context: {
        ...before.context,
        effectivePlanRevision: 5,
        summary: {
          ...before.context.summary,
          properties: {
            effectiveNavigation: { commandId: 'business-command-1', planRevision: 5, routeRef },
          },
        },
      },
      objects: before.objects.map((object) =>
        object.kind === 'intervention'
          ? {
              ...object,
              value: {
                ...object.value,
                state: 'applied',
                acceptedCommandId: 'business-command-1',
                resultRefs: [routeRef],
              },
            }
          : object,
      ),
    };
    expect(observeTaskBusinessCommand(command, view)).toMatchObject({
      state: 'confirmed',
      evidence: { adoptedRouteRef: routeRef },
    });
    expect(
      observeTaskBusinessCommand(command, {
        ...view,
        context: {
          ...view.context,
          summary: {
            ...view.context.summary,
            properties: {
              effectiveNavigation: { commandId: 'another-command', planRevision: 5, routeRef },
            },
          },
        },
      }).state,
    ).toBe('accepted');
    expect(
      observeTaskBusinessCommand(command, {
        ...view,
        objects: view.objects.filter((object) => object.kind !== 'artifact'),
      }).state,
    ).toBe('accepted');
    expect(() =>
      observeTaskBusinessCommand(command, {
        ...view,
        context: {
          ...view.context,
          identity: { ...view.context.identity, executionId: 'foreign' },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_BUSINESS_EXECUTION_CONFLICT' }));
  });
  it('keeps a lost Input acknowledgment uncertain when the public response lacks a client command correlation', () => {
    const command = businessCommandFixture('input_response');
    const before = taskBusinessFixture();
    const view: TaskBusinessView = {
      ...before,
      objects: before.objects.map((object) =>
        object.kind === 'input_request'
          ? {
              ...object,
              value: {
                ...object.value,
                revision: 2,
                state: 'answered',
                responseCommandId: 'provider-owned-command',
                response: { action: 'accept', value: { decision: 'continue_observation' } },
              },
            }
          : object,
      ),
    };
    expect(observeTaskBusinessCommand(command, view)).toMatchObject({
      state: 'confirmed',
      evidence: {
        causalQuality: 'request_response_match',
        providerResponseCommandId: 'provider-owned-command',
      },
    });
    expect(observeTaskBusinessCommand({ ...command, state: 'uncertain' }, view)).toMatchObject({
      state: 'uncertain',
      evidence: { causalQuality: 'request_response_match' },
    });
  });
  it('requires the published Capability, active exact Skill implementation and current resource override', () => {
    const scope = businessControlScope;
    const constraints = [businessMutationPolicy];
    const authority = {
      definition: {
        capability_id: scope.capabilityId,
        version: scope.capabilityVersion,
        status: 'published',
        risk_level: 'high',
        supported_modes: ['plan_confirmed', 'remote_task'],
        constraints,
      },
      implementationBindings: [
        {
          capability_id: scope.capabilityId,
          capability_version: scope.capabilityVersion,
          implementation_type: 'skill',
          implementation_id: scope.skillId,
          implementation_version: String(scope.skillVersion),
          role: 'primary',
          status: 'active',
          provider_policy_override: {
            selection: 'required',
            mcpProviderBindingId: scope.providerBindingId,
            localServerId: scope.serverId,
            mcpToolName: scope.toolName,
            requireActive: true,
            requireAvailable: true,
            requireUnexpiredFreshness: true,
            denyFallback: true,
            allowedResourceIds: ['vehicle:ugv'],
          },
        },
      ],
    };
    expect(() => {
      assertTaskBusinessCurrentCapability({
        authority,
        scope,
        constraints,
        resourceId: 'vehicle:ugv',
      });
    }).not.toThrow();
    for (const definition of [
      { ...authority.definition, status: 'draft' },
      { ...authority.definition, constraints: [] },
    ])
      expect(() => {
        assertTaskBusinessCurrentCapability({
          authority: { ...authority, definition },
          scope,
          constraints,
          resourceId: 'vehicle:ugv',
        });
      }).toThrow(expect.objectContaining({ code: 'TASK_BUSINESS_CURRENT_CAPABILITY_DENIED' }));
    expect(() => {
      assertTaskBusinessCurrentCapability({ authority, scope, constraints, resourceId: 'foreign' });
    }).toThrow(expect.objectContaining({ code: 'TASK_BUSINESS_CURRENT_CAPABILITY_DENIED' }));
  });
});
