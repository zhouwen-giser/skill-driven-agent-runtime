import console from 'node:console';
const { fetch, AbortSignal } = globalThis;
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {gowmSharedPoolConfiguration,verifyGowmStorageContract} from './dist/packages/persistence-postgres/src/gowm-storage-contract.js';
const c=JSON.parse(await readFile('/run/sdar/environment.json','utf8'));
const pool=new pg.Pool(gowmSharedPoolConfiguration(c.GOWM_DATABASE_URL));
const client=await pool.connect();
try {
 await verifyGowmStorageContract(client,'contracts/gowm-shared-storage/current');
 const identity=(await client.query('select current_database() as database,current_user as role,current_setting(\'search_path\') as search_path')).rows[0];
 const counts=(await client.query('select (select count(*)::int from mcp_server) as mcp_servers,(select count(*)::int from model_provider) as model_providers,(select count(*)::int from task_wait_policy) as wait_policies,(select count(*)::int from agent_task) as tasks')).rows[0];
 console.log(JSON.stringify({contract:'PASS',...identity,...counts}));
} finally {client.release();await pool.end();}
for (const url of ['http://127.0.0.1:10998/api/v1/health','http://127.0.0.1:10998/console/','http://127.0.0.1:10999/.well-known/agent-card.json','http://control-api:10091/health/ready','http://smpp-gowm-runtime-1:8080/health/ready','http://world-api:3000/health','http://world-mcp-server:3001/health']) {
 const r=await fetch(url,{signal:AbortSignal.timeout(10000)});console.log(JSON.stringify({url,status:r.status}));if(!r.ok)throw Error('SITE_HEALTH_FAILED');
}
const model=await fetch(c.SDAR_UGV_MODEL_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.SDAR_UGV_MODEL_API_KEY},body:JSON.stringify({model:c.SDAR_UGV_MODEL_NAME,messages:[{role:'user',content:'Reply with OK.'}],max_tokens:8,stream:false}),signal:AbortSignal.timeout(60000)});
console.log(JSON.stringify({model:c.SDAR_UGV_MODEL_NAME,status:model.status,scope:'synthetic-connectivity-only'}));
if(!model.ok)throw Error('SITE_MODEL_HEALTH_FAILED');
