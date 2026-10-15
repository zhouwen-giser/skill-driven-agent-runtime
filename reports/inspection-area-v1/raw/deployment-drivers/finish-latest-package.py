import pathlib,json,subprocess
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');r=repo/'reports/inspection-area-v1';h=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment');assert json.loads((r/'raw/sdar-inspection-gate-18.json').read_text())['status']=='PASS'
for name in ['IMAGES','PACKAGE_SOURCE_PARITY']:(r/(name+'_BEFORE_README_CLOSEOUT.json')).write_bytes((r/(name+'.json')).read_bytes())
subprocess.run(['python3',str(h/'fix-deployment-readme.py')],check=True)
subprocess.run(['node','scripts/inspection/run.mjs','sdar-inspection-readme-format-01','pnpm','exec','prettier','--check','deploy/united/README.md'],cwd=repo,check=True)
subprocess.run(['node','scripts/inspection/run.mjs','sdar-inspection-package-09','pnpm','package:joint','--','--upstream','/mnt/data/inspection-area-v1-20261014/smpp-gowm-gdps-gsap-wsgs-telemetry-fe559b1e4ef8bfd8.tar.gz','--output','artifacts/inspection-area-v1/united-final-v9'],cwd=repo,check=True)
subprocess.run(['python3',str(h/'build-sdar-v7.py')],cwd=repo,check=True)
print(json.dumps({'status':'PASS','scope':'Post-gate deployment documentation corrected and exact remaining runtime inputs matched; final archive verified and image built.'}))
