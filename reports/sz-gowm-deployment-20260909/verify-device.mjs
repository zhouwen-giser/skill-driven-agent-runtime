import console from 'node:console';
const { fetch } = globalThis;
import {readFile} from 'node:fs/promises';import pg from 'pg';
import {PostgresGowmDeviceContextReader} from './dist/packages/persistence-postgres/src/gowm-device-context.js';
import {gowmSharedPoolConfiguration} from './dist/packages/persistence-postgres/src/gowm-storage-contract.js';
const c=JSON.parse(await readFile('/run/sdar/environment.json','utf8'));
const pool=new pg.Pool(gowmSharedPoolConfiguration(c.GOWM_DATABASE_URL));
try {
 const r=await new PostgresGowmDeviceContextReader(pool,{allowedDeviceIds:JSON.parse(c.SDAR_ALLOWED_DEVICE_IDS),sdarServiceKey:c.SDAR_SERVICE_KEY,includeNonDevice:c.SDAR_INCLUDE_NON_DEVICE_TASKS==='true'}).resolve({deviceId:c.SDAR_DEVICE_ID,dataScopeKey:c.SDAR_DATA_SCOPE_KEY});
 console.log(JSON.stringify({status:'PASS',context:r}));
} finally {await pool.end();}
const r=await fetch('http://127.0.0.1:10998/api/v1/mcp/servers/smpp-sz-gowm/refresh',{method:'POST',headers:{authorization:'Bearer '+c.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN}});
if(!r.ok)throw Error('SMPP_REFRESH_FAILED');const tools=await (await fetch('http://127.0.0.1:10998/api/v1/mcp/servers/smpp-sz-gowm/tools')).json();console.log(JSON.stringify({refresh:r.status,toolCount:tools.items.length,deviceCalls:0}));
