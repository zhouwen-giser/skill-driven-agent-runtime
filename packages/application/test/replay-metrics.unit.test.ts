import { describe, expect, it } from 'vitest';

import { VALIDATION_METRIC_CATALOG_VERSION, ValidationMetricCatalog } from '../src/index.js';

describe('P05 versioned Validation Metric Catalog', () => {
  it('defines transparent aggregation metadata for every required metric', () => {
    const definitions = new ValidationMetricCatalog().list();
    expect(definitions).toHaveLength(29);
    expect(definitions[0]?.version).toBe(VALIDATION_METRIC_CATALOG_VERSION);
    expect(
      definitions.every(
        (item) =>
          item.unit.length > 0 &&
          item.direction.length > 0 &&
          item.denominator.length > 0 &&
          item.aggregation.length > 0 &&
          item.nullPolicy.length > 0 &&
          item.minimumSample >= 1,
      ),
    ).toBe(true);
    expect(definitions.map((item) => item.metricId)).toEqual(
      expect.arrayContaining([
        'criterion_coverage',
        'unsafe_allow_count',
        'missed_confirmation_count',
        'false_positive',
        'false_negative',
        'planning_latency_ms',
        'estimated_cost_units',
      ]),
    );
    expect(definitions.map((item) => item.metricId)).not.toContain('validation_score');
  });

  it('rejects opaque, unknown and non-finite metrics', () => {
    const catalog = new ValidationMetricCatalog();
    expect(() => {
      catalog.validate({ validation_score: 0.9 });
    }).toThrow(/VALIDATION_METRIC_UNKNOWN/u);
    expect(() => {
      catalog.validate({ criterion_coverage: Number.NaN });
    }).toThrow(/VALIDATION_METRIC_VALUE_INVALID/u);
  });
});
