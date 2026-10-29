import { UgvAgentProfileSkillProviderDependencyPolicy } from '../../runtime-control-application/src/skill-provider-dependency-policy.js';
import { describe, it, expect } from 'vitest';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { siteFixture, siteNow } from '../test-support/zmq-site.js';
import { patrolFixture, patrolNow } from '../test-support/zmq-patrol.js';
import { buildZmqSiteConsumerCandidate } from '../src/zmq-site-profile.js';
import { assertZmqCatalogContract, zmqToolArguments } from '../src/zmq-provider-profile.js';
import { nativeZmqDispatchInput } from '../../domain/src/zmq-capability.js';
import {
  parseZmqPatrolInput,
  aggregateZmqPatrol,
  zmqPatrolChildInput,
  ZMQ_PATROL_CHILDREN,
} from '../../domain/src/zmq-area-patrol.js';
import { prepareZmqPatrolWorkflow } from '../src/zmq-patrol-workflow.js';
const profile = 'zmq_v1_3_0_site_control_13';
const schemas = new AjvJsonSchemaValidator();
const area = () => ({
  crs: 'OGC:CRS84',
  searchStrategy: 'recognize',
  vertices: [
    { longitude: 106, latitude: 29 },
    { longitude: 106.001, latitude: 29 },
    { longitude: 106.001, latitude: 29.001 },
    { longitude: 106, latitude: 29.001 },
  ],
});
describe('1.3.0 defaults before exact physical confirmation', () => {
  it('authorizes only the matching successor patrol declaration', () => {
    const f = patrolFixture(profile);
    const policy = new UgvAgentProfileSkillProviderDependencyPolicy();
    const value = {
      definition: f.definition,
      implementation: f.implementation,
      implementations: [f.implementation],
      skill: {
        ...f.skill,
        usageSpecification: f.skill.usageSpecification,
        packageChecksum: 'a'.repeat(64),
      },
    };
    expect(policy.assess(value).decision).toBe('authorized');
    expect(
      policy.assess({
        ...value,
        definition: {
          ...f.definition,
          constraints: (f.definition.constraints ?? []).map((c) =>
            c['type'] === 'composition_authority_policy'
              ? { ...c, catalogProfile: 'zmq_v1_2_0_site_control_13' }
              : c,
          ),
        },
      }).decision,
    ).toBe('denied');
  });
  it('pins the exact new thirteen-tool anonymous source and rejects old-profile assembly', () => {
    const f = siteFixture(profile);
    const candidate = buildZmqSiteConsumerCandidate(f.authority, f.discovery, f.tools, siteNow);
    expect(candidate.executableTools).toHaveLength(13);
    expect(candidate.credentialRef).toBe('unauthenticated://none');
    expect(() => {
      assertZmqCatalogContract(f.tools, f.authority.resourceId, 'zmq_v1_2_0_site_control_13');
    }).toThrow();
  });
  it.each(['vehicle_zmq_area_recon', 'vehicle_zmq_inspect_area'])(
    'freezes concrete %s arguments consistently across dispatch preparation',
    (toolName) => {
      const input = {
        resourceId: 'vehicle:ugv',
        area: area(),
        timeWindow: { earliestStart: siteNow, deadline: '2026-10-28T00:05:00.000Z' },
      };
      const args = zmqToolArguments(toolName, input, 'vehicle:ugv', schemas, profile);
      expect(args).toMatchObject({
        area: {
          vertices: area().vertices.map((p) => ({
            ...p,
            ellipsoidHeightM: 0,
            ellipsoidHeightSource: 'default_zero',
          })),
        },
      });
      expect(
        nativeZmqDispatchInput({
          requestedCapabilityId: `vehicle.ugv.zmq.${toolName}`,
          inputSnapshot: input,
          constraintSnapshot: [
            {
              type: 'zmq_input_adapter',
              version: 2,
              toolName,
              catalogProfile: profile,
              maxElapsedMs: 300000,
            },
          ],
        }),
      ).toEqual(args);
      expect(input.area.vertices[0]).not.toHaveProperty('ellipsoidHeightM');
    },
  );
  it.each([null, NaN, Infinity, '0'])('rejects an invalid height %s', (height) => {
    const input = { resourceId: 'vehicle:ugv', area: area() };
    Object.assign(input.area.vertices[0] ?? {}, { ellipsoidHeightM: height });
    expect(() =>
      zmqToolArguments('vehicle_zmq_inspect_area', input, 'vehicle:ugv', schemas, profile),
    ).toThrow();
  });
  it('retains explicit zero and nonzero values and their source', () => {
    const input = { resourceId: 'vehicle:ugv', area: area() };
    Object.assign(input.area.vertices[0] ?? {}, { ellipsoidHeightM: 0 });
    Object.assign(input.area.vertices[1] ?? {}, { ellipsoidHeightM: 100 });
    expect(
      zmqToolArguments('vehicle_zmq_inspect_area', input, 'vehicle:ugv', schemas, profile),
    ).toMatchObject({
      area: {
        vertices: [
          { ...input.area.vertices[0], ellipsoidHeightSource: 'provided' },
          { ...input.area.vertices[1], ellipsoidHeightSource: 'provided' },
          expect.anything(),
          expect.anything(),
        ],
      },
    });
  });
  it('resolves omitted patrol heights into both frozen children and the truthful parent report', () => {
    const f = patrolFixture(profile);
    const input = {
      ...f.input,
      area: area(),
      entryPoint: { longitude: 106.0005, latitude: 29.0005 },
      speedLimitMps: 60 / 3.6,
    };
    expect(() => parseZmqPatrolInput(input)).toThrow();
    const parsed = parseZmqPatrolInput(input, profile);
    expect(parsed.area.vertices.every((p) => p.ellipsoidHeightM === 0)).toBe(true);
    const prepared = prepareZmqPatrolWorkflow(f.planning, input, patrolNow);
    const inspection = prepared.deterministicDefinition.nodes.find(
      (n) => n.type === 'skill_call' && n.skillId === ZMQ_PATROL_CHILDREN[1],
    );
    expect(inspection).toMatchObject({
      input: zmqPatrolChildInput(input, ZMQ_PATROL_CHILDREN[1], profile),
    });
    const report = aggregateZmqPatrol(input, [], profile);
    expect(report.status).toBe('degraded');
    expect(report.parameterResolution).toMatchObject({
      policy: 'missing_height_zero',
      requestedArea: input.area,
      effectiveArea: {
        vertices: expect.arrayContaining([
          expect.objectContaining({ ellipsoidHeightM: 0, ellipsoidHeightSource: 'default_zero' }),
        ]),
      },
    });
    expect(report.missingEvidence).toContain('NAVIGATION_SUCCESS_AND_STOP_UNCONFIRMED');
  });
});
