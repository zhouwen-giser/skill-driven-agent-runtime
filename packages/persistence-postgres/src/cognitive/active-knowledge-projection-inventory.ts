import type { Pool, QueryResultRow } from 'pg';

import type { ActiveKnowledgeProjectionInventory } from '../../../application/src/index.js';

interface ProjectionRow extends QueryResultRow {
  memory_id: string;
}

export class PostgresActiveKnowledgeProjectionInventory implements ActiveKnowledgeProjectionInventory {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listActiveProjectionIds(): Promise<readonly string[]> {
    const result = await this.#pool.query<ProjectionRow>(
      `SELECT memory_id FROM memory_item
       WHERE status='active'
         AND content_json->>'projectionType'='active_knowledge'
       ORDER BY memory_id`,
    );
    return Object.freeze(result.rows.map((row) => row.memory_id));
  }
}
