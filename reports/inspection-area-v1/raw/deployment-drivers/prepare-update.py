import pathlib,json,hashlib,subprocess,os,sys,datetime
smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform')
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1')
private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment')
paths={'smpp-compose':pathlib.Path('/home/sz/.smpp-debug/refresh-cfda8c7f-20261013-2i1s3dqr/after.compose.json'),'sdar-compose':pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/compose.json'),'sdar-environment':pathlib.Path('/mnt/data/sdar-local-integrated-20261013/config/.state/environment.json')}
sha=lambda b:hashlib.sha256(b).hexdigest()
before=json.loads((sdar/'reports/inspection-area-v1/DEPLOYMENT_BEFORE.json').read_text())
for name,p in paths.items():assert sha(p.read_bytes())==next(e['sha256'] for e in before['files'] if e['name']==name),'LIVE_CONFIG_DRIFT:'+name
si=json.loads((smpp/'reports/inspection-area-v1/IMAGES.json').read_text());di=json.loads((sdar/'reports/inspection-area-v1/IMAGES.json').read_text());assert si['status']==di['status']=='PASS'
for component,image,revision in [('smpp-runtime',si['images']['runtime'],si['sourceRevision']),('smpp-adapter',si['images']['adapter'],si['sourceRevision']),('sdar',di['image'],di['sourceRevision'])]:
 info=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0];assert info['Config']['Labels']['org.opencontainers.image.revision']==revision,component
configs={name:json.loads(p.read_text()) for name,p in paths.items()}
for mode in ['adapter','runtime']:
 service=configs['smpp-compose']['services'][mode];service['image']=si['images'][mode];service['build']['context']=si['sourceRoot'];service['build']['args']['VCS_REF']=si['sourceRevision']
configs['smpp-compose']['services']['adapter']['environment']['UGV_INSPECTION_ENABLED']='true'
for service in ['runtime','control-api','control-worker']:configs['sdar-compose']['services'][service]['image']=di['image']
configs['sdar-compose']['services']['runtime']['build']['context']=di['sourceRoot']
configs['sdar-compose']['services']['runtime']['build']['args']['SDAR_SOURCE_REVISION']=di['sourceRevision']
configs['sdar-environment']['SDAR_UGV_CATALOG_PROFILE']='ugv-inspect-v1-13'
allowed={'smpp-compose':{'/services/adapter/image','/services/runtime/image','/services/adapter/build/context','/services/runtime/build/context','/services/adapter/build/args/VCS_REF','/services/runtime/build/args/VCS_REF','/services/adapter/environment/UGV_INSPECTION_ENABLED'},'sdar-compose':{'/services/runtime/image','/services/control-api/image','/services/control-worker/image','/services/runtime/build/context','/services/runtime/build/args/SDAR_SOURCE_REVISION'},'sdar-environment':{'/SDAR_UGV_CATALOG_PROFILE'}}
def diff(a,b,p=''):
 if isinstance(a,dict) and isinstance(b,dict):return sum((diff(a.get(k),b.get(k),p+'/'+k) for k in sorted(a.keys()|b.keys())),[])
 return [] if a==b else [p]
changes={}
for name,c in configs.items():
 changes[name]=diff(json.loads(paths[name].read_text()),c);assert set(changes[name])<=allowed[name],changes[name]
 p=private/(name+'.proposed.json');p.write_text(json.dumps(c,indent=2)+'\n');p.chmod(0o600)
for name in ['smpp-compose','sdar-compose']:subprocess.run(['docker','compose','-f',str(private/(name+'.proposed.json')),'config','-q'],check=True)
report={'status':'PREPARED','preparedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'changedPaths':changes,'proposedSha256':{n:sha((private/(n+'.proposed.json')).read_bytes()) for n in paths},'images':{'smpp':si['images'],'sdar':di['image']},'privateDirectory':str(private),'liveFilesChanged':False}
(sdar/'reports/inspection-area-v1/DEPLOYMENT_PREPARED.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
