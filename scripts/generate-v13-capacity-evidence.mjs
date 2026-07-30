import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(root, 'reports', 'goal');
const capacityReportPath = path.join(reportDirectory, 'v1.3-final-capacity-report.json');
const sloReportPath = path.join(reportDirectory, 'v1.3-final-slo-report.json');
const classifications = new Set(['real-local', 'simulated', 'static', 'unverified']);

const sourcePaths = Object.freeze({
  contract:
    'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P13_Codex_Goal_Package_V1.1/CAPACITY-SLO-CONTRACT.md',
  requirements: 'docs/01_REQUIREMENTS_BASELINE.md',
  definitionOfDone: 'docs/16_DEFINITION_OF_DONE.md',
  traceability: 'docs/17_TRACEABILITY_MATRIX.md',
  p03: 'reports/goal/v1.3-p03-mining-report.json',
  p05: 'reports/goal/v1.3-p05-performance-report.json',
  p06Shadow: 'reports/goal/v1.3-p06-shadow-capacity-report.json',
  p07: 'reports/goal/v1.3-p07-performance-report.json',
  p08: 'reports/goal/v1.3-p08-performance-report.json',
  p08Handoff: 'reports/goal/v1.3-p08-handoff-transaction-report.json',
  p09: 'reports/goal/v1.3-p09-performance-report.json',
  p10: 'reports/goal/v1.3-p10-performance-report.json',
  p10Attribution: 'reports/goal/v1.3-p10-attribution-report.json',
  p10Deadline: 'reports/goal/v1.3-p10-deadline-report.json',
  p10Fallback: 'reports/goal/v1.3-p10-fallback-report.json',
  p10Resilience: 'reports/goal/v1.3-p10-resilience-report.json',
  p11: 'reports/goal/v1.3-p11-performance-report.json',
  p11Budget: 'reports/goal/v1.3-p11-budget-cost-report.json',
  p12: 'reports/goal/v1.3-p12-performance-report.json',
  p12Console: 'reports/goal/v1.3-p12-console-e2e-report.json',
  p12Sse: 'reports/goal/v1.3-p12-sse-report.json',
  nfrConcurrency: 'reports/EP-07-hardening-acceptance/NFR-PERF-001-context-concurrency.json',
  p07PerformanceTest:
    'packages/persistence-postgres/test/artifact-retrieval-p07.integration.test.ts',
  p09PerformanceTest: 'packages/domain/test/decision-rule-runtime-p09.unit.test.ts',
  p10PerformanceTest: 'packages/application/test/fast-gateway-p10.unit.test.ts',
  p12PerformanceTest:
    'packages/persistence-postgres/test/artifact-management-p12-performance.integration.test.ts',
});

const contractDimensions = Object.freeze({
  workloads: Object.freeze([
    'request_entry_fast_gateway',
    'exact_semantic_retrieval',
    'rule',
    'template',
    'formal_handoff',
    'cognitive_fallback',
    'case',
    'model_route_cascade',
    'feedback',
    'management_api',
    'console',
    'sse',
    'shadow',
    'replay',
    'compiler_workers',
  ]),
  data: Object.freeze([
    'active_artifact',
    'candidate',
    'experience_trace',
    'replay_case',
    'concurrent_request',
    'concurrent_operator',
    'sse_client',
    'queue_lag',
    'model_invocation',
    'tenant_count',
  ]),
  resources: Object.freeze([
    'cpu',
    'memory',
    'database_connection',
    'lock',
    'query',
    'index',
    'redis',
    'queue',
    'network',
    'token_cost',
    'storage_growth',
  ]),
  backpressure: Object.freeze([
    'gateway_load_shedding',
    'shadow_pause',
    'replay_compiler_low_priority',
    'model_rate_limit',
    'sse_slow_consumer',
    'feedback_queue',
    'management_rate_limit',
  ]),
  slo: Object.freeze([
    'availability',
    'error_rate',
    'latency_percentiles',
    'deadline_miss',
    'fast_path_added_latency',
    'formal_handoff',
    'fallback',
    'feedback_lag',
    'revalidation_lag',
    'console_load',
    'management_query',
    'sse_delivery',
    'queue_recovery',
  ]),
});

await main();

