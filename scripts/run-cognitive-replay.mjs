import process from 'node:process';

import { generateReplayArtifact } from './lib/cognitive-replay.mjs';

const check = process.argv.includes('--check');
const result = await generateReplayArtifact({ check });
process.stdout.write(
  `Cognitive Replay ${check ? 'artifact verified' : 'completed'}: ${result.report.status}, ` +
    `${String(result.report.replayPassedCount)} passed, ` +
    `${String(result.report.replayFailedCount)} failed, no physical Provider calls.\n`,
);
