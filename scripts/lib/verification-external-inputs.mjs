import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Existing unit/Compose contracts read these sibling-project assets. Snapshot only these
// reviewed data inputs, never a sibling .env, dependency tree, running service or writable link.
export const externalVerificationInputs = Object.freeze([
  'smpp-telemetry-platform/deploy/ugv-debug/collector.template.yaml',
  'smpp-telemetry-platform/deploy/ugv-debug/compose.yaml',
  'smpp-telemetry-platform/config/projection-targets.example.json',
  'sdar-telemetry-platform/migrations/clickhouse/015_provider_closure_v2.sql',
  'sdar-mcp-provider-platform/compose.yaml',
  'sdar-mcp-provider-platform/compose.ugv-agent-profile-simulation.yaml',
]);

export async function copyExternalVerificationInputs(sourceParent, snapshotParent) {
  const entries = [];
  for (const relative of externalVerificationInputs) {
    const source = join(sourceParent, relative);
    const stat = await lstat(source);
    if (!stat.isFile()) throw new Error(`EXTERNAL_INPUT_NOT_REGULAR:${relative}`);
    const content = await readFile(source);
    const destination = join(snapshotParent, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, { mode: stat.mode });
    entries.push({
      path: `../${relative}`,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
  return entries;
}
