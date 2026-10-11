const BUSINESS_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    outcome: Object.freeze({ type: 'string', minLength: 1 }),
    reasonCode: Object.freeze({ type: 'string', minLength: 1 }),
    retryable: Object.freeze({ type: 'boolean' }),
    completedAt: Object.freeze({ type: 'string', format: 'date-time' }),
  }),
  required: Object.freeze(['outcome', 'reasonCode', 'retryable', 'completedAt']),
  additionalProperties: true,
});

/**
 * Resolves the success Schema from the exact UGV Provider result wrapper.
 *
 * The wrapper must contain exactly one branch equal to the pinned Provider business-result Schema
 * and one other object branch. Success-specific Schema checks remain with the Profile consumer.
 */
export function resolveUgvProfileProviderSuccessOutputSchema(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const wrapper = jsonObject(value);
  if (
    wrapper === undefined ||
    !sameKeys(wrapper, ['type', 'anyOf']) ||
    wrapper['type'] !== 'object' ||
    !Array.isArray(wrapper['anyOf']) ||
    wrapper['anyOf'].length !== 2
  )
    return undefined;

  const branches = wrapper['anyOf'].map(jsonObject);
  if (branches.some((branch) => branch === undefined)) return undefined;
  const objectBranches = branches as readonly Readonly<Record<string, unknown>>[];
  const businessIndexes = objectBranches.flatMap((branch, index) =>
    canonicalEqual(branch, BUSINESS_RESULT_SCHEMA) ? [index] : [],
  );
  if (businessIndexes.length !== 1) return undefined;

  return objectBranches[businessIndexes[0] === 0 ? 1 : 0];
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function sameKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function canonicalEqual(left: unknown, right: unknown, active = new Set<object>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== 'object') return false;
  if (active.has(left)) return false;
  active.add(left);
  try {
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((item, index) => canonicalEqual(item, right[index], active))
      );
    }
    const leftRecord = jsonObject(left);
    const rightRecord = jsonObject(right);
    if (leftRecord === undefined || rightRecord === undefined) return false;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && canonicalEqual(leftRecord[key], rightRecord[key], active),
      )
    );
  } finally {
    active.delete(left);
  }
}
