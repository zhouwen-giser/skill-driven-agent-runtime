import console from 'node:console';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { RedisConnection } from 'bullmq';
const c = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
const pool = new pg.Pool({ connectionString: c.SDAR_POSTGRES_URL });
const control = new pg.Pool({ connectionString: c.SDAR_CONTROL_DATABASE_URL });
const connection = new RedisConnection({
  host: c.SDAR_REDIS_HOST,
  port: Number(c.SDAR_REDIS_PORT),
  password: c.SDAR_REDIS_PASSWORD,
  db: Number(c.SDAR_REDIS_DB),
});
try {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM agent_task WHERE phase NOT IN ('completed','failed','canceled')) AS tasks,
    (SELECT count(*)::int FROM remote_task_binding WHERE local_state NOT IN ('closed','reentered','quarantined')) AS remote_tasks,
    (SELECT count(*)::int FROM remote_task_admission_intent WHERE status NOT IN ('closed','materialized')) AS pending_dispatch`);
  if (Object.values(result.rows[0]).some((count) => count !== 0))
    throw new Error('DEVELOPMENT_UPGRADE_ACTIVE_EXECUTION');
  const operations = await control.query(
    "SELECT count(*)::int AS active FROM sdar_control.management_operation WHERE status IN ('accepted','running')",
  );
  if (operations.rows[0].active !== 0)
    throw new Error('DEVELOPMENT_UPGRADE_ACTIVE_GOVERNANCE_OPERATION');
  const redis = await connection.client;
  const persistence = await redis.info('persistence');
  if (!persistence.includes('aof_enabled:1') || !persistence.includes('aof_last_write_status:ok'))
    throw new Error('DEVELOPMENT_REDIS_AOF_UNHEALTHY');
  let cursor = '0';
  let active = 0;
  let leases = 0;
  do {
    const next = await redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 200);
    cursor = next[0];
    for (const key of next[1]) {
      if (key.endsWith(':active')) active += await redis.llen(key);
      if (key.endsWith(':lock')) leases++;
    }
  } while (cursor !== '0');
  if (active || leases) throw new Error('DEVELOPMENT_UPGRADE_ACTIVE_QUEUE_LEASE');
  console.log(
    JSON.stringify({
      ...result.rows[0],
      activeQueue: active,
      leases,
      aof: 'enabled/writable',
      status: 'idle',
    }),
  );
} finally {
  await connection.close();
  await pool.end();
  await control.end();
}
