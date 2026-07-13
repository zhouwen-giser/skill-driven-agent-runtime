import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const baseline = JSON.parse(
  await readFile(new URL('third_party/a2a-1.0.1-baseline.json', root), 'utf8'),
);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const sourceLock = await readFile(new URL('third_party/sources.lock.yaml', root), 'utf8');
const compatibilitySource = await readFile(
  new URL('packages/a2a-adapter/src/compatibility.ts', root),
  'utf8',
);
const tckRunner = await readFile(new URL('scripts/run-a2a-tck.mjs', root), 'utf8');
const report = JSON.parse(await readFile(new URL(baseline.tck.report, root), 'utf8'));
const junit = await readFile(new URL(baseline.tck.junit, root), 'utf8');

assertEqual(baseline.spec.version, '1.0.1', 'A2A_SPEC_VERSION');
assertEqual(baseline.spec.wireVersion, '1.0', 'A2A_WIRE_VERSION');
assertEqual(
  packageJson.dependencies?.[baseline.sdk.package],
  baseline.sdk.version,
  'A2A_SDK_VERSION',
);
assertIncludes(
  sourceLock,
  `npm:${baseline.sdk.package}@${baseline.sdk.version}#commit:${baseline.sdk.commit}`,
  'A2A_SDK_SOURCE_PIN',
);
assertIncludes(
  compatibilitySource,
  `A2A_PROTOCOL_BASELINE = '${baseline.spec.wireVersion}'`,
  'A2A_WIRE_CONSTANT',
);
assertIncludes(
  compatibilitySource,
  `A2A_SPEC_PATCH_BASELINE = '${baseline.spec.version}'`,
  'A2A_SPEC_CONSTANT',
);
assertIncludes(tckRunner, baseline.tck.commit, 'A2A_TCK_COMMIT');
assertEqual(report.summary?.must_compatibility, '100.0%', 'A2A_TCK_MUST_COMPATIBILITY');

const requirementResults = Object.values(report.per_requirement ?? {});
const failedRequirements = requirementResults.filter(
  (result) => result?.status === 'FAIL' || result?.transports?.http_json === 'FAIL',
);
assertEqual(failedRequirements.length, 0, 'A2A_TCK_FAILED_REQUIREMENTS');

const suite = junit.match(
  /<testsuite\b[^>]*\berrors="(\d+)"[^>]*\bfailures="(\d+)"[^>]*\bskipped="(\d+)"[^>]*\btests="(\d+)"/u,
);
if (suite === null) throw new Error('A2A_TCK_JUNIT_SUMMARY_MISSING');
const [, errors, failures, skipped, tests] = suite.map(Number);
assertEqual(errors, 0, 'A2A_TCK_JUNIT_ERRORS');
assertEqual(failures, 0, 'A2A_TCK_JUNIT_FAILURES');
const passed = tests - skipped - failures - errors;

process.stdout.write(
  `${JSON.stringify({
    specVersion: baseline.spec.version,
    wireVersion: baseline.spec.wireVersion,
    sdk: `${baseline.sdk.package}@${baseline.sdk.version}`,
    sdkStability: baseline.sdk.stability,
    tckCommit: baseline.tck.commit,
    tckScope: `${baseline.tck.transport}/${baseline.tck.level}`,
    tests,
    passed,
    skipped,
    failures,
    errors,
    mustCompatibility: report.summary.must_compatibility,
  })}\n`,
);

function assertEqual(actual, expected, code) {
  if (actual !== expected) {
    throw new Error(`${code}_MISMATCH: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertIncludes(haystack, needle, code) {
  if (!haystack.includes(needle)) throw new Error(`${code}_MISSING: ${needle}`);
}
