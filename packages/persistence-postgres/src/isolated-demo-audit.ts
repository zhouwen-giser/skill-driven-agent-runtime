import type { Pool } from 'pg';
import { IsolatedDemoError } from '../../application/src/isolated-demo-service.js';
import type {
  IsolatedDemoAudit,
  IsolatedDemoRecord,
} from '../../application/src/isolated-demo-service.js';

export class PostgresIsolatedDemoAudit implements IsolatedDemoAudit {
  constructor(private readonly pool: Pool) {}
  async append(record: IsolatedDemoRecord): Promise<void> {
    const inserted = await this.pool.query(
      `INSERT INTO development_isolated_demo_audit(request_id,phase,payload) VALUES($1,$2,$3::jsonb)
       ON CONFLICT(request_id,phase) DO NOTHING RETURNING request_id`,
      [record.requestId, record.phase, JSON.stringify(record)],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.pool.query<{ payload: IsolatedDemoRecord }>(
        'SELECT payload FROM development_isolated_demo_audit WHERE request_id=$1 AND phase=$2',
        [record.requestId, record.phase],
      );
      if (
        existing.rows[0]?.payload.objectId !== record.objectId ||
        existing.rows[0].payload.state !== record.state
      )
        throw new IsolatedDemoError('SOFTWARE_DEMO_IDEMPOTENCY_CONFLICT');
    }
  }
  async list(): Promise<readonly IsolatedDemoRecord[]> {
    const rows = await this.pool.query<{ payload: IsolatedDemoRecord }>(
      'SELECT payload FROM development_isolated_demo_audit ORDER BY sequence',
    );
    return rows.rows.map((row) => row.payload);
  }
}
