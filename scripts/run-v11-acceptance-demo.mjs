import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const root = process.cwd();
const reportDirectory = resolve(root, 'reports', 'v1.1-mcp-tasks');
const acceptancePath = resolve(reportDirectory, 'V11-ACCEPTANCE.json');
const acceptanceMarkdownPath = resolve(reportDirectory, 'V11-ACCEPTANCE.md');
const demoPath = resolve(reportDirectory, 'V11-LOCAL-DEMO.json');
const demoMarkdownPath = resolve(reportDirectory, 'V11-LOCAL-DEMO.md');
const startedAt = new Date();
const commandRuns = [];
const pnpmCli = process.env['npm_execpath'];
let infrastructureStarted = false;
let failure;

if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('PNPM_EXECUTABLE_UNAVAILABLE: run this demo through pnpm demo:acceptance');
}

try {
  requirePassed(
    run('production-build', process.execPath, [pnpmCli, 'build'], 'pnpm build', 180_000),
  );
  requirePassed(
    run(
      'mcp-tasks-sixteen-scenario-contract',
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        'contract',
        'packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts',
      ],
      'pnpm exec vitest run --project contract packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts',
      180_000,
    ),
  );

  startInfrastructure(root);
  infrastructureStarted = true;
  requirePassed(
    run(
      'acceptance-unit-evidence',
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--project', 'unit'],
      'pnpm test:unit',
      240_000,
    ),
  );
  requirePassed(
    run(
      'postgres-redis-integration-including-restart',
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--project', 'integration'],
      'pnpm test:integration',
      360_000,
    ),
  );
  requirePassed(
    run(
      'full-e2e',
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e'],
      'pnpm test:e2e',
      360_000,
    ),
  );
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  if (infrastructureStarted) stopInfrastructure(root);
}

let acceptance = createAcceptanceReport(failure === undefined ? 'passed' : 'incomplete');
await writeAcceptance(acceptance);

if (failure === undefined) {
  const verification = run(
    'acceptance-report-verifier',
    process.execPath,
    [resolve(root, 'scripts', 'verify-v11-acceptance.mjs')],
    'pnpm verify:v11-acceptance',
    30_000,
  );
  if (verification.status !== 'passed') {
    failure = new Error('V11_ACCEPTANCE_REPORT_VERIFICATION_FAILED');
    acceptance = createAcceptanceReport('incomplete');
    await writeAcceptance(acceptance);
  }
}

const finishedAt = new Date();
const demo = {
  schemaVersion: 1,
  status: failure === undefined ? 'passed' : 'failed',
  generatedAt: finishedAt.toISOString(),
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  commit: capture('git', ['rev-parse', 'HEAD']).trim(),
  dirty: capture('git', ['status', '--short']).trim() !== '',
  infrastructure:
    'real PostgreSQL/pgvector and Redis/BullMQ through compose or operator-managed equivalents',
  providerAndModel: 'deterministic local Mock MCP Tasks Provider and Mock Model loopbacks',
  commands: commandRuns,
  acceptanceReport: 'reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json',
  ...(failure === undefined ? {} : { error: failure.message }),
};
await mkdir(reportDirectory, { recursive: true });
await writeFile(demoPath, `${JSON.stringify(demo, null, 2)}\n`);
await writeFile(demoMarkdownPath, renderDemoMarkdown(demo));

