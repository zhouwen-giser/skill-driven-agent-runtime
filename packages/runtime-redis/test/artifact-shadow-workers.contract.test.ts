import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const workerUrl = new URL('../src/compiler/artifact-shadow-workers.ts', import.meta.url);
const applicationUrl = new URL(
  '../../application/src/compiler/artifact-shadow-runtime.ts',
  import.meta.url,
);
const replayRepositoryUrl = new URL(
  '../../persistence-postgres/src/compiler/artifact-replay-validation-repository.ts',
  import.meta.url,
);

describe('P06 BullMQ Shadow wakes', () => {
  it('uses the frozen P06 queues and only persists wake identifiers in Redis', async () => {
    const source = await readFile(workerUrl, 'utf8');
    const application = await readFile(applicationUrl, 'utf8');
    expect(application).toContain("ARTIFACT_SHADOW_QUEUE_NAME = 'sdar-artifact-shadow'");
    expect(application).toContain(
      "ARTIFACT_REVALIDATION_QUEUE_NAME = 'sdar-artifact-revalidation'",
    );
    expect(source).toContain('ARTIFACT_SHADOW_QUEUE_NAME');
    expect(source).toContain('ARTIFACT_REVALIDATION_QUEUE_NAME');
    expect(source).toContain('z.object({ shadowRunId: z.string().min(1).max(512) }).strict()');
    expect(source).toContain('const claimed = await service.claim(workerId, 1)');
    expect(source).not.toContain('woken=true');
  });

  it('routes the durable P06 trigger to the P05 replay worker and accepts revalidation runs', async () => {
    const [source, replayRepository] = await Promise.all([
      readFile(workerUrl, 'utf8'),
      readFile(replayRepositoryUrl, 'utf8'),
    ]);
    expect(source).toContain('class BullMqArtifactRevalidationWorker');
    expect(source).toContain('await service.process(wake.shadowRunId)');
    expect(replayRepository).toContain("validation_type IN ('replay','revalidation')");
    expect(replayRepository).toContain(
      "['candidate', 'revalidating', 'deprecated'].includes(artifact.status)",
    );
  });
});
