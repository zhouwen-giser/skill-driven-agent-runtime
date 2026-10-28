import { describe, it, expect } from 'vitest';
import { buildZmqSiteConsumerCandidate, ZmqSiteAuthoritySchema } from '../src/zmq-site-profile.js';
import { assertZmqCatalogContract, zmqToolArguments } from '../src/zmq-provider-profile.js';
import { buildNativeZmqSkill } from '../src/zmq-skill.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { siteFixture, siteNow } from '../test-support/zmq-site.js';
import { reviewedZmqCatalog } from '../src/zmq-catalogs.js';
import {
  nativeZmqDispatchInput,
  ZMQ_NATIVE_CONTROLS,
  type ZmqNativeTool,
  nativeZmqTaskExecution,
} from '../../domain/src/zmq-capability.js';
import {
  assertNativeZmqExecutionContext,
  projectSiteZmqResult,
} from '../../domain/src/zmq-site-capability.js';
const schemas = new AjvJsonSchemaValidator();
const profile = 'zmq_v1_2_0_site_control_13' as const;
const constraints = (toolName = 'vehicle_zmq_navigate', catalogProfile = profile as string) => [
  { type: 'zmq_input_adapter', version: 2, toolName, catalogProfile, maxElapsedMs: 300000 },
];
describe('exact site catalogs and native live authority', () => {
  it.each(['zmq_v1_1_0_readonly_13', 'zmq_v1_2_0_site_control_13'] as const)(
    'pins %s without substituting legacy contracts',
    (p) => {
      const f = siteFixture(p),
        c = buildZmqSiteConsumerCandidate(f.authority, f.discovery, f.tools, siteNow);
      expect(f.tools).toHaveLength(13);
      expect(c.executableTools).toHaveLength(p === profile ? 13 : 7);
      expect(c.dispatchAuthorized).toBe(false);
      expect(c.credentialRef).toBe('unauthenticated://none');
      expect(() => {
        assertZmqCatalogContract(f.tools, f.authority.resourceId);
      }).toThrow('ZMQ_CATALOG_TOOL_SET_MISMATCH');
      for (const t of f.tools) {
        if (p !== profile && ZMQ_NATIVE_CONTROLS.has(t.toolName)) {
          expect(() => buildNativeZmqSkill(f.authority, t.toolName as ZmqNativeTool, t, 1)).toThrow(
            'READONLY',
          );
          continue;
        }
        const skill = buildNativeZmqSkill(f.authority, t.toolName as ZmqNativeTool, t, 1);
        expect(skill.outputSchema).toMatchObject({
          properties: {
            schemaVersion: { const: 'sdar.zmq-skill-report/2' },
            catalogProfile: { const: p },
          },
        });
        expect(skill.runtimePolicy.autoConfirmPlan).toBe(!ZMQ_NATIVE_CONTROLS.has(t.toolName));
        expect(skill.outcomeSpecification?.taskGoalPolicy['simulationId']).toBeNull();
      }
    },
  );
  it.each([
    'missing',
    'unknown',
    'input',
    'output',
    'profile',
    'semantics',
    'resource',
    'version',
    'checksum',
    'expired',
  ] as const)('rejects %s drift', (kind) => {
    const f = siteFixture();
    const t = f.tools[0];
    if (!t?.taskExecutionProfile) throw Error('fixture');
    if (kind === 'missing') f.tools.pop();
    if (kind === 'unknown') f.tools.push({ ...t, toolName: 'unexpected' });
    if (kind === 'input') f.tools[0] = { ...t, inputSchema: { type: 'object' } };
    if (kind === 'output') f.tools[0] = { ...t, outputSchema: { type: 'object' } };
    if (kind === 'profile')
      f.tools[0] = {
        ...t,
        taskExecutionProfile: { ...t.taskExecutionProfile, supportsScheduling: true },
      };
    if (kind === 'semantics')
      f.tools[0] = { ...t, executionSemantics: { ...t.executionSemantics, replay: 'forbidden' } };
    const authority = {
      ...f.authority,
      ...(kind === 'resource' ? { resourceId: 'other' } : {}),
      ...(kind === 'checksum' ? { catalogChecksum: 'b'.repeat(64) } : {}),
      ...(kind === 'expired' ? { validUntil: siteNow } : {}),
    };
    if (kind === 'version') f.discovery.providerCatalog.providerVersion = '1.0.1';
    expect(() => buildZmqSiteConsumerCandidate(authority, f.discovery, f.tools, siteNow)).toThrow();
  });
  it('rejects fabricated direct registry lineage and unknown profiles', () => {
    const f = siteFixture();
    expect(() =>
      ZmqSiteAuthoritySchema.parse({
        ...f.authority,
        registryRevision: 1,
        registryChecksum: 'a'.repeat(64),
      }),
    ).toThrow();
    expect(() => reviewedZmqCatalog('zmq_unknown')).toThrow('PROFILE_UNREVIEWED');
    expect(() =>
      ZmqSiteAuthoritySchema.parse({
        ...f.authority,
        executionMode: 'simulation',
        simulationId: 'scene',
      }),
    ).toThrow();
    expect(() =>
      assertNativeZmqExecutionContext(
        constraints(),
        { mode: 'simulation', simulationId: 'scene' },
        'vehicle_zmq_navigate',
      ),
    ).toThrow('SITE_EXECUTION');
    expect(() =>
      assertNativeZmqExecutionContext(
        constraints('vehicle_zmq_navigate', 'zmq_v1_1_0_readonly_13'),
        { mode: 'live' },
        'vehicle_zmq_navigate',
      ),
    ).toThrow('READONLY');
    expect(
      assertNativeZmqExecutionContext(constraints(), { mode: 'live' }, 'vehicle_zmq_navigate'),
    ).toBe(profile);
  });
  it('preserves planner preview arguments without a Task time window', () => {
    const f = siteFixture();
    const input = {
      resourceId: f.authority.resourceId,
      start: { longitude: 106, latitude: 29 },
      waypoints: [{ longitude: 106.001, latitude: 29.001 }],
    };
    expect(
      zmqToolArguments('vehicle_zmq_plan_route', input, f.authority.resourceId, schemas, profile),
    ).toEqual(input);
    expect(
      nativeZmqDispatchInput({
        requestedCapabilityId: 'vehicle.ugv.zmq.vehicle_zmq_plan_route',
        inputSnapshot: input,
        constraintSnapshot: constraints('vehicle_zmq_plan_route'),
      }),
    ).toEqual(input);
    expect(() =>
      nativeZmqDispatchInput({
        requestedCapabilityId: 'vehicle.ugv.zmq.vehicle_zmq_plan_route',
        inputSnapshot: { ...input, timeWindow: {} },
        constraintSnapshot: constraints('vehicle_zmq_plan_route'),
      }),
    ).toThrow();
  });
  it('validates explicit manual provenance and rejects silently supplied default altitude', () => {
    const f = siteFixture(),
      input = {
        resourceId: f.authority.resourceId,
        targetSource: 'manual',
        targetId: 'entity-1',
        sourceNote: 'Operator selected virtual entity',
        position: { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: null },
        timeWindow: { earliestStart: siteNow, deadline: '2026-10-28T00:05:00Z' },
      };
    expect(
      zmqToolArguments('simulation_apply_effect', input, f.authority.resourceId, schemas, profile),
    ).toMatchObject({ targetSource: 'manual', position: { ellipsoid_height_m: null } });
    expect(() =>
      zmqToolArguments(
        'simulation_apply_effect',
        { ...input, sourceNote: undefined },
        f.authority.resourceId,
        schemas,
        profile,
      ),
    ).toThrow();
    expect(() =>
      zmqToolArguments(
        'simulation_apply_effect',
        { ...input, targetSource: 'observation' },
        f.authority.resourceId,
        schemas,
        profile,
      ),
    ).toThrow();
  });
  it('keeps an anchored maximum of 300 seconds and start tolerance at most 60 seconds', () => {
    const w = { earliestStart: siteNow, deadline: '2026-10-28T00:08:00Z' };
    expect(nativeZmqTaskExecution(w, siteNow, 60000).timing).toMatchObject({
      maxElapsedMs: 300000,
      start: { startToleranceMs: 60000 },
    });
    expect(nativeZmqTaskExecution(w, '2026-10-28T00:07:59Z', 60000).timing).toMatchObject({
      maxElapsedMs: 1000,
      start: { startToleranceMs: 999 },
    });
  });
  it('distinguishes canceled, unknown and incomplete reports while retaining raw values', () => {
    const raw = {
      schemaVersion: 'ugv.zmq-control-result/2',
      nativeOutcome: 'completed',
      stopConfirmed: true,
      missingEvidence: [],
      sourceRefs: [],
    };
    expect(projectSiteZmqResult('vehicle_zmq_navigate', raw, 'r', profile).status).toBe(
      'completed',
    );
    expect(
      projectSiteZmqResult(
        'vehicle_zmq_navigate',
        { ...raw, nativeOutcome: 'canceled' },
        'r',
        profile,
      ).status,
    ).toBe('cancelled');
    expect(
      projectSiteZmqResult(
        'vehicle_zmq_navigate',
        { ...raw, nativeOutcome: null, stopConfirmed: false },
        'r',
        profile,
      ).missingEvidence,
    ).toContain('PHYSICAL_STOP_UNCONFIRMED');
    const inspection = {
      ...raw,
      schemaVersion: 'ugv.zmq-inspection-result/2',
      inspectionReport: { complete: false, absenceConclusion: 'unavailable' },
      anomalies: [],
    };
    const report = projectSiteZmqResult('vehicle_zmq_inspect_area', inspection, 'r', profile);
    expect(report.status).toBe('degraded');
    expect(report.providerResult).toEqual(inspection);
    expect(report.missingEvidence).toContain('SOURCE_STREAM_COMPLETENESS_UNVERIFIED');
    expect(() =>
      projectSiteZmqResult(
        'vehicle_zmq_plan_route',
        { schemaVersion: 'ugv.zmq-route-preview/1', adoption: 'adopted' },
        'r',
        profile,
      ),
    ).toThrow('PREVIEW_REQUIRED');
  });
});
