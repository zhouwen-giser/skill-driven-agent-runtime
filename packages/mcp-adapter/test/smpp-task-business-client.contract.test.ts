import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FrozenV1McpClient,
  SmppTaskBusinessClient,
} from '../src/index.js';

const endpoint = 'http://localhost:19100/mcp';
const taskId = '11111111-1111-4111-8111-111111111111';
const executionId = 'vehicle:ugv:eo:bound-execution';
const providerId = 'isr.vehicle.ugv.ugv';
const resourceId = 'vehicle:ugv';
const now = '2026-10-03T17:00:00.000Z';
const actionRef = { kind: 'action', id: 'lock-9', revision: 2 };
const requestRef = { kind: 'input_request', id: 'decision-9', revision: 1 };
const interventionRef = { kind: 'intervention', id: 'adjust-1', revision: 1 };
const cursor = {
  streamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  afterSequence: '12',
};
const identity = { taskId, executionId, providerId, resourceId, operationName: 'vehicle_area_recon' };
const semantic = {
  schemaVersion: 'ugv.business-semantics/1',
  missionTaskState: 'running',
  reconPhase: 'manual_intervention',
  visualLockState: 'locked',
  sensorMode: 'infrared',
  payloadHealth: 'unknown',
  payloadLoadState: 'unknown',
  native: {
    missionTaskState: 1,
    reconMotionStatus: 13,
    lockStage: 3,
    reconType: 3,
    loadStatus: 1,
  },
};
const subjectBinding = {
  kind: 'visual_lock',
  targetId: '9',
  lockSessionId: 'lock-9',
  actionRef,
};
const requestValue = {
  schemaVersion: 'sdar.required-input/1.0-rc2',
  requestId: 'decision-9',
  requestKey: 'target-decision:lock-9',
  identity,
  revision: 1,
  state: 'pending',
  subjectBinding,
  deadlineAt: '2026-10-03T17:05:00.000Z',
  inputSchema: {
    type: 'object',
    properties: { decision: { const: 'continue_observation' } },
    required: ['decision'],
    additionalProperties: false,
  },
};
const context = {
  schemaVersion: 'sdar.task-business-context/1.0-rc2',
  identity,
  contextRevision: 5,
  effectivePlanRevision: 1,
  summary: {
    status: 'in_progress',
    properties: { businessSemantics: semantic, reconStatusCorrelation: 'INFERRED_CURRENT_EXECUTION' },
  },
  activeRefs: { 'input:visualLock': requestRef },
  artifactRefs: [],
  actionRefs: [actionRef],
  requiredInputRefs: [requestRef],
  interventionRefs: [],
  updatedAt: now,
  phase: null,
};
const inputObject = { kind: 'input_request', value: requestValue };
const methods = {
  contextGet: 'io.sdar/taskBusiness/context/get',
  snapshotPartGet: 'io.sdar/taskBusiness/snapshotParts/get',
  artifactGet: 'io.sdar/taskBusiness/artifacts/get',
  eventListen: 'io.sdar/businessEvents/listen',
  interventionApply: 'io.sdar/taskBusiness/interventions/apply',
};

function discovery() {
  return {
    resultType: 'complete',
    supportedVersions: ['2026-07-28'],
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
        'io.sdar/taskBusiness': {
          profileVersion: '1.0-rc2',
          methods,
        },
        'io.sdar/providerCatalog': {
          providerId,
          providerType: 'isr.vehicle.ugv',
          providerVersion: '1.3',
          manifestHash: 'a'.repeat(64),
        },
      },
    },
    _meta: {
      'io.modelcontextprotocol/serverInfo': { name: 'smpp-ugv', version: '1.3' },
    },
  };
}

interface Captured {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly headers: Headers;
}

function fake(handler: (call: Captured) => unknown) {
  const calls: Captured[] = [];
  const client = new FrozenV1McpClient((_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('TEST_REQUEST_BODY_REQUIRED');
    const body = JSON.parse(init.body) as Readonly<Record<string, unknown>>;
    const captured: Captured = {
      method: String(body['method']),
      params: body['params'] as Readonly<Record<string, unknown>>,
      headers: new Headers(init?.headers),
    };
    calls.push(captured);
    const result = handler(captured);
    return Promise.resolve(new Response(JSON.stringify({
      jsonrpc: '2.0', id: body['id'], result,
    }), { headers: { 'content-type': 'application/json' } }));
  });
  return { client, calls };
}

