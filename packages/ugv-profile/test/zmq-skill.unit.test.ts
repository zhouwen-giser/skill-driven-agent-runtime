import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkillPackageImporter, SkillPackageValidator } from '../../application/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../skill-package-adapter/src/index.js';
import {
  ZMQ_NATIVE_TOOLS,
  ZMQ_NATIVE_CONTROLS,
  zmqCapabilityId,
  nativeZmqDispatchInput,
  nativeZmqTaskExecution,
  projectNativeZmqResult,
} from '../../domain/src/zmq-capability.js';
import { buildNativeZmqSkill } from '../src/zmq-skill.js';
import { authority, tools, discovery, now } from '../test-support/zmq.js';
import { buildZmqConsumerCandidate } from '../src/zmq-provider-profile.js';
import { writeNativeZmqPackage } from '../../../apps/node-control-acceptance/src/zmq-skill-governance.js';
import { assertIsolatedZmqEndpoint } from '../../../apps/node-control-acceptance/src/zmq-provider-materialization.js';
import { explicitProviderJsonDictionaries } from '../../../apps/node-control-acceptance/src/provider-json-schema.js';
import type { JsonObject } from '../../node-control-domain/src/index.js';
import { skillSchemaContractErrors } from '../../domain/src/skill-schema-contract.js';

