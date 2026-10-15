import pathlib,json,subprocess,hashlib,tarfile
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1')
report=repo/'reports/inspection-area-v1';package=json.loads(next(x for x in (report/'raw/sdar-inspection-package-09.log').read_text().splitlines() if x.startswith('{')));assert package['status']=='PACKAGE_VERIFIED';archive=pathlib.Path(package['archive']);root=archive.parent
def run(name,*cmd):subprocess.run(['node','scripts/inspection/run.mjs',name,*map(str,cmd)],cwd=repo,check=True)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==pathlib.Path(str(archive)+'.sha256').read_text().split()[0]
with tarfile.open(archive) as outer:
 manifest=json.load(outer.extractfile(root.name+'/sdar/source.manifest.json'))
 sourceData=outer.extractfile(root.name+'/sdar/source.tar.gz').read()
assert hashlib.sha256(sourceData).hexdigest()==manifest['archiveSha256']
source=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment/sdar-source-final-v7.tar.gz');source.write_bytes(sourceData)
target=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment/sdar-source-final-v7');target.mkdir(mode=0o700,exist_ok=True)
with tarfile.open(source) as t:t.extractall(target,filter='data')
for e in manifest['files']:assert hashlib.sha256((target/e['path']).read_bytes()).hexdigest()==e['sha256'],e['path']
lock=json.loads((repo/'reports/inspection-area-v1/RUNTIME_SOURCE_LOCK.json').read_text());matched=[];excluded=[];documentation=[];deltas=lock.get('postGateDocumentation',{}).get('files',[])
for e in lock['files']:
 p=target/e['path']
 if not p.is_file():excluded.append(e['path'])
 else:
  actualHash=hashlib.sha256(p.read_bytes()).hexdigest()
  if actualHash==e['sha256']:matched.append(e['path'])
  else:
   delta=next((x for x in deltas if x['path']==e['path']),None);assert delta and e['path']=='deploy/united/README.md' and delta['beforeSha256']==e['sha256'] and actualHash==delta['afterSha256'],e['path'];documentation.append(delta)
expectedExcluded={'deploy/ugv-smpp-integration/.env.example','deploy/ugv-smpp-integration/secrets/README.md','reports/ugv-agent-profile-simulation/contract-freeze.json','reports/v1.4.1-evidence/source-to-evidence-matrix.json','reports/v1.4.1-evidence/verification-proof-manifest.json','../smpp-telemetry-platform/deploy/ugv-debug/collector.template.yaml','../smpp-telemetry-platform/deploy/ugv-debug/compose.yaml','../smpp-telemetry-platform/config/projection-targets.example.json','../sdar-telemetry-platform/migrations/clickhouse/015_provider_closure_v2.sql','../sdar-mcp-provider-platform/compose.yaml','../sdar-mcp-provider-platform/compose.ugv-agent-profile-simulation.yaml'}
assert set(excluded)==expectedExcluded,excluded
assert not any('/src/' in p or p.startswith(('skills/','schemas/','contracts/','infra/')) for p in excluded),excluded
metadata=json.loads((target/'sdar-deployment-source.json').read_text());assert len(documentation)==1 and len(matched)==2060
assert metadata=={k:manifest[k] for k in ['sourceRevision','sourceHash']}
image='sdar-inspection:'+manifest['sourceRevision'][:12]+'-'+manifest['sourceHash'][:12]
parity={'status':'PASS','archive':str(archive),'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'sourceRevision':manifest['sourceRevision'],'sourceHash':manifest['sourceHash'],'sourceRoot':str(target),'packageFiles':len(manifest['files']),'gateRuntimeEntriesMatched':len(matched),'postGateDocumentation':documentation,'gateTestDataExcludedByDeploymentExport':excluded,'image':image}
(repo/'reports/inspection-area-v1/PACKAGE_SOURCE_PARITY.json').write_text(json.dumps(parity,indent=2)+'\n')
run('sdar-inspection-image-07','docker','build','--file',target/'deploy/development/Dockerfile','--build-arg','SDAR_SOURCE_REVISION='+manifest['sourceRevision'],'--tag',image,target)
actual=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0];assert actual['Config']['Labels']['org.opencontainers.image.revision']==manifest['sourceRevision'];parity['imageId']=actual['Id']
(repo/'reports/inspection-area-v1/IMAGES.json').write_text(json.dumps(parity,indent=2)+'\n');print(json.dumps(parity))
