import { Queue } from 'bullmq';

import type { RedisConnectionConfig } from '../src/index.js';

export async function obliterateTestQueues(
  connection: RedisConnectionConfig,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    const queue = new Queue(name, { connection });
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }
}
