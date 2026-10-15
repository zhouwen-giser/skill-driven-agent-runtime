import {loadRuntimeConfig} from './dist/apps/runtime/src/config.js';
import {createGowmPool,scopePredicate} from './dist/packages/gowm-shared-storage-adapter/src/index.js';
import {Pool} from 'pg';
const c=loadRuntimeConfig();const p=c.gowmStorage?createGowmPool(c.gowmStorage,1):new Pool({connectionString:c.DATABASE_URL,max:1});
try {
 const queries=[['activeTasks','provider_task',"internal_state NOT LIKE 'TERMINAL_%'"],['pendingAdmissions','admission_intent',"state IN ('PENDING','UNCERTAIN')"],['pendingCommands','task_command',"state IN ('PENDING','CLAIMED','RETRY_WAIT')"]];const counts={};
 for(const [key,table,condition] of queries){const r=await p.query(`SELECT count(*)::int AS count FROM ${table} WHERE (${scopePredicate(p,table,table)}) AND (${condition})`);counts[key]=r.rows[0].count;}
 if(Object.values(counts).some(n=>n!==0))throw Error('SMPP_UPGRADE_ACTIVE_EXECUTION');console.log(JSON.stringify({...counts,status:'idle'}));
}finally{await p.end();}
