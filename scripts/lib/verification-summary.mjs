import { bootstrapSteps } from './verification-steps.mjs';

// Read historical aggregate reports explicitly; never fill missing current stages from history.
export function bootstrapVerificationResult(summary) {
  if (summary.status !== 'passed') throw new Error('VERIFICATION_NOT_PASSED');
  function required(name) {
    const matches = summary.steps.filter((step) => step.name === name);
    const step = matches[0];
    if (
      matches.length !== 1 ||
      step.status !== 'passed' ||
      step.error !== undefined ||
      step.reason !== undefined ||
      (step.exitCode !== undefined && step.exitCode !== 0)
    )
      throw new Error(`VERIFICATION_STAGE_INVALID:${name}`);
    return step;
  }
  if (summary.schemaVersion === 1) return required('static-unit-contract-build');
  if (summary.schemaVersion !== 2 || summary.scope !== 'full' || summary.pendingSteps?.length !== 0)
    throw new Error('VERIFICATION_SUMMARY_INCOMPLETE');
  for (const [name] of bootstrapSteps) required(name);
  const testStages = [required('unit'), required('contract')];
  const metrics = {};
  for (const metric of ['tests', 'testFiles']) {
    if (testStages.some((stage) => !Number.isSafeInteger(stage.metrics?.[metric])))
      throw new Error(`VERIFICATION_METRIC_MISSING:${metric}`);
    metrics[metric] = testStages.reduce((total, stage) => total + stage.metrics[metric], 0);
  }
  metrics.openapiOperations = required('management-openapi').metrics?.openapiOperations;
  if (!Number.isSafeInteger(metrics.openapiOperations))
    throw new Error('VERIFICATION_METRIC_MISSING:openapiOperations');
  return { status: 'passed', metrics };
}
