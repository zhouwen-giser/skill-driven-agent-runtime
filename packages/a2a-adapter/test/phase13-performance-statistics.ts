export function phase13NearestRank(samples: readonly number[], quantile: number): number {
  if (samples.length === 0 || !Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error('P13_PERFORMANCE_PERCENTILE_INPUT_INVALID');
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const value = ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)];
  if (value === undefined) throw new Error('P13_PERFORMANCE_SAMPLES_MISSING');
  return value;
}

export function phase13Median(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('P13_PERFORMANCE_MEDIAN_SAMPLES_MISSING');
  const ordered = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) throw new Error('P13_PERFORMANCE_MEDIAN_SAMPLES_MISSING');
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  if (lower === undefined) throw new Error('P13_PERFORMANCE_MEDIAN_SAMPLES_MISSING');
  return (lower + upper) / 2;
}

export function phase13RegressionPercent(baseline: number, candidate: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(candidate)) {
    throw new Error('P13_PERFORMANCE_REGRESSION_INPUT_INVALID');
  }
  return ((candidate - baseline) / baseline) * 100;
}

export function phase13SymmetricDriftPercent(left: number, right: number): number {
  if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right) || right <= 0) {
    throw new Error('P13_PERFORMANCE_DRIFT_INPUT_INVALID');
  }
  return (Math.abs(right - left) / ((left + right) / 2)) * 100;
}

export function phase13MaximumPairwiseDriftPercent(samples: readonly number[]): number {
  if (samples.length < 2) throw new Error('P13_PERFORMANCE_DRIFT_SAMPLES_MISSING');
  let maximum = 0;
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      const leftValue = samples[left];
      const rightValue = samples[right];
      if (leftValue === undefined || rightValue === undefined) {
        throw new Error('P13_PERFORMANCE_DRIFT_SAMPLES_MISSING');
      }
      maximum = Math.max(maximum, phase13SymmetricDriftPercent(leftValue, rightValue));
    }
  }
  return maximum;
}

export function phase13Round(value: number): number {
  return Number(value.toFixed(3));
}
