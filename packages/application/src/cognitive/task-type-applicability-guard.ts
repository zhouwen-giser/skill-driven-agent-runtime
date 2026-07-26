import type {
  MissingDimensionKind,
  TaskTypeDefinitionSnapshot,
} from '../../../domain/src/index.js';

export type TaskTypeApplicabilityReason =
  | 'TASK_TYPE_CAPABILITY_UNAVAILABLE'
  | 'TASK_TYPE_CONSTRAINT_CONFLICT'
  | 'TASK_TYPE_NEGATIVE_EXAMPLE_MATCH'
  | 'TASK_TYPE_REQUIRED_DIMENSION_MISSING';

export interface TaskTypeApplicabilityResult {
  readonly applicable: boolean;
  readonly reasonCodes: readonly TaskTypeApplicabilityReason[];
}

export class TaskTypeApplicabilityGuard {
  evaluate(
    definition: TaskTypeDefinitionSnapshot,
    context: Readonly<{
      requestText: string;
      knownDimensions: readonly MissingDimensionKind[];
      userConstraints: readonly string[];
      availableCapabilities: readonly string[];
    }>,
  ): TaskTypeApplicabilityResult {
    const request = normalize(context.requestText);
    const knownDimensions = new Set(context.knownDimensions);
    const constraints = new Set(context.userConstraints.map(normalize));
    const capabilities = new Set(context.availableCapabilities.map(normalize));
    const reasons = new Set<TaskTypeApplicabilityReason>();
    if (
      definition.capabilityRequirements.some(
        (capability) => !capabilities.has(normalize(capability)),
      )
    ) {
      reasons.add('TASK_TYPE_CAPABILITY_UNAVAILABLE');
    }
    if (
      definition.incompatibleConstraints.some((constraint) =>
        constraints.has(normalize(constraint)),
      )
    ) {
      reasons.add('TASK_TYPE_CONSTRAINT_CONFLICT');
    }
    if (
      definition.recognition.negativeExamples.some((example) => {
        const tokens = normalize(example)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 4);
        return tokens.length > 0 && tokens.filter((token) => request.includes(token)).length >= 2;
      })
    ) {
      reasons.add('TASK_TYPE_NEGATIVE_EXAMPLE_MATCH');
    }
    if (definition.requiredDimensions.some((dimension) => !knownDimensions.has(dimension))) {
      reasons.add('TASK_TYPE_REQUIRED_DIMENSION_MISSING');
    }
    const reasonCodes = Object.freeze([...reasons].sort());
    return Object.freeze({ applicable: reasonCodes.length === 0, reasonCodes });
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}
