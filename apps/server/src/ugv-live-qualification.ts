import { createMcpProviderDispatchHash } from '../../../packages/application/src/mcp-registry.js';
import { ugvQualificationAuthorityIdentity } from '../../../packages/application/src/ugv-live-qualification.js';
import { randomUUID } from 'node:crypto';

import type {
  Clock,
  McpRegistryService,
  RuntimeCapabilityResolution,
  UgvLiveQualificationStore,
} from '../../../packages/application/src/index.js';
import {
  hashCanonicalEvidenceJson,
  type RemoteTaskAuthoritySnapshot,
} from '../../../packages/domain/src/index.js';
import type { UgvMoveTaskBindingResolver } from './ugv-move-binding.js';
import {
  ugvSimulationQualificationStateReadArguments,
  validateUgvQualificationReceipt,
} from './ugv-move-skill-usage.js';

const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const LIVE = Object.freeze({ mode: 'live' as const });
export const UGV_LIVE_QUALIFICATION_CONSTRAINT = 'ugv_live_qualification';

export class UgvLiveQualificationError extends Error {
  readonly code = 'UGV_LIVE_QUALIFICATION_INVALID';
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = 'UgvLiveQualificationError';
  }
}
function fail(message: string): never {
  throw new UgvLiveQualificationError(message);
}
function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('Qualification reference must be an object.');
  return value as Readonly<Record<string, unknown>>;
}
function same(left: unknown, right: unknown) {
  return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
}

/** Exact durable observation, separate from remote Task binding authority. */
export class UgvLiveQualificationService {
  constructor(
    private readonly dependencies: Readonly<{
      registry: Pick<McpRegistryService, 'callDetailed'>;
      authority: Pick<UgvMoveTaskBindingResolver, 'resolveQualificationAuthority'>;
      store: UgvLiveQualificationStore;
      clock: Pick<Clock, 'now'>;
      nextInvocationId?: () => string;
    }>,
  ) {}

  async capture(
    input: Readonly<{ requestId: string; executionContext: Readonly<{ mode: 'live' }> }>,
  ) {
    if (
      !IDENTIFIER.test(input.requestId) ||
      Object.keys(input.executionContext).join(',') !== 'mode' ||
      !same(input.executionContext, LIVE) ||
      Object.keys(input).some((key) => !['requestId', 'executionContext'].includes(key))
    )
      fail('An exact live request without simulationId is required.');
    const prior = await this.dependencies.store.load(input.requestId);
    if (prior !== undefined) return (await this.load(input.requestId)).receipt;
    const invocationId = this.dependencies.nextInvocationId?.() ?? `mcp-invocation-${randomUUID()}`;
    if (
      !(await this.dependencies.store.reserve({
        requestId: input.requestId,
        invocationId,
        createdAt: this.dependencies.clock.now(),
      }))
    )
      return (await this.load(input.requestId)).receipt;
    try {
      const authority = await this.dependencies.authority.resolveQualificationAuthority();
      const outcome = await this.dependencies.registry.callDetailed(
        authority.serverId,
        'vehicle_get_state',
        ugvSimulationQualificationStateReadArguments(),
        undefined,
        {
          providerBindingId: authority.providerBindingId,
          providerId: authority.providerId,
          executionContext: LIVE,
          preTransportFence: {
            invocationId,
            signal: new AbortController().signal,
            enter: async (dispatch) => {
              requireSnapshot(dispatch.authoritySnapshot);
              if (
                dispatch.dispatchId !== invocationId ||
                dispatch.authoritySnapshot.runtime.serverId !== authority.serverId ||
                dispatch.authoritySnapshot.providerBinding?.bindingId !==
                  authority.providerBindingId ||
                dispatch.authoritySnapshot.providerBinding.providerId !== authority.providerId
              )
                fail(
                  'The actual dispatch authority does not match the selected qualification binding.',
                );
              await this.dependencies.store.freezeDispatch({
                requestId: input.requestId,
                invocationId,
                dispatchHash: dispatch.dispatchHash,
                authoritySnapshot: dispatch.authoritySnapshot,
              });
            },
          },
        },
      );
      if (outcome.invocationId !== invocationId || outcome.outcome.kind !== 'immediate')
        fail('Qualification must complete one synchronous invocation.');
      const saved = await this.dependencies.store.load(input.requestId);
      if (saved?.invocation === undefined || saved.record.authoritySnapshot === undefined)
        fail('The exact durable qualification invocation is missing.');
      const now = this.dependencies.clock.now();
      validateUgvQualificationReceipt(saved.invocation, authority.serverId, LIVE, now, now);
      await this.dependencies.store.complete(
        input.requestId,
        invocationId,
        hashCanonicalEvidenceJson(saved.invocation.result),
      );
      return (await this.load(input.requestId)).receipt;
    } catch (error: unknown) {
      await this.dependencies.store.markUncertain(input.requestId, invocationId);
      throw error;
    }
  }