async function main() {
  try {
    const sources = await readSources();
    validateInputs(sources);
    const capacityReport = buildCapacityReport(sources);
    const sloReport = buildSloReport(sources, capacityReport);
    await validateCoverage(capacityReport, sloReport);
    await writeReports(capacityReport, sloReport);
    process.stdout.write(
      'P13 capacity/SLO evidence generated: local acceptance release-candidate evidence only; production SLO=false.\n',
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await writeFailureReports(reason);
    process.stderr.write(`P13 capacity/SLO evidence failed: ${reason}\n`);
    process.exitCode = 1;
  }
}

async function readSources() {
  const entries = await Promise.all(
    Object.entries(sourcePaths).map(async ([key, relativePath]) => {
      const content = await readFile(path.join(root, relativePath), 'utf8');
      const value = relativePath.endsWith('.json') ? JSON.parse(content) : content;
      return [
        key,
        Object.freeze({
          path: relativePath,
          content,
          value,
          sha256: createHash('sha256').update(content).digest('hex'),
        }),
      ];
    }),
  );
  return Object.freeze(Object.fromEntries(entries));
}

function validateInputs(sources) {
  const contract = sources.contract.content;
  for (const fragment of [
    'Request Entry / Fast Gateway',
    'Exact / Semantic Retrieval',
    'Active Artifact',
    'Concurrent Operator',
    'Model Invocation',
    'Database Connection',
    'Storage Growth',
    'Gateway Load Shedding',
    'Management Rate Limit',
  ]) {
    invariant(contract.includes(fragment), `CAPACITY_CONTRACT_FRAGMENT_MISSING:${fragment}`);
  }

  invariant(
    /NFR-PERF-001[\s\S]*1\s*[～~-]\s*10/u.test(sources.requirements.content),
    'NFR_PERF_001_APPROVED_RANGE_MISSING',
  );
  invariant(
    sources.traceability.content.includes('NFR-PERF-001') &&
      sources.traceability.content.includes('v1.3-p03-mining-report.json') &&
      sources.traceability.content.includes(
        'Local latency/concurrency evidence is explicitly not a production capacity SLO.',
      ),
    'CAPACITY_TRACEABILITY_EVIDENCE_MISSING',
  );
  invariant(
    /capacity|容量/iu.test(sources.definitionOfDone.content),
    'DEFINITION_OF_DONE_CAPACITY_CLASSIFICATION_MISSING',
  );

  const p03 = sources.p03.value;
  validatePackage(p03, 'SDAR-V1.3-P03');
  invariant(
    sameNumbers(
      p03.performance.mining.map((sample) => sample.traceCount),
      [1_000, 10_000],
    ),
    'P03_TRACE_SCALES_INVALID',
  );
  invariant(p03.performance.databaseQuery.traceCount === 10_000, 'P03_DB_SCALE_INVALID');
  invariant(p03.performance.workerThroughput.processedRuns === 100, 'P03_RUN_SCALE_INVALID');
  invariant(number(p03.performance.queueLag.queueLagMs) > 0, 'P03_QUEUE_LAG_INVALID');

  const p05 = sources.p05.value;
  validatePackage(p05, 'SDAR-V1.3-P05');
  invariant(number(p05.datasetBuild.cases1k.p50Ms) > 0, 'P05_1K_CASES_INVALID');
  invariant(number(p05.datasetBuild.cases10k.p50Ms) > 0, 'P05_10K_CASES_INVALID');
  invariant(p05.actualBullMqWorkers.workers === 4, 'P05_WORKER_SCALE_INVALID');
  invariant(p05.actualBullMqWorkers.completedPostgreSQLRuns === 12, 'P05_RUN_SCALE_INVALID');
  invariant(p05.postgresClaim.runs === 100, 'P05_CLAIM_SCALE_INVALID');

  const p07 = sources.p07.value;
  validatePackage(p07, 'SDAR-V1.3-P07');
  invariant(p07.measurement.samples === 25, 'P07_SAMPLE_COUNT_INVALID');
  invariant(number(p07.measurement.p95Ms) > 0, 'P07_P95_INVALID');
  invariant(
    sources.p07PerformanceTest.content.includes('expect(p95).toBeLessThan(100)'),
    'P07_FROZEN_TEST_BUDGET_MISSING',
  );

  const p08 = sources.p08.value;
  validatePackage(p08, 'SDAR-V1.3-P08');
  invariant(number(p08.observations.fullVerifyDurationMs) > 0, 'P08_VERIFY_DURATION_INVALID');
  invariant(/not a production SLO/iu.test(p08.scope), 'P08_CLASSIFICATION_INVALID');

  const p09 = sources.p09.value;
  validatePackage(p09, 'SDAR-V1.3-P09');
  invariant(
    sameNumbers(
      p09.conflictResolution30Samples.map((sample) => sample.ruleCount),
      [1, 10, 100, 1_000],
    ),
    'P09_RULE_SCALES_INVALID',
  );
  invariant(
    sources.p09PerformanceTest.content.includes('expect(elapsedMs).toBeLessThan(2_000)'),
    'P09_FROZEN_TEST_BUDGET_MISSING',
  );

  const p10 = sources.p10.value;
  validatePackage(p10, 'SDAR-V1.3-P10');
  invariant(
    sameNumbers(
      p10.concurrency.map((sample) => sample.requests),
      [1, 10, 100, 1_000],
    ),
    'P10_REQUEST_SCALES_INVALID',
  );
  invariant(p10.sequentialNoMatch.budgetMs === 25, 'P10_GATEWAY_BUDGET_INVALID');
  invariant(
    sources.p10PerformanceTest.content.includes('expect(results.at(-1)?.p99Ms).toBeLessThan(750)'),
    'P10_STRESS_TEST_BUDGET_MISSING',
  );

  const p11 = sources.p11.value;
  validatePackage(p11, 'SDAR-V1.3-P11');
  invariant(sameNumbers(p11.gatewayConcurrency, [1, 10, 100, 1_000]), 'P11_GATEWAY_SCALES_INVALID');
  invariant(p11.gatewayRegression.budgetMs === 25, 'P11_GATEWAY_BUDGET_INVALID');

  const p12 = sources.p12.value;
  validatePackage(p12, 'SDAR-V1.3-P12');
  invariant(
    sameNumbers(Object.keys(p12.artifactListMs).map(Number), [1_000, 10_000, 100_000]),
    'P12_ARTIFACT_SCALES_INVALID',
  );
  invariant(p12.concurrentOperators === 32, 'P12_OPERATOR_SCALE_INVALID');
  invariant(p12.a2aProjectionIterations === 10_000, 'P12_A2A_SCALE_INVALID');
  invariant(
    sources.p12PerformanceTest.content.includes('value % 20') &&
      sources.p12PerformanceTest.content.includes('length: 32'),
    'P12_TENANT_OPERATOR_TEST_EVIDENCE_MISSING',
  );
  for (const budget of [
    'expect(Math.max(...Object.values(scaleMs))).toBeLessThan(1_000)',
    'expect(concurrentOperatorsMs).toBeLessThan(2_000)',
    'expect(a2aTenThousandMs).toBeLessThan(2_000)',
  ]) {
    invariant(sources.p12PerformanceTest.content.includes(budget), 'P12_TEST_BUDGET_MISSING');
  }

  const nfr = sources.nfrConcurrency.value;
  invariant(nfr.requirement === 'NFR-PERF-001', 'NFR_CONCURRENCY_REPORT_INVALID');
  invariant(nfr.acceptance.maximumSupportedActiveTasks === 10, 'NFR_ACTIVE_TASK_LIMIT_INVALID');
  invariant(nfr.acceptance.sameContextStrictlySerial === true, 'NFR_CONTEXT_SERIAL_INVALID');
  invariant(nfr.acceptance.conversationStateCrossover === false, 'NFR_CONTEXT_CROSSOVER_INVALID');

  for (const key of [
    'p06Shadow',
    'p08Handoff',
    'p10Attribution',
    'p10Deadline',
    'p10Fallback',
    'p10Resilience',
    'p11Budget',
    'p12Console',
    'p12Sse',
  ]) {
    invariant(sources[key].value !== null, `SUPPORT_EVIDENCE_INVALID:${key}`);
  }
}

function buildCapacityReport(sources) {
  const p03 = sources.p03.value;
  const p05 = sources.p05.value;
  const p07 = sources.p07.value;
  const p08 = sources.p08.value;
  const p09 = sources.p09.value;
  const p10 = sources.p10.value;
  const p11 = sources.p11.value;
  const p12 = sources.p12.value;

  const workloadCoverage = [
    evidence(
      'request_entry_fast_gateway',
      'simulated',
      [sourcePaths.p10, sourcePaths.p10PerformanceTest],
      {
        measurements: p10.concurrency,
        limitation:
          'In-process Gateway harness with bounded adapters; request concurrency is not Formal active-task concurrency.',
      },
    ),
    evidence(
      'exact_semantic_retrieval',
      'real-local',
      [sourcePaths.p07, sourcePaths.p07PerformanceTest],
      {
        measurements: p07.measurement,
        limitation:
          'The PostgreSQL sample exercises active-index retrieval and durable audit; semantic-provider capacity is not isolated.',
      },
    ),
    evidence('rule', 'simulated', [sourcePaths.p09, sourcePaths.p09PerformanceTest], {
      measurements: p09.conflictResolution30Samples,
      limitation: 'Deterministic in-process Rule resolution; no network or Provider work.',
    }),
    evidence(
      'template',
      'simulated',
      [sourcePaths.p08, 'packages/application/test/template-runtime-p08.unit.test.ts'],
      {
        measurement: p08.observations.focusedRuntimeAndPlanningTests,
        limitation: 'Includes transform/import overhead and is not a per-template latency sample.',
      },
    ),
    evidence(
      'formal_handoff',
      'static',
      [sourcePaths.p08Handoff, 'packages/application/test/template-runtime-p08.unit.test.ts'],
      {
        verified: 'atomic existing planning authority handoff and stale rejection',
        limitation: 'No standalone Formal Handoff latency distribution was measured.',
      },
    ),
    evidence(
      'cognitive_fallback',
      'simulated',
      [sourcePaths.p10Fallback, sourcePaths.p10PerformanceTest],
      {
        verified: 'independent bounded fallback bulkhead and no-match fallback',
        limitation: 'No production model/network fallback latency.',
      },
    ),
    evidence(
      'case',
      'simulated',
      [sourcePaths.p11, 'packages/application/test/case-model-runtime-p11.unit.test.ts'],
      {
        boundedWork: p11.boundedWork,
        limitation:
          'Case matching is covered by deterministic local tests, not a production load run.',
      },
    ),
    evidence('model_route_cascade', 'simulated', [sourcePaths.p11, sourcePaths.p11Budget], {
      boundedWork: p11.boundedWork,
      limitation: 'Mock model/provider paths; no production model service rate or latency claim.',
    }),
    evidence(
      'feedback',
      'real-local',
      [
        sourcePaths.p10Attribution,
        'packages/persistence-postgres/test/fast-gateway-p10.integration.test.ts',
      ],
      {
        verified: 'idempotent PostgreSQL feedback and outcome-safe Outbox attribution',
        limitation: 'Feedback persistence lag is not separately sampled.',
      },
    ),
    evidence('management_api', 'real-local', [sourcePaths.p12, sourcePaths.p12PerformanceTest], {
      artifactListMs: p12.artifactListMs,
      concurrentOperators: p12.concurrentOperators,
      concurrentOperatorsMs: p12.concurrentOperatorsMs,
      limitation: 'Local Docker PostgreSQL and loopback process only.',
    }),
    evidence(
      'console',
      'real-local',
      [sourcePaths.p12Console, 'apps/server/test/artifact-management-p12.e2e.test.ts'],
      {
        verified: 'real API bindings and server vertical state',
        limitation: 'No browser-pixel or production browser load measurement.',
      },
    ),
    evidence('sse', 'real-local', [sourcePaths.p12Sse, sourcePaths.p12Console], {
      verified: 'bounded resumable Outbox replay in the server vertical',
      limitation: 'No concurrent-client delivery-latency distribution.',
    }),
    evidence(
      'shadow',
      'real-local',
      [
        sourcePaths.p06Shadow,
        'packages/persistence-postgres/test/artifact-shadow-p06.integration.test.ts',
      ],
      {
        verified: 'PostgreSQL-authoritative bounded queue, lease fencing and Redis wake-only',
        limitation: 'No Shadow throughput percentile was recorded.',
      },
    ),
    evidence('replay', 'real-local', [sourcePaths.p05], {
      datasetBuild: p05.datasetBuild,
      postgresClaim: p05.postgresClaim,
      workers: p05.actualBullMqWorkers,
      redisWake: p05.redisWake,
    }),
    evidence('compiler_workers', 'real-local', [sourcePaths.p03], {
      mining: p03.performance.mining,
      databaseQuery: p03.performance.databaseQuery,
      workerThroughput: p03.performance.workerThroughput,
      queueLag: p03.performance.queueLag,
    }),
  ];

  const dataScaleCoverage = [
    evidence('active_artifact', 'simulated', [sourcePaths.p12, sourcePaths.p12PerformanceTest], {
      baseline: 1_000,
      expected: 10_000,
      stress: 100_000,
      limitation:
        'Generic indexed Artifact projection rows in a temporary table; not 100k authoritative Active versions.',
    }),
    evidence('candidate', 'simulated', [sourcePaths.p12, sourcePaths.p12PerformanceTest], {
      baseline: 1_000,
      expected: 10_000,
      stress: 100_000,
      limitation:
        'Generic indexed Artifact projection rows do not distinguish Candidate lifecycle status.',
    }),
    evidence('experience_trace', 'real-local', [sourcePaths.p03], {
      baseline: 1_000,
      expected: 10_000,
      stress: 10_000,
      stressMeaning: 'tested local ceiling; no higher approved target',
    }),
    evidence('replay_case', 'simulated', [sourcePaths.p05], {
      baseline: 1_000,
      expected: 10_000,
      stress: 10_000,
      stressMeaning: 'tested local dataset ceiling; no higher approved target',
    }),
    evidence('concurrent_request', 'simulated', [sourcePaths.p10], {
      baseline: [1],
      expected: [10],
      stress: [100, 1_000],
      limitation: 'Gateway harness requests, not concurrent Formal active Tasks.',
    }),
    evidence(
      'concurrent_operator',
      'real-local',
      [sourcePaths.p12, sourcePaths.p12PerformanceTest],
      {
        baseline: 1,
        expected: 10,
        stress: 32,
        measuredStressMs: p12.concurrentOperatorsMs,
        inference:
          'Baseline/expected are strict subsets of the measured 32-operator Promise.all run; only 32 has a recorded duration.',
      },
    ),
    evidence('sse_client', 'unverified', [sourcePaths.p12Sse], {
      baseline: 1,
      expected: null,
      stress: null,
      verifiedBound: 'replay page limit max 500 with resumable overflow',
      limitation: 'The 500 bound is events per replay response, not concurrent SSE clients.',
    }),
    evidence('queue_lag', 'real-local', [sourcePaths.p03, sourcePaths.p05], {
      baseline: { runs: 1, measuredMs: p03.performance.queueLag.queueLagMs },
      expected: {
        workers: p05.actualBullMqWorkers.workers,
        runs: p05.actualBullMqWorkers.completedPostgreSQLRuns,
        measuredWakeMs: p05.redisWake.queueLagMs,
      },
      stress: {
        runs: p05.postgresClaim.runs,
        workers: p05.postgresClaim.parallelWorkers,
        claimElapsedMs: p05.postgresClaim.elapsedMs,
      },
    }),
    evidence('model_invocation', 'simulated', [sourcePaths.p11Budget], {
      baseline: 1,
      expected: 'bounded by per-request maxInvocations',
      stress: 'budget-exhausted fallback path',
      limitation: 'No physical production Model endpoint was used for capacity measurement.',
    }),
    evidence('tenant_count', 'real-local', [sourcePaths.p12, sourcePaths.p12PerformanceTest], {
      baseline: 1,
      expected: 10,
      stress: 20,
      evidence:
        'The 100k-row local PostgreSQL benchmark partitions rows across 20 tenant identifiers.',
    }),
  ];

  const resourceCoverage = [
    evidence('cpu', 'unverified', [sourcePaths.p03, sourcePaths.p10], {
      proxy: 'elapsed throughput under local Node.js execution',
      limitation: 'CPU utilization and saturation were not sampled.',
    }),
    evidence('memory', 'real-local', [sourcePaths.p03, sourcePaths.p05], {
      miningHeapDeltaBytes: p03.performance.mining.map((sample) => ({
        traceCount: sample.traceCount,
        heapDeltaBytes: sample.heapDeltaBytes,
      })),
      replayHeapDeltaBytesFor10k: p05.heapDeltaBytesFor10k,
    }),
    evidence(
      'database_connection',
      'static',
      ['apps/server/src/runtime.ts', sourcePaths.p12PerformanceTest],
      {
        productionPoolBound: 10,
        benchmarkPoolBound: 40,
        limitation: 'Pool bounds are code configuration, not a saturation curve.',
      },
    ),
    evidence('lock', 'real-local', [sourcePaths.p05], {
      mechanism: p05.capacityControls.horizontalParallelism,
      backpressureExtraClaims: p05.postgresClaim.backpressureExtraClaims,
    }),
    evidence('query', 'real-local', [sourcePaths.p03, sourcePaths.p07, sourcePaths.p12], {
      cohort10kMs: p03.performance.databaseQuery.queryElapsedMs,
      retrievalP95Ms: p07.measurement.p95Ms,
      artifactProjectionMs: p12.artifactListMs,
    }),
    evidence('index', 'real-local', [sourcePaths.p07, sourcePaths.p12PerformanceTest], {
      verified: 'active-pointer lookup and 1k/10k/100k indexed projection query',
    }),
    evidence('redis', 'real-local', [sourcePaths.p03, sourcePaths.p05, sourcePaths.p06Shadow], {
      authority: false,
      compilerWakeMs: p03.performance.queueLag.queueLagMs,
      replayWakeMs: p05.redisWake.queueLagMs,
    }),
    evidence('queue', 'real-local', [sourcePaths.p03, sourcePaths.p05, sourcePaths.p06Shadow], {
      bounded: true,
      durableAuthority: 'PostgreSQL',
      workers: p05.actualBullMqWorkers.workers,
      measuredRuns: p05.actualBullMqWorkers.completedPostgreSQLRuns,
    }),
    evidence('network', 'unverified', [sourcePaths.p12Console, sourcePaths.p12Sse], {
      proxy: 'local loopback HTTP/SSE vertical',
      limitation: 'No production RTT, packet loss or bandwidth profile.',
    }),
    evidence('token_cost', 'simulated', [sourcePaths.p11Budget], {
      verified: sources.p11Budget.value.bounds,
      limitation: 'Persisted/model-stub usage only; no production price or quota claim.',
    }),
    evidence('storage_growth', 'real-local', [sourcePaths.p03, sourcePaths.p12PerformanceTest], {
      patternDefinitionBytes: p03.performance.mining.map((sample) => ({
        traceCount: sample.traceCount,
        definitionBytes: sample.definitionBytes,
        brotliBytes: sample.brotliBytes,
      })),
      artifactProjectionRows: 100_000,
      limitation: 'No long-duration production retention growth forecast.',
    }),
  ];

  const backpressureCoverage = [
    evidence(
      'gateway_load_shedding',
      'simulated',
      [sourcePaths.p10Resilience, sourcePaths.p10PerformanceTest],
      {
        verified: 'bulkheads, circuit opening and formal-runtime priority',
      },
    ),
    evidence(
      'shadow_pause',
      'real-local',
      [sourcePaths.p06Shadow, 'packages/application/test/artifact-shadow-runtime.unit.test.ts'],
      {
        verified: 'feature-off/degraded pause and bounded PostgreSQL queue depth',
      },
    ),
    evidence('replay_compiler_low_priority', 'real-local', [sourcePaths.p03, sourcePaths.p05], {
      verified:
        'bounded claims, per-worker concurrency 1, durable available_at and low-priority sidecar workers',
    }),
    evidence('model_rate_limit', 'simulated', [sourcePaths.p11Budget], {
      verified: 'serial cascade, max-invocation/token/cost/deadline exhaustion fallback',
      limitation: 'No production Provider quota endpoint.',
    }),
    evidence('sse_slow_consumer', 'static', [sourcePaths.p12Sse], {
      verified: 'max-500 bounded replay page and explicit resumable overflow',
      limitation: 'No socket-level slow-reader timing sample.',
    }),
    {
      ...evidence(
        'feedback_queue',
        'static',
        [
          'packages/application/src/compiler/fast-gateway.ts',
          'packages/persistence-postgres/test/fast-gateway-p10.integration.test.ts',
        ],
        {
          verified: 'synchronous idempotent PostgreSQL feedback plus durable Outbox',
        },
      ),
      applicability: 'not_applicable',
      reason:
        'There is no independent feedback queue in V1.3; inventing one would create an unsupported authority path.',
    },
    evidence(
      'management_rate_limit',
      'unverified',
      [sourcePaths.p12, sourcePaths.p12PerformanceTest],
      {
        verified: 'bounded page size and 32 concurrent local operators',
        limitation: 'No global Management API rate limiter or production saturation threshold.',
      },
    ),
  ];

  return {
    schemaVersion: '1.0',
    packageId: 'SDAR-V1.3-P13',
    reportId: 'v1.3-final-capacity-report',
    status: 'passed',
    classification: 'local acceptance release-candidate evidence',
    productionCapacityClaim: false,
    scopeNotice:
      'Measurements are local acceptance evidence. Simulated/static/unverified rows are not upgraded to real or production evidence.',
    approvedProductCapacityTarget: {
      requirement: 'NFR-PERF-001',
      singleInstanceActiveTasks: { minimumApproximate: 1, maximumApproximate: 10 },
      sameContextStrictlySerial: true,
      source: sourcePaths.requirements,
    },
    scenarioMatrix: {
      baseline: {
        activeTasks: 1,
        gatewayRequests: 1,
        artifactProjectionRows: 1_000,
        traces: 1_000,
        replayCases: 1_000,
        operators: 1,
        workers: 1,
        tenants: 1,
      },
      expected: {
        activeTasks: 10,
        gatewayRequests: 10,
        artifactProjectionRows: 10_000,
        traces: 10_000,
        replayCases: 10_000,
        operators: 10,
        workers: 4,
        completedWorkerRuns: 12,
        tenants: 10,
      },
      stress: {
        activeTasks: 10,
        gatewayRequests: [100, 1_000],
        artifactProjectionRows: 100_000,
        traces: 10_000,
        replayCases: 10_000,
        operators: 32,
        postgresClaimRuns: 100,
        tenants: 20,
      },
      caveat:
        'Gateway request stress is not an approved active-task target; 10k is the tested Trace/Replay ceiling, not a production ceiling.',
    },
    contractDimensions,
    workloadCoverage,
    dataScaleCoverage,
    resourceCoverage,
    backpressureCoverage,
    commands: [
      p03.performance.command,
      p05.command,
      `pnpm exec vitest run ${sourcePaths.p07PerformanceTest} --project integration`,
      'pnpm exec vitest run packages/application/test/template-runtime-p08.unit.test.ts --project unit',
      `pnpm exec vitest run ${sourcePaths.p09PerformanceTest} --project unit`,
      `pnpm exec vitest run ${sourcePaths.p10PerformanceTest} --project unit`,
      'pnpm exec vitest run packages/application/test/case-model-runtime-p11.unit.test.ts --project unit',
      `pnpm exec vitest run ${sourcePaths.p12PerformanceTest} --project integration`,
    ],
    sources: sourceManifest(sources),
    validation: {
      requiredPerformancePackages: ['P03', 'P05', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12'],
      contractCoverageComplete: true,
      classifications: [...classifications],
      noProductionSloClaim: true,
    },
  };
}

function buildSloReport(sources, capacityReport) {
  const p03 = sources.p03.value;
  const p05 = sources.p05.value;
  const p07 = sources.p07.value;
  const p09 = sources.p09.value;
  const p10 = sources.p10.value;
  const p12 = sources.p12.value;
  const p10Stress = p10.concurrency.find((sample) => sample.requests === 1_000);
  const p09Stress = p09.conflictResolution30Samples.find((sample) => sample.ruleCount === 1_000);
  invariant(p10Stress !== undefined, 'P10_STRESS_SAMPLE_MISSING');
  invariant(p09Stress !== undefined, 'P09_STRESS_SAMPLE_MISSING');

  const approvedTargets = [
    {
      id: 'active_task_concurrency',
      authority: 'product-requirement',
      requirement: 'NFR-PERF-001',
      target: { minimumApproximate: 1, maximumApproximate: 10 },
      observed: {
        maximumSupportedActiveTasks:
          sources.nfrConcurrency.value.acceptance.maximumSupportedActiveTasks,
        sameContextStrictlySerial:
          sources.nfrConcurrency.value.acceptance.sameContextStrictlySerial,
        stateCrossover: sources.nfrConcurrency.value.acceptance.conversationStateCrossover,
      },
      classification: 'real-local',
      evidenceRefs: [sourcePaths.requirements, sourcePaths.nfrConcurrency],
    },
    localBudget(
      'retrieval_p95',
      { percentile: 'p95', lessThanMs: 100 },
      { samples: p07.measurement.samples, p95Ms: p07.measurement.p95Ms },
      [sourcePaths.p07, sourcePaths.p07PerformanceTest],
    ),
    localBudget(
      'gateway_no_match_p95',
      { percentile: 'p95', lessThanMs: p10.sequentialNoMatch.budgetMs },
      p10.sequentialNoMatch,
      [sourcePaths.p10, sourcePaths.p10PerformanceTest],
    ),
    localBudget(
      'gateway_1000_request_p99',
      { requests: 1_000, percentile: 'p99', lessThanMs: 750 },
      p10Stress,
      [sourcePaths.p10, sourcePaths.p10PerformanceTest],
    ),
    localBudget('rule_1000_resolution', { ruleCount: 1_000, lessThanMs: 2_000 }, p09Stress, [
      sourcePaths.p09,
      sourcePaths.p09PerformanceTest,
    ]),
    localBudget(
      'management_artifact_query',
      { maximumAcrossRows: [1_000, 10_000, 100_000], lessThanMs: 1_000 },
      p12.artifactListMs,
      [sourcePaths.p12, sourcePaths.p12PerformanceTest],
    ),
    localBudget(
      'management_32_operators',
      { operators: 32, lessThanMs: 2_000 },
      { elapsedMs: p12.concurrentOperatorsMs },
      [sourcePaths.p12, sourcePaths.p12PerformanceTest],
    ),
    localBudget(
      'a2a_projection_10000',
      { iterations: 10_000, lessThanMs: 2_000 },
      { elapsedMs: p12.a2aTenThousandMs },
      [sourcePaths.p12, sourcePaths.p12PerformanceTest],
    ),
  ];

  const metrics = [
    sloMetric('availability', 'static', null, {
      observed: 'functional recovery and full-gate pass/fail only',
      evidenceRefs: [sourcePaths.traceability, sourcePaths.p10Resilience],
      limitation: 'No approved availability percentage or production observation window.',
    }),
    sloMetric('error_rate', 'simulated', null, {
      observed: p10.concurrency.map((sample) => ({
        requests: sample.requests,
        errorRate: sample.errorRate,
      })),
      evidenceRefs: [sourcePaths.p10],
      limitation: 'Harness-only sample; no approved production error-rate objective.',
    }),
    sloMetric('latency_percentiles', 'real-local', null, {
      observed: {
        retrieval: p07.measurement,
        gateway: p10.concurrency,
      },
      evidenceRefs: [sourcePaths.p07, sourcePaths.p10],
      limitation: 'Per-workload local measurements; no global production percentile.',
    }),
    sloMetric('deadline_miss', 'simulated', null, {
      observed: sources.p10Deadline.value,
      evidenceRefs: [sourcePaths.p10Deadline],
      limitation: 'Behavioral deadline/late-result tests; no deadline-miss rate.',
    }),
    sloMetric('fast_path_added_latency', 'simulated', null, {
      observed: p10.sequentialNoMatch,
      evidenceRefs: [sourcePaths.p10],
      limitation: 'No-match orchestration proxy, not production end-to-end added latency.',
    }),
    sloMetric('formal_handoff', 'static', null, {
      observed: sources.p08Handoff.value,
      evidenceRefs: [sourcePaths.p08Handoff],
      limitation: 'Atomicity/idempotency evidence only; no handoff latency target.',
    }),
    sloMetric('fallback', 'simulated', null, {
      observed: sources.p10Fallback.value,
      evidenceRefs: [sourcePaths.p10Fallback],
      limitation: 'Fallback correctness/bulkhead evidence; no production fallback latency target.',
    }),
    sloMetric('feedback_lag', 'unverified', null, {
      observed: 'synchronous durable persistence and Outbox correctness',
      evidenceRefs: [
        sourcePaths.p10Attribution,
        'packages/persistence-postgres/test/fast-gateway-p10.integration.test.ts',
      ],
      limitation: 'No feedback-lag distribution.',
    }),
    sloMetric('revalidation_lag', 'real-local', null, {
      observed: {
        compilerWakeMs: p03.performance.queueLag.queueLagMs,
        replayWakeMs: p05.redisWake.queueLagMs,
      },
      evidenceRefs: [sourcePaths.p03, sourcePaths.p05],
      limitation: 'Queue-wake proxies, not full revalidation completion latency.',
    }),
    sloMetric('console_load', 'static', null, {
      observed: sources.p12Console.value,
      evidenceRefs: [sourcePaths.p12Console],
      limitation: 'Functional rendered-state evidence; no browser load percentile.',
    }),
    sloMetric('management_query', 'real-local', null, {
      observed: p12.artifactListMs,
      evidenceRefs: [sourcePaths.p12],
      limitation: 'Local temporary indexed projection, not production data distribution.',
    }),
    sloMetric('sse_delivery', 'static', null, {
      observed: sources.p12Sse.value,
      evidenceRefs: [sourcePaths.p12Sse],
      limitation: 'Ordering/resume/backpressure behavior; no delivery-latency percentile.',
    }),
    sloMetric('queue_recovery', 'real-local', null, {
      observed: {
        compilerQueueLagMs: p03.performance.queueLag.queueLagMs,
        replayQueueLagMs: p05.redisWake.queueLagMs,
        recoveryEvidence: p03.performance.queueLag.recoveryEvidence,
      },
      evidenceRefs: [sourcePaths.p03, sourcePaths.p05],
      limitation: 'No approved production RTO.',
    }),
  ];

  for (const target of approvedTargets) {
    invariant(target.passed !== false, `APPROVED_LOCAL_TARGET_FAILED:${target.id}`);
  }

  return {
    schemaVersion: '1.0',
    packageId: 'SDAR-V1.3-P13',
    reportId: 'v1.3-final-slo-report',
    status: 'passed',
    classification: 'local acceptance release-candidate evidence',
    productionSloClaim: false,
    policy: {
      approvedTargetSources: ['NFR-PERF-001', 'checked-in frozen test assertions'],
      absentPercentagePolicy: 'approvedTarget is null',
      absentProductionRtoPolicy: 'approvedTarget is null',
      prohibition:
        'Local measurements, full-verify durations and inferred lower-load subsets are not production SLOs.',
    },
    approvedTargets,
    metrics,
    releaseCandidateAssessment: {
      capacityContractCoverage: capacityReport.validation.contractCoverageComplete,
      approvedLocalTargetsPassed: true,
      productionAvailabilityObjectiveDefined: false,
      productionRtoDefined: false,
      productionSloApproved: false,
    },
    sources: capacityReport.sources,
  };
}

async function validateCoverage(capacityReport, sloReport) {
  for (const [section, entries] of [
    ['workloads', capacityReport.workloadCoverage],
    ['data', capacityReport.dataScaleCoverage],
    ['resources', capacityReport.resourceCoverage],
    ['backpressure', capacityReport.backpressureCoverage],
  ]) {
    const expected = contractDimensions[section];
    invariant(Array.isArray(expected), `CONTRACT_SECTION_UNKNOWN:${section}`);
    const ids = entries.map((entry) => entry.id);
    invariant(sameStrings(ids, expected), `CAPACITY_COVERAGE_MISMATCH:${section}`);
    for (const entry of entries) await validateEvidenceEntry(entry, section);
  }

  invariant(
    sameStrings(
      sloReport.metrics.map((entry) => entry.id),
      contractDimensions.slo,
    ),
    'SLO_COVERAGE_MISMATCH',
  );
  for (const entry of sloReport.metrics) {
    await validateEvidenceEntry(entry, 'slo');
    invariant(
      Object.hasOwn(entry, 'approvedTarget'),
      `SLO_APPROVED_TARGET_FIELD_MISSING:${entry.id}`,
    );
  }
  invariant(capacityReport.productionCapacityClaim === false, 'PRODUCTION_CAPACITY_CLAIMED');
  invariant(sloReport.productionSloClaim === false, 'PRODUCTION_SLO_CLAIMED');
}

async function validateEvidenceEntry(entry, section) {
  invariant(classifications.has(entry.classification), `EVIDENCE_CLASS_INVALID:${entry.id}`);
  invariant(
    Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.length > 0,
    `EVIDENCE_MISSING:${section}:${entry.id}`,
  );
  if (entry.applicability === 'not_applicable') {
    invariant(
      typeof entry.reason === 'string' && entry.reason.length > 0,
      `NA_REASON_MISSING:${entry.id}`,
    );
  }
  for (const evidenceRef of entry.evidenceRefs) {
    await access(path.join(root, evidenceRef));
  }
}

async function writeReports(capacityReport, sloReport) {
  await mkdir(reportDirectory, { recursive: true });
  await Promise.all([
    writeFile(capacityReportPath, `${JSON.stringify(capacityReport, null, 2)}\n`),
    writeFile(sloReportPath, `${JSON.stringify(sloReport, null, 2)}\n`),
  ]);
}

async function writeFailureReports(reason) {
  const failure = {
    schemaVersion: '1.0',
    packageId: 'SDAR-V1.3-P13',
    status: 'failed',
    classification: 'unverified',
    productionSloClaim: false,
    validationErrors: [reason],
  };
  await mkdir(reportDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      capacityReportPath,
      `${JSON.stringify(
        { ...failure, reportId: 'v1.3-final-capacity-report', productionCapacityClaim: false },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      sloReportPath,
      `${JSON.stringify({ ...failure, reportId: 'v1.3-final-slo-report' }, null, 2)}\n`,
    ),
  ]);
}

function sourceManifest(sources) {
  return Object.values(sources)
    .map((source) => ({
      path: source.path,
      sha256: source.sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function evidence(id, classification, evidenceRefs, observations) {
  return {
    id,
    classification,
    applicability: 'required',
    evidenceRefs,
    observations,
  };
}

function sloMetric(id, classification, approvedTarget, details) {
  return {
    id,
    classification,
    applicability: 'required',
    approvedTarget,
    ...details,
  };
}

function localBudget(id, target, observed, evidenceRefs) {
  return {
    id,
    authority: 'frozen-local-test-budget',
    target,
    observed,
    classification: 'real-local',
    evidenceRefs,
    passed: localBudgetPassed(id, target, observed),
    productionSlo: false,
  };
}

function localBudgetPassed(id, target, observed) {
  switch (id) {
    case 'retrieval_p95':
      return observed.p95Ms < target.lessThanMs;
    case 'gateway_no_match_p95':
      return observed.p95Ms < target.lessThanMs;
    case 'gateway_1000_request_p99':
      return observed.p99Ms < target.lessThanMs;
    case 'rule_1000_resolution':
      return observed.maxMs < target.lessThanMs;
    case 'management_artifact_query':
      return Math.max(...Object.values(observed)) < target.lessThanMs;
    case 'management_32_operators':
    case 'a2a_projection_10000':
      return observed.elapsedMs < target.lessThanMs;
    default:
      throw new Error(`LOCAL_BUDGET_UNKNOWN:${id}`);
  }
}

function validatePackage(value, packageId) {
  invariant(value?.packageId === packageId, `PERFORMANCE_PACKAGE_INVALID:${packageId}`);
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function sameNumbers(actual, expected) {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function sameStrings(actual, expected) {
  return sameNumbers(actual, expected);
}

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}
