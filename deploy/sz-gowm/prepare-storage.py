"""Run on sz-gowm after backup and pgvector image activation. No credential output."""
import json
import pathlib
import subprocess
import sys

site = pathlib.Path(sys.argv[1])
world_api = sys.argv[2]
config = {}
for line in (site / "config/.env").read_text().splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        config[key] = value[1:-1] if value.startswith("'") and value.endswith("'") else json.loads(value)
password = config["SDAR_CONTROL_POSTGRES_PASSWORD"]
script = "const input=" + json.dumps({"controlPassword": password}) + ";\n" + r"""
import pg from 'pg';
import { install } from './dist/scripts/business-storage/installer.js';
const c=new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try {
  await c.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
  await install(c,'sdar');
  await c.query('BEGIN');
  await c.query('GRANT USAGE ON SCHEMA ugv_sdar,gowm_task,gowm_business_v1,ugv_smpp TO ugv_sdar_app');
  await c.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_sdar TO ugv_sdar_app');
  await c.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_sdar,gowm_task TO ugv_sdar_app');
  await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA gowm_business_v1 TO ugv_sdar_app');
  await c.query('GRANT SELECT,INSERT ON gowm_task.target_geometry,gowm_task.target_binding TO ugv_sdar_app');
  await c.query('GRANT SELECT ON ugv_smpp.provider_task TO ugv_sdar_app');
  const old=await c.query("SELECT rolname FROM pg_roles WHERE rolname='sdar_control'");
  if (!old.rowCount) {
    await c.query("SELECT set_config('sdar.bootstrap_password',$1,true)",[input.controlPassword]);
    await c.query("DO $$ BEGIN EXECUTE format('CREATE ROLE sdar_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',current_setting('sdar.bootstrap_password')); END $$");
  }
  await c.query('COMMIT');
  const db=await c.query("SELECT datname FROM pg_database WHERE datname='sdar_control'");
  if(!db.rowCount) await c.query('CREATE DATABASE sdar_control OWNER sdar_control');
  const controlUrl=new URL(process.env.DATABASE_URL);controlUrl.username='sdar_control';controlUrl.password=input.controlPassword;controlUrl.pathname='/sdar_control';
  const check=new pg.Client({connectionString:controlUrl.href});await check.connect();await check.query('SELECT 1');await check.end();
  console.log(JSON.stringify({status:'PREPARED',schema:'ugv_sdar',controlDatabase:'sdar_control',businessPasswordPreserved:true}));
} catch(e) {
  await c.query('ROLLBACK');
  console.error(JSON.stringify({status:'FAILED',code:e.code??'STORAGE_PREPARATION_FAILED',message:e.message.replaceAll(input.controlPassword,'[redacted]')}));
  process.exitCode=1;
} finally {await c.end();}
"""
result = subprocess.run(
    ["docker", "exec", "-i", "-w", "/app", world_api, "node", "--input-type=module"],
    input=script,
    text=True,
    capture_output=True,
)
print(result.stdout, end="")
print(result.stderr, end="", file=sys.stderr)
sys.exit(result.returncode)
