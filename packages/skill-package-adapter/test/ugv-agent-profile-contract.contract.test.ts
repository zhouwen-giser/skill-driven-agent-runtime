import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NodeSkillPackageReader } from '../src/index.js';

const skillRoot = fileURLToPath(new URL('../../../skills/embodied.move_to/', import.meta.url));
const freezePath = new URL(
  '../../../reports/ugv-agent-profile-simulation/contract-freeze.json',
  import.meta.url,
);

describe('UGV Agent Profile contract freeze', () => {
  it('pins the exact reviewed Skill package and external contract authorities', async () => {
    const report = record(JSON.parse(await readFile(freezePath, 'utf8')));
    const contract = record(report['contract']);
    const sources = record(contract['sourceAuthorities']);
    const sdar = record(sources['sdar']);
    const smpp = record(sources['smpp']);
    const imported = await new NodeSkillPackageReader().read(skillRoot);

    expect(report).toMatchObject({
      schemaVersion: 'ugv-agent-profile.contract-freeze/v1',
      status: 'FROZEN',
      evidenceClass: 'external_simulation',
      productionEligible: false,
      physicalVehicleQualified: false,
    });
    expect(imported.packageChecksum).toBe(sdar['packageChecksum']);
    expect(sdar).toMatchObject({
      repositoryCommit: '928c645702f9e05e32cc001335898b79444ef9f6',
      skillPackageRoot: 'skills/embodied.move_to',
    });
    expect(record(smpp['deviceContract'])['contractCanonicalHash']).toMatch(/^[a-f0-9]{64}$/u);
    expect(record(smpp['mqttContract'])['contractCanonicalHash']).toMatch(/^[a-f0-9]{64}$/u);
    expect(report['contractCanonicalHash']).toBe(canonicalHash(contract));
  });

  it('freezes the exact Profile, point adapter, evidence gate and zero-side-effect boundary', async () => {
    const report = record(JSON.parse(await readFile(freezePath, 'utf8')));
    const contract = record(report['contract']);
    const profile = record(contract['profile']);
    const operations = record(profile['operations']);
    const navigate = record(operations['navigate']);
    const coordinate = record(contract['coordinateContract']);
    const workflow = record(contract['workflow']);
    const evidence = record(contract['finalPositionEvidence']);
    const safety = record(contract['safety']);

    expect(profile).toMatchObject({
      profileId: 'ugv-agent-profile',
      exactSkillAllowlist: [
        { skillId: 'embodied.move_to', version: 1, reference: 'embodied.move_to@1' },
      ],
      semanticTaskType: 'embodied.move',
      bindingId: 'ugv-agent-profile/move-resource',
      resource: { resourceId: 'vehicle:ugv1', resourceType: 'vehicle' },
    });
    expect(record(operations['initialState'])['operationName']).toBe('vehicle_get_state');
    expect(record(operations['finalState'])['operationName']).toBe('vehicle_get_state');
    expect(navigate).toMatchObject({
      operationName: 'vehicle_navigate',
      executionSemantics: 'TASK_REQUIRED',
      executionMode: 'simulation',
      missionType: 'point',
    });
    expect(record(record(record(navigate['argumentTemplate'])['mission'])['target'])).toEqual({
      longitude: '$skillInput.target.x',
      latitude: '$skillInput.target.y',
    });
    expect(coordinate).toMatchObject({
      acceptedFrames: ['EPSG:4326', 'WGS84'],
      canonicalFrame: 'WGS84',
      x: { meaning: 'longitude', minimum: -180, maximum: 180 },
      y: { meaning: 'latitude', minimum: -90, maximum: 90 },
      axisSwapAllowed: false,
      undeclaredCrsTransformationAllowed: false,
    });
    expect(workflow).toMatchObject({
      navigationDispatchCount: 1,
      continuationMayRestartAtStart: false,
      outerPlanConfirmationIsOnlyBusinessConfirmation: true,
      governedControlAuthorityBypassAllowed: false,
    });
    expect(evidence).toMatchObject({
      evidenceType: 'position.observation',
      resourceId: 'vehicle:ugv1',
      coordinateFrame: 'WGS84',
      postDispatchRequired: true,
      distanceFormula: 'haversine',
      defaultToleranceM: 2,
      providerCompletedNecessaryButNotSufficient: true,
    });
    expect(safety).toMatchObject({
      authorizationGrantedByThisArtifact: false,
      toolsCallCount: 0,
      mqttPublishCount: 0,
      controlInvocationCount: 0,
      forbiddenOperationCallCount: 0,
      sdarDirectSouthboundAccessCount: 0,
      emergencyStopAuthority: 'manual_operator_only',
    });
  });

  it('fails closed for a missing, ambiguous, mocked, auto-wire or non-exact contract', async () => {
    const report = record(JSON.parse(await readFile(freezePath, 'utf8')));
    const contract = record(report['contract']);
    const binding = record(contract['bindingFreeze']);
    const mqtt = record(contract['mqttContract']);
    const mock = record(contract['mockContractDecision']);

    expect(binding).toMatchObject({
      selectionCardinality: 'exactly_one',
      missingCode: 'UGV_PROFILE_BINDING_NOT_FOUND',
      ambiguousCode: 'UGV_PROFILE_BINDING_AMBIGUOUS',
      firstMatchAllowed: false,
    });
    expect(mqtt).toMatchObject({
      wireMode: 'ros_bridge_json',
      autoDetectionAllowedAfterFreeze: false,
      subscriptionCount: 18,
      wildcardsAllowed: false,
    });
    expect(mock).toMatchObject({
      resolvedValue: false,
      goalPolicy: 'forbidden',
      reasonCode: 'UGV_EXTERNAL_SIMULATION_REAL_TOOLS_LIST_REQUIRED',
    });
  });
});

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('UGV_CONTRACT_INVALID');
  return value as Record<string, unknown>;
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
