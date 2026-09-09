import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { ArtifactExecutionStart } from '../../application/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../domain/src/index.js';
import { PostgresArtifactRepository, PostgresArtifactExecutionRepository } from '../src/index.js';

export async function verifyGowmArtifactExecutionScope(pool: Pool, taskIds: readonly string[]) {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as {
    artifacts: CompiledArtifact[];
    lineage: ArtifactLineage;
    runtimeBinding: ArtifactRuntimeBinding;
  };
  const artifact = fixture.artifacts[0];
  assert.ok(artifact);
  await new PostgresArtifactRepository(pool).saveCandidate({
    artifact,
    lineage: {
      ...fixture.lineage,
      lineageId: artifact.lineageRef,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      validationRunRefs: [],
    },
    runtimeBinding: {
      ...fixture.runtimeBinding,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
    },
  });
  for (const taskId of taskIds) {
    const owner = (
      await pool.query<{ device_id: string; sdar_service_key: string }>(
        'SELECT device_id,sdar_service_key FROM agent_task WHERE task_id=$1',
        [taskId],
      )
    ).rows[0];
    assert.ok(owner);
    const scope = {
      allowedDeviceIds: [owner.device_id],
      sdarServiceKey: owner.sdar_service_key,
      includeNonDevice: false,
    };
    const owned = new PostgresArtifactExecutionRepository(pool, scope);
    const foreign = new PostgresArtifactExecutionRepository(pool, {
      ...scope,
      allowedDeviceIds: [],
    });
    const input: ArtifactExecutionStart = {
      artifactExecutionId: randomUUID(),
      artifactId: artifact.artifactId,
      version: artifact.version,
      taskId,
      mode: 'shadow',
      decisionSnapshot: { fixture: 'device scope' },
      startedAt: new Date().toISOString(),
    };
    await assert.rejects(foreign.start(input), { code: 'ARTIFACT_EXECUTION_DEVICE_SCOPE_DENIED' });
    const created = await owned.start(input);
    assert.equal(created.taskId, taskId);
    const native = (
      await pool.query<{ device_id: string }>(
        'SELECT device_id FROM artifact_execution WHERE artifact_execution_id=$1',
        [input.artifactExecutionId],
      )
    ).rows[0];
    assert.equal(native?.device_id, owner.device_id);
    const completion = {
      artifactExecutionId: input.artifactExecutionId,
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
    };
    await assert.rejects(foreign.complete(completion), { code: 'ARTIFACT_EXECUTION_CAS_CONFLICT' });
    assert.equal(
      (
        await pool.query<{ status: string }>(
          'SELECT status FROM artifact_execution WHERE artifact_execution_id=$1',
          [input.artifactExecutionId],
        )
      ).rows[0]?.status,
      'started',
    );
    await owned.complete(completion);
    const feedback = {
      feedbackId: randomUUID(),
      artifactExecutionId: input.artifactExecutionId,
      artifactId: artifact.artifactId,
      feedbackType: 'outcome',
      reasonCode: 'FIXTURE',
      summary: 'Persistence scope fixture',
      impact: {},
      createdAt: new Date().toISOString(),
    };
    await assert.rejects(foreign.appendFeedback(feedback), {
      code: 'ARTIFACT_FEEDBACK_EXECUTION_MISMATCH',
    });
    await owned.appendFeedback(feedback);
  }
}
