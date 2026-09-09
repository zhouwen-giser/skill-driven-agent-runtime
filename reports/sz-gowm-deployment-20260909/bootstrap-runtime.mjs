import console from 'node:console';
const { fetch } = globalThis;
import {readFile} from 'node:fs/promises';
const c=JSON.parse(await readFile('/run/sdar/environment.json','utf8'));
const base='http://127.0.0.1:10998';
const headers={'content-type':'application/json',authorization:'Bearer '+c.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN};
const get=async path=>{const r=await fetch(base+path);return {status:r.status,data:await r.json()}};
const policy=await get('/api/v1/system/task-wait-policy');
if(policy.data?.code==='TASK_WAIT_POLICY_NOT_CONFIGURED'||policy.data?.error?.code==='TASK_WAIT_POLICY_NOT_CONFIGURED') {
 const r=await fetch(base+'/api/v1/system/task-wait-policy',{method:'PUT',headers,body:JSON.stringify({timeoutSeconds:300})});
 if(!r.ok)throw Error('WAIT_POLICY_INITIALIZATION_FAILED');
}
console.log(JSON.stringify({waitPolicy:await get('/api/v1/system/task-wait-policy'),memoryPolicy:await get('/api/v1/system/memory-retention-policy'),evolutionPolicy:await get('/api/v1/system/evolution-policy')}));
const list=await get('/api/v1/mcp/servers');
if(!list.data.items.some(s=>s.serverId==='smpp-sz-gowm')){
 const r=await fetch(base+'/api/v1/mcp/servers',{method:'POST',headers,body:JSON.stringify({serverId:'smpp-sz-gowm',name:'sz-gowm SMPP',endpoint:'http://smpp-gowm-runtime-1:8080/mcp',credentialHeaders:{}})});
 const d=await r.json();if(!r.ok)throw Error(JSON.stringify({status:r.status,error:d}));
 console.log(JSON.stringify({registration:'created',serverId:d.server?.serverId??d.serverId,toolCount:d.tools?.length}));
}
const tools=await get('/api/v1/mcp/servers/smpp-sz-gowm/tools');console.log(JSON.stringify({serverId:'smpp-sz-gowm',status:tools.status,toolCount:tools.data.items?.length,tools:tools.data.items?.map(x=>x.toolName)}));
