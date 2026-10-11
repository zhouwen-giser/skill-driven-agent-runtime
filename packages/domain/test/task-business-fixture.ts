import catalog from '../../../contracts/smpp-task-business/v1.3/positive-catalog.json' with { type: 'json' };
import {
  normalizeTaskBusinessView,
  type TaskBusinessIdentity,
  type TaskBusinessView,
} from '../src/task-business.js';

export function taskBusinessFixture(
  overrides: Partial<TaskBusinessIdentity> = {},
): TaskBusinessView {
  const identity = { ...catalog.context.identity, ...overrides };
  return normalizeTaskBusinessView(
    {
      context: { ...structuredClone(catalog.context), identity },
      objects: [
        { kind: 'action', value: { ...structuredClone(catalog.action), identity } },
        { kind: 'input_request', value: { ...structuredClone(catalog.requiredInput), identity } },
        { kind: 'intervention', value: { ...structuredClone(catalog.intervention), identity } },
        ...catalog.artifacts
          .filter((artifact) => artifact.artifactId === 'route-line')
          .map((value) => ({ kind: 'artifact', value: { ...structuredClone(value), identity } })),
      ],
      resumeFrom: { streamId: 'public-stream-1', afterSequence: '12' },
    },
    identity,
  );
}
