import pathlib,json,shutil,hashlib
r=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');out=r/'reports/inspection-area-v1';receipt=json.loads((out/'raw/sdar-inspection-gate-18.json').read_text());assert receipt['status']=='PASS';lock=json.loads((out/'RUNTIME_SOURCE_LOCK.json').read_text());original=pathlib.Path(lock['gateInputManifest']);source=r/original.parent;dest=out/'final-gate-18';dest.mkdir(exist_ok=True)
for name in ['inputs.json','run.json','cleanup.json','git-snapshot.json']:shutil.copy2(source/name,dest/name)
shutil.copytree(source/'snapshot-reports/verification',dest/'verification',dirs_exist_ok=True)
summary=json.loads((dest/'verification/summary.json').read_text());run=json.loads((dest/'run.json').read_text());assert summary['status']=='passed' and len(summary['steps'])==30 and not summary['pendingSteps'];assert run['exitCode']==run['cleanupExitCode']==0 and run['inputUnchanged'] and run['baselineUnchanged']
if not (out/'FULL_GATE_GATE11.json').exists():shutil.copy2(out/'FULL_GATE.json',out/'FULL_GATE_GATE11.json')
files=[{'path':str(p.relative_to(out)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(dest.rglob('*')) if p.is_file()];(out/'FULL_GATE.json').write_text(json.dumps({'status':'PASS','gateReceipt':'raw/sdar-inspection-gate-18.json','runId':run['runId'],'steps':30,'exitCode':0,'cleanupExitCode':0,'runtimeInputSha256':run['inputSha256'],'baselineSha256':run['baselineSha256'],'files':files},indent=2)+'\n')
lock['originalGateInputManifest']=str(original);lock['gateInputManifest']=str((dest/'inputs.json').relative_to(r));(out/'RUNTIME_SOURCE_LOCK.json').write_text(json.dumps(lock,indent=2)+'\n')
tck=pathlib.Path('EP-01-protocol-domain-skeleton/a2a-tck-http-json-must-protocol-harness')
for name in ['compatibility.html','compatibility.json','junitreport.xml','tck_report.html']:shutil.copy2(source/'snapshot-reports'/tck/name,r/'reports'/tck/name)
shutil.copy2(source/'snapshot-reports/v1.4.1-evidence/phase-12-e2e.json',r/'reports/v1.4.1-evidence/phase-12-e2e.json')
shutil.copy2(source/'snapshot-reports/v1.4.1-evidence/phase-13-performance.json',r/'reports/v1.4.1-evidence/phase-13-performance.json')
print(json.dumps({'status':'PASS','stages':30,'metadataFiles':len(files),'runtimeInputSha256':run['inputSha256']}))
