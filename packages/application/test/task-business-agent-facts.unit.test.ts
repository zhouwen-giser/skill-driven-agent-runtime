import { describe, expect, it } from 'vitest';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import { projectTaskBusiness } from '../../domain/src/task-business.js';
import { taskBusinessAgentFacts } from '../src/task-business-agent-facts.js';

describe('TaskBusiness model input budget', () => {
  it('AC-016/017 retains exact content references while explicitly bounding aggregate model facts', () => {
    const view = taskBusinessFixture();
    const projection = projectTaskBusiness({
      bindingId: 'binding-1',
      taskId: 'task-1',
      view: {
        ...view,
        context: {
          ...view.context,
          summary: { ...view.context.summary, properties: { providerText: 'x'.repeat(31_000) } },
        },
      },
      contents: [],
      historyContinuous: false,
      receivedAt: '2026-10-10T12:00:00.000Z',
      projectedAt: '2026-10-10T12:00:00.000Z',
    });
    const result = taskBusinessAgentFacts(
      Array.from({ length: 128 }, (_, index) => ({
        ...projection,
        bindingId: `binding-${String(index)}`,
      })),
    );
    expect(Buffer.byteLength(JSON.stringify(result.items))).toBeLessThanOrEqual(result.byteBudget);
    expect(result.items.length + result.omittedProjectionCount).toBe(128);
    expect(result.omittedProjectionCount).toBeGreaterThan(0);
    expect(result.completeness).toBe('bounded_partial');
    expect(result.items[0]).toMatchObject({
      quality: { historyContinuous: false },
      objects: projection.objects,
    });
    expect(JSON.stringify(result)).not.toContain('authorize');
  });
});
