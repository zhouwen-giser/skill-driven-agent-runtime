import pathlib,json,subprocess,hashlib,os,time,datetime
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');root=repo/'reports/inspection-area-v1';private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');path=pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/compose.json');sha=lambda b:hashlib.sha256(b).hexdigest()
assert json.loads((root/'raw/sdar-inspection-gate-18.json').read_text())['status']=='PASS','CURRENT_FULL_GATE_REQUIRED'
prior=json.loads((root/'DEPLOYMENT_PREPARED.json').read_text());assert sha(path.read_bytes())==prior['proposedSha256']['sdar-compose'],'LIVE_COMPOSE_DRIFT'
for name,p in [('smpp-compose',pathlib.Path('/home/sz/.smpp-debug/refresh-cfda8c7f-20261013-2i1s3dqr/after.compose.json')),('sdar-environment',pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/environment.json'))]:assert sha(p.read_bytes())==prior['proposedSha256'][name],'LIVE_CONFIG_DRIFT:'+name
image=json.loads((root/'IMAGES.json').read_text());assert image['status']=='PASS' and image['sourceRevision']=='c8a39c8616c5c9574afb104077fb59879c32ea0b'
actual=json.loads(subprocess.check_output(['docker','image','inspect',image['image']]))[0];assert actual['Config']['Labels']['org.opencontainers.image.revision']==image['sourceRevision']
idle=json.loads(subprocess.check_output(['docker','exec','sdar-sz-gowm-runtime-1','node','deploy/development/upgrade-preflight.mjs']));assert idle['status']=='idle','ACTIVE_TASKS_OR_OPERATIONS'
(root/'IDLE_BEFORE_SDAR_CAS_UPDATE.json').write_text(json.dumps(idle,indent=2)+'\n')
before=path.read_bytes();backup=pathlib.Path('/home/sz/.smpp-debug/inspection-area-v1-20261014/backups/sdar-compose.gate16.json');assert not backup.exists();backup.write_bytes(before);backup.chmod(0o600)
c=json.loads(before)
for name in ['runtime','control-api','control-worker']:c['services'][name]['image']=image['image']
c['services']['runtime']['build']['context']=image['sourceRoot'];c['services']['runtime']['build']['args']['SDAR_SOURCE_REVISION']=image['sourceRevision'];data=(json.dumps(c,indent=2)+'\n').encode()
proposal=private/'sdar-compose.cas.proposed.json';proposal.write_bytes(data);proposal.chmod(0o600);subprocess.run(['docker','compose','-f',str(proposal),'config','-q'],check=True)
def atomic(data):
 p=path.with_name(path.name+'.cas-upgrade');assert not p.exists();p.write_bytes(data);p.chmod(0o600);os.replace(p,path)
def up():subprocess.run(['docker','compose','-f',str(path),'up','-d','--no-deps','--no-build','control-api','control-worker','runtime'],check=True)
result={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'UPDATING_SDAR','physicalExecution':'NOT_RUN','sourceRevision':image['sourceRevision'],'image':image['image'],'privateRollback':str(backup)}
try:
 atomic(data);up();end=time.monotonic()+90
 names=[r['name'] for r in json.loads((root/'DEPLOYMENT_INITIAL.json').read_text())['containers']]
 while True:
  rows=json.loads(subprocess.check_output(['docker','inspect',*names]))
  if all(r['State']['Running'] and r['State'].get('Health',{}).get('Status','healthy')=='healthy' for r in rows):break
  if time.monotonic()>end:raise RuntimeError('SDAR_HEALTH_TIMEOUT')
  time.sleep(1)
 prepared=dict(prior);prepared['proposedSha256']=dict(prior['proposedSha256'],**{'sdar-compose':sha(data)});prepared['images']=dict(prior['images'],sdar=image['image']);prepared['currentSdarUpgradeSourceRevision']=image['sourceRevision'];prepared['liveFilesChanged']=True;(root/'DEPLOYMENT_PREPARED.json').write_text(json.dumps(prepared,indent=2)+'\n')
 result['status']='SERVICES_UPDATED_PENDING_NATIVE_BOOTSTRAP';result['containers']=[{'name':r['Name'].lstrip('/'),'image':r['Config']['Image'],'imageId':r['Image'],'health':r['State'].get('Health',{}).get('Status','running')} for r in rows]
 (root/'DEPLOYMENT.json').write_text(json.dumps(result,indent=2)+'\n')
except Exception:
 atomic(before);up();result['status']='FAILED_RESTORED_GATE16_SDAR';raise
finally:
 result['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(root/'SDAR_CAS_UPDATE.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
