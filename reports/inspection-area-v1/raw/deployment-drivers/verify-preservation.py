import pathlib,json,subprocess,hashlib,datetime
root=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1/reports/inspection-area-v1')
sha=lambda b:hashlib.sha256(b).hexdigest()
before=json.loads((root/'DEPLOYMENT_ASSETS_BEFORE.json').read_text());old={r['name']:r for r in before['containers']};rows=json.loads(subprocess.check_output(['docker','inspect',*old]));envChanges={}
for row in rows:
 name=row['Name'].lstrip('/');prior=old[name];mounts=[{'type':m['Type'],'source':m['Source'],'destination':m['Destination'],'rw':m['RW']} for m in row['Mounts']]
 assert sorted(mounts,key=lambda m:m['destination'])==sorted(prior['mounts'],key=lambda m:m['destination']),'MOUNT_CHANGED:'+name
 assert sorted(row['NetworkSettings']['Networks'])==prior['networks'],'NETWORK_CHANGED:'+name
 assert row['HostConfig']['PortBindings']==prior['portBindings'],'PORT_CHANGED:'+name
 env=dict(e.split('=',1) for e in row['Config'].get('Env',[]) if '=' in e);hashes={k:sha(v.encode()) for k,v in env.items()};changed=[k for k in sorted(hashes.keys()|prior['environmentSha256'].keys()) if hashes.get(k)!=prior['environmentSha256'].get(k)]
 assert set(changed)<={'UGV_INSPECTION_ENABLED','HOSTNAME','NODE_VERSION','YARN_VERSION'},'UNEXPECTED_ENVIRONMENT_CHANGE:'+name+':'+','.join(changed)
 envChanges[name]=changed
cfg=json.loads((root/'DEPLOYMENT_BEFORE.json').read_text());private=pathlib.Path(cfg['privateBackupDirectory']);prepared=json.loads((root/'DEPLOYMENT_PREPARED.json').read_text())
for e in cfg['files']:
 if e['name'].startswith('smpp-config/'):
  p=pathlib.Path('/home/sz/.smpp-debug/refresh-cfda8c7f-20261013-2i1s3dqr/smpp/deploy/development/server/config')/e['name'].split('/',1)[1]
  assert sha(p.read_bytes())==e['sha256'],'CONFIG_OR_KEY_CHANGED:'+e['name'];assert oct(p.stat().st_mode&0o777)==e['mode'],'PRIVATE_FILE_MODE_CHANGED:'+e['name']
 else:assert sha(pathlib.Path(e['path']).read_bytes())==prepared['proposedSha256'][e['name']],'UNREVIEWED_CONFIG_CHANGE:'+e['name']
oldEnv=json.loads((private/'sdar-environment.before.json').read_text());newEnv=json.loads(pathlib.Path(next(e['path'] for e in cfg['files'] if e['name']=='sdar-environment')).read_text());assert {k for k in oldEnv.keys()|newEnv.keys() if oldEnv.get(k)!=newEnv.get(k)}=={'SDAR_UGV_CATALOG_PROFILE'}
up=json.loads((root/'UPSTREAM_BEFORE.json').read_text());current=json.loads(subprocess.check_output(['docker','inspect',*[r['name'] for r in up['containers']]]));currentBy={r['Name'].lstrip('/'):r for r in current}
for prior in up['containers']:
 row=currentBy[prior['name']];assert row['Id']==prior['id'] and row['Image']==prior['imageId'] and row['State']['StartedAt']==prior['startedAt'] and row['State']['Running'],'UPSTREAM_RESTARTED_OR_CHANGED:'+prior['name']
 mounts=[{'type':m['Type'],'source':m['Source'],'destination':m['Destination'],'rw':m['RW']} for m in row['Mounts']];assert sorted(mounts,key=lambda m:(m['destination'],m['type'],m['source'],m['rw']))==sorted(prior['mounts'],key=lambda m:(m['destination'],m['type'],m['source'],m['rw'])),'UPSTREAM_MOUNT_CHANGED:'+prior['name']
for name,row in currentBy.items():
 if name.startswith('sdar-site-pms-'):assert row['State'].get('Health',{}).get('Status','healthy')=='healthy','PMS_NOT_HEALTHY:'+name
b=json.loads((root/'GOVERNANCE_BEFORE.json').read_text());a=json.loads((root/'GOVERNANCE_AFTER.json').read_text());assert b['identity']==a['identity'],'BINDING_IDENTITY_CHANGED'
result={'status':'PASS','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'serviceMountsPortsNetworksPreserved':len(rows),'unchangedUpstreamContainers':len(up['containers']),'signingKeyAndPmsConfigurationBytesPreserved':True,'bindingIdentityPreserved':True,'sdarEnvironmentChangedKeys':['SDAR_UGV_CATALOG_PROFILE'],'containerEnvironmentChangedKeys':envChanges,'liveDataVolumesPreserved':True,'pmsHealthy':True}
(root/'PRESERVATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
