import { generateReplayArtifact } from './lib/cognitive-replay.mjs';

const result = await generateReplayArtifact();
process.stdout.write(`Promotion provenance written to ${result.outputPath}.\n`);
