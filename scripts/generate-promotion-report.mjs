import { generateReplayArtifact } from './lib/cognitive-replay.mjs';
import process from 'node:process';

const result = await generateReplayArtifact();
process.stdout.write(`Promotion provenance written to ${result.outputPath}.\n`);