if (failure !== undefined) {
  process.stderr.write(`V1.1 local acceptance demo failed: ${failure.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `V1.1 local acceptance demo passed; reports written to ${reportDirectory}.\n`,
  );
}

function run(name, command, args, displayCommand, timeout) {
  const commandStartedAt = new Date();
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  const commandFinishedAt = new Date();
  const passed = result.status === 0 && result.error === undefined;
  const record = {
    name,
    command: displayCommand,
    status: passed ? 'passed' : 'failed',
    exitCode: result.status ?? -1,
    startedAt: commandStartedAt.toISOString(),
    finishedAt: commandFinishedAt.toISOString(),
    durationMs: commandFinishedAt.getTime() - commandStartedAt.getTime(),
    ...(result.signal === null ? {} : { signal: result.signal }),
    ...(result.error === undefined ? {} : { error: result.error.message }),
  };
  commandRuns.push(record);
  return record;
}

function requirePassed(record) {
  if (record.status !== 'passed') {
    throw new Error(`V11_ACCEPTANCE_COMMAND_FAILED:${record.name}`);
  }
}

function createAcceptanceReport(status) {
  const passed = status === 'passed';
  return {
    schemaVersion: 1,
    status,
    generatedAt: new Date().toISOString(),
    commit: capture('git', ['rev-parse', 'HEAD']).trim(),
    dirty: capture('git', ['status', '--short']).trim() !== '',
    commandRuns,
    unverified: passed ? [] : acceptanceScenarios().map((scenario) => scenario.id),
    scenarios: acceptanceScenarios().map((scenario) => ({
      ...scenario,
      status: passed ? 'passed' : 'incomplete',
      classification: passed ? scenario.classification : ['unverified'],
    })),
  };
}

async function writeAcceptance(report) {
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(acceptancePath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(acceptanceMarkdownPath, renderAcceptanceMarkdown(report));
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : 'unavailable';
}

function renderAcceptanceMarkdown(report) {
  const lines = [
    '# V1.1 MCP Tasks Acceptance',
    '',
    `- Status: **${report.status}**`,
    `- Generated: ${report.generatedAt}`,
    `- Commit: \`${report.commit}\`${report.dirty ? ' (dirty working tree)' : ''}`,
    '',
    '| Scenario | Result | Classification | Evidence |',
    '| --- | --- | --- | --- |',
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.id} ${scenario.title} | ${scenario.status} | ${scenario.classification.join(', ')} | ${scenario.evidence.map((item) => `\`${item.path}\``).join('<br>')} |`,
    );
  }
  lines.push('', '## Commands', '', '| Gate | Command | Result |', '| --- | --- | --- |');
  for (const command of report.commandRuns) {
    lines.push(`| ${command.name} | \`${command.command}\` | ${command.status} |`);
  }
  return `${lines.join('\n')}\n`;
}

