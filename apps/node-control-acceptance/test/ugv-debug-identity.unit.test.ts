import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

interface Identity {
  authorizeDebugSimulationId(
    id: string,
    options: { stateRoot: string; reportRoot: string },
  ): Promise<unknown>;
}
interface State {
  initializeState(root: string): Promise<{ simulationRunId: string }>;
}
interface Acceptance {
  authorizeB02SimulationId(
    id: string,
    options: { stateRoot: string; reportRoot: string },
  ): Promise<unknown>;
}
const script = (name: string) =>
  pathToFileURL(resolve('scripts/ugv-agent-profile-simulation', name)).href;
const identity = (await import(script('debug-identity.mjs'))) as Identity;
const state = (await import(script('initialize-state.mjs'))) as State;
const acceptance = (await import(script('b02-attempt-identity.mjs'))) as Acceptance;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('keeps development identity independent of historical acceptance reports without changing acceptance validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdar-debug-identity-'));
  roots.push(root);
  const { simulationRunId } = await state.initializeState(root);
  const identityRoot = join(root, 'b02/attempt-identities');
  await mkdir(identityRoot, { recursive: true, mode: 0o700 });
  const evidence = join(identityRoot, `${simulationRunId}.json`);
  await writeFile(evidence, '{"old":"preserved"}', { mode: 0o600 });
  const options = { stateRoot: root, reportRoot: join(root, 'reports') };
  await expect(
    identity.authorizeDebugSimulationId(simulationRunId, options),
  ).resolves.toMatchObject({
    simulationId: simulationRunId,
    kind: 'development_reserved',
  });
  await expect(acceptance.authorizeB02SimulationId(simulationRunId, options)).rejects.toThrow();
  await expect(
    identity.authorizeDebugSimulationId('uap-p3-b02-unissued-12345678', options),
  ).rejects.toThrow();
  await expect(identity.authorizeDebugSimulationId('invalid', options)).rejects.toThrow();
  expect(await readFile(evidence, 'utf8')).toBe('{"old":"preserved"}');
  expect((await readFile(join(root, 'simulation-run-id'), 'utf8')).trim()).toBe(simulationRunId);
});

it('refuses a missing or modified private local identity rather than generating one during authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdar-debug-identity-'));
  roots.push(root);
  const options = { stateRoot: root, reportRoot: join(root, 'reports') };
  await expect(
    identity.authorizeDebugSimulationId('uap-p3-b02-unissued-12345678', options),
  ).rejects.toThrow();
  const { simulationRunId } = await state.initializeState(root);
  await writeFile(join(root, 'simulation-run-id'), 'invalid', { mode: 0o600 });
  await expect(identity.authorizeDebugSimulationId(simulationRunId, options)).rejects.toThrow();
});
