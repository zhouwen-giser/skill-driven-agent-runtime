import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { z } from 'zod';
import catalog from '../../../contracts/smpp-task-business/v1.3/positive-catalog.json' with { type: 'json' };

const object = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const point = {
  type: 'object',
  required: ['longitude', 'latitude'],
  additionalProperties: false,
  properties: {
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
  },
};
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: { decision: { const: 'continue_observation' } },
};

/** Loopback wire fixture. Its Context changes only after the captured original command/Task lifecycle. */
export async function startSmppBusinessProvider(
  operation: 'vehicle_navigate' | 'vehicle_area_recon',
) {
  let remoteTaskId = randomUUID();
  const identity = {
    taskId: remoteTaskId,
    executionId: `execution:${remoteTaskId}`,
    providerId: 'isr.vehicle.ugv.ugv',
    resourceId: 'vehicle:ugv',
    operationName: operation,
  };
  let createdAt = new Date().toISOString();
  const outputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['resourceId', 'status', 'observedAt', 'businessSemantics'],
    properties: {
      resourceId: { const: identity.resourceId },
      status: { const: 'completed' },
      observedAt: { type: 'string', format: 'date-time' },
      businessSemantics: {
        type: 'object',
        additionalProperties: false,
        required: [
          'schemaVersion',
          'missionTaskState',
          'reconPhase',
          'visualLockState',
          'sensorMode',
          'payloadHealth',
          'payloadLoadState',
          'native',
        ],
        properties: {
          schemaVersion: { const: 'ugv.business-semantics/1' },
          missionTaskState: { enum: ['succeeded', 'failed', 'unknown'] },
          reconPhase: { enum: ['completed', 'idle', 'unknown'] },
          visualLockState: { const: 'unlocked' },
          sensorMode: { const: 'unknown' },
          payloadHealth: { const: 'unknown' },
          payloadLoadState: { const: 'unknown' },
          native: { type: 'object' },
        },
      },
    },
  };
  let revision = 1;
  let runtimeRevision = 1;
  let released = false;
  let inputAnswered = false;
  let applied = false;
  let missionTaskState: 'succeeded' | 'failed' = 'succeeded';
  let commandId: string | undefined;
  const calls: Readonly<{ method: string; params: Readonly<Record<string, unknown>> }>[] = [];
  const trajectoryBytes = Buffer.from(
    JSON.stringify({
      kind: 'geojson',
      crs: 'OGC:CRS84',
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 256 }, (_, i) => [106.8 + i / 100_000, 29.7]),
      },
    }),
  );
  const trajectoryHash = createHash('sha256').update(trajectoryBytes).digest('hex');
  const toolSchema =
    operation === 'vehicle_navigate'
      ? {
          type: 'object',
          required: ['resourceId', 'mission', 'stopOnObstacle'],
          additionalProperties: false,
          properties: {
            resourceId: { const: identity.resourceId },
            mission: {
              type: 'object',
              required: ['type', 'target'],
              additionalProperties: false,
              properties: { type: { const: 'point' }, target: point },
            },
            stopOnObstacle: { type: 'boolean' },
          },
        }
      : {
          type: 'object',
          required: ['resourceId', 'scanMode', 'area'],
          additionalProperties: false,
          properties: {
            resourceId: { const: identity.resourceId },
            scanMode: { const: 'area' },
            area: {
              type: 'object',
              required: ['polygon'],
              additionalProperties: false,
              properties: { polygon: { type: 'array', minItems: 3, items: point } },
            },
          },
        };
  const ref = (kind: 'artifact' | 'input_request' | 'intervention', id: string, v = 1) => ({
    kind,
    id,
    revision: v,
  });
  const routeRef = () => ref('artifact', 'route-line', applied ? 2 : 1);
  const input = () => ({
    ...catalog.requiredInput,
    identity,
    revision: inputAnswered ? 2 : 1,
    state: inputAnswered ? 'answered' : 'pending',
    inputSchema,
    requestedAt: createdAt,
    deadlineAt: new Date(Date.parse(createdAt) + 600_000).toISOString(),
    ...(inputAnswered
      ? {
          resolvedAt: createdAt,
          response: { action: 'accept', value: { decision: 'continue_observation' } },
          responseCommandId: `provider-input-command:${remoteTaskId}`,
        }
      : {}),
  });
  const intervention = () => ({
    ...catalog.intervention,
    identity,
    revision: applied ? 2 : 1,
    effectivePlanRevision: applied ? 3 : 2,
    state: applied ? 'applied' : 'available',
    createdAt,
    validUntil: new Date(Date.parse(createdAt) + 600_000).toISOString(),
    inputSchema: {
      type: 'object',
      required: ['waypoints', 'density'],
      additionalProperties: false,
      properties: {
        waypoints: { type: 'array', minItems: 1, items: point },
        density: { enum: ['sparse', 'normal', 'dense'] },
      },
    },
    appliesTo: [routeRef()],
    ...(applied ? { acceptedCommandId: commandId, resultRefs: [routeRef()] } : {}),
  });
  const artifacts = () => [
    ...catalog.artifacts
      .filter((a) =>
        operation === 'vehicle_navigate'
          ? ['destination-point', 'route-line'].includes(a.artifactId)
          : ['area-polygon', 'covered-multi-polygon'].includes(a.artifactId),
      )
      .map((a) => ({
        ...a,
        identity,
        ...(a.artifactId === 'route-line' ? { revision: applied ? 2 : 1 } : {}),
      })),
    {
      ...catalog.artifacts[3],
      artifactId: 'trajectory-256',
      artifactType: 'navigation.trajectory',
      identity,
      revision: 1,
      semantics: 'observed',
      properties: { sampleCount: 256 },
      content: {
        kind: 'content_ref',
        artifactId: 'trajectory-256',
        revision: 1,
        readMethod: 'business_artifact_content',
        handle: 'trajectory-256_1',
        mediaType: 'application/geo+json',
        sizeBytes: trajectoryBytes.length,
        sha256: trajectoryHash,
        expiresAt: new Date(Date.parse(createdAt) + 600_000).toISOString(),
      },
    },
  ];
  const view = () => {
    const artifactObjects = artifacts();
    return {
      ...catalog.context,
      identity,
      contextRevision: revision,
      effectivePlanRevision: applied ? 3 : 2,
      phase: {
        code: released
          ? 'complete'
          : operation === 'vehicle_navigate'
            ? 'navigation.running'
            : 'recon.scanning',
        since: createdAt,
      },
      summary: {
        status: released ? 'finalized' : 'in_progress',
        resultCode:
          released && missionTaskState === 'failed'
            ? 'CONTROLLED_BUSINESS_FAILURE'
            : released
              ? operation === 'vehicle_navigate'
                ? 'NAVIGATION_COMPLETED'
                : 'RECON_COMPLETE'
              : 'RUNNING',
        properties: {
          trajectoryLast: { observedAt: createdAt, deviceReportedAt: createdAt },
          effectiveNavigation: {
            ...(applied ? { commandId, planRevision: 3 } : {}),
            routeRef: routeRef(),
          },
        },
      },
      activeRefs:
        operation === 'vehicle_navigate'
          ? {
              route: routeRef(),
              navigationAdjustment: ref('intervention', 'intervention-1', applied ? 2 : 1),
            }
          : inputAnswered
            ? {}
            : { 'input:visualLock': ref('input_request', 'input-1') },
      artifactRefs: artifactObjects.map((a) => ref('artifact', a.artifactId, a.revision)),
      actionRefs: [],
      requiredInputRefs:
        operation === 'vehicle_area_recon'
          ? [ref('input_request', 'input-1', inputAnswered ? 2 : 1)]
          : [],
      interventionRefs:
        operation === 'vehicle_navigate'
          ? [ref('intervention', 'intervention-1', applied ? 2 : 1)]
          : [],
      updatedAt: createdAt,
    };
  };
  const task = (resultType: 'task' | 'complete') => ({
    resultType,
    taskId: remoteTaskId,
    status: released
      ? 'completed'
      : operation === 'vehicle_area_recon' && !inputAnswered
        ? 'input_required'
        : 'working',
    createdAt,
    lastUpdatedAt: createdAt,
    ttlMs: 600_000,
    pollIntervalMs: 100,
    _meta: {
      'io.sdar/taskExecution': {
        profileVersion: '1.0',
        runtimeRevision: String(runtimeRevision++),
        observedAt: createdAt,
      },
    },
    ...(resultType === 'complete' && operation === 'vehicle_area_recon' && !inputAnswered
      ? {
          inputRequests: {
            'input-key-1': {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Continue this non-weapon observation?',
                requestedSchema: inputSchema,
              },
            },
          },
        }
      : {}),
    ...(released
      ? {
          result: {
            resultType: 'complete',
            content: [],
            isError: false,
            _meta: {
              'io.sdar/evidence': {
                profileVersion: '1.0',
                items: [
                  {
                    evidenceId: `business:${identity.executionId}`,
                    evidenceType: 'business.observation',
                    observedAt: createdAt,
                    payloadRef: { kind: 'structured_content', jsonPointer: '/businessSemantics' },
                  },
                ],
              },
            },
            structuredContent: {
              resourceId: identity.resourceId,
              status: 'completed',
              observedAt: createdAt,
              businessSemantics: {
                schemaVersion: 'ugv.business-semantics/1',
                missionTaskState,
                reconPhase: operation === 'vehicle_area_recon' ? 'completed' : 'idle',
                visualLockState: 'unlocked',
                sensorMode: 'unknown',
                payloadHealth: 'unknown',
                payloadLoadState: 'unknown',
                native: {},
              },
            },
          },
        }
      : {}),
  });
  const contextResponse = () => ({
    resultType: 'complete',
    profileVersion: '1.0-rc2',
    snapshot: {
      contextRevision: revision,
      context: view(),
      objects: [
        ...artifacts().map((value) => ({ kind: 'artifact', value })),
        ...(operation === 'vehicle_navigate'
          ? [{ kind: 'intervention', value: intervention() }]
          : [{ kind: 'input_request', value: input() }]),
      ],
    },
    resumeFrom: { streamId: `stream:${remoteTaskId}`, afterSequence: String(revision) },
  });
  const priorTasks = new Map<
    string,
    {
      task: ReturnType<typeof task>;
      context: ReturnType<typeof contextResponse>;
      artifacts: ReturnType<typeof artifacts>;
    }
  >();
  const server = createServer((request, response) => {
    void (async () => {
      let id: unknown = null;
      try {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers['mcp-protocol-version'], '2026-07-28');
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          assert.ok(chunk instanceof Uint8Array);
          chunks.push(Buffer.from(chunk));
          assert.ok(chunks.reduce((n, c) => n + c.length, 0) < 262_144);
        }
        const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        id = body['id'];
        const method = z.string().parse(body['method']);
        assert.equal(request.headers['mcp-method'], method);
        const params = object(body['params']);
        const prior = priorTasks.get(String(params['taskId']));
        assert.ok(params['_meta']);
        calls.push({ method, params });
        let result: unknown;
        if (method === 'server/discover')
          result = {
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: {
              extensions: {
                'io.modelcontextprotocol/tasks': {},
                'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
                'io.sdar/providerCatalog': {
                  providerId: identity.providerId,
                  providerType: 'isr.vehicle.ugv',
                  providerVersion: '1.3',
                  manifestHash: 'b'.repeat(64),
                },
                'io.sdar/taskBusiness': {
                  profileVersion: '1.0-rc2',
                  methods: {
                    contextGet: 'io.sdar/taskBusiness/context/get',
                    snapshotPartGet: 'io.sdar/taskBusiness/snapshotParts/get',
                    artifactGet: 'io.sdar/taskBusiness/artifacts/get',
                    interventionApply: 'io.sdar/taskBusiness/interventions/apply',
                    inputUpdate: 'tasks/update',
                  },
                },
              },
            },
            _meta: {
              'io.modelcontextprotocol/serverInfo': {
                name: 'isolated-smpp-business',
                version: '1.3',
              },
            },
            ttlMs: 600_000,
          };
        else if (method === 'tools/list')
          result = {
            tools: [
              {
                name: operation,
                description: 'Exact controlled non-weapon operation',
                inputSchema: toolSchema,
                outputSchema,
                _meta: {
                  'io.sdar/taskExecution': {
                    profileVersion: '1.0',
                    taskBehavior: 'task_required',
                    availability: 'dynamic',
                    supportsScheduling: false,
                    supportsMaxElapsed: true,
                    supportsCancellation: true,
                    supportsPauseResume: false,
                    supportsObservations: true,
                    supportsInputRequired: operation === 'vehicle_area_recon',
                    idempotency: 'server_managed',
                  },
                  'io.sdar/tool-execution-semantics': {
                    effect: 'side_effecting',
                    execution: 'task_required',
                    cancellation: 'task_cancel',
                    idempotency: 'server_managed',
                    replay: 'forbidden',
                  },
                },
              },
            ],
          };
        else if (method === 'io.sdar/taskExecution/checkAvailability')
          result = {
            resultType: 'complete',
            profileVersion: '1.0',
            results: z
              .array(z.unknown())
              .parse(params['checks'])
              .map((raw) => ({
                requestId: object(raw)['requestId'],
                operationName: operation,
                availability: 'available',
                riskLevel: 'high',
                validUntil: new Date(Date.now() + 300_000).toISOString(),
                nextAvailableWindows: [],
                reservationMode: 'none',
                possibleEffects: ['task_pause'],
              })),
          };
        else if (method === 'tools/call') {
          assert.equal(params['name'], operation);
          assert.equal(object(params['arguments'])['resourceId'], identity.resourceId);
          result = task('task');
        } else if (method === 'tasks/get') {
          assert.ok(prior !== undefined || params['taskId'] === remoteTaskId);
          result = prior?.task ?? task('complete');
        } else if (method === 'io.sdar/taskBusiness/context/get') {
          assert.ok(prior !== undefined || params['taskId'] === remoteTaskId);
          result = prior?.context ?? contextResponse();
        } else if (method === 'io.sdar/taskBusiness/artifacts/get') {
          assert.ok(prior !== undefined || params['taskId'] === remoteTaskId);
          const artifact = (prior?.artifacts ?? artifacts()).find(
            (a) => a.artifactId === params['artifactId'] && a.revision === params['revision'],
          );
          assert.ok(artifact);
          const bytes =
            artifact.artifactId === 'trajectory-256'
              ? trajectoryBytes
              : Buffer.from(JSON.stringify(artifact.content));
          const offset = z
            .number()
            .int()
            .nonnegative()
            .parse(params['contentOffset'] ?? 0);
          const end = Math.min(offset + Number(params['maxContentBytes'] ?? 49_152), bytes.length);
          result = {
            resultType: 'complete',
            profileVersion: '1.0-rc2',
            artifact,
            ...(params['includeContent'] !== true
              ? {}
              : {
                  content: {
                    encoding: 'base64',
                    bytes: bytes.subarray(offset, end).toString('base64'),
                    offset,
                    totalBytes: String(bytes.length),
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                    ...(end < bytes.length ? { nextOffset: String(end) } : {}),
                  },
                }),
          };
        } else if (method === 'io.sdar/taskBusiness/interventions/apply') {
          assert.equal(operation, 'vehicle_navigate');
          assert.equal(params['taskId'], remoteTaskId);
          assert.equal(params['executionId'], identity.executionId);
          assert.deepEqual(params['guard'], {
            mode: 'semantic',
            expectedEffectivePlanRevision: 2,
            expectedInterventionRevision: 1,
          });
          assert.equal(params['schemaVersion'], 'sdar.runtime-intervention-command/1.0-rc2');
          assert.equal(params['interventionId'], 'intervention-1');
          assert.deepEqual(params['input'], {
            waypoints: [{ longitude: 106.802, latitude: 29.7 }],
            density: 'normal',
          });
          commandId = z.string().parse(params['commandId']);
          result = {
            resultType: 'complete',
            profileVersion: '1.0-rc2',
            receipt: {
              commandId,
              commandSequence: 1,
              commandState: 'accepted',
              durablyAccepted: true,
              businessApplied: false,
              duplicate: false,
            },
          };
        } else if (method === 'tasks/update') {
          assert.equal(operation, 'vehicle_area_recon');
          assert.equal(params['taskId'], remoteTaskId);
          assert.deepEqual(Object.keys(params).sort(), ['_meta', 'inputResponses', 'taskId']);
          assert.deepEqual(params['inputResponses'], {
            'input-key-1': { action: 'accept', content: { decision: 'continue_observation' } },
          });
          inputAnswered = true;
          revision++;
          result = { resultType: 'complete' };
        } else throw new Error(`ISOLATED_BUSINESS_METHOD_UNSUPPORTED:${method}`);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      } catch (error: unknown) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: error instanceof Error ? error.message : 'ISOLATED_FIXTURE_ERROR',
            },
          }),
        );
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    endpoint: new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    calls,
    identity,
    toolSchema,
    trajectoryBytes,
    applyAcceptedNavigation() {
      assert.ok(commandId);
      applied = true;
      revision++;
    },
    release(outcome: 'succeeded' | 'failed' = 'succeeded') {
      assert.ok(operation === 'vehicle_navigate' ? applied : inputAnswered);
      missionTaskState = outcome;
      released = true;
      revision++;
    },
    nextTask() {
      assert.ok(released, 'Only a finalized fixture Task can precede a new Tool execution');
      priorTasks.set(
        remoteTaskId,
        structuredClone({
          task: task('complete'),
          context: contextResponse(),
          artifacts: artifacts(),
        }),
      );
      remoteTaskId = randomUUID();
      identity.taskId = remoteTaskId;
      identity.executionId = `execution:${remoteTaskId}`;
      createdAt = new Date().toISOString();
      revision = 1;
      runtimeRevision = 1;
      released = false;
      inputAnswered = false;
      applied = false;
      missionTaskState = 'succeeded';
      commandId = undefined;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    },
  };
}
