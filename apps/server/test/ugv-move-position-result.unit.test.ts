import { describe, expect, it } from 'vitest';

import {
  UgvMoveOutcomeConfigurationError,
  assessUgvMoveOutcome,
  haversineDistanceM,
  type UgvMoveOutcomeAssessmentInput,
  type UgvMoveOutcomeFailureCode,
  type UgvMoveStateRead,
} from '../src/ugv-move-position-result.js';

const RESOURCE_ID = 'vehicle:ugv1';
const TARGET = Object.freeze({ longitude: 121.4737, latitude: 31.2304 });
const FINAL_POSITION = Object.freeze({ longitude: 121.47371, latitude: 31.2304 });
const INITIAL_POSITION = Object.freeze({ longitude: 121.4727, latitude: 31.2304 });
const POLICY = Object.freeze({
  toleranceM: 2,
  minimumDisplacementM: 10,
  maxFinalStateAgeMs: 3_000,
});
const GOLDEN_PROVIDER_CURSOR =
  'oc1.eyJ2ZXJzaW9uIjoxLCJraW5kIjoiZmllbGQiLCJmaWVsZCI6ImNoYXNzaXMucG9zaXRpb24uZ2VvZGV0aWMiLCJ0b3BpYyI6Ii91Z3YvZ25zcyIsIm9ic2VydmVkQXQiOiIyMDI2LTA4LTIxVDEyOjAwOjA5LjkwMFoiLCJ0aW1lQXV0aG9yaXR5Ijoic291cmNlIiwiaW5nZXN0U2VxdWVuY2UiOjEwMSwicGF5bG9hZEhhc2giOiJkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkIn0';

