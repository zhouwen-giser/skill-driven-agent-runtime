const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const ZMQ_ZERO_HEIGHT_PROFILE = 'zmq_v1_3_0_site_control_13';
/** Concrete values and provenance enter the immutable plan before human confirmation. */
export function resolveZmqRegionHeights(value: unknown) {
  if (
    !record(value) ||
    !record(value['area']) ||
    !Array.isArray(value['area']['vertices']) ||
    value['area']['vertices'].length !== 4
  )
    throw Error('ZMQ_REGION_DEFAULT_INPUT_INVALID');
  const vertices = value['area']['vertices'].map((p: unknown) => {
    if (
      !record(p) ||
      (p['ellipsoidHeightM'] !== undefined &&
        (typeof p['ellipsoidHeightM'] !== 'number' || !Number.isFinite(p['ellipsoidHeightM'])))
    )
      throw Error('ZMQ_REGION_HEIGHT_INVALID');
    const source =
      p['ellipsoidHeightSource'] ??
      (p['ellipsoidHeightM'] === undefined ? 'default_zero' : 'provided');
    if (
      typeof source !== 'string' ||
      !['provided', 'default_zero'].includes(source) ||
      (source === 'provided' && p['ellipsoidHeightM'] === undefined) ||
      (source === 'default_zero' &&
        p['ellipsoidHeightM'] !== undefined &&
        p['ellipsoidHeightM'] !== 0)
    )
      throw Error('ZMQ_HEIGHT_PROVENANCE_MISMATCH');
    return {
      ...p,
      ellipsoidHeightM: p['ellipsoidHeightM'] ?? 0,
      ellipsoidHeightSource:
        source === 'provided' ? ('provided' as const) : ('default_zero' as const),
    };
  });
  return { ...value, area: { ...value['area'], vertices } };
}
