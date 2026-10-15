import pathlib,json,subprocess,hashlib,os,datetime,time
smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform')
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1')
private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment')
report=sdar/'reports/inspection-area-v1'
paths={'smpp-compose':pathlib.Path('/home/sz/.smpp-debug/refresh-cfda8c7f-20261013-2i1s3dqr/after.compose.json'),'sdar-compose':pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/compose.json'),'sdar-environment':pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/environment.json')}
sha=lambda b:hashlib.sha256(b).hexdigest()
for p in [smpp/'reports/inspection-area-v1/raw/smpp-inspection-gate-11.json',report/'raw/sdar-inspection-gate-10.json']:assert json.loads(p.read_text())['status']=='PASS','FULL_GATE_REQUIRED'
prepared=json.loads((report/'DEPLOYMENT_PREPARED.json').read_text());before=json.loads((report/'DEPLOYMENT_BEFORE.json').read_text())
for name,p in paths.items():
 assert sha(p.read_bytes())==next(e['sha256'] for e in before['files'] if e['name']==name),'LIVE_CONFIG_DRIFT:'+name
 assert sha((private/(name+'.proposed.json')).read_bytes())==prepared['proposedSha256'][name],'PROPOSAL_CHANGED:'+name

def docker_json(container,script=None,args=None):
 command=['docker','exec']
 if script is not None:command+=['-i',container,'node','--input-type=module','-']
 else:command+=[container,*args]
 return json.loads(subprocess.check_output(command,input=script))
core=docker_json('gowm-analysis-dev-f3dc6f4b8e-smpp-runtime-1',(private/'smpp-idle-core.mjs').read_bytes())
adapter=docker_json('gowm-analysis-dev-f3dc6f4b8e-smpp-adapter-1',b'''import {loadUgvProviderConfig} from './dist/apps/ugv-provider-adapter/src/config.js';import {PostgresProviderStore} from './dist/packages/provider-adapter-kit/src/index.js';const c=loadUgvProviderConfig();const s=new PostgresProviderStore(c.UGV_ADAPTER_DATABASE_URL,1,'ugv',c.gowmStorage);try{const a=await s.listActiveExecutions();if(a.length)throw Error('SMPP_ACTIVE_EXECUTION');console.log(JSON.stringify({active:a.length,status:'idle'}));}finally{await s.close();}''')
runtime=docker_json('sdar-sz-gowm-runtime-1',args=['node','deploy/development/upgrade-preflight.mjs'])
assert core['status']==adapter['status']==runtime['status']=='idle','IDLE_REQUIRED'
(report/'IDLE_BEFORE_UPDATE.json').write_text(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'smppCore':core,'smppAdapter':adapter,'sdar':runtime},indent=2)+'\n')

def atomic(path,data):
 temp=path.with_name(path.name+'.inspection-update');assert not temp.exists();temp.write_bytes(data);temp.chmod(0o600);os.replace(temp,path)
def up(name,services):
 subprocess.run(['docker','compose','-f',str(paths[name]),'up','-d','--no-deps','--no-build',*services],check=True)
def healthy(names):
 end=time.monotonic()+90
 while time.monotonic()<end:
  rows=json.loads(subprocess.check_output(['docker','inspect',*names]))
  if all(r['State']['Running'] and r['State'].get('Health',{}).get('Status','healthy')=='healthy' for r in rows):return rows
  time.sleep(1)
 raise RuntimeError('UPDATED_SERVICE_HEALTH_TIMEOUT')
result={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'UPDATING','physicalExecution':'NOT_RUN','changedPaths':prepared['changedPaths']}
try:
 for name,p in paths.items():atomic(p,(private/(name+'.proposed.json')).read_bytes())
 up('smpp-compose',['adapter','runtime'])
 healthy(['gowm-analysis-dev-f3dc6f4b8e-smpp-adapter-1','gowm-analysis-dev-f3dc6f4b8e-smpp-runtime-1'])
 up('sdar-compose',['control-api','control-worker','runtime'])
 rows=healthy(['gowm-analysis-dev-f3dc6f4b8e-smpp-adapter-1','gowm-analysis-dev-f3dc6f4b8e-smpp-runtime-1','sdar-sz-gowm-control-api-1','sdar-sz-gowm-control-worker-1','sdar-sz-gowm-runtime-1'])
 result['status']='SERVICES_UPDATED_PENDING_NATIVE_BOOTSTRAP';result['containers']=[{'name':r['Name'].lstrip('/'),'image':r['Config']['Image'],'imageId':r['Image'],'health':r['State'].get('Health',{}).get('Status','running')} for r in rows]
except Exception:
 result['status']='FAILED_RESTORING_PREVIOUS_SERVICES'
 for name,p in paths.items():atomic(p,(private/(name+'.before.json')).read_bytes())
 up('smpp-compose',['adapter','runtime']);up('sdar-compose',['control-api','control-worker','runtime']);result['status']='FAILED_ROLLED_BACK';raise
finally:
 result['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(report/'DEPLOYMENT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