function renderDemoMarkdown(report) {
  const lines = [
    '# V1.1 Local Acceptance Demo',
    '',
    `- Status: **${report.status}**`,
    `- Commit: \`${report.commit}\`${report.dirty ? ' (dirty working tree)' : ''}`,
    `- Duration: ${String(report.durationMs)} ms`,
    `- Infrastructure: ${report.infrastructure}`,
    `- Provider/model: ${report.providerAndModel}`,
    `- Acceptance report: \`${report.acceptanceReport}\``,
    ...(report.error === undefined ? [] : [`- Error: \`${report.error}\``]),
    '',
    '| Gate | Command | Result | Duration |',
    '| --- | --- | --- | ---: |',
  ];
  for (const command of report.commands) {
    lines.push(
      `| ${command.name} | \`${command.command}\` | ${command.status} | ${String(command.durationMs)} ms |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function acceptanceScenarios() {
  const contract = 'mcp-tasks-sixteen-scenario-contract';
  const unit = 'acceptance-unit-evidence';
  const integration = 'postgres-redis-integration-including-restart';
  const e2e = 'full-e2e';
  const providerContract = 'packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts';
  const adapterContract = 'packages/mcp-adapter/test/streamable-http.contract.test.ts';
  const runtimeIntegration = 'apps/server/test/remote-task-runtime.integration.test.ts';
  const restartIntegration = 'apps/server/test/server-runtime-restart.integration.test.ts';
  const verticalE2e = 'packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts';

  return [
    scenario(
      'AC-MCPT-01',
      'synchronous Tool regression',
      ['simulated'],
      [contract],
      [
        evidence(
          providerContract,
          'The loopback Provider returns synchronous success with no remote Task.',
        ),
        evidence(
          adapterContract,
          'Immediate business errors remain synchronous and create no remote Task ID.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-02',
      'Task negotiation and creation',
      ['real', 'simulated'],
      [contract, e2e],
      [
        evidence(
          adapterContract,
          'Exact protocol negotiation, execution Headers, handle creation and Task methods cross a real HTTP loopback.',
        ),
        evidence(
          verticalE2e,
          'The composed Server persists a Binding after confirmed Workflow admission.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-03',
      'Provider without Tasks',
      ['simulated'],
      [contract, e2e],
      [
        evidence(
          adapterContract,
          'An undeclared Provider rejects Task results and require_task rejects synchronous fallback.',
        ),
        evidence(
          'packages/application/test/mcp-task-readiness.e2e.test.ts',
          'Unsupported or changed readiness produces zero Tool calls.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-04',
      'working to completed continuation',
      ['real', 'simulated'],
      [integration, e2e],
      [
        evidence(
          runtimeIntegration,
          'PostgreSQL observations and BullMQ continuation advance a remote Task exactly once.',
        ),
        evidence(
          verticalE2e,
          'The full Skill-to-LangGraph-to-remote-Task path returns the terminal result through A2A.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-05',
      'pause and resume observation',
      ['simulated'],
      [contract, unit],
      [
        evidence(
          providerContract,
          'Paused and resuming snapshots remain working until one terminal observation.',
        ),
        evidence(
          'packages/application/test/remote-task-polling.unit.test.ts',
          'Nonterminal observations do not enqueue a graph continuation.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-06',
      'input required',
      ['real', 'simulated'],
      [contract, integration],
      [
        evidence(
          providerContract,
          'Exact tasks/update wire behavior completes one-round and two-round form elicitation.',
        ),
        evidence(
          runtimeIntegration,
          'A2A-shaped input is persisted and returned to the same remote Task without replanning.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-07',
      'cooperative cancellation acknowledged',
      ['real', 'simulated'],
      [contract, integration],
      [
        evidence(
          providerContract,
          'Cancellation acknowledgement is separate from the later Provider cancelled snapshot.',
        ),
        evidence(
          runtimeIntegration,
          'PostgreSQL keeps request, acknowledgement and Provider terminal state separate.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-08',
      'cancellation Provider unreachable',
      ['simulated'],
      [unit],
      [
        evidence(
          'packages/application/test/remote-task-cancellation.unit.test.ts',
          'An unreachable Provider records uncertainty without fabricating cancelled.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-09',
      'restricted operation accepted',
      ['real', 'simulated'],
      [contract, unit, e2e],
      [
        evidence(
          providerContract,
          'The Provider advertises restricted availability and accepts the confirmed operation.',
        ),
        evidence(
          'packages/application/test/mcp-task-readiness.e2e.test.ts',
          'Restricted planning requires confirmation and exact pre-call refresh before Provider admission.',
        ),
        evidence(verticalE2e, 'The composed plan stays unexecuted until explicit confirmation.'),
      ],
    ),
    scenario(
      'AC-MCPT-10',
      'admission rejected',
      ['simulated'],
      [contract, unit],
      [
        evidence(
          providerContract,
          'Restricted rejection returns an immediate structured admission outcome without a Task.',
        ),
        evidence(
          'packages/langgraph-runtime/test/workflow-compiler.unit.test.ts',
          'A remote Tool business error follows the existing typed node error handler.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-11',
      'scheduled start window missed',
      ['simulated'],
      [contract, unit],
      [
        evidence(
          providerContract,
          'The Provider declares start_window_missed with stable reason and retry evidence.',
        ),
        evidence(
          'packages/domain/test/provider-business-outcome.unit.test.ts',
          'SDAR validates and maps only Provider-declared start-window evidence.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-12',
      'maximum elapsed deadline reached',
      ['simulated'],
      [contract, unit],
      [
        evidence(
          providerContract,
          'The Provider declares deadline_reached as completed business evidence.',
        ),
        evidence(
          'packages/langgraph-runtime/test/workflow-compiler.unit.test.ts',
          'The typed deadline result reaches the existing LangGraph error handler.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-13',
      'Provider unreachable and recovery',
      ['real', 'simulated'],
      [contract, integration],
      [
        evidence(
          providerContract,
          'A deterministic transport outage recovers without a fabricated terminal snapshot.',
        ),
        evidence(
          runtimeIntegration,
          'Real PostgreSQL/Redis polling backs off, preserves state and resumes after recovery.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-14',
      'process and Redis restart',
      ['real', 'simulated'],
      [integration],
      [
        evidence(
          restartIntegration,
          'A fresh ServerRuntime reconstructs PostgreSQL waiting state after ephemeral queue loss without replaying tools/call.',
        ),
        evidence(
          'packages/persistence-postgres/test/workflow-continuation.integration.test.ts',
          'PostgreSQL continuation inbox state rebuilds pending queue work idempotently.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-15',
      'parallel and child waits',
      ['real', 'simulated'],
      [unit, integration],
      [
        evidence(
          'apps/server/test/remote-task-composition.integration.test.ts',
          'Real PostgreSQL/Redis composition keeps parallel bindings independent, joins once and propagates a remote child result only after child persistence.',
        ),
        evidence(
          'packages/langgraph-runtime/test/workflow-compiler.unit.test.ts',
          'A fresh LangGraph runtime continues independent waits without replaying completed nodes.',
        ),
      ],
    ),
    scenario(
      'AC-MCPT-16',
      'Goal Patch and late remote events',
      ['real', 'simulated'],
      [integration, e2e],
      [
        evidence(
          'packages/persistence-postgres/test/repositories.integration.test.ts',
          'Goal Patch invalidates old bindings, snapshots and controls while late evidence remains audit-only.',
        ),
        evidence(
          verticalE2e,
          'Goal Patch forces a fresh plan and confirmation before any new execution.',
        ),
      ],
    ),
  ];
}

function scenario(id, title, classification, commands, evidenceItems) {
  return { id, title, classification, commands, evidence: evidenceItems };
}

function evidence(path, assertion) {
  return { path, assertion };
}
