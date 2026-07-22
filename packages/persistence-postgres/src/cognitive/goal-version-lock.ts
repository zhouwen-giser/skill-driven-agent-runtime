import type { Pool } from 'pg';

import type { GoalVersionLock } from '../../../application/src/cognitive/index.js';

export class PostgresGoalVersionLock implements GoalVersionLock {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async withLock<T>(goalId: string, goalVersion: number, operation: () => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('sdar:v123:goal-version:' || $1),$2)", [
        goalId,
        goalVersion,
      ]);
      return await operation();
    } finally {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('sdar:v123:goal-version:' || $1),$2)",
          [goalId, goalVersion],
        );
      } finally {
        client.release();
      }
    }
  }
}
