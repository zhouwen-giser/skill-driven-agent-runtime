import pathlib,json,hashlib,shutil,tarfile,datetime,os
sdar=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');smpp=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');reports=sdar/'reports/inspection-area-v1';private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');delivery=pathlib.Path('/mnt/data/inspection-area-v1-20261014');delivery.mkdir(mode=0o755,exist_ok=True)
backup=pathlib.Path('/home/sz/.smpp-debug/inspection-area-v1-20261014/backups');backup.mkdir(parents=True,mode=0o700,exist_ok=True);backup.parent.chmod(0o700)
for p in private.glob('*.before.json'):
 q=backup/p.name
 if q.exists():assert q.read_bytes()==p.read_bytes()
 else:shutil.copy2(p,q)
 q.chmod(0o600)
result={'status':'PASS','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privateRollbackBackups':str(backup),'sourceRoots':{},'packages':[]}
for repo,key in [(smpp,'smpp'),(sdar,'sdar')]:
 p=repo/'reports/inspection-area-v1/IMAGES.json';d=json.loads(p.read_text());assert d['status']=='PASS';src=pathlib.Path(d['sourceRoot']);dest=delivery/'source'/(key+'-'+d['sourceRevision'][:12])
 if src!=dest:
  assert not dest.exists();dest.parent.mkdir(mode=0o755,exist_ok=True);shutil.copytree(src,dest)
  files=[x for x in src.rglob('*') if x.is_file()]
  for a in files:
   b=dest/a.relative_to(src);assert hashlib.sha256(a.read_bytes()).digest()==hashlib.sha256(b.read_bytes()).digest(),str(a.relative_to(src))
  d['builtFromSourceRoot']=str(src);d['sourceRoot']=str(dest);d['durableSourceFilesChecked']=len(files);p.write_text(json.dumps(d,indent=2)+'\n')
 result['sourceRoots'][key]=str(dest)
 archive=pathlib.Path(d['telemetryArchive'] if key=='smpp' else d['archive']);target=delivery/archive.name
 if not target.exists():shutil.copy2(archive,target)
 assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(archive.read_bytes()).digest()
 checksum=hashlib.sha256(target.read_bytes()).hexdigest();target.with_name(target.name+'.sha256').write_text(checksum+'  '+target.name+'\n');result['packages'].append({'component':key,'path':str(target),'sha256':checksum,'bytes':target.stat().st_size})
(reports/'DURABLE_DELIVERY.json').write_text(json.dumps(result,indent=2)+'\n');(delivery/'DELIVERY.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