const schemas = new AjvJsonSchemaValidator();
describe('governed native ZMQ Skill contracts', () => {
  it('imports all twelve exact packages through the real package reader/validator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdar-zmq-skill-packages-'));
    try {
      const importer = new SkillPackageImporter({
        reader: new NodeSkillPackageReader(),
        validator: new SkillPackageValidator({
          schemas,
          packageSchema: JSON.parse(
            await readFile('schemas/skill-package.schema.json', 'utf8'),
          ) as unknown,
        }),
        clock: { now: () => now },
      });
      expect(ZMQ_NATIVE_TOOLS.slice().sort()).toEqual(
        tools()
          .map((t) => t.toolName)
          .sort(),
      );
      for (const name of ZMQ_NATIVE_TOOLS) {
        const tool = tools().find((t) => t.toolName === name);
        if (!tool) throw Error('FIXTURE_TOOL_REQUIRED');
        const built = buildNativeZmqSkill(authority(), name, tool, 1),
          skill = {
            ...built,
            outputSchema: explicitProviderJsonDictionaries(built.outputSchema as JsonObject),
          },
          path = join(root, name);
        expect(skillSchemaContractErrors(skill.inputSchema, 'input'), name).toEqual([]);
        expect(skillSchemaContractErrors(skill.outputSchema, 'output'), name).toEqual([]);
        await writeNativeZmqPackage(path, skill);
        await writeNativeZmqPackage(path, skill);
        await writeNativeZmqPackage(path, {
          ...skill,
          outputSchema: Object.fromEntries(Object.entries(skill.outputSchema).reverse()),
        });
        const imported = await importer.import(path);
        expect(imported.skillVersion).toEqual(skill);
        expect(skill.capabilities).toEqual([zmqCapabilityId(name)]);
        expect(skill.runtimePolicy.autoConfirmPlan).toBe(!ZMQ_NATIVE_CONTROLS.has(name));
        expect(skill.outcomeSpecification?.sideEffectPolicy['redispatchAfterUncertain']).toBe(
          ZMQ_NATIVE_CONTROLS.has(name) ? false : undefined,
        );
        expect(JSON.stringify(skill)).not.toContain(authority().validUntil);
        if (ZMQ_NATIVE_CONTROLS.has(name))
          expect(
            schemas.validate(skill.inputSchema, { resourceId: authority().resourceId }).valid,
          ).toBe(false);
        await expect(
          writeNativeZmqPackage(path, { ...skill, description: 'changed' }),
        ).rejects.toThrow('ZMQ_EXISTING_PACKAGE_BYTES_DIFFER');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects another local server and a different Provider kind', () => {
    const changed = tools();
    const first = changed[0];
    if (!first) throw Error('FIXTURE_TOOL_REQUIRED');
    changed[0] = { ...first, serverId: 'other' };
    expect(() => buildZmqConsumerCandidate(authority(), discovery, changed, now)).toThrow(
      'ZMQ_PROVIDER_AUTHORITY_MISMATCH',
    );
    expect(() =>
      buildZmqConsumerCandidate(
        authority(),
        {
          ...discovery,
          providerCatalog: {
            ...discovery.providerCatalog,
            providerType: 'legacy',
          },
        },
        tools(),
        now,
      ),
    ).toThrow('ZMQ_PROVIDER_AUTHORITY_MISMATCH');
  });
  it.each([
    'http://192.168.2.63:19100/mcp',
    'http://127.0.0.1:19100/mcp',
    'http://127.0.0.1:19101/',
    'https://127.0.0.1:20000/mcp',
    'http://localhost:20000/mcp',
    'http://user:pass@127.0.0.1:20000/mcp',
  ])('refuses an endpoint outside the owned numeric-loopback scope: %s', (url) => {
    expect(() => {
      assertIsolatedZmqEndpoint(url);
    }).toThrow('ZMQ_OWNED_LOOPBACK_ENDPOINT_REQUIRED');
  });
  it('keeps the parent deadline anchored and refuses reversed or expired windows', () => {
    const window = { earliestStart: now, deadline: '2026-10-24T00:10:00.000Z' };
    expect(nativeZmqTaskExecution(window, '2026-10-24T00:09:59.500Z').timing.maxElapsedMs).toBe(
      500,
    );
    expect(() => nativeZmqTaskExecution(window, window.deadline)).toThrow('ZMQ_DEADLINE_EXPIRED');
    expect(() =>
      nativeZmqTaskExecution({ earliestStart: window.deadline, deadline: now }, now),
    ).toThrow('ZMQ_DEADLINE_EXPIRED');
  });
  it('requires exact native input adapter authority and strips only the control time window', () => {
    const input = {
        resourceId: authority().resourceId,
        zoom: 2,
        timeWindow: { earliestStart: now, deadline: '2026-10-24T00:01:00.000Z' },
      },
      binding = {
        requestedCapabilityId: zmqCapabilityId('vehicle_zmq_camera'),
        inputSnapshot: input,
        constraintSnapshot: [
          {
            type: 'zmq_input_adapter',
            version: 1,
            toolName: 'vehicle_zmq_camera',
            maxElapsedMs: 300000,
          },
        ],
      };
    expect(nativeZmqDispatchInput(binding)).toEqual({ resourceId: input.resourceId, zoom: 2 });
    expect(() => nativeZmqDispatchInput({ ...binding, constraintSnapshot: [] })).toThrow(
      'ZMQ_INPUT_ADAPTER_AUTHORITY_INVALID',
    );
    expect(() =>
      nativeZmqDispatchInput({ ...binding, requestedCapabilityId: 'embodied.inspect_area' }),
    ).toThrow('ZMQ_INPUT_ADAPTER_AUTHORITY_INVALID');
    expect(() =>
      nativeZmqDispatchInput({
        ...binding,
        constraintSnapshot: [...binding.constraintSnapshot, ...binding.constraintSnapshot],
      }),
    ).toThrow('ZMQ_INPUT_ADAPTER_AUTHORITY_INVALID');
  });
  it('retains a valid empty frame as degraded and never invents spatial completeness', () => {
    const raw = {
      schemaVersion: 'ugv.zmq-inspection-result/1',
      inspectionReport: {
        complete: false,
        absenceConclusion: 'no_observations_in_received_frames',
      },
      anomalies: [],
      missingEvidence: [],
    };
    const result = projectNativeZmqResult('vehicle_zmq_inspect_area', raw, authority().resourceId);
    expect(result.status).toBe('degraded');
    expect(result.providerResult).toEqual(raw);
    expect(result.missingEvidence).toContain('TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE');
    expect(raw.missingEvidence).toEqual([]);
    expect(
      projectNativeZmqResult(
        'simulation_apply_effect',
        { executionFinished: null, effect: 'unknown' },
        authority().resourceId,
      ).status,
    ).toBe('degraded');
    expect(
      projectNativeZmqResult(
        'vehicle_zmq_camera',
        { nativeOutcome: 'failed' },
        authority().resourceId,
      ).status,
    ).toBe('failed');
  });
});
