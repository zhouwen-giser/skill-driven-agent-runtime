import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const c = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
const pool = new pg.Pool({
  connectionString: c.GOWM_DATABASE_URL,
  options: '-c search_path=ugv_sdar,public,pg_catalog',
});
const base = 'http://127.0.0.1:10998';
const headers = {
  'content-type': 'application/json',
  authorization: 'Bearer ' + c.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN,
};
async function request(path, method = 'GET', body) {
  const r = await globalThis.fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`SITE_API_FAILED:${r.status}:${path}`);
  return r.json();
}
try {
  // GOWM owns DDL and intentionally omits SDAR configuration seeds. Install only
  // the three baseline singleton data rows; preserve any operator-edited values.
  await pool.query(`INSERT INTO task_wait_policy(singleton,timeout_seconds,updated_at)
    VALUES(true,300,now()) ON CONFLICT(singleton) DO NOTHING`);
  await pool.query(`INSERT INTO memory_retention_policy(singleton,review_after_days,archive_after_days,delete_after_days,automatic_archive_enabled,automatic_delete_enabled,updated_at)
    VALUES(true,90,365,730,false,false,now()) ON CONFLICT(singleton) DO NOTHING`);
  await pool.query(`INSERT INTO evolution_policy(singleton,success_threshold,updated_at)
    VALUES(true,2,now()) ON CONFLICT(singleton) DO NOTHING`);
  for (const path of ['task-wait-policy', 'memory-retention-policy', 'evolution-policy'])
    await request('/api/v1/system/' + path);
  const servers = await request('/api/v1/mcp/servers');
  const old = servers.items.find((s) => s.serverId === 'smpp-sz-gowm');
  if (!old)
    await request('/api/v1/mcp/servers', 'POST', {
      serverId: 'smpp-sz-gowm',
      name: 'sz-gowm SMPP',
      endpoint: 'http://smpp-gowm-runtime-1:8080/mcp',
      credentialHeaders: {},
    });
  const tools = await request('/api/v1/mcp/servers/smpp-sz-gowm/tools');
  if (!tools.items.some((t) => t.toolName === 'vehicle_get_state'))
    throw new Error('SITE_SMPP_READ_TOOL_MISSING');
  process.stdout.write(
    JSON.stringify({
      status: 'PASS',
      policies: 3,
      serverId: 'smpp-sz-gowm',
      toolCount: tools.items.length,
      deviceCalls: 0,
    }) + '\n',
  );
} finally {
  await pool.end();
}

const governance = spawnSync(process.execPath, ['deploy/development/bootstrap.mjs'], {
  stdio: 'inherit',
});
if (governance.error) throw governance.error;
process.exitCode = governance.status ?? 1;
