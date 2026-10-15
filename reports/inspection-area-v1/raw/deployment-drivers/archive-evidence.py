import pathlib,json,hashlib,tarfile,datetime,shutil,os
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');r=sdar/'reports/inspection-area-v1';delivery=pathlib.Path('/mnt/data/inspection-area-v1-20261014');assert json.loads((r/'FINAL_VALIDATION.json').read_text())['status']=='LOCAL_DEPLOYED_READONLY_ACCEPTED'
index=json.loads((r/'DEPLOYMENT_DRIVERS.json').read_text());assert index['status']=='ARCHIVED_ACTUAL_DRIVERS'
for entry in index['files']:assert hashlib.sha256((r/entry['path']).read_bytes()).hexdigest()==entry['sha256'],entry['path']
assert json.loads((r/'PUBLIC_SECRET_CHECK.json').read_text())['status']=='PASS'
files=[]
for key,repo in [('smpp',smpp),('sdar',sdar)]:
 for p in sorted((repo/'reports/inspection-area-v1').rglob('*')):
  if p.is_file() and p.name not in ['EVIDENCE_ARCHIVE.json','EVIDENCE_INDEX.json']:
   assert not p.name.endswith(('.key','.pem','.pfx','.p12'))
   rel=pathlib.Path(key)/p.relative_to(repo/'reports/inspection-area-v1');files.append((p,rel))
index={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'fixed source, tests, immutable command logs, deployment and readonly site acceptance; no private environment/configuration/key backups','files':[{'path':str(rel),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p,rel in files]};(r/'EVIDENCE_INDEX.json').write_text(json.dumps(index,indent=2)+'\n');archive=delivery/'inspection-area-v1-evidence.tar.gz';assert not archive.exists()
with tarfile.open(archive,'w:gz') as t:
 for p,rel in files:t.add(p,arcname='inspection-area-v1-evidence/'+str(rel),recursive=False)
 t.add(r/'EVIDENCE_INDEX.json',arcname='inspection-area-v1-evidence/EVIDENCE_INDEX.json')
record={'status':'PASS','path':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'files':len(files),'indexSha256':hashlib.sha256((r/'EVIDENCE_INDEX.json').read_bytes()).hexdigest()};archive.with_name(archive.name+'.sha256').write_text(record['sha256']+'  '+archive.name+'\n');(r/'EVIDENCE_ARCHIVE.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
