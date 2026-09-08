import assert from 'node:assert/strict';
import type { Pool } from 'pg';

import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { GoalExecutionContract } from '../../domain/src/goal.js';
import { DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS } from '../../domain/src/mcp.js';
import type { SkillInputResolutionRecord } from '../../domain/src/skill-input-resolution.js';
import type { WorkflowDefinition, WorkflowPlanRecord } from '../../domain/src/workflow.js';
import {
  PostgresMcpRegistryRepository,
  PostgresSkillRepository,
  PostgresSkillInputResolutionRepository,
  PostgresWorkflowPlanRepository,
} from '../src/repositories.js';

/** Real PostgreSQL tests of the normal repository entry points, not a substitute
 * for the separately required Server/LangGraph/Frozen MCP execution smoke. */
export async function verifyGowmTargetCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
  goalContract: GoalExecutionContract,
): Promise<string[]> {
  const otherDeviceId = scope.allowedDeviceIds[1];
  assert.ok(otherDeviceId);
  const timestamp = new Date().toISOString();
  const taskId = `${run}-task-0`;
  const skillId = `${run}-spatial-skill`;
  const serverId = `${run}-spatial-server`;
  const inputSchema = {
    type: 'object',
    properties: { area: { type: 'object' }, frame: { type: 'string' } },
    required: ['area'],
    additionalProperties: false,
    'x-sdar-targets': [
      { argumentPath: '/area', format: 'geojson', crsPath: '/frame', purpose: 'survey-area' },
    ],
  };
  const toolSchema = {
    type: 'object',
    properties: {
      destination: { type: 'object' },
      route: { type: 'object' },
      frame: { type: 'string' },
    },
    additionalProperties: false,
    'x-sdar-targets': [
      {
        argumentPath: '/destination',
        format: 'xy',
        crsPath: '/frame',
        purpose: 'move-destination',
      },
      { argumentPath: '/route', format: 'geojson', crsPath: '/frame', purpose: 'route' },
    ],
  };
  await new PostgresSkillRepository(pool).saveVersionAndSetCurrent(
    {
      skillId,
      version: 1,
      name: 'spatial fixture',
      summary: 'Explicit spatial input',
      description: 'Repository test fixture only',
      capabilities: [],
      workflowGuidance: 'Preserve explicit targets',
      outputInstruction: 'Return evidence',
      inputSchema,
      outputSchema: { type: 'boolean' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: timestamp,
    },
    timestamp,
  );
  await new PostgresMcpRegistryRepository(pool).saveServerAndReplaceTools(
    {
      server: {
        serverId,
        name: 'spatial catalog fixture',
        endpoint: 'http://127.0.0.1:1/mcp',
        transport: 'streamable_http',
        status: 'enabled',
        toolRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      encryptedCredential: 'fixture-no-credential',
    },
    [
      {
        serverId,
        toolName: 'move',
        inputSchema: toolSchema,
        executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
        discoveredAt: timestamp,
      },
    ],
  );

  const inputs = new PostgresSkillInputResolutionRepository(pool, scope);
  const area = {
    type: 'Polygon',
    coordinates: [
      [
        [10, 20],
        [11, 20],
        [11, 21],
        [10, 20],
      ],
    ],
  };
  const record: SkillInputResolutionRecord = {
    resolutionId: `${run}-target-input`,
    taskId,
    goalId: goalContract.goalId,
    goalVersion: goalContract.version,
    skillId,
    skillVersion: 1,
    structuredInput: { area, frame: 'EPSG:4326' },
    unresolvedFields: [],
    sourceRefs: ['fixture:explicit-user-input'],
    decisionSummary: 'Validated synthetic area',
    status: 'resolved',
    createdAt: timestamp,
  };
  await inputs.save(record);
  assert.deepEqual(await inputs.find(record.resolutionId), record);
  const planned: WorkflowDefinition = {
    executionSemanticsVersion: '2.0',
    workflowDefinitionId: `${run}-spatial-definition`,
    version: 1,
    goalId: goalContract.goalId,
    goalVersion: goalContract.version,
    entryNodeId: 'move',
    exitNodeIds: ['done'],
    nodes: [
      {
        nodeId: 'move',
        name: 'move',
        type: 'mcp_tool',
        tool: { serverId, toolName: 'move' },
        arguments: {
          destination: { x: 10.25, y: 20.25 },
          frame: 'EPSG:4326',
          route: {
            type: 'LineString',
            coordinates: [
              [10, 20],
              [10.25, 20.25],
            ],
          },
        },
      },
      { nodeId: 'done', name: 'done', type: 'result', value: { op: 'literal', value: true } },
    ],
    edges: [{ sourceNodeId: 'move', targetNodeId: 'done' }],
  };
  const resultNode = planned.nodes[1];
  assert.ok(resultNode);
  const plans = new PostgresWorkflowPlanRepository(pool, undefined, scope);
  const plan: WorkflowPlanRecord = {
    planId: `${run}-spatial-plan`,
    executionTaskId: taskId,
    goalId: goalContract.goalId,
    goalVersion: goalContract.version,
    goalContract,
    definition: planned,
    confirmationStatus: 'awaiting_confirmation',
    attemptCount: 1,
    createdAt: timestamp,
  };
  await plans.savePlan(plan);
  assert.deepEqual((await plans.findPlan(plan.planId))?.definition, planned);
  const ownerRows = await pool.query<{
    owner_kind: string;
    owner_key: unknown;
    geometry_kind: string;
    normalized: boolean;
  }>(
    `SELECT b.owner_kind,b.owner_key,g.geometry_kind,g.geometry_wgs84 IS NOT NULL AS normalized
       FROM gowm_task.target_binding b JOIN gowm_task.target_geometry g USING(target_id,data_scope_key)
       WHERE b.device_id=$1 ORDER BY b.owner_kind,g.geometry_kind`,
    [scope.allowedDeviceIds[0]],
  );
  assert.equal(ownerRows.rows.length, 3);
  assert.deepEqual(
    ownerRows.rows.map((r) => [r.owner_kind, r.geometry_kind, r.normalized]),
    [
      ['PLAN_NODE', 'LINESTRING', true],
      ['PLAN_NODE', 'POINT', true],
      ['TASK', 'POLYGON', true],
    ],
  );
  assert.deepEqual(ownerRows.rows.find((r) => r.owner_kind === 'TASK')?.owner_key, { taskId });
  assert.deepEqual(ownerRows.rows.find((r) => r.owner_kind === 'PLAN_NODE')?.owner_key, {
    planId: plan.planId,
    nodeId: 'move',
  });
  const geometryCount = async () =>
    Number(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM gowm_task.target_geometry WHERE data_scope_key=$1',
          [`TEST:${run}`],
        )
      ).rows[0]?.count,
    );
  const before = await geometryCount();
  await Promise.all(
    [1, 2].map((index) =>
      inputs.save({ ...record, resolutionId: `${record.resolutionId}-repeat-${String(index)}` }),
    ),
  );
  assert.equal(await geometryCount(), before);
  const conflictId = `${record.resolutionId}-conflict`;
  await assert.rejects(
    inputs.save({
      ...record,
      resolutionId: conflictId,
      structuredInput: { area: { type: 'Point', coordinates: [11, 22] }, frame: 'EPSG:4326' },
    }),
    /TARGET_BINDING_CONFLICT/u,
  );
  assert.equal(await inputs.find(conflictId), undefined);
  assert.equal(await geometryCount(), before);

  const otherDevice = new PostgresSkillInputResolutionRepository(pool, {
    ...scope,
    allowedDeviceIds: [otherDeviceId],
  });
  assert.equal(await otherDevice.find(record.resolutionId), undefined);
  await assert.rejects(
    otherDevice.save({ ...record, resolutionId: `${record.resolutionId}-denied` }),
    /SKILL_INPUT_DEVICE_SCOPE_DENIED/u,
  );

  const missingCrs = {
    ...record,
    resolutionId: `${record.resolutionId}-missing-crs`,
    structuredInput: { area },
  };
  await inputs.save(missingCrs);
  assert.deepEqual((await inputs.find(missingCrs.resolutionId))?.structuredInput, { area });
  assert.equal(await geometryCount(), before);
  const diagnostic = await pool.query<{ summary: string }>(
    "SELECT summary FROM runtime_event WHERE task_id=$1 AND event_type='task.target_diagnostic'",
    [taskId],
  );
  assert.equal(diagnostic.rowCount, 1);
  const diagnosticData: unknown = JSON.parse(diagnostic.rows[0]?.summary ?? 'null');
  assert.ok(
    typeof diagnosticData === 'object' && diagnosticData !== null && 'code' in diagnosticData,
  );
  assert.equal(diagnosticData.code, 'TARGET_CRS_UNRESOLVED');

  const localDefinition: WorkflowDefinition = {
    ...planned,
    version: 2,
    nodes: [
      {
        nodeId: 'move',
        name: 'move',
        type: 'mcp_tool',
        tool: { serverId, toolName: 'move' },
        arguments: { destination: { x: 5000, y: 6000 }, frame: 'GAME:local-map' },
      },
      resultNode,
    ],
  };
  const successor = {
    ...plan,
    planId: `${plan.planId}-v2`,
    definition: localDefinition,
    sourcePlanId: plan.planId,
  };
  await plans.savePlanAndSupersede(successor, plan.planId);
  assert.equal((await plans.findPlan(plan.planId))?.confirmationStatus, 'superseded');
  const local = await pool.query<{
    native_crs: string;
    normalization_state: string;
    empty: boolean;
    native_geometry: unknown;
  }>(
    `SELECT g.native_crs,g.normalization_state,g.geometry_wgs84 IS NULL AS empty,g.native_geometry
       FROM gowm_task.target_binding b JOIN gowm_task.target_geometry g USING(target_id,data_scope_key)
       WHERE b.owner_key=$1::jsonb`,
    [JSON.stringify({ planId: successor.planId, nodeId: 'move' })],
  );
  assert.deepEqual(local.rows, [
    {
      native_crs: 'GAME:local-map',
      normalization_state: 'NATIVE_ONLY',
      empty: true,
      native_geometry: { type: 'Point', coordinates: [5000, 6000] },
    },
  ]);
  assert.equal(await geometryCount(), before + 1);

  // A self-intersecting ring passes basic shape checks but must fail PostGIS.
  // It rolls back the entire native input record, not only the geometry insert.
  const invalid = {
    ...record,
    taskId: `${run}-task-1`,
    resolutionId: `${run}-invalid-polygon`,
    structuredInput: {
      area: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      frame: 'EPSG:4326',
    },
  };
  await assert.rejects(inputs.save(invalid), /check constraint/u);
  assert.equal(await inputs.find(invalid.resolutionId), undefined);
  assert.equal(await geometryCount(), before + 1);
  const failedSuccessorId = `${successor.planId}-invalid`;
  const failedSuccessor: WorkflowPlanRecord = {
    ...successor,
    planId: failedSuccessorId,
    definition: {
      ...localDefinition,
      version: 3,
      nodes: [
        {
          nodeId: 'move',
          name: 'move',
          type: 'mcp_tool',
          tool: { serverId, toolName: 'move' },
          arguments: {
            destination: { x: 1, y: 2 },
            frame: 'EPSG:4326',
            route: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 1],
                  [0, 1],
                  [1, 0],
                  [0, 0],
                ],
              ],
            },
          },
        },
        resultNode,
      ],
    },
  };
  await assert.rejects(
    plans.savePlanAndSupersede(failedSuccessor, successor.planId),
    /check constraint/u,
  );
  assert.equal(await plans.findPlan(failedSuccessorId), undefined);
  assert.equal(
    (await plans.findPlan(successor.planId))?.confirmationStatus,
    'awaiting_confirmation',
  );
  assert.equal(await geometryCount(), before + 1);
  return [
    'Native input/Plan transactions bind distinct Polygon REQUESTED and Point/LineString PLANNED owners; DSL aliases round-trip',
    'Concurrent identical targets reuse geometry; conflicting inputs roll back; other-device input reads/writes are denied',
    'Missing CRS records a persistent diagnostic without geometry; successor Plan preserves local coordinates and prior targets',
    'PostGIS rejects self-intersecting geometry and rolls back native Input/Plan writes and supersession with no orphan target',
  ];
}
