import { describe, expect, it } from 'vitest';
import {
  normalizeTaskBusinessView,
  projectTaskBusiness,
  taskBusinessObjectRef,
  taskBusinessContentDigest,
} from '../src/task-business.js';
import { taskBusinessFixture } from './task-business-fixture.js';

const time = '2026-10-10T12:00:00.000Z';
describe('native TaskBusiness projection', () => {
  it.each(['taskId', 'executionId', 'providerId', 'resourceId', 'operationName'] as const)(
    'AC-007 rejects a foreign %s',
    (field) => {
      const view = taskBusinessFixture();
      expect(() =>
        normalizeTaskBusinessView(
          {
            ...view,
            objects: [
              {
                ...view.objects[0],
                value: {
                  ...view.objects[0]?.value,
                  identity: { ...view.context.identity, [field]: 'foreign' },
                },
              },
            ],
          },
          view.context.identity,
        ),
      ).toThrow(/TASK_BUSINESS_(IDENTITY|EXECUTION)_CONFLICT/u);
    },
  );
  it('AC-008 distinguishes references, required content resolution, and stream history', () => {
    const view = taskBusinessFixture();
    const partial = projectTaskBusiness({
      bindingId: 'binding-1',
      taskId: 'task-1',
      view,
      contents: [],
      receivedAt: time,
      projectedAt: time,
      historyContinuous: false,
    });
    expect(partial.quality).toMatchObject({
      currentStateComplete: false,
      requiredObjectsResolved: false,
      historyContinuous: false,
    });
    const contents = view.objects.map((object) => {
      const bytes = Buffer.from(JSON.stringify(object.value));
      return {
        ref: taskBusinessObjectRef(object),
        identity: object.value.identity,
        bytes,
        metadata: object.value,
        digest: taskBusinessContentDigest(bytes),
      };
    });
    const complete = projectTaskBusiness({
      bindingId: 'binding-1',
      taskId: 'task-1',
      view,
      contents,
      receivedAt: time,
      projectedAt: time,
      historyContinuous: false,
    });
    expect(complete.quality).toMatchObject({
      currentStateComplete: true,
      requiredObjectsResolved: true,
      historyContinuous: false,
    });
    expect(complete.interactionRequests).toHaveLength(1);
    expect(complete.allowedInterventions).toHaveLength(1);
    expect(
      complete.objects.every(
        (object) => object.contentRef?.startsWith('sdar-task-business://binding-1/') === true,
      ),
    ).toBe(true);
  });
  it('AC-005/034 never fills source clocks with snapshot or local receipt time', () => {
    const view = taskBusinessFixture();
    const base = {
      bindingId: 'binding-1',
      taskId: 'task-1',
      view,
      contents: [],
      receivedAt: time,
      projectedAt: time,
      historyContinuous: true,
      sourceTimeQualified: true,
    };
    expect(projectTaskBusiness(base).sourceTime).toBeUndefined();
    const qualified = {
      ...view,
      context: {
        ...view.context,
        summary: {
          ...view.context.summary,
          properties: {
            trajectoryLast: {
              observedAt: '2026-10-10T11:59:00+00:00',
              deviceReportedAt: '2026-10-10T11:00:00Z',
            },
          },
        },
      },
    };
    expect(projectTaskBusiness({ ...base, view: qualified })).toMatchObject({
      sourceTime: '2026-10-10T11:59:00+00:00',
      sourceTimeBasis: 'provider_received_at',
      sdarReceivedAt: time,
      projectedAt: time,
    });
    expect(projectTaskBusiness(base).quality.gaps).toContain('provider_receive_time_unavailable');
  });
  it('AC-035 preserves late source time and exposes reversal and future clocks', () => {
    const view = taskBusinessFixture();
    const input = {
      bindingId: 'binding-1',
      taskId: 'task-1',
      contents: [],
      receivedAt: time,
      projectedAt: time,
      historyContinuous: true,
      sourceTimeQualified: true,
    };
    const timed = (observedAt: string) => ({
      ...view,
      context: {
        ...view.context,
        summary: { status: 'in_progress' as const, properties: { trajectoryLast: { observedAt } } },
      },
    });
    const previous = projectTaskBusiness({ ...input, view: timed('2026-10-10T11:59:00Z') });
    const late = projectTaskBusiness({ ...input, view: timed('2026-10-10T11:58:00Z'), previous });
    expect(late.sourceTime).toBe('2026-10-10T11:58:00Z');
    expect(late.quality.gaps).toContain('source_time_reversed');
    expect(
      projectTaskBusiness({ ...input, view: timed('2026-10-10T13:00:00Z') }).quality.gaps,
    ).toContain('source_time_in_future');
  });
});
