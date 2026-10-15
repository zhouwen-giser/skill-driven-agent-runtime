import pathlib,json,hashlib,shutil,subprocess
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');r=repo/'reports/inspection-area-v1';private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');public=r/'raw/deployment-drivers';public.mkdir(exist_ok=True)
assert json.loads((r/'FINAL_VALIDATION.json').read_text())['status']=='LOCAL_DEPLOYED_READONLY_ACCEPTED'
drivers=['stage-durable.py', 'prepare-update.py', 'apply-update.py', 'upgrade-sdar.py', 'rebind-current-catalog.mjs', 'verify-publication.mjs', 'verify-preservation.py', 'verify-live-source.py', 'smpp-idle-core.mjs', 'snapshot-tools.mjs', 'final-live.py', 'final-live-v2.py', 'copy-final-gate-18.py', 'finalize-outcomes.py', 'verify-public-secrets.py', 'archive-evidence.py', 'prepare-tck-tools.py', 'prepare-tck-tools-gate16.py', 'prepare-tck-tools-gate17.py', 'prepare-tck-tools-gate18.py', 'pin-owned-performance.py', 'build-sdar-v5.py', 'build-sdar-v6.py', 'owned-cas-test.mjs', 'stage-public-drivers.py','fix-deployment-readme.py','build-sdar-v7.py','finish-latest-package.py','write-delivery-readme.py','united-README.proposed.md','finish-native-site.py','finish-publication-site.py','inspect-runtime-catalog.mjs','finish-preservation-site.py']
for name in drivers:
 p=private/name
 if p.suffix=='.py':compile(p.read_text(),str(p),'exec')
 if p.suffix=='.mjs':subprocess.run(['node','--check',str(p)],check=True)
 shutil.copy2(p,public/name)
f=r/'DEPLOYMENT_DRIVERS.json';initial=r/'DEPLOYMENT_DRIVERS_INITIAL.json'
if not initial.exists():shutil.copy2(f,initial)
proof={'status':'ARCHIVED_ACTUAL_DRIVERS','scope':'Exact local operational source; command receipts prove each executed action separately. Historical preparation drivers are retained as history. No credentials included.','files':[{'path':str((public/n).relative_to(r)),'sha256':hashlib.sha256((public/n).read_bytes()).hexdigest()} for n in drivers]}
f.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'status':'PASS','drivers':len(drivers)}))
