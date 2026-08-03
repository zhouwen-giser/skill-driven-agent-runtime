import process from 'node:process';

import { loadNodeControlApiEnvironment } from './environment.js';
import { startNodeControlApi } from './runtime.js';

const runtime = await startNodeControlApi(loadNodeControlApiEnvironment());
process.stdout.write(
  `${JSON.stringify({ event: 'node_control.api.ready', baseUrl: runtime.baseUrl })}\n`,
);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await runtime.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
