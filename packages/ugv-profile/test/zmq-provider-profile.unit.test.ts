import { describe, it, expect } from 'vitest';
import catalog from '../src/zmq-catalog-contract.json' with { type: 'json' };
import {
  assertZmqCatalogContract,
  buildZmqConsumerCandidate,
  zmqTaskExecution,
  zmqToolArguments as adaptZmqToolArguments,
  projectZmqInspection,
} from '../src/zmq-provider-profile.js';
import { deriveFrozenMcpCatalogAuthority } from '../../domain/src/mcp-catalog-authority.js';
import type { McpTool } from '../../domain/src/mcp.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/ajv-validator.js';
const schemas = new AjvJsonSchemaValidator();
const zmqToolArguments = (toolName: string, input: unknown, resourceId: string) =>
  adaptZmqToolArguments(toolName, input, resourceId, schemas);
function present<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('FIXTURE_TOOL_REQUIRED');
  return v;
}
const now = '2026-10-24T00:00:00.000Z',
  resource = 'vehicle:SIMULATED';
function tools(): McpTool[] {
  return catalog.tools.map(
    (t) =>
      ({
        ...t,
        serverId: 'zmq-isolated',
        toolName: t.name,
        inputSchema: {
          ...t.inputSchema,
          properties: {
            ...t.inputSchema.properties,
            resourceId: { ...t.inputSchema.properties.resourceId, const: resource },
          },
        },
        protocolMode: 'frozen_v1',
        taskExecutionProfile: t._meta['io.sdar/taskExecution'],
        executionSemantics: {
          effect:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'side_effecting'
              : 'read_only',
          execution:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'task_required'
              : 'synchronous',
          cancellation: t._meta['io.sdar/taskExecution'].supportsCancellation
            ? 'task_cancel'
            : 'unsupported',
          idempotency: 'server_managed',
          replay:
            t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required'
              ? 'forbidden'
              : 'allowed',
          source: 'mcp_declared',
        },
        discoveredAt: now,
      }) as McpTool,
  );
}
const discovery = {
  protocolVersion: '2026-07-28' as const,
  serverInfo: { name: 'SIMULATED-provider', version: '1.0' },
  providerCatalog: {
    providerId: 'SIMULATED-provider',
    providerType: 'isr.vehicle.ugv.zmq',
    providerVersion: '1.0',
    manifestHash: 'a'.repeat(64),
  },
};
const authority = (ts = tools()) => ({
  bindingId: 'SIMULATED-binding',
  providerId: 'SIMULATED-provider',
  resourceId: resource,
  localServerId: 'zmq-isolated',
  bindingRevision: 1,
  registryRevision: 1,
  registryChecksum: 'b'.repeat(64),
  catalogRevision: deriveFrozenMcpCatalogAuthority(discovery, ts, 1).catalogRevision,
  catalogChecksum: deriveFrozenMcpCatalogAuthority(discovery, ts, 1).catalogChecksum,
  simulationId: 'SIMULATED-scene',
  validUntil: '2026-10-24T00:01:00.000Z',
});
const input = {
  resourceId: resource,
  area: {
    crs: 'OGC:CRS84',
    vertices: [
      { longitude: 106, latitude: 29, ellipsoidHeightM: 10 },
      { longitude: 106.001, latitude: 29, ellipsoidHeightM: 10 },
      { longitude: 106.001, latitude: 29.001, ellipsoidHeightM: 10 },
      { longitude: 106, latitude: 29.001, ellipsoidHeightM: 10 },
    ],
    searchStrategy: 'track',
  },
  timeWindow: { earliestStart: now, deadline: '2026-10-24T00:10:00.000Z' },
};
describe('separate ZMQ consumer candidate', () => {
  it('retains exact lineage without granting publication or dispatch', () => {
    const candidate = buildZmqConsumerCandidate(authority(), discovery, tools(), now);
    expect(candidate.capabilities).toHaveLength(12);
    expect(candidate.dispatchAuthorized).toBe(false);
    expect(candidate.patrolComposition.state).toBe('blocked');
    expect(
      candidate.capabilities.find((c) => c.toolName === 'simulation_apply_effect'),
    ).toMatchObject({ confirmation: 'explicit_plan_required', automaticReplay: 'forbidden' });
  });
  it.each(['missing', 'unknown', 'schema', 'profile', 'resource'])(
    'rejects %s catalog drift',
    (kind) => {
      const ts = tools();
      if (kind === 'missing') ts.pop();
      if (kind === 'unknown') ts.push({ ...present(ts[0]), toolName: 'unknown_action' });
      if (kind === 'schema') ts[0] = { ...present(ts[0]), inputSchema: {} };
      if (kind === 'profile')
        ts[0] = {
          ...present(ts[0]),
          taskExecutionProfile: {
            ...present(present(ts[0]).taskExecutionProfile),
            supportsCancellation: true,
          },
        };
      expect(() => {
        assertZmqCatalogContract(ts, kind === 'resource' ? 'other' : resource);
      }).toThrow();
    },
  );
  it('rejects stale or conflicting authority', () => {
    const a = authority();
    expect(() =>
      buildZmqConsumerCandidate({ ...a, catalogChecksum: 'c'.repeat(64) }, discovery, tools(), now),
    ).toThrow('ZMQ_CATALOG_AUTHORITY_MISMATCH');
    expect(() =>
      buildZmqConsumerCandidate({ ...a, validUntil: now }, discovery, tools(), now),
    ).toThrow('ZMQ_AUTHORITY_EXPIRED');
  });
  it('preserves axes and explicit height', () => {
    expect(zmqToolArguments('vehicle_zmq_inspect_area', input, resource)).toEqual({
      resourceId: resource,
      area: input.area,
    });
    const noHeight = structuredClone(input);
    delete (noHeight.area.vertices[0] as Record<string, unknown>)['ellipsoidHeightM'];
    expect(() => zmqToolArguments('vehicle_zmq_inspect_area', noHeight, resource)).toThrow(
      'ZMQ_TOOL_INPUT_INVALID',
    );
  });
  it('rejects crossing/duplicate geometry and exclusions', () => {
    for (const vertices of [
      [
        input.area.vertices[0],
        input.area.vertices[2],
        input.area.vertices[1],
        input.area.vertices[3],
      ],
      [
        input.area.vertices[0],
        input.area.vertices[1],
        input.area.vertices[1],
        input.area.vertices[3],
      ],
    ])
      expect(() =>
        zmqToolArguments(
          'vehicle_zmq_inspect_area',
          { ...input, area: { ...input.area, vertices } },
          resource,
        ),
      ).toThrow();
    expect(() =>
      zmqToolArguments(
        'vehicle_zmq_inspect_area',
        { ...input, area: { ...input.area, excludedZones: [] } },
        resource,
      ),
    ).toThrow();
  });
  it('anchors the parent deadline, caps at 300 seconds and refuses expiry', () => {
    expect(zmqTaskExecution(input.timeWindow, now).timing.maxElapsedMs).toBe(300000);
    expect(zmqTaskExecution(input.timeWindow, '2026-10-24T00:09:59Z').timing).toMatchObject({
      maxElapsedMs: 1000,
      start: { startToleranceMs: 999 },
    });
    expect(() => zmqTaskExecution(input.timeWindow, input.timeWindow.deadline)).toThrow(
      'ZMQ_DEADLINE_EXPIRED',
    );
  });
  it('keeps complete-looking empty reports degraded without altering source facts', () => {
    const r = {
      schemaVersion: 'ugv.zmq-inspection-result/1',
      inspectionReport: {
        completion: 'complete',
        absenceConclusion: 'no_observations_in_received_frames',
      },
      anomalies: [],
      coverageEvidence: { ratio: 1, complete: true },
      missingEvidence: [],
    };
    expect(projectZmqInspection(r)).toMatchObject({
      status: 'degraded',
      completeSpatialEvidence: false,
      missingEvidence: [
        'COVERAGE_FOOTPRINTS_UNAVAILABLE',
        'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
        'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
      ],
    });
    expect(r.missingEvidence).toEqual([]);
  });
});
