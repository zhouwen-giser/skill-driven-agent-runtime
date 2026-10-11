import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

describe('isolated migration image identity', () => {
  it('creates the captured PostgreSQL image after another build replaces the requested tag', () => {
    const suffix = randomUUID();
    const tag = `sdar-verifier/migration-race:${suffix}`;
    const container = `sdar-verifier-migration-race-${suffix}`;
    const docker = (args: readonly string[]) => execFileSync('docker', args, { encoding: 'utf8' });
    let created = false;
    let tagged = false;
    try {
      docker(['tag', 'sdar/postgres-pgvector:17.10-0.8.5-alpine3.23', tag]);
      tagged = true;
      const captured = z
        .object({ imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u) })
        .parse(
          JSON.parse(
            execFileSync(
              process.execPath,
              [
                '--input-type=module',
                '-e',
                "import {execFileSync} from 'node:child_process'; import {inspectMigrationDockerImage} from './scripts/lib/migration-image-identity.mjs'; process.stdout.write(JSON.stringify(inspectMigrationDockerImage(args=>execFileSync('docker',args,{encoding:'utf8'}),process.argv[1])));",
                tag,
              ],
              { encoding: 'utf8' },
            ),
          ),
        );
      docker([
        'tag',
        'redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
        tag,
      ]);
      expect(docker(['image', 'inspect', '--format', '{{.Id}}', tag]).trim()).not.toBe(
        captured.imageId,
      );
      docker(['create', '--pull=never', '--name', container, captured.imageId]);
      created = true;
      expect(docker(['container', 'inspect', '--format', '{{.Image}}', container]).trim()).toBe(
        captured.imageId,
      );
    } finally {
      if (created) docker(['rm', container]);
      if (tagged) docker(['image', 'rm', tag]);
    }
  });
});
