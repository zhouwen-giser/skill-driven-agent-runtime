import assert from 'node:assert/strict';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export function assertPlanningBoundary(file, source) {
  const normalized = file.split(path.sep).join('/');
  const imports = [
    ...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu),
  ].map((match) => match[1]);
  if (/^packages\/(?:domain|application)\/src\//u.test(normalized)) {
    if (/\btoolName\s*===\s*['"]vehicle_/u.test(source))
      throw new Error(`ARCH_CORE_PROFILE_OPERATION_POLICY: ${normalized}`);
    for (const dependency of imports) {
      if (/ugv-profile|governed-control-ugv|ugv-move/u.test(dependency))
        throw new Error(`ARCH_CORE_PROFILE_REVERSE_DEPENDENCY: ${normalized} -> ${dependency}`);
    }
  }
  if (normalized.startsWith('packages/ugv-profile/src/')) {
    if (
      /\b(?:commitTerminalOutcome|submitTerminalOutcome|completeTask|failTask|cancelTask|achieveGoal|setGoalTerminal|saveTerminalOutcome)\s*\(/u.test(
        source,
      )
    )
      throw new Error(`ARCH_PROFILE_TERMINAL_WRITER: ${normalized}`);
    for (const dependency of imports) {
      if (
        /(?:apps\/server|persistence-postgres|runtime-redis|mcp-adapter|a2a-adapter|langgraph-runtime|management-api|@a2a-js|@modelcontextprotocol|@langchain|^(?:pg|bullmq|express|redis)$)/u.test(
          dependency,
        )
      )
        throw new Error(`ARCH_PROFILE_ADAPTER_DEPENDENCY: ${normalized} -> ${dependency}`);
    }
  }
  if (/\/(?:user-goal|workflow|task-planning)-candidate-generator\.ts$/u.test(normalized)) {
    if (
      /\b(?:WorkflowPlanRepository|UserGoalPlanningRepository|WorkflowExecutionService|TaskService|UserGoalPlanningService|WorkflowPlanCommitService|UserGoalPlanCommitService|savePlan|savePlanAndSupersede|saveContract|createPlan|replacePlan|confirmPlan|bindInitialPlan|saveTask)\b/u.test(
        source,
      )
    )
      throw new Error(`ARCH_CANDIDATE_FORMAL_WRITER: ${normalized}`);
  }
}

// These execute in the architecture gate. Each forbidden example must fail for its own boundary.
const fixtures = [
  [
    'packages/application/src/task-capability.ts',
    "invocation.toolName === 'vehicle_navigate'",
    /ARCH_CORE_PROFILE_OPERATION_POLICY/u,
  ],
  [
    'packages/ugv-profile/src/policy.ts',
    'terminal.setGoalTerminal(result);',
    /ARCH_PROFILE_TERMINAL_WRITER/u,
  ],
  [
    'packages/application/src/task-service.ts',
    "import type { UgvPolicy } from '../../ugv-profile/src/index.js';",
    /ARCH_CORE_PROFILE_REVERSE_DEPENDENCY/u,
  ],
  [
    'packages/ugv-profile/src/policy.ts',
    "import { Pool } from 'pg';",
    /ARCH_PROFILE_ADAPTER_DEPENDENCY/u,
  ],
  [
    'packages/ugv-profile/src/policy.ts',
    "import type { Client } from '@modelcontextprotocol/sdk';",
    /ARCH_PROFILE_ADAPTER_DEPENDENCY/u,
  ],
  [
    'packages/application/src/workflow-candidate-generator.ts',
    'class Generator { constructor(repository: WorkflowPlanRepository) {} }',
    /ARCH_CANDIDATE_FORMAL_WRITER/u,
  ],
  [
    'packages/application/src/user-goal-candidate-generator.ts',
    'await repository.replacePlan(input);',
    /ARCH_CANDIDATE_FORMAL_WRITER/u,
  ],
];
for (const [file, source, code] of fixtures)
  assert.throws(() => assertPlanningBoundary(file, source), code);
assert.doesNotThrow(() =>
  assertPlanningBoundary(
    'packages/ugv-profile/src/policy.ts',
    "import type { AgentTask } from '../../domain/src/index.js';",
  ),
);
assert.doesNotThrow(() =>
  assertPlanningBoundary(
    'packages/application/src/workflow-candidate-generator.ts',
    'await audit.saveAttempt(attempt); await plans.findPlan(id);',
  ),
);

async function collect(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory()
          ? collect(file)
          : Promise.resolve(entry.name.endsWith('.ts') ? [file] : []);
      }),
    )
  ).flat();
}
for (const directory of [
  'packages/domain/src',
  'packages/application/src',
  'packages/ugv-profile/src',
  'apps/server/src',
]) {
  for (const file of await collect(directory))
    assertPlanningBoundary(file, await readFile(file, 'utf8'));
}
console.log('Planning/profile boundaries: PASS (7 forbidden fixtures rejected).');