  /** Completed duplicates recover the original receipt even after its admission window expires. */
  async load(requestId: string, freshness?: Readonly<{ now: string; boundAt: string }>) {
    const saved = await this.dependencies.store.load(requestId);
    const invocation = saved?.invocation;
    const record = saved?.record;
    if (
      record?.status !== 'completed' ||
      invocation === undefined ||
      record.authoritySnapshot === undefined ||
      record.requestId !== requestId ||
      record.invocationId !== invocation.invocationId ||
      !same(record.executionContext, LIVE) ||
      record.resultHash !== hashCanonicalEvidenceJson(invocation.result)
    )
      fail('The request has no exact completed durable receipt; redispatch is forbidden.');
    requireSnapshot(record.authoritySnapshot);
    const authority = record.authoritySnapshot;
    const provider = authority.providerBinding;
    if (provider === undefined) fail('The saved qualification binding is missing.');
    if (
      authority.capturedAt !== invocation.startedAt ||
      record.dispatchHash !==
        createMcpProviderDispatchHash({
          invocationId: invocation.invocationId,
          serverId: invocation.serverId,
          toolName: invocation.toolName,
          arguments: invocation.arguments,
          providerBindingId: provider.bindingId,
          providerId: provider.providerId,
        })
    )
      fail('The durable invocation does not match its actual pre-transport fence.');
    const validated = validateUgvQualificationReceipt(
      invocation,
      authority.runtime.serverId,
      LIVE,
      freshness?.now ?? invocation.completedAt,
      freshness?.boundAt ?? invocation.completedAt,
    );
    const receipt = Object.freeze({
      requestId,
      executionContext: LIVE,
      invocationId: invocation.invocationId,
      resultHash: record.resultHash,
      completedAt: invocation.completedAt,
      observedAt: validated.observedAt,
      revision: validated.revision,
      mqttIngressSequence: validated.mqttIngressSequence,
      serverId: authority.runtime.serverId,
      providerBindingId: provider.bindingId,
      providerId: provider.providerId,
      operationName: 'vehicle_get_state' as const,
      resourceId: 'vehicle:ugv1' as const,
      sourcePosition: validated.position,
    });
    const constraint = Object.freeze({
      type: UGV_LIVE_QUALIFICATION_CONSTRAINT,
      requestId,
      executionContext: LIVE,
      invocationId: invocation.invocationId,
      resultHash: record.resultHash,
      authoritySnapshot: authority,
    });
    return Object.freeze({ receipt, constraint, invocation });
  }

  async prepareAcceptance(
    input: Readonly<{
      requestId: string;
      metadata: Readonly<Record<string, unknown>>;
      boundAt: string;
      resolution: RuntimeCapabilityResolution;
    }>,
  ) {
    const policies = input.resolution.constraints.filter(
      (c) => c['type'] === 'runtime_execution_mode_policy',
    );
    if (policies[0]?.['mode'] !== 'live') {
      if (input.metadata['io.sdar/ugvQualification'] !== undefined)
        fail('Live qualification cannot authorize another execution mode.');
      return Object.freeze([]);
    }
    if (
      policies.length !== 1 ||
      !same(policies[0], { type: 'runtime_execution_mode_policy', mode: 'live' }) ||
      input.resolution.requestedCapabilityId !== 'embodied.move' ||
      input.resolution.capabilityVersion !== 2 ||
      input.resolution.constraints.some((c) => c['type'] === UGV_LIVE_QUALIFICATION_CONSTRAINT)
    )
      fail(
        'The live UGV exposure must contain exactly one mode policy and no caller qualification constraint.',
      );
    const ref = object(input.metadata['io.sdar/ugvQualification']);
    if (
      Object.keys(ref).sort().join(',') !== 'invocationId,requestId,resultHash' ||
      ref['requestId'] !== input.requestId ||
      !IDENTIFIER.test(input.requestId) ||
      typeof ref['invocationId'] !== 'string' ||
      !IDENTIFIER.test(ref['invocationId']) ||
      typeof ref['resultHash'] !== 'string' ||
      !HASH.test(ref['resultHash'])
    )
      fail('The exact admission qualification reference is required.');
    const saved = await this.load(input.requestId, {
      now: this.dependencies.clock.now(),
      boundAt: input.boundAt,
    });
    if (
      saved.receipt.invocationId !== ref['invocationId'] ||
      saved.receipt.resultHash !== ref['resultHash']
    )
      fail('Qualification reference conflicts with its durable receipt.');
    await this.assertCurrent(saved.constraint.authoritySnapshot);
    const providers = input.resolution.constraints.filter(
      (c) => c['type'] === 'provider_binding_policy',
    );
    if (
      providers.length !== 1 ||
      providers[0]?.['localServerId'] !== saved.receipt.serverId ||
      providers[0]['mcpProviderBindingId'] !== saved.receipt.providerBindingId
    )
      fail('Exposure and qualification Provider bindings differ.');
    return Object.freeze([saved.constraint]);
  }

  async loadConstraint(
    constraint: Readonly<Record<string, unknown>>,
    boundAt: string,
    now: string,
  ) {
    if (typeof constraint['requestId'] !== 'string')
      fail('Frozen qualification request is missing.');
    const saved = await this.load(constraint['requestId'], { boundAt, now });
    if (!same(constraint, saved.constraint))
      fail('Frozen qualification constraint does not equal the durable receipt.');
    await this.assertCurrent(saved.constraint.authoritySnapshot);
    return saved.invocation;
  }

  private async assertCurrent(snapshot: RemoteTaskAuthoritySnapshot) {
    const current = (await this.dependencies.authority.resolveQualificationAuthority())
      .authoritySnapshot;
    if (
      current === undefined ||
      !same(ugvQualificationAuthorityIdentity(snapshot), ugvQualificationAuthorityIdentity(current))
    )
      fail('Qualification binding authority changed before admission or planning.');
  }
}

function requireSnapshot(snapshot: RemoteTaskAuthoritySnapshot) {
  const provider = snapshot.providerBinding;
  if (
    provider?.originType !== 'smpp_registry' ||
    provider.scope?.environment !== 'development' ||
    provider.scope.tenantId.length === 0 ||
    provider.scope.projectId.length === 0
  )
    fail(
      'Live qualification requires explicit development scope and verified SMPP registry authority.',
    );
}
