// Keep bootstrap and full verification on the same explicit, observable stage list.
export const bootstrapSteps = [
  ['format', ['format:check'], 300_000],
  ['verification-runner-contract', ['test:verification'], 60_000],
  ['lint', ['lint'], 1_200_000],
  ['typecheck', ['typecheck'], 1_200_000],
  ['unit', ['test:unit'], 1_200_000],
  ['contract', ['test:contract'], 600_000],
  ...[
    'evidence-contract',
    'evidence-coverage',
    'architecture',
    'a2a-baseline',
    'management-openapi',
    'node-control-contract',
    'node-control-implementation-conformance',
    'smpp-registry-projection',
    'acceptance',
    'sources',
    'protocol',
    'infra',
    'project-license',
    'licenses',
  ].map((name) => [name, [`verify:${name}`], 600_000]),
  ['build', ['build'], 600_000],
];

export const fullSteps = [
  ...bootstrapSteps,
  ['cognitive-replay-no-physical-provider', ['verify:cognitive-replay'], 60_000],
  ['clean-baseline-reset-seed', ['verify:migrations'], 300_000],
  ['postgres-redis-integration', ['test:integration'], 660_000],
  ['postgres-redis-model-mcp-e2e', ['test:e2e'], 360_000],
  ['official-a2a-tck', ['test:a2a-tck'], 300_000],
  ['canonical-evidence-demo', ['demo:evidence-e2e'], 600_000],
  ['infrastructure-smoke', ['smoke:infra'], 240_000],
  ['server-console-smoke', ['smoke:server'], 300_000],
  ['node-control-api-worker-smoke', ['smoke:node-control'], 300_000],
];
