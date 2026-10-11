/** Detached JSON-domain candidate data, recursively frozen before leaving the generator. */
export function immutablePlanningSnapshot<T>(input: T): T {
  return freeze(structuredClone(input));
}
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
