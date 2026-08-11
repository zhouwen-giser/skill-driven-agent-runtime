import { describe, expect, it } from 'vitest';

import {
  phase13MaximumPairwiseDriftPercent,
  phase13Median,
  phase13NearestRank,
  phase13RegressionPercent,
} from './phase13-performance-statistics.js';

describe('Phase 13 performance statistics', () => {
  it('computes odd and even medians without rounding the authoritative value', () => {
    expect(phase13Median([1])).toBe(1);
    expect(phase13Median([1, 2])).toBe(1.5);
    expect(phase13Median([3, 1, 2])).toBe(2);
  });

  it('uses the unrounded nearest-rank P95 and regression at the frozen boundary', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(phase13NearestRank(samples, 0.95)).toBe(19);
    expect(phase13RegressionPercent(100, 110.0004)).toBeGreaterThan(10);
    expect(phase13NearestRank([...Array.from({ length: 19 }, () => 1), 20.0004], 0.95)).toBe(1);
    expect(phase13NearestRank([...Array.from({ length: 18 }, () => 1), 20.0004, 30], 0.95)).toBe(
      20.0004,
    );
  });

  it('checks baseline stability across every pair of measured windows', () => {
    expect(phase13MaximumPairwiseDriftPercent([100, 110, 105])).toBeCloseTo((10 / 105) * 100);
  });
});
