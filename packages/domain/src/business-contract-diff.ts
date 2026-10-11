import { isDeepStrictEqual } from 'node:util';

export interface BusinessContractDifference {
  readonly pointer: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly impact: 'requires_successor';
}

/** Contract data only. Differences never authorize refreshing a frozen Task. */
export function diffBusinessContract(
  before: unknown,
  after: unknown,
): readonly BusinessContractDifference[] {
  const result: BusinessContractDifference[] = [];
  const visit = (left: unknown, right: unknown, pointer: string): void => {
    if (isDeepStrictEqual(left, right)) return;
    if (isObject(left) && isObject(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort())
        visit(
          left[key],
          right[key],
          `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        );
    } else {
      result.push(
        Object.freeze({ pointer, before: left, after: right, impact: 'requires_successor' }),
      );
    }
  };
  visit(before, after, '');
  return Object.freeze(result);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