function consumer(client: FrozenV1McpClient, allow = false) {
  return new SmppTaskBusinessClient({
    endpoint,
    headers: {},
    client,
    now: () => now,
    expectedProviderId: providerId,
    expectedResourceId: resourceId,
    ...(allow ? { mutationAuthority: { authorize: () => Promise.resolve(true) } } : {}),
  });
}

function page(
  value: unknown = context,
  objects: readonly unknown[] = [inputObject],
  nextCursor?: string,
  resumeFrom = cursor,
) {
  return {
    resultType: 'complete',
    profileVersion: '1.0-rc2',
    snapshotToken: 'opaque-token',
    snapshot: {
      contextRevision: 5,
      context: value,
      objects,
      ...(nextCursor ? { nextCursor } : {}),
    },
    resumeFrom,
  };
}

describe('SMPP v1.3 TaskBusiness adapter over the frozen transport', () => {
  it('preserves caller extensions and sends required business headers and capability', async () => {
    const { client, calls } = fake((call) => call.method === 'server/discover'
      ? discovery()
      : page());
    await client.request({
      endpoint,
      headers: {},
      method: 'io.sdar/taskBusiness/context/get',
      params: {
        taskId,
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.sdar/businessEvents': { profileVersion: '1.0' } },
          },
        },
      },
    });
    expect(calls[0]?.headers.get('mcp-name')).toBe(taskId);
    expect(calls[0]?.headers.get('mcp-method')).toBe('io.sdar/taskBusiness/context/get');
    const caps = (
      calls[0]?.params['_meta'] as Record<string, Record<string, unknown>>
    )['io.modelcontextprotocol/clientCapabilities'];
    expect(caps).toMatchObject({
      extensions: {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/businessEvents': { profileVersion: '1.0' },
        'io.sdar/taskBusiness': { profileVersion: '1.0-rc2' },
      },
    });
  });

  it('reads a task-bound Context and preserves unknown health and inferred correlation', async () => {
    const { client, calls } = fake((call) => call.method === 'server/discover'
      ? discovery()
      : page());
    const view = await consumer(client).getContext({ taskId });
    expect(view.context.identity).toMatchObject(identity);
    expect(view.resumeFrom).toEqual(cursor);
    expect(view.objects).toHaveLength(1);
    expect(view.businessSemantics).toMatchObject({
      payloadHealth: 'unknown',
      native: { loadStatus: 1 },
    });
    expect(view.context.summary.properties?.['reconStatusCorrelation'])
      .toBe('INFERRED_CURRENT_EXECUTION');
    expect(calls.map((call) => call.method)).toEqual([
      'server/discover', 'io.sdar/taskBusiness/context/get',
    ]);
  });

  it('assembles context pagination at one revision and fails closed on changed watermark', async () => {
    let changed = false;
    const { client } = fake((call) => {
      if (call.method === 'server/discover') return discovery();
      return call.params['pageCursor'] === undefined
        ? page(context, [inputObject], 'next-page')
        : page(context, [], undefined, changed ? {
          ...cursor, afterSequence: '13',
        } : cursor);
    });
    const business = consumer(client);
    expect((await business.getContext({ taskId })).objects).toHaveLength(1);
    changed = true;
    await expect(business.getContext({ taskId }))
      .rejects.toMatchObject({ code: 'SMPP_CONTEXT_SNAPSHOT_CHANGED' });
  });

  it('restores a verified JSON snapshot part and rejects tampered SHA-256', async () => {
    let tampered = false;
    const bytes = Buffer.from(JSON.stringify(context));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const { client, calls } = fake((call) => {
      if (call.method === 'server/discover') return discovery();
      if (call.method === 'io.sdar/taskBusiness/context/get') {
        return {
          resultType: 'complete', profileVersion: '1.0-rc2', snapshotToken: 'signed-token',
          snapshot: { contextRevision: 5, contextDescriptor: {
            revision: 5, sizeBytes: bytes.length, readMethod: 'getContext',
          }, objects: [inputObject] },
          resumeFrom: cursor,
        };
      }
      return {
        resultType: 'complete', profileVersion: '1.0-rc2',
        part: {
          encoding: 'base64', bytes: bytes.toString('base64'),
          totalBytes: String(bytes.length), sha256: tampered ? 'f'.repeat(64) : hash, offset: 0,
        },
      };
    });
    const business = consumer(client);
    expect((await business.getContext({ taskId })).context.contextRevision).toBe(5);
    expect(calls.find((x) => x.method.endsWith('snapshotParts/get'))?.headers.has('mcp-name'))
      .toBe(false);
    tampered = true;
    await expect(business.getContext({ taskId }))
      .rejects.toMatchObject({ code: 'SMPP_SNAPSHOT_PART_HASH_MISMATCH' });
  });

  it('requires exact Artifact identity and revision; no content is assumed complete', async () => {
    const { client } = fake((call) => call.method === 'server/discover'
      ? discovery()
      : {
        resultType: 'complete', profileVersion: '1.0-rc2',
        artifact: { artifactId: 'route-1', revision: 2, identity },
      });
    const artifact = await consumer(client).getArtifact({
      taskId, artifactId: 'route-1', revision: 2,
    });
    expect(artifact.artifact.revision).toBe(2);
    await expect(consumer(client).getArtifact({ taskId, artifactId: 'route-1', revision: 3 }))
      .rejects.toMatchObject({ code: 'SMPP_ARTIFACT_REVISION_MISMATCH' });
  });

  it('refuses ungoverned Input writes, then accepts an exact current target decision', async () => {
    const { client, calls } = fake((call) => {
      if (call.method === 'server/discover') return discovery();
      if (call.method === 'io.sdar/taskBusiness/context/get') return page();
      if (call.method === 'tasks/get') return {
        taskId, status: 'input_required',
        inputRequests: { [requestValue.requestKey]: {
          method: 'elicitation/create', params: { mode: 'form' },
        } },
      };
      return { resultType: 'complete' };
    });
    const input = {
      taskId, executionId, requestId: requestValue.requestId,
      requestKey: requestValue.requestKey, expectedRequestRevision: 1,
      expectedSubjectBinding: subjectBinding, action: 'accept' as const,
      content: { decision: 'continue_observation' },
    };
    await expect(consumer(client).respondToRequiredInput(input))
      .rejects.toMatchObject({ code: 'SMPP_BUSINESS_GOVERNANCE_REQUIRED' });
    expect(calls.filter((x) => x.method === 'tasks/update')).toHaveLength(0);
    await expect(consumer(client, true).respondToRequiredInput({
      ...input, expectedRequestRevision: 3,
    })).rejects.toMatchObject({ code: 'SMPP_INPUT_BINDING_INVALID' });
    await expect(consumer(client, true).respondToRequiredInput(input))
      .resolves.toEqual({ acceptedByRuntime: true, businessConfirmed: false });
    const submitted = calls.find((call) => call.method === 'tasks/update');
    expect(submitted?.params).toMatchObject({
      taskId,
      inputResponses: {
        [requestValue.requestKey]: {
          action: 'accept', content: { decision: 'continue_observation' },
        },
      },
    });
    expect(JSON.stringify(submitted?.params)).not.toContain('respondedBy');
  });

  it('rejects unexpected Input content and expired requests without dispatch', async () => {
    const { client, calls } = fake((call) =>
      call.method === 'server/discover' ? discovery() : page());
    const input = {
      taskId, executionId, requestId: requestValue.requestId,
      requestKey: requestValue.requestKey, expectedRequestRevision: 1,
      expectedSubjectBinding: subjectBinding,
    };
    await expect(consumer(client, true).respondToRequiredInput({
      ...input, action: 'decline', content: { fake: true },
    })).rejects.toMatchObject({ code: 'SMPP_INPUT_CONTENT_UNEXPECTED' });
    await expect(consumer(client, true).respondToRequiredInput({
      ...input, action: 'accept', content: { decision: 'unknown' },
    })).rejects.toMatchObject({ code: 'SMPP_BUSINESS_INPUT_SCHEMA_INVALID' });
    expect(calls.some((call) => call.method === 'tasks/update')).toBe(false);
  });

  it('preflights exact navigation Intervention and treats receipt as acceptance only', async () => {
    const navIdentity = { ...identity, operationName: 'vehicle_navigate' };
    const navRef = { ...interventionRef };
    const navContext = {
      ...context,
      identity: navIdentity,
      activeRefs: { navigationAdjustment: navRef },
      requiredInputRefs: [],
      interventionRefs: [navRef],
      effectivePlanRevision: 2,
    };
    const intervention = {
      kind: 'intervention',
      value: {
        interventionId: 'adjust-1',
        interventionType: 'navigation.adjust_plan',
        identity: navIdentity,
        revision: 1,
        state: 'available',
        inputSchema: {
          type: 'object',
          properties: {
            waypoints: { type: 'array', minItems: 1, items: {
              type: 'object',
              required: ['longitude', 'latitude'],
              properties: { longitude: { type: 'number' }, latitude: { type: 'number' } },
              additionalProperties: false,
            } },
            density: { type: 'string' },
          },
          required: ['waypoints', 'density'],
          additionalProperties: false,
        },
      },
    };
    const { client, calls } = fake((call) => {
      if (call.method === 'server/discover') return discovery();
      if (call.method === 'io.sdar/taskBusiness/context/get')
        return page(navContext, [intervention]);
      return {
        resultType: 'complete', profileVersion: '1.0-rc2',
        receipt: {
          commandId: 'adjust-command-1', commandSequence: 1, commandState: 'accepted',
          durablyAccepted: true, businessApplied: false, duplicate: false,
        },
      };
    });
    const command = {
      taskId, executionId, interventionId: 'adjust-1',
      expectedInterventionRevision: 1, expectedEffectivePlanRevision: 2,
      commandId: 'adjust-command-1',
      waypoints: [{ longitude: 106.8131, latitude: 29.7195 }], density: 'adaptive',
    };
    await expect(consumer(client).applyNavigationAdjustment(command))
      .rejects.toMatchObject({ code: 'SMPP_BUSINESS_GOVERNANCE_REQUIRED' });
    await expect(consumer(client, true).applyNavigationAdjustment({
      ...command, expectedEffectivePlanRevision: 1,
    })).rejects.toMatchObject({ code: 'SMPP_PLAN_REVISION_CONFLICT' });
    const accepted = await consumer(client, true).applyNavigationAdjustment(command);
    expect(accepted).toMatchObject({
      commandId: 'adjust-command-1', durablyAccepted: true, businessApplied: false,
    });
    expect(calls.filter((x) => x.method.endsWith('/interventions/apply'))).toHaveLength(1);
    const submitted = calls.find((x) => x.method.endsWith('/interventions/apply'));
    expect(submitted?.headers.get('mcp-name')).toBe(taskId);
    expect(submitted?.params).toMatchObject({
      executionId,
      interventionId: 'adjust-1',
      guard: {
        mode: 'semantic',
        expectedInterventionRevision: 1,
        expectedEffectivePlanRevision: 2,
      },
    });
  });

  it('fails closed for a Provider lacking the declared TaskBusiness profile', async () => {
    const { client } = fake((call) => {
      if (call.method !== 'server/discover') return page();
      const result = discovery();
      const extensions = { ...result.capabilities.extensions };
      delete (extensions as Record<string, unknown>)['io.sdar/taskBusiness'];
      return { ...result, capabilities: { extensions } };
    });
    await expect(consumer(client).getContext({ taskId }))
      .rejects.toMatchObject({ code: 'SMPP_BUSINESS_EXTENSION_UNAVAILABLE' });
  });

  it('rejects foreign Context identity even if the transport succeeded', async () => {
    const { client } = fake((call) => call.method === 'server/discover'
      ? discovery()
      : page({ ...context, identity: { ...identity, resourceId: 'vehicle:foreign' } }));
    await expect(consumer(client).getContext({ taskId }))
      .rejects.toMatchObject({ code: 'SMPP_BUSINESS_IDENTITY_MISMATCH' });
  });
});
