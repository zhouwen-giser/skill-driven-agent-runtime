export const VALIDATION_METRIC_CATALOG_VERSION = 'sdar-validation-metrics/1.1' as const;

export type ValidationMetricDirection = 'higher_better' | 'lower_better' | 'neutral';
export type ValidationMetricNullPolicy =
  'zero_when_denominator_zero' | 'unknown_when_missing' | 'not_applicable';
export type ValidationMetricAggregation = 'mean' | 'sum' | 'p50' | 'p95' | 'count' | 'ratio';

export interface ValidationMetricDefinition {
  readonly metricId: string;
  readonly unit: string;
  readonly direction: ValidationMetricDirection;
  readonly nullPolicy: ValidationMetricNullPolicy;
  readonly denominator: string;
  readonly aggregation: ValidationMetricAggregation;
  readonly minimumSample: number;
  readonly confidenceInterval: 'wilson_95' | 'bootstrap_95' | 'not_applicable';
  readonly version: typeof VALIDATION_METRIC_CATALOG_VERSION;
}

const DEFINITIONS: readonly ValidationMetricDefinition[] = Object.freeze(
  [
    metric(
      'goal_success_match',
      'ratio',
      'higher_better',
      'all replay cases',
      'ratio',
      1,
      'wilson_95',
    ),
    metric(
      'criterion_coverage',
      'ratio',
      'higher_better',
      'all required criteria',
      'ratio',
      1,
      'wilson_95',
    ),
    metric(
      'evidence_completeness',
      'ratio',
      'higher_better',
      'all required evidence',
      'ratio',
      1,
      'wilson_95',
    ),
    metric(
      'artifact_correctness',
      'ratio',
      'higher_better',
      'all required artifacts',
      'ratio',
      1,
      'wilson_95',
    ),
    metric(
      'outcome_regression',
      'count',
      'lower_better',
      'all comparable historical outcomes',
      'sum',
      1,
    ),
    metric(
      'activity_fitness',
      'ratio',
      'higher_better',
      'all required historical activities',
      'mean',
      1,
      'bootstrap_95',
    ),
    metric(
      'precision_proxy',
      'ratio',
      'higher_better',
      'all candidate branches',
      'mean',
      1,
      'bootstrap_95',
    ),
    metric(
      'generalization_proxy',
      'ratio',
      'higher_better',
      'independent holdout cases',
      'mean',
      3,
      'bootstrap_95',
    ),
    metric(
      'variant_coverage',
      'ratio',
      'higher_better',
      'all accepted variants',
      'ratio',
      1,
      'wilson_95',
    ),
    metric(
      'unexpected_branch_rate',
      'ratio',
      'lower_better',
      'all candidate branches',
      'ratio',
      1,
      'wilson_95',
    ),
    metric('unsafe_allow_count', 'count', 'lower_better', 'all policy decisions', 'sum', 1),
    metric(
      'missed_confirmation_count',
      'count',
      'lower_better',
      'all confirmation-required decisions',
      'sum',
      1,
    ),
    metric(
      'false_positive',
      'count',
      'lower_better',
      'all authority-negative rule cases',
      'sum',
      1,
    ),
    metric(
      'false_negative',
      'count',
      'lower_better',
      'all authority-positive rule cases',
      'sum',
      1,
    ),
    metric('side_effect_attempt_count', 'count', 'lower_better', 'all replay operations', 'sum', 1),
    metric(
      'planning_latency_ms',
      'milliseconds',
      'lower_better',
      'completed plan replay cases',
      'p95',
      1,
      'bootstrap_95',
    ),
    metric('model_call_count', 'count', 'lower_better', 'all replay cases', 'sum', 1),
    metric('token_input', 'tokens', 'lower_better', 'all replay cases', 'sum', 1),
    metric('token_output', 'tokens', 'lower_better', 'all replay cases', 'sum', 1),
    metric('estimated_cost_units', 'cost_units', 'lower_better', 'all replay cases', 'sum', 1),
    metric('plan_node_count', 'count', 'neutral', 'all replay plans', 'mean', 1),
    metric('human_interaction_count', 'count', 'lower_better', 'all replay cases', 'sum', 1),
    metric('fallback_count', 'count', 'lower_better', 'all replay cases', 'sum', 1),
    metric('plan_edit_distance', 'count', 'lower_better', 'all comparable plans', 'mean', 1),
    metric('user_patch_count', 'count', 'lower_better', 'all replay cases', 'sum', 1),
    metric('rejected_candidate_count', 'count', 'lower_better', 'all replay cases', 'sum', 1),
    metric('missing_parameter_count', 'count', 'lower_better', 'all required parameters', 'sum', 1),
    metric('capability_gap_count', 'count', 'lower_better', 'all required capabilities', 'sum', 1),
    metric(
      'readiness_gap_count',
      'count',
      'lower_better',
      'all required ready capabilities',
      'sum',
      1,
    ),
  ].sort((left, right) => left.metricId.localeCompare(right.metricId)),
);

export class ValidationMetricCatalog {
  list(): readonly ValidationMetricDefinition[] {
    return DEFINITIONS;
  }

  require(metricId: string): ValidationMetricDefinition {
    const definition = DEFINITIONS.find((item) => item.metricId === metricId);
    if (definition === undefined) throw new Error(`VALIDATION_METRIC_UNKNOWN:${metricId}`);
    return definition;
  }

  validate(metrics: Readonly<Record<string, number>>): void {
    for (const [metricId, value] of Object.entries(metrics)) {
      this.require(metricId);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`VALIDATION_METRIC_VALUE_INVALID:${metricId}`);
      }
    }
  }
}

function metric(
  metricId: string,
  unit: string,
  direction: ValidationMetricDirection,
  denominator: string,
  aggregation: ValidationMetricAggregation,
  minimumSample: number,
  confidenceInterval: ValidationMetricDefinition['confidenceInterval'] = 'not_applicable',
): ValidationMetricDefinition {
  return Object.freeze({
    metricId,
    unit,
    direction,
    nullPolicy:
      denominator === 'all replay cases'
        ? ('unknown_when_missing' as const)
        : ('zero_when_denominator_zero' as const),
    denominator,
    aggregation,
    minimumSample,
    confidenceInterval,
    version: VALIDATION_METRIC_CATALOG_VERSION,
  });
}
