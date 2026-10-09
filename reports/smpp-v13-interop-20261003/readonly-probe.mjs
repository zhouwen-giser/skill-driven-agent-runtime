import fs from 'node:fs';
import { FrozenV1McpClient } from '/app/dist/packages/mcp-adapter/src/frozen-v1-mcp-client.js';
const config=JSON.parse(fs.readFileSync('/run/sdar/environment.json','utf8'));
const keys=['NODE_ENV','SDAR_CONTROL_ENVIRONMENT','SDAR_MCP_LIVE_EXECUTION_MODE_HEADER','SDAR_UGV_EXECUTION_MODE','SDAR_UGV_SIMULATION_ID','SDAR_UGV_RESOURCE_ID'];
const calls=[];const client=new FrozenV1McpClient(async (url,init)=>{const body=JSON.parse(init.body);calls.push({id:body.id,method:body.method,tool:body.params.name??null,mode:init.headers['x-sdar-execution-mode']??null,hasSimulationHeader:'x-sdar-simulation-id' in init.headers,hasAuthorization:'Authorization' in init.headers});return fetch(url,{...init,signal:AbortSignal.timeout(15000)});});
const base={endpoint:'http://smpp-gowm-runtime:9100/mcp',headers:{}};
base.endpoint='http://172.17.0.1:19100/mcp';
const results=[];
for(const headers of [{},{'x-sdar-execution-mode':'live'}]){
 for(const method of ['server/discover','tools/list']){
  try{const r=await client.request({...base,headers,method});results.push({mode:headers['x-sdar-execution-mode']??'omitted',method,status:'PASS',extensions:r.capabilities?.extensions,tools:r.tools?.map(t=>({name:t.name,resource:t.inputSchema?.properties?.resourceId,hasBusinessSemantics:!!t.outputSchema?.properties?.businessSemantics}))});}catch(e){results.push({method,status:'FAIL',code:e.code,message:e.message});}
 }
 for(const name of ['vehicle_get_state','vehicle_get_payload_status','vehicle_get_targets']){
  try{const r=await client.request({...base,headers,method:'tools/call',params:{name,arguments:{resourceId:'vehicle:ugv'}}});results.push({mode:headers['x-sdar-execution-mode']??'omitted',tool:name,status:r.isError?'FAIL':'PASS',resultType:r.resultType,semantic:r.structuredContent?.businessSemantics??null,outputKeys:Object.keys(r.structuredContent??{})});}catch(e){results.push({tool:name,status:'FAIL',code:e.code,message:e.message});}
 }
}
console.log(JSON.stringify({configuration:Object.fromEntries(keys.map(k=>[k,config[k]??null])),calls,results,mutatingToolsCalled:0},null,2));
