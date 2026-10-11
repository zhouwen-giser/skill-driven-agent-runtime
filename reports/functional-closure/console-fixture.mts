import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { startServerRuntime, type ServerRuntimeHandle } from '../../apps/server/src/runtime.js';
import { PostgresConversationContextRepository, PostgresGoalRepository, PostgresWorkflowPlanRepository } from '../../packages/persistence-postgres/src/repositories.js';
import { createGoal, createGoalExecutionContract } from '../../packages/domain/src/index.js';
const id=`sdar-console-${randomUUID()}`;
const containers:string[]=[];
let runtime:ServerRuntimeHandle|undefined;
let pool:Pool|undefined;
const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:60000}).trim();
try {
 const password=randomBytes(24).toString('hex');
 const pgid=docker(['create','--label',`io.sdar.console-fixture=${id}`,'--publish','127.0.0.1::5432','--env','POSTGRES_USER=sdar','--env',`POSTGRES_PASSWORD=${password}`,'--env','POSTGRES_DB=sdar_console_test','gowm-plus-db:sdar-pgvector-0.8.5']);containers.push(pgid);
 const rid=docker(['create','--label',`io.sdar.console-fixture=${id}`,'--publish','127.0.0.1::6379','redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb']);containers.push(rid);
 for(const c of containers)docker(['start',c]);
 const port=(c:string,p:string)=>Number(docker(['inspect','--format',`{{(index (index .NetworkSettings.Ports "${p}/tcp") 0).HostPort}}`,c]));
 let url=`postgresql://sdar:${password}@127.0.0.1:${port(pgid,'5432')}/sdar_console_test`;
 pool=new Pool({connectionString:url,connectionTimeoutMillis:1000});
 for(let n=0;;n++){try{await pool.query('SELECT 1');break;}catch(e){if(n===60)throw Error('fixture unavailable');await new Promise(r=>setTimeout(r,1000));}}
 await pool.query('CREATE DATABASE sdar_console_clean_test TEMPLATE template0');await pool.end();url=url.replace('/sdar_console_test','/sdar_console_clean_test');pool=new Pool({connectionString:url});
 runtime=await startServerRuntime({postgresUrl:url,redis:{host:'127.0.0.1',port:port(rid,'6379')},masterKeyBase64:randomBytes(32).toString('base64'),applyMigrations:true,a2aPort:0,managementPort:0,queueName:id,evidenceEnvironment:'e2e',outboundEndpointPolicy:{unsafeTestOpen:false,mcpAllowedAuthorities:[],providerAllowedAuthorities:[]}});
 const now=new Date().toISOString();const contextId=`${id}-context`;
 await new PostgresConversationContextRepository(pool).save({contextId,userId:'local-ui-fixture',createdAt:now,updatedAt:now});
 const goal=createGoal({goalId:`${id}-goal`,contextId,title:'Console node editor verification',description:'Return the operator-edited literal; isolated fixture, no tools',timestamp:now});
 await new PostgresGoalRepository(pool).save(goal);
 const planId=`${id}-plan`;
 await new PostgresWorkflowPlanRepository(pool).savePlan({planId,goalId:goal.goalId,goalVersion:1,goalContract:createGoalExecutionContract(goal),confirmationStatus:'awaiting_confirmation',attemptCount:1,createdAt:now,definition:{executionSemanticsVersion:'2.0',workflowDefinitionId:planId,version:1,goalId:goal.goalId,goalVersion:1,entryNodeId:'result',exitNodeIds:['result'],nodes:[{nodeId:'result',name:'Result',type:'result',value:{op:'literal',value:'original'}}],edges:[]}});
 await writeFile('/tmp/sdar-console-fixture.json',JSON.stringify({url:runtime.management.baseUrl,planId,instanceId:`${id}-instance`,runId:id}));
 console.log('CONSOLE_FIXTURE_READY');
 await new Promise<void>(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
} finally {
 await runtime?.close();await pool?.end();
 for(const c of containers.reverse()) {if(docker(['inspect','--format','{{index .Config.Labels "io.sdar.console-fixture"}}',c])!==id)throw Error('fixture ownership mismatch');docker(['rm','--force','--volumes',c]);}
 console.log('CONSOLE_FIXTURE_CLEANUP_PASS');
}
