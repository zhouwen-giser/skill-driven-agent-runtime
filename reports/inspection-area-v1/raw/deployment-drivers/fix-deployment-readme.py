import pathlib,json,hashlib,subprocess
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');r=repo/'reports/inspection-area-v1';h=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert json.loads((r/'raw/sdar-inspection-gate-18.json').read_text())['status']=='PASS'
lock=json.loads((r/'RUNTIME_SOURCE_LOCK.json').read_text());changed=[]
for e in lock['files']:
 if sha(repo/e['path'])!=e['sha256']:changed.append(e['path'])
assert not changed,changed
p=repo/'deploy/united/README.md';old=sha(p);p.write_bytes((h/'united-README.proposed.md').read_bytes());new=sha(p)
subprocess.run(['git','add','--','deploy/united/README.md'],cwd=repo,check=True)
subprocess.run(['git','-c','user.name=zhouwen-giser','-c','user.email=zhouwen.tm@gmail.com','commit','-m','docs: describe governed area inspection deployment','--','deploy/united/README.md'],cwd=repo,check=True)
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();diff=subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r',revision],cwd=repo,text=True).splitlines();assert diff==['deploy/united/README.md'],diff
proof={'status':'PASS','scope':'One deployment README correction after full gate; no production, test, configuration, contract, dependency or migration changes.','qualifiedGate':'raw/sdar-inspection-gate-18.json','qualifiedCommit':'ebe1e7ebced304c35448553dba27840af1bb651b','sourceRevision':revision,'files':[{'path':'deploy/united/README.md','beforeSha256':old,'afterSha256':new,'classification':'deployment documentation only'}]}
(r/'DEPLOYMENT_README_DELTA.json').write_text(json.dumps(proof,indent=2)+'\n');lock['postGateDocumentation']=proof;(r/'RUNTIME_SOURCE_LOCK.json').write_text(json.dumps(lock,indent=2)+'\n')
for e in lock['files']:assert sha(repo/e['path'])==(new if e['path']=='deploy/united/README.md' else e['sha256']),e['path']
p=h/'upgrade-sdar.py';s=p.read_text();assert "image['sourceRevision']=='ebe1e7ebced304c35448553dba27840af1bb651b'" in s;s=s.replace("image['sourceRevision']=='ebe1e7ebced304c35448553dba27840af1bb651b'","image['sourceRevision']=='"+revision+"'");p.write_text(s);compile(s,str(p),'exec')
print(json.dumps(proof))
