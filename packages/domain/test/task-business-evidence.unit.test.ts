import { describe, expect, it } from 'vitest';
import catalog from '../../../contracts/smpp-task-business/v1.3/positive-catalog.json' with { type: 'json' };
import { taskBusinessFixture } from './task-business-fixture.js';
import {
  projectTaskBusiness,
  taskBusinessContentDigest,
  type TaskBusinessContent,
} from '../src/task-business.js';
import {
  assessTaskBusinessOutcome,
  buildTaskBusinessSourceArtifact,
  summarizeTaskBusinessGeometry,
  taskBusinessContentFromStoredObject,
  taskBusinessEvidencePolicySchema,
} from '../src/task-business-evidence.js';
import {
  assertRuntimeSourceArtifactRef,
  validateRuntimeSourceArtifactRef,
} from '../src/evidence/source-artifact-ref.js';

const view = taskBusinessFixture();
const projection = projectTaskBusiness({
  bindingId: 'binding-1',
  taskId: 'task-1',
  view,
  contents: [],
  receivedAt: '2026-10-10T12:00:00Z',
  projectedAt: '2026-10-10T12:00:00Z',
  historyContinuous: false,
});
const policy = taskBusinessEvidencePolicySchema.parse({
  schemaVersion: 'sdar.task-business-evidence-policy/v1',
  operationName: 'vehicle_area_recon',
  providerSuccess: { jsonPointer: '/resultCode', equals: 'RECON_COMPLETE' },
  skillSuccess: { jsonPointer: '/success', equals: true },
  requiredGeometryRoles: [],
  requireHistoryContinuity: false,
  requireTrajectoryTime: false,
});
function content(
  metadata: Readonly<Record<string, unknown>>,
  bytes = Buffer.from(JSON.stringify(metadata['content'])),
): TaskBusinessContent {
  return {
    identity: view.context.identity,
    ref: { kind: 'artifact', id: String(metadata['artifactId']), revision: 1 },
    metadata: { ...metadata, identity: view.context.identity },
    bytes,
    digest: taskBusinessContentDigest(bytes),
  };
}
describe('Task business outcome and original source evidence', () => {
  it('AC-035 retains duplicate and reversed coordinates in Provider order without manufacturing sample clocks', () => {
    const coordinates = [
      [106.802, 29.7],
      [106.802, 29.7],
      [106.801, 29.7],
    ];
    const bytes = Buffer.from(
      JSON.stringify({
        kind: 'geojson',
        crs: 'OGC:CRS84',
        geometry: { type: 'LineString', coordinates },
      }),
    );
    const original = content(
      {
        artifactId: 'raw-duplicates',
        artifactType: 'navigation.trajectory',
        semantics: 'observed',
        lifecycle: 'active',
        properties: { sampleCount: 3 },
      },
      bytes,
    );
    const summary = summarizeTaskBusinessGeometry(original, view);
    expect(summary).toMatchObject({
      retainedCoordinateCount: 3,
      providerSampleCount: 3,
      sampleOrder: 'provider_retained_order',
      perSampleSourceTimeComplete: false,
      rawContentComplete: true,
      gaps: expect.arrayContaining(['provider_trajectory_has_no_per_sample_receive_time']),
    });
    const artifact = buildTaskBusinessSourceArtifact('obs-duplicates', original);
    const decoded = JSON.parse(artifact.canonicalJson) as { bytes: string };
    const recovered = Buffer.from(decoded.bytes, 'base64');
    expect(recovered.equals(bytes)).toBe(true);
    expect(JSON.parse(recovered.toString('utf8'))).toEqual({
      kind: 'geojson',
      crs: 'OGC:CRS84',
      geometry: { type: 'LineString', coordinates },
    });
    expect(summary).not.toHaveProperty('sampleTimes');
  });
  it('AC-031/037 keeps completed, business failure/partial/unknown and original Provider reason independent', () => {
    const assess = (
      resultSnapshot: NonNullable<
        Parameters<typeof assessTaskBusinessOutcome>[0]['binding']['resultSnapshot']
      >,
    ) =>
      assessTaskBusinessOutcome({
        binding: { protocolStatus: 'completed', resultSnapshot },
        operationName: 'vehicle_area_recon',
        geometry: [],
        quality: { ...projection.quality, requiredObjectsResolved: true },
        policy,
      });
    expect(
      assess({
        isError: true,
        content: [],
        structuredContent: {
          outcome: 'business_failure',
          reasonCode: 'SENSOR_LOST',
          retryable: false,
        },
      }),
    ).toMatchObject({
      protocolStatus: 'completed',
      businessStatus: 'failure',
      reasonCode: 'SENSOR_LOST',
    });
    expect(
      assess({
        isError: true,
        content: [],
        structuredContent: {
          outcome: 'partial_completion',
          reasonCode: 'COVERAGE_PARTIAL',
          retryable: false,
          partialResult: { percent: 12 },
        },
      }),
    ).toMatchObject({ businessStatus: 'partial', reasonCode: 'COVERAGE_PARTIAL' });
    expect(
      assess({ isError: false, content: [], structuredContent: { resultCode: 'unknown' } })
        .businessStatus,
    ).toBe('unknown');
    expect(
      assess({ isError: false, content: [], structuredContent: { resultCode: 'RECON_COMPLETE' } })
        .businessStatus,
    ).toBe('success');
    expect(
      assessTaskBusinessOutcome({
        binding: {
          protocolStatus: 'completed',
          resultSnapshot: {
            isError: false,
            content: [],
            structuredContent: { resultCode: 'RECON_COMPLETE' },
          },
        },
        operationName: 'vehicle_area_recon',
        geometry: [],
        quality: projection.quality,
        policy: { ...policy, requireHistoryContinuity: true, requireTrajectoryTime: true },
      }).gaps,
    ).toEqual(expect.arrayContaining(['business_event_history_gap', 'trajectory_source_time_gap']));
  });
  it('AC-032/036 uses frozen geometry types, exact adopted route and preserves unavailable sample time and derived coverage', () => {
    const geometries = catalog.artifacts
      .filter((item) =>
        [
          'destination-point',
          'route-line',
          'trajectory-multi-line',
          'area-polygon',
          'covered-multi-polygon',
        ].includes(item.artifactId),
      )
      .map((item) => summarizeTaskBusinessGeometry(content(item), view));
    expect(geometries.map((item) => item.role)).toEqual([
      'requested_target',
      'planned_route',
      'actual_trajectory',
      'observation_area',
      'other',
    ]);
    expect(geometries[2]).toMatchObject({
      perSampleSourceTimeComplete: false,
      rawContentComplete: true,
      coordinateOrder: 'longitude_latitude',
    });
    expect(geometries[4]?.gaps).toContain('derived_coverage_has_no_measured_quality');
    const route = catalog.artifacts.find((item) => item.artifactId === 'route-line');
    expect(route).toBeDefined();
    expect(
      summarizeTaskBusinessGeometry(content(route ?? {}), {
        ...view,
        context: {
          ...view.context,
          summary: {
            status: 'in_progress',
            properties: {
              effectiveNavigation: {
                routeRef: { kind: 'artifact', id: 'route-line', revision: 1 },
              },
            },
          },
        },
      }).role,
    ).toBe('adopted_route');
    const fov = summarizeTaskBusinessGeometry(
      content({
        ...route,
        artifactType: 'recon.current_footprint',
        semantics: 'derived',
        properties: { quality: 'estimated', model: 'nominal_fov' },
      }),
      view,
    );
    expect(fov.role).toBe('estimated_fov');
    expect(fov.gaps).toContain('estimated_geometry_is_not_measured_coverage');
  });
  it('AC-036 retains an expired estimated footprint as history and exposes a conflicting CRS without converting coordinates', () => {
    const route = catalog.artifacts.find((item) => item.artifactId === 'route-line');
    if (route === undefined) throw new Error('FROZEN_ROUTE_FIXTURE_REQUIRED');
    const original = content({
      ...route,
      artifactType: 'recon.current_footprint',
      semantics: 'derived',
      validUntil: '2026-10-10T00:01:00Z',
      properties: { quality: 'estimated', model: 'nominal_fov' },
    });
    const current = summarizeTaskBusinessGeometry(original, view, '2026-10-10T00:00:00Z');
    const expired = summarizeTaskBusinessGeometry(original, view, '2026-10-10T00:02:00Z');
    expect(current).toMatchObject({ role: 'estimated_fov', current: true });
    expect(expired).toMatchObject({
      role: 'estimated_fov',
      current: false,
      rawContentComplete: true,
    });
    expect(expired.gaps).toContain('geometry_validity_expired');
    expect(Buffer.from(original.bytes).equals(Buffer.from(JSON.stringify(route.content)))).toBe(
      true,
    );
    const conflicting = content(
      route,
      Buffer.from(
        JSON.stringify({
          ...route.content,
          crs: 'EPSG:3857',
        }),
      ),
    );
    expect(summarizeTaskBusinessGeometry(conflicting, view)).toMatchObject({
      crs: 'EPSG:3857',
      coordinateOrder: 'unspecified',
      gaps: expect.arrayContaining(['geometry_crs_conflict_no_conversion_performed']),
    });
  });
  it('AC-033 keeps a large original trajectory byte-for-byte through bounded chunks and canonical ArtifactRef and rejects missing/modified chunks', () => {
    const bytes = Buffer.from(
      JSON.stringify({
        crs: 'OGC:CRS84',
        geometry: {
          type: 'LineString',
          coordinates: Array.from({ length: 100_000 }, (_, i) => [106 + i / 1_000_000, 29]),
        },
      }),
    );
    expect(bytes.length).toBeGreaterThan(1_048_576);
    const original = content(
      {
        artifactId: 'large-trajectory',
        artifactType: 'navigation.trajectory',
        semantics: 'observed',
        properties: { sampleCount: 100_000 },
      },
      bytes,
    );
    const chunks = Array.from({ length: Math.ceil(bytes.length / 49152) }, (_, i) => ({
      recordType: 'task_business.content',
      digest: original.digest,
      offset: i * 49152,
      totalBytes: bytes.length,
      bytes: bytes.subarray(i * 49152, (i + 1) * 49152).toString('base64'),
    }));
    const object = {
      recordType: 'task_business.object',
      refKey: JSON.stringify(['artifact', 'large-trajectory', 1]),
      digest: original.digest,
      metadata: original.metadata,
    };
    const restored = taskBusinessContentFromStoredObject(object, chunks);
    expect(Buffer.from(restored.bytes).equals(bytes)).toBe(true);
    const artifact = buildTaskBusinessSourceArtifact('obs-large', restored);
    expect(validateRuntimeSourceArtifactRef(artifact.artifactRef).sourceTable).toBe(
      'remote_task_observation',
    );
    expect(() => {
      assertRuntimeSourceArtifactRef(
        { ...artifact.artifactRef, sha256: `sha256:${'0'.repeat(64)}` },
        artifact,
      );
    }).toThrow(/integrity/u);
    expect(() => taskBusinessContentFromStoredObject(object, chunks.slice(1))).toThrow();
    expect(() =>
      taskBusinessContentFromStoredObject(object, [
        { ...chunks[0], bytes: 'YWJj' },
        ...chunks.slice(1),
      ]),
    ).toThrow();
    const decoded = JSON.parse(artifact.canonicalJson) as { bytes: string; rawSha256: string };
    expect(Buffer.from(decoded.bytes, 'base64').equals(bytes)).toBe(true);
    expect(decoded.rawSha256).toBe(`sha256:${original.digest}`);
  });
});
