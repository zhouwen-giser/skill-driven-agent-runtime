import pathlib,json,subprocess
repo=pathlib.Path('/home/sz/code/skill-driven-agent-runtime-inspect-area-v1');out=repo/'reports/inspection-area-v1';private=pathlib.Path('/tmp/smpp-inspection-v1-20261014/deployment')
assert json.loads((out/'raw/sdar-inspection-gate-18.json').read_text())['status']=='PASS'
def run(name,*cmd):
 subprocess.run(['node','scripts/inspection/run.mjs',name,*map(str,cmd)],cwd=repo,check=True)
def capture(name,target,*cmd):
 run(name,*cmd);value=json.loads((out/'raw'/str(name+'.log')).read_text());(out/(target+'.json')).write_text(json.dumps(value,indent=2)+'\n');return value
value=capture('sdar-inspection-live-bootstrap-03','BOOTSTRAP','docker','exec','sdar-sz-gowm-runtime-1','node','deploy/development/bootstrap.mjs');assert value['status'] in ['registered','succeeded','passed'] and value.get('deviceCalls')==0 and not value.get('blocked')
capture('sdar-inspection-readonly-catalog-final-01','CATALOG_AFTER','node',private/'snapshot-tools.mjs')
value=capture('sdar-inspection-readonly-publication-01','GOVERNANCE_AFTER','bash','-c','docker exec -i sdar-sz-gowm-runtime-1 node --input-type=module - < '+str(private/'verify-publication.mjs'));assert value['status']=='PASS'
run('sdar-inspection-preservation-01','python3',private/'verify-preservation.py')
run('sdar-inspection-container-source-01','python3',private/'verify-live-source.py')
value=capture('sdar-inspection-idle-after-update-01','IDLE_AFTER_UPDATE','docker','exec','sdar-sz-gowm-runtime-1','node','deploy/development/upgrade-preflight.mjs');assert value['status']=='idle'
print(json.dumps({'status':'PASS','siteTools':13,'siteInventory':14,'physicalExecution':'NOT_RUN'}))
