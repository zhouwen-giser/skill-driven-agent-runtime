#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readExistingState } from './initialize-state.mjs';
import { authorizeB02SimulationId } from './b02-attempt-identity.mjs';

// Development uses the existing private local identity, not the health of unrelated
// historical acceptance evidence. Explicit successor IDs still require their full chain.
export async function authorizeDebugSimulationId(simulationId, options = {}) {
  const state = await readExistingState(options.stateRoot);
  if (simulationId === state.simulationRunId)
    return Object.freeze({
      simulationId,
      bootstrapRunId: state.bootstrapRunId,
      kind: 'development_reserved',
    });
  return authorizeB02SimulationId(simulationId, options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== 'authorize')
      throw new Error('UGV_DEBUG_IDENTITY_ARGUMENT_INVALID');
    await authorizeDebugSimulationId(process.argv[3]);
    process.stdout.write('{"status":"authorized"}\n');
  } catch {
    process.stderr.write('UGV_DEBUG_IDENTITY_NOT_AUTHORIZED\n');
    process.exitCode = 2;
  }
}
