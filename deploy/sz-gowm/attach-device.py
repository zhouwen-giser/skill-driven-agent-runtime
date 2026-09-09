"""Attach this SDAR through GOWM's official binding API; --apply reloads idle SMPP only."""
import json
import pathlib
import subprocess
import sys

site = pathlib.Path(sys.argv[1])
apply = '--apply' in sys.argv[2:]
container = 'gowm-analysis-dev-d2bf0ea98e-world-api-1'
inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'smpp-gowm-runtime-1']))[0]
compose_path = pathlib.Path(inspect['Config']['Labels']['com.docker.compose.project.config_files'])
compose = json.loads(compose_path.read_text())
assert set(compose['services']) == {'runtime', 'adapter'}
config_dir = pathlib.Path(next(m['Source'] for m in inspect['Mounts'] if m['Destination'] == '/run/config'))
binding_path = config_dir / 'gowm-binding.json'
script = r"""
import pg from 'pg';
import {resolveBusinessDeviceContext} from './dist/packages/integrations/device-business-storage/src/context.js';
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try {
 await c.query('BEGIN');
 const active=(await c.query("SELECT count(*)::int n FROM ugv_smpp.provider_task WHERE terminal_at IS NULL")).rows[0].n;
 const executions=(await c.query('SELECT count(*)::int n FROM ugv_smpp.ugv_execution')).rows[0].n;
 if(active||executions)throw Error('SITE_BINDING_REQUIRES_IDLE_SMPP');
 const current=(await c.query("SELECT binding_id,sdar_service_key,sdar_mcp_server_id FROM gowm_device.device_service_binding WHERE device_id='ugv:ugv' AND valid_to IS NULL")).rows;
 if(current.length!==1)throw Error('SITE_BINDING_AMBIGUOUS');
 if(apply) {
  const r=await resolveBusinessDeviceContext(c,{scope:'default',deviceId:'ugv:ugv',smppServiceKey:'smpp.sz-gowm.ugv',providerId:'isr.vehicle.ugv.ugv',resourceId:'vehicle:ugv',sdarServiceKey:'sdar-sz-gowm',sdarMcpServerId:'smpp-sz-gowm'});
  console.log(JSON.stringify({status:'ATTACHED',bindingId:r.bindingId,previous:current[0].binding_id}));
 } else console.log(JSON.stringify({status:'PREFLIGHT_PASS',activeTasks:active,executions,current:current[0]}));
 await c.query('COMMIT');
} catch(e) {await c.query('ROLLBACK');throw e;} finally {await c.end();}
"""
def invoke(do_apply):
    r = subprocess.run(['docker', 'exec', '-i', '-w', '/app', container, 'node', '--input-type=module'], input='const apply='+json.dumps(do_apply)+';\n'+script, text=True, capture_output=True)
    if r.returncode:
        print(r.stderr, file=sys.stderr)
        raise RuntimeError('SITE_BINDING_FAILED')
    return json.loads(r.stdout)

preflight = invoke(False)
print(json.dumps(preflight), flush=True)
if apply:
    backup = site / 'smpp-binding-before'
    backup.mkdir(exist_ok=True, mode=0o700)
    for source, name in [(compose_path, 'compose.json'), (binding_path, 'gowm-binding.json')]:
        target = backup / name
        if not target.exists():
            target.write_bytes(source.read_bytes())
            target.chmod(0o600)
    command = ['docker', 'compose', '-f', str(compose_path)]
    subprocess.run(command + ['stop', 'runtime', 'adapter'], check=True)
    try:
        attached = invoke(True)
        for service in compose['services'].values():
            service['environment']['SMPP_GOWM_BINDING_ID'] = attached['bindingId']
        compose_path.write_text(json.dumps(compose))
        b = json.loads(binding_path.read_text())
        b['bindingId'] = attached['bindingId']
        binding_path.write_text(json.dumps(b, indent=2)+'\n')
        print(json.dumps(attached), flush=True)
        (site / 'device-binding.json').write_text(json.dumps(attached, indent=2)+'\n')
    finally:
        subprocess.run(command + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120'], check=True)
