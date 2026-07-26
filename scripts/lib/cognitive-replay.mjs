import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function generateReplayArtifact(options = {}) {
  const root = process.cwd();
  const fixturePath = resolve(
    root,
    options.fixturePath ?? 'tests/replay/cognitive/promotion.fixture.json',
  );
  const outputPath = resolve(
    root,
    options.outputPath ?? 'reports/v1.2.3-replay/promotion-report.json',
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const application = await import(
    resolve(root, 'dist/packages/application/src/index.js')
  );
  const domain = await import(resolve(root, 'dist/packages/domain/src/index.js'));
  const evaluator = {
    evaluate(testCase) {
      const candidateMetrics =
        fixture.candidateMetrics[testCase.episodeId] ?? testCase.baselineMetrics;
      return Promise.resolve({
        baseline: variant(domain, testCase, 'baseline', testCase.baselineMetrics),
        champion: variant(domain, testCase, 'champion', testCase.baselineMetrics),
        candidate: variant(domain, testCase, 'candidate', candidateMetrics),
        receipt: {
          sideEffectClass: 'none',
          providerCalls: 0,
          mcpCalls: 0,
          deviceCalls: 0,
        },
      });
    },
  };
  const generator = new application.PromotionReportGenerator({
    datasets: new application.PlanningReplayDatasetBuilder({
      load: () => Promise.resolve(fixture.records),
    }),
    shadow: new application.ShadowPlanningService({
      evaluator,
      physicalProvider: new application.NoPhysicalProvider(),
    }),
  });
  const report = await generator.generate(fixture.candidate);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.check === true) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== serialized) throw new Error('COGNITIVE_REPLAY_ARTIFACT_STALE');
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized);
  }
  return { report, fixturePath, outputPath };
}

function variant(domain, testCase, name, metrics) {
  const hardFailures =
    metrics.hardFailureCount === 0 ? [] : [`fixture-hard-failure:${testCase.caseId}`];
  return domain.createReplayVariantResult({
    caseId: testCase.caseId,
    variant: name,
    valid: true,
    safe: metrics.riskScore < 1,
    metrics,
    hardFailures,
    outputHash: `sha256:${createHash('sha256')
      .update(JSON.stringify([testCase.caseId, name, metrics, hardFailures]))
      .digest('hex')}`,
  });
}