describe('UGV move final-position outcome gate', () => {
  it('completes only with fresh post-terminal state evidence within the 2 m Haversine tolerance', () => {
    const assessment = assessUgvMoveOutcome(validAssessmentInput());

    expect(assessment.status).toBe('completed');
    if (assessment.status !== 'completed') return;
    expect(assessment.reasonCode).toBe('UGV_MOVE_FINAL_POSITION_CONFIRMED');
    expect(assessment.evidence).toMatchObject({
      evidenceType: 'position.observation',
      resourceId: RESOURCE_ID,
      correlationId: 'corr-move-1',
      remoteTaskId: 'provider-task-1',
      providerRuntimeRevision: 'runtime-revision-7',
      providerSnapshotRevision: 'provider-snapshot-101',
      initialStateRevision: 'state-revision-100',
      finalStateRevision: 'state-revision-102',
      initialCursor: '100',
      providerCursor: providerCursor(101),
      finalCursor: '102',
      coordinateReferenceSystem: 'WGS84',
      coordinateOrder: 'longitude_latitude',
      toleranceM: 2,
      minimumDisplacementM: 10,
    });
    expect(assessment.evidence.distanceToTargetM).toBeLessThanOrEqual(2);
    expect(assessment.evidence.distanceToTargetM).toBeCloseTo(
      haversineDistanceM(FINAL_POSITION, TARGET),
      12,
    );
    expect(assessment.evidence.displacementM).toBeGreaterThanOrEqual(10);
    expect(providerCursor(101)).toBe(GOLDEN_PROVIDER_CURSOR);
  });

  it('accepts a legitimate local Provider terminal authority while requiring geodetic final state', () => {
    const observedAt = '2026-08-21T12:00:09.900Z';
    const assessment = assessUgvMoveOutcome(
      validAssessmentInput({
        providerTerminal: providerTerminal({
          positionField: 'chassis.position.local',
          positionTopic: '/ugv/nav_state',
          cursor: providerCursor(101, observedAt, 'chassis.position.local', '/ugv/nav_state'),
        }),
      }),
    );

    expect(assessment.status).toBe('completed');
  });

  it('accepts field-authority-gated aggregate geodetic evidence for the exact live execution', () => {
    const observedAt = '2026-08-21T12:00:09.900Z';
    const assessment = assessUgvMoveOutcome(
      validAssessmentInput({
        expectedExecutionMode: 'live',
        initialState: stateRead({
          startedAt: '2026-08-21T11:59:59.000Z',
          completedAt: '2026-08-21T11:59:59.900Z',
          observedAt: '2026-08-21T11:59:59.800Z',
          revision: 'state-revision-100',
          cursor: 100,
          position: INITIAL_POSITION,
          executionMode: 'live',
        }),
        providerTerminal: providerTerminal({
          positionTopic: 'status/ugv1',
          timeAuthority: 'ingest',
          cursor: providerCursor(
            101,
            observedAt,
            'chassis.position.geodetic',
            'status/ugv1',
            undefined,
            'ingest',
          ),
        }),
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
          executionMode: 'live',
        }),
      }),
    );

    expect(assessment.status).toBe('completed');
  });

  it('rejects aggregate geodetic evidence without its exact ingest-time authority', () => {
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({ positionTopic: 'status/ugv1' }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
  });

  it('does not impose ordering between independent mission and position timestamps', () => {
    expect(
      assessUgvMoveOutcome(
        validAssessmentInput({
          providerTerminal: providerTerminal({
            resultObservedAt: '2026-08-21T12:00:09.800Z',
            positionObservedAt: '2026-08-21T12:00:09.900Z',
          }),
        }),
      ).status,
    ).toBe('completed');
  });

  it('requires an explicit positive tolerance, displacement threshold, and freshness policy', () => {
    const { policy, ...withoutPolicy } = validAssessmentInput();
    expect(policy).toBe(POLICY);
    expectConfigurationError(withoutPolicy);
    expectConfigurationError(
      validAssessmentInput({ policy: { ...POLICY, minimumDisplacementM: 0 } }),
    );
    expectConfigurationError(validAssessmentInput({ policy: { ...POLICY, toleranceM: 2.001 } }));
    expectConfigurationError(
      validAssessmentInput({ policy: { ...POLICY, maxFinalStateAgeMs: 3_001 } }),
    );
  });

  it('treats Provider completion as necessary but not sufficient without a final get-state read', () => {
    const { finalState, ...withoutFinalState } = validAssessmentInput();
    expect(finalState).toBeDefined();

    expectFailure(withoutFinalState, 'failed', 'UGV_MOVE_FINAL_STATE_REQUIRED');
  });

  it.each([0, 2] as const)('requires exactly one navigation dispatch, not %s', (count) => {
    expectFailure(
      validAssessmentInput({
        executionAudit: { navigationDispatchCount: count, forbiddenOperationCount: 0 },
      }),
      'failed',
      'UGV_MOVE_DISPATCH_CARDINALITY_INVALID',
    );
  });

  it('rejects any observed forbidden operation before evaluating Provider success', () => {
    expectFailure(
      validAssessmentInput({
        executionAudit: { navigationDispatchCount: 1, forbiddenOperationCount: 1 },
      }),
      'failed',
      'UGV_MOVE_FORBIDDEN_OPERATION_OBSERVED',
    );
  });

  it.each([
    { longitude: Number.NaN, latitude: 31.2304 },
    { longitude: 180.001, latitude: 31.2304 },
    { longitude: 121.4737, latitude: -90.001 },
  ])('rejects an invalid target authority before Haversine evaluation: %j', (target) => {
    expectFailure(validAssessmentInput({ target }), 'failed', 'UGV_MOVE_TARGET_INVALID');
  });

  it('rejects a final get-state read that starts before the Provider terminal observation', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:09.999Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL',
    );
  });

  it.each([
    ['dispatch timestamp', { dispatchedAt: 'not-a-time' }],
    ['assessment timestamp', { assessedAt: 'not-a-time' }],
    [
      'Provider terminal timestamp',
      { providerTerminal: { ...providerTerminal(), observedAt: 'not-a-time' } },
    ],
    ['remote Task identity', { providerTerminal: { ...providerTerminal(), remoteTaskId: '   ' } }],
    [
      'Provider Runtime revision',
      { providerTerminal: { ...providerTerminal(), runtimeRevision: '' } },
    ],
    ['correlation identity', { correlationId: '' }],
  ] as const)('rejects an invalid %s without accepting terminal success', (_label, override) => {
    expectFailure(validAssessmentInput(override), 'failed', 'UGV_MOVE_PROVIDER_RESULT_INVALID');
  });

  it('requires post-dispatch Provider position authority with a finite timestamp', () => {
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({ observationAuthority: 'baseline_or_unknown' }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({ positionObservedAt: 'not-a-time' }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({
          positionObservedAt: '2026-08-21T11:59:59.999Z',
          cursor: providerCursor(101, '2026-08-21T11:59:59.999Z'),
        }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({
          resultObservedAt: '2026-08-21T11:59:59.999Z',
        }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
  });

  it.each([
    {
      field: 'chassis.position.geodetic' as const,
      topic: '/evil',
    },
    {
      field: 'chassis.position.local' as const,
      topic: '/ugv/gnss',
    },
  ])(
    'rejects the non-authoritative Provider field/topic pair $field -> $topic',
    ({ field, topic }) => {
      expectFailure(
        validAssessmentInput({
          providerTerminal: providerTerminal({
            positionField: field,
            positionTopic: topic,
            cursor: providerCursor(101, '2026-08-21T12:00:09.900Z', field, topic),
          }),
        }),
        'failed',
        'UGV_MOVE_PROVIDER_RESULT_INVALID',
      );
    },
  );

  it('rejects invalid read timestamps and an initial read completed after dispatch', () => {
    for (const initialState of [
      stateRead({
        startedAt: 'not-a-time',
        completedAt: '2026-08-21T11:59:59.900Z',
        observedAt: '2026-08-21T11:59:59.800Z',
        revision: 'state-revision-100',
        cursor: 100,
        position: INITIAL_POSITION,
      }),
      stateRead({
        startedAt: '2026-08-21T11:59:59.000Z',
        completedAt: '2026-08-21T12:00:00.001Z',
        observedAt: '2026-08-21T11:59:59.800Z',
        revision: 'state-revision-100',
        cursor: 100,
        position: INITIAL_POSITION,
      }),
    ])
      expectFailure(
        validAssessmentInput({ initialState }),
        'failed',
        'UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL',
      );

    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: 'not-a-time',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL',
    );
    expectFailure(
      validAssessmentInput({
        assessedAt: '2026-08-21T12:00:10.400Z',
      }),
      'failed',
      'UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL',
    );
  });

  it('rejects an initial observation whose authority timestamp is after dispatch', () => {
    expectFailure(
      validAssessmentInput({
        initialState: stateRead({
          startedAt: '2026-08-21T11:59:59.000Z',
          completedAt: '2026-08-21T11:59:59.900Z',
          observedAt: '2026-08-21T12:00:01.001Z',
          revision: 'state-revision-100',
          cursor: 100,
          position: INITIAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
  });

  it('uses chassis freshness, not a newer aggregate snapshot timestamp', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          chassisObservedAt: '2026-08-21T12:00:07.999Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
  });

  it('rejects a final chassis authority timestamp even 1 ms before dispatch', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          chassisObservedAt: '2026-08-21T11:59:59.999Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
  });

  it('rejects position authority beyond the frozen 1000 ms future-skew allowance', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          chassisObservedAt: '2026-08-21T12:00:12.001Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
    expectFailure(
      validAssessmentInput({
        providerTerminal: providerTerminal({
          positionObservedAt: '2026-08-21T12:00:11.001Z',
          cursor: providerCursor(101, '2026-08-21T12:00:11.001Z'),
        }),
      }),
      'failed',
      'UGV_MOVE_PROVIDER_RESULT_INVALID',
    );
  });

  it('rejects missing chassis freshness and a stale initial position', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          chassisObservedAt: null,
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_FINAL_POSITION_INVALID',
    );
    expectFailure(
      validAssessmentInput({
        initialState: stateRead({
          startedAt: '2026-08-21T11:59:56.000Z',
          completedAt: '2026-08-21T11:59:59.900Z',
          observedAt: '2026-08-21T11:59:59.900Z',
          chassisObservedAt: '2026-08-21T11:59:56.999Z',
          revision: 'state-revision-100',
          cursor: 100,
          position: INITIAL_POSITION,
        }),
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
  });

  it('rejects state evidence from a different Provider identity', () => {
    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
          providerId: 'isr.vehicle.ugv.other',
        }),
      }),
      'failed',
      'UGV_MOVE_FINAL_POSITION_INVALID',
    );
  });

  it('rejects state evidence whose execution mode differs from the frozen selection', () => {
    expectFailure(
      validAssessmentInput({ expectedExecutionMode: 'live' }),
      'failed',
      'UGV_MOVE_FINAL_POSITION_INVALID',
    );
  });

  it.each(['102', -1, Number.MAX_SAFE_INTEGER + 1] as const)(
    'rejects a non-authoritative MQTT ingress sequence %s',
    (cursor) => {
      expectFailure(
        validAssessmentInput({
          finalState: stateRead({
            startedAt: '2026-08-21T12:00:10.100Z',
            completedAt: '2026-08-21T12:00:10.500Z',
            observedAt: '2026-08-21T12:00:10.400Z',
            revision: 'state-revision-102',
            cursor,
            position: FINAL_POSITION,
          }),
        }),
        'failed',
        'UGV_MOVE_FINAL_POSITION_INVALID',
      );
    },
  );

  it.each([
    {
      label: 'belongs to another resource',
      input: validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: FINAL_POSITION,
          resourceId: 'vehicle:ugv2',
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_RESOURCE_MISMATCH',
    },
    {
      label: 'declares a Provider correlation mismatch',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({ correlationStrength: 'MISMATCH' }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CORRELATION_MISMATCH',
    },
    {
      label: 'reuses the initial state revision',
      input: validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-100',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_REVISION_MISMATCH',
    },
    {
      label: 'has an empty final state revision',
      input: validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: '   ',
          cursor: 102,
          position: FINAL_POSITION,
        }),
      }),
      code: 'UGV_MOVE_FINAL_POSITION_INVALID',
    },
    {
      label: 'omits the Provider snapshot revision',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({ snapshotRevision: '   ' }),
      }),
      code: 'UGV_MOVE_EVIDENCE_REVISION_MISMATCH',
    },
    {
      label: 'has a cursor topic beyond the frozen maximum length',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({
          cursor: providerCursor(
            101,
            '2026-08-21T12:00:09.900Z',
            'chassis.position.geodetic',
            `/${'t'.repeat(2_048)}`,
          ),
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'has a cursor timestamp outside strict RFC 3339 syntax',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({
          positionObservedAt: '2026-08-21 12:00:09Z',
          cursor: providerCursor(101, '2026-08-21 12:00:09Z'),
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'has an oversized cursor source sequence',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({
          cursor: providerCursor(
            101,
            '2026-08-21T12:00:09.900Z',
            'chassis.position.geodetic',
            '/ugv/gnss',
            's'.repeat(1_025),
          ),
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'has a cursor whose embedded topic differs',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({
          cursor: providerCursor(
            101,
            '2026-08-21T12:00:09.900Z',
            'chassis.position.geodetic',
            '/ugv/nav_state',
          ),
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'has a cursor whose embedded authority timestamp differs',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({
          cursor: providerCursor(101, '2026-08-21T12:00:09.800Z'),
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'equals the initial observation cursor',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({ cursor: providerCursor(100) }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'uses a Provider cursor older than the initial observation',
      input: validAssessmentInput({
        providerTerminal: providerTerminal({ cursor: providerCursor(99) }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
    {
      label: 'does not advance beyond the Provider cursor',
      input: validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 100,
          position: FINAL_POSITION,
        }),
      }),
      code: 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH',
    },
  ] as const)('fails closed when final evidence $label', ({ input, code }) => {
    expectFailure(input, 'failed', code);
  });

  it('rejects stale post-dispatch position evidence', () => {
    expectFailure(
      validAssessmentInput({
        assessedAt: '2026-08-21T12:00:20.000Z',
      }),
      'failed',
      'UGV_MOVE_EVIDENCE_STALE',
    );
  });

  it('uses Haversine distance and rejects a final position outside the explicit 2 m tolerance', () => {
    const outsideTolerance = Object.freeze({ longitude: 121.47373, latitude: 31.2304 });
    expect(haversineDistanceM(outsideTolerance, TARGET)).toBeGreaterThan(2);

    expectFailure(
      validAssessmentInput({
        finalState: stateRead({
          startedAt: '2026-08-21T12:00:10.100Z',
          completedAt: '2026-08-21T12:00:10.500Z',
          observedAt: '2026-08-21T12:00:10.400Z',
          revision: 'state-revision-102',
          cursor: 102,
          position: outsideTolerance,
        }),
      }),
      'failed',
      'UGV_MOVE_FINAL_POSITION_OUT_OF_TOLERANCE',
    );
  });

  it('requires movement to exceed the explicitly configured discernible-displacement threshold', () => {
    expectFailure(
      validAssessmentInput({ policy: { ...POLICY, minimumDisplacementM: 200 } }),
      'failed',
      'UGV_MOVE_DISPLACEMENT_NOT_DISCERNIBLE',
    );
  });

  it.each([
    {
      status: 'failed',
      expectedStatus: 'failed',
      code: 'UGV_MOVE_PROVIDER_TASK_FAILED',
    },
    {
      status: 'cancelled',
      expectedStatus: 'cancelled',
      code: 'UGV_MOVE_PROVIDER_TASK_CANCELLED',
    },
    {
      status: 'working',
      expectedStatus: 'uncertain',
      code: 'UGV_MOVE_PROVIDER_TASK_NOT_TERMINAL',
    },
  ] as const)(
    'does not complete a Provider task in $status state',
    ({ status, expectedStatus, code }) => {
      expectFailure(
        validAssessmentInput({ providerTerminal: { ...providerTerminal(), status } }),
        expectedStatus,
        code,
      );
    },
  );
});

function validAssessmentInput(
  overrides: Partial<UgvMoveOutcomeAssessmentInput> = {},
): UgvMoveOutcomeAssessmentInput {
  return {
    resourceId: RESOURCE_ID,
    expectedProviderId: 'isr.vehicle.ugv.ugv1',
    expectedExecutionMode: 'simulation',
    correlationId: 'corr-move-1',
    dispatchedAt: '2026-08-21T12:00:00.000Z',
    assessedAt: '2026-08-21T12:00:11.000Z',
    target: TARGET,
    policy: POLICY,
    initialState: stateRead({
      startedAt: '2026-08-21T11:59:59.000Z',
      completedAt: '2026-08-21T11:59:59.900Z',
      observedAt: '2026-08-21T11:59:59.800Z',
      revision: 'state-revision-100',
      cursor: 100,
      position: INITIAL_POSITION,
    }),
    providerTerminal: providerTerminal(),
    finalState: stateRead({
      startedAt: '2026-08-21T12:00:10.100Z',
      completedAt: '2026-08-21T12:00:10.500Z',
      observedAt: '2026-08-21T12:00:10.400Z',
      revision: 'state-revision-102',
      cursor: 102,
      position: FINAL_POSITION,
    }),
    executionAudit: { navigationDispatchCount: 1, forbiddenOperationCount: 0 },
    ...overrides,
  };
}

function providerTerminal(
  overrides: Readonly<{
    resourceId?: string;
    snapshotRevision?: string;
    cursor?: string;
    correlationStrength?: 'STRICT_CORRELATED' | 'WEAK_UNCORRELATED' | 'MISMATCH';
    positionObservedAt?: string;
    observationAuthority?: string;
    resultObservedAt?: string;
    positionField?: 'chassis.position.geodetic' | 'chassis.position.local';
    positionTopic?: string;
    timeAuthority?: 'source' | 'ingest';
  }> = {},
): UgvMoveOutcomeAssessmentInput['providerTerminal'] {
  const {
    resourceId = RESOURCE_ID,
    snapshotRevision = 'provider-snapshot-101',
    cursor = providerCursor(101),
    correlationStrength = 'STRICT_CORRELATED',
    positionObservedAt = '2026-08-21T12:00:09.900Z',
    observationAuthority = 'post_dispatch',
    resultObservedAt = '2026-08-21T12:00:10.000Z',
    positionField = 'chassis.position.geodetic',
    positionTopic = '/ugv/gnss',
    timeAuthority = 'source',
  } = overrides;
  return {
    status: 'completed',
    remoteTaskId: 'provider-task-1',
    runtimeRevision: 'runtime-revision-7',
    observedAt: '2026-08-21T12:00:10.000Z',
    result: {
      resourceId,
      status: 'completed',
      observedAt: resultObservedAt,
      snapshotRevision,
      correlationStrength,
      observationAuthority,
      positionAuthority: {
        field: positionField,
        topic: positionTopic,
        observedAt: positionObservedAt,
        timeAuthority,
        cursor,
      },
    },
  };
}

function stateRead(
  input: Readonly<{
    startedAt: string;
    completedAt: string;
    observedAt: string;
    chassisObservedAt?: string | null;
    revision: string;
    cursor: number | string;
    position: Readonly<{ longitude: number; latitude: number }>;
    resourceId?: string;
    providerId?: string;
    executionMode?: 'simulation' | 'live';
  }>,
): UgvMoveStateRead {
  return {
    operationName: 'vehicle_get_state',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: {
      identity: {
        providerId: input.providerId ?? 'isr.vehicle.ugv.ugv1',
        resourceId: input.resourceId ?? RESOURCE_ID,
        vehicleType: 'ugv',
        executionMode: input.executionMode ?? 'simulation',
      },
      connectivity: {
        mqttConnected: true,
        deviceMcpConnected: true,
      },
      observedAt: input.observedAt,
      freshness:
        input.chassisObservedAt === null
          ? {}
          : { chassisObservedAt: input.chassisObservedAt ?? input.observedAt },
      revision: input.revision,
      mqttIngressSequence: input.cursor,
      chassis: { position: input.position },
    },
  };
}

function providerCursor(
  ingestSequence: number,
  observedAt = '2026-08-21T12:00:09.900Z',
  field: 'chassis.position.geodetic' | 'chassis.position.local' = 'chassis.position.geodetic',
  topic = '/ugv/gnss',
  sourceSequence?: string,
  timeAuthority: 'source' | 'ingest' = 'source',
): string {
  const payload = {
    version: 1,
    kind: 'field',
    field,
    topic,
    observedAt,
    timeAuthority,
    ...(sourceSequence === undefined ? {} : { sourceSequence }),
    ingestSequence,
    payloadHash: 'd'.repeat(64),
  };
  return `oc1.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function expectFailure(
  input: UgvMoveOutcomeAssessmentInput,
  status: 'failed' | 'cancelled' | 'uncertain',
  reasonCode: UgvMoveOutcomeFailureCode,
): void {
  expect(assessUgvMoveOutcome(input)).toEqual({ status, reasonCode });
}

function expectConfigurationError(input: UgvMoveOutcomeAssessmentInput): void {
  try {
    assessUgvMoveOutcome(input);
    expect.unreachable('expected the missing position policy to fail closed');
  } catch (error) {
    expect(error).toBeInstanceOf(UgvMoveOutcomeConfigurationError);
    expect(error).toMatchObject({ code: 'UGV_MOVE_POSITION_POLICY_REQUIRED' });
  }
}
