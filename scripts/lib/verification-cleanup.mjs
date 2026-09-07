import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { runVerificationProcess, verificationProcessPassed } from './verification-process.mjs';
import { verificationProjects } from './verification-projects.mjs';

// Continue all cleanup attempts, but never let an unsuccessful cleanup produce a green gate.
export function recordVerificationCleanupFailure(resource, error) {
  process.stderr.write(
    `${JSON.stringify({ event: 'verification.cleanup_failed', resource, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
}

export function migrationVerificationResources(runId) {
  if (!/^[a-z0-9-]+$/u.test(runId)) throw new Error('MIGRATION_VERIFICATION_RUN_INVALID');
  return {
    sourceContainer: `sdar-p13-migration-source-${runId}`,
    sourceVolume: `sdar-p13-migration-source-data-${runId}`,
    targetContainer: `sdar-p13-migration-target-${runId}`,
    targetVolume: `sdar-p13-migration-target-data-${runId}`,
  };
}

export async function cleanupVerificationMigrations({
  runId,
  cwd,
  env,
  reports,
  run = runVerificationProcess,
}) {
  verificationProjects(runId); // The outer cleanup can only own an isolated verification run.
  const resources = migrationVerificationResources(runId);
  const results = [];
  for (const [kind, expected] of [
    ['container', [resources.sourceContainer, resources.targetContainer]],
    ['volume', [resources.sourceVolume, resources.targetVolume]],
  ]) {
    const logPath = join(reports, `cleanup-migration-${kind}-inventory.log`);
    const query = await run({
      command: 'docker',
      args: [
        kind,
        'ls',
        ...(kind === 'container' ? ['--all'] : []),
        '--filter',
        `label=io.sdar.run=${runId}`,
        '--filter',
        'label=io.sdar.scope=p13-migration-verifier',
        '--format',
        '{{.Name' + (kind === 'container' ? 's' : '') + '}}',
      ],
      cwd,
      env,
      logPath,
      timeoutMs: 60_000,
    });
    results.push({ resource: `migration-${kind}-inventory`, ...query });
    if (!verificationProcessPassed(query)) continue;
    const names = (await readFile(logPath, 'utf8')).trim().split(/\s+/u).filter(Boolean);
    if (names.some((name) => !expected.includes(name))) {
      results.push({
        resource: `migration-${kind}-ownership`,
        exitCode: 1,
        error: 'MIGRATION_CLEANUP_RESOURCE_NOT_OWNED',
      });
      continue;
    }
    for (const name of names) {
      const removal = await run({
        command: 'docker',
        args: [kind, 'rm', ...(kind === 'container' ? ['--force'] : []), name],
        cwd,
        env,
        logPath: join(reports, `cleanup-${name}.log`),
        timeoutMs: 60_000,
      });
      results.push({ resource: name, ...removal });
    }
  }
  return results;
}
