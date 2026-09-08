import { describe, expect, it } from 'vitest';

import { extractStructuredTargets } from '../../domain/src/structured-target.js';
import type { WorkflowDefinition } from '../../domain/src/workflow.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/ajv-validator.js';
import {
  decodeGowmWorkflowDefinition,
  encodeGowmWorkflowDefinition,
} from '../src/gowm-workflow-definition.js';

const mapping = {
  argumentPath: '/target',
  purpose: 'destination',
  format: 'xy',
  crsPath: '/target/frame',
};
const schema = { 'x-sdar-targets': [mapping] };

describe('Explicit structured target mapping', () => {
  it('does not discover arbitrary coordinates outside a declared schema mapping', () => {
    expect(extractStructuredTargets({}, { target: { x: 1, y: 2, frame: 'EPSG:4326' } })).toEqual({
      targets: [],
      diagnostics: [],
    });
  });
  it('preserves local coordinates and raw input without inventing a CRS', () => {
    const input = { target: { x: 4000, y: -9000, frame: 'GAME:local-map' } };
    const before = structuredClone(input);
    expect(extractStructuredTargets(schema, input).targets[0]).toEqual({
      argumentPath: '/target',
      purpose: 'destination',
      geometry: { type: 'Point', coordinates: [4000, -9000] },
      nativeCrs: 'GAME:local-map',
    });
    expect(input).toEqual(before);
    expect(extractStructuredTargets(schema, { target: { x: 1, y: 2 } })).toEqual({
      targets: [],
      diagnostics: [{ argumentPath: '/target', code: 'TARGET_CRS_UNRESOLVED' }],
    });
  });
  it('rejects out-of-range WGS84 and an open polygon while accepting a closed polygon and line', () => {
    expect(
      extractStructuredTargets(schema, { target: { x: 181, y: 2, frame: 'EPSG:4326' } })
        .diagnostics[0]?.code,
    ).toBe('TARGET_GEOMETRY_INVALID');
    const geo = { 'x-sdar-targets': [{ ...mapping, format: 'geojson', crsPath: '/frame' }] };
    for (const geometry of [
      {
        type: 'LineString',
        coordinates: [
          [1, 2],
          [2, 3],
        ],
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [1, 2],
            [2, 2],
            [2, 3],
            [1, 2],
          ],
        ],
      },
    ])
      expect(
        extractStructuredTargets(geo, { target: geometry, frame: 'EPSG:4326' }).targets,
      ).toHaveLength(1);
    expect(
      extractStructuredTargets(geo, {
        target: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [2, 2],
              [2, 3],
              [1, 3],
            ],
          ],
        },
        frame: 'EPSG:4326',
      }).diagnostics[0]?.code,
    ).toBe('TARGET_GEOMETRY_INVALID');
  });
  it('defers unresolved Workflow references until actual invocation arguments exist', () => {
    expect(
      extractStructuredTargets(
        schema,
        { target: { x: { op: 'ref', path: ['input', 'x'] }, y: 2, frame: 'EPSG:4326' } },
        { deferWorkflowReferences: true },
      ),
    ).toEqual({ targets: [], diagnostics: [] });
  });
  it('validates annotation definitions without weakening ordinary JSON Schema validation', () => {
    const validator = new AjvJsonSchemaValidator();
    const inputSchema = {
      type: 'object',
      properties: { target: { type: 'object' } },
      required: ['target'],
      additionalProperties: false,
      ...schema,
    };
    expect(validator.checkSchema(inputSchema).valid).toBe(true);
    expect(validator.validate(inputSchema, {}).valid).toBe(false);
    expect(validator.checkSchema({ ...schema, 'x-sdar-targets': [mapping, mapping] }).valid).toBe(
      false,
    );
    expect(
      validator.checkSchema({ 'x-sdar-targets': [{ ...mapping, crs: 'EPSG:4326' }] }).valid,
    ).toBe(false);
  });
});

describe('GOWM stored plan alias', () => {
  const definition: WorkflowDefinition = {
    executionSemanticsVersion: '2.0',
    workflowDefinitionId: 'definition',
    version: 1,
    goalId: 'goal',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      { nodeId: 'result', name: 'result', type: 'result', value: { op: 'literal', value: true } },
    ],
    edges: [],
  };
  it('round-trips without changing the DSL or its hash input', () => {
    const original = JSON.stringify(definition);
    const stored = encodeGowmWorkflowDefinition(definition);
    expect(stored).toMatchObject({ nodes: [{ id: 'result', nodeId: 'result' }] });
    expect(JSON.stringify(decodeGowmWorkflowDefinition(stored))).toBe(original);
    expect(JSON.stringify(definition)).toBe(original);
    expect(decodeGowmWorkflowDefinition(definition)).toEqual(definition);
  });
  it('preserves old governance records using only id without treating them as aliases', () => {
    const legacy = {
      nodes: [{ id: 'move', type: 'mcp_tool', serverId: 'server', toolName: 'move' }],
    };
    expect(decodeGowmWorkflowDefinition(legacy)).toEqual(legacy);
  });
  it('rejects conflicting storage identities', () => {
    expect(() =>
      decodeGowmWorkflowDefinition({ ...definition, nodes: [{ nodeId: 'result', id: 'another' }] }),
    ).toThrow('GOWM_WORKFLOW_NODE_ALIAS_CONFLICT');
  });
});
