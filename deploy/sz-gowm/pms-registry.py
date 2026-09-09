#!/usr/bin/env python3
"""Prepare private configuration for the qualified upstream PMS images; no device calls."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess

p = argparse.ArgumentParser()
p.add_argument('site', type=Path)
p.add_argument('--api-image', required=True)
p.add_argument('--worker-image', required=True)
p.add_argument('--postgres-image', required=True)
a = p.parse_args()
site = a.site.resolve()
site.mkdir(parents=True, exist_ok=True, mode=0o700)
runtime = json.loads(subprocess.check_output(['docker', 'inspect', 'smpp-gowm-runtime-1']))[0]
env = dict(s.split('=', 1) for s in runtime['Config']['Env'])
for key in ['PROVIDER_ID', 'RUNTIME_DEPLOYMENT_ID', 'RUNTIME_INSTANCE_ID']:
    if not env.get(key):
        raise ValueError('PMS_RUNTIME_IDENTITY_MISSING:' + key)


def private(name, value):
    path = site / name
    if path.is_symlink():
        raise ValueError('PRIVATE_PATH_SYMLINK')
    if not path.exists():
        path.write_text(value)
        path.chmod(0o600)
    return path.read_text().strip()


password = private('postgres-password', secrets.token_hex(32))
token = private('registration-token', secrets.token_hex(32))
url = 'postgresql://pms_admin:' + password + '@pms-postgres:5432/pms'
if private('database-url', url) != url:
    raise ValueError('PMS_DATABASE_IDENTITY_DRIFT')
registration = {
    'subjectId': 'sdar-site-runtime-registration',
    'providerId': env['PROVIDER_ID'],
    'deploymentId': env['RUNTIME_DEPLOYMENT_ID'],
    'instanceId': env['RUNTIME_INSTANCE_ID'],
    'runtimeVersion': '2.0.0-rc.1',
    'protocolVersion': '2026-07-28',
    'scopes': ['runtime:register', 'runtime:heartbeat'],
    'tokenFile': '/run/pms-site/registration-token',
}
descriptor = {'runtimeConfig': [], 'runtimeRegistration': [registration]}
if json.loads(private('runtime.json', json.dumps(descriptor))) != descriptor:
    raise ValueError('PMS_REGISTRATION_IDENTITY_DRIFT')
private('provisioning.json', json.dumps({'clusterRef': 'site-pms', 'adminSecretRef': 'file/site-pms/admin', 'adminDatabaseUrl': url, 'runtimePassword': secrets.token_hex(32)}))
for name in ['runtime-releases', 'worker-state', 'runtime-secrets', 'runtime-cache', 'control-plane', 'pm2']:
    (site / name).mkdir(exist_ok=True, mode=0o700)
networks = {'default': {}}
for index, name in enumerate(runtime['NetworkSettings']['Networks']):
    networks['existing' + str(index)] = {'external': True, 'name': name}
shared = {'restart': 'unless-stopped', 'networks': list(networks), 'volumes': [str(site)+':/run/pms-site:ro']}
services = {
    'pms-postgres': {'image': a.postgres_image, 'restart': 'unless-stopped', 'environment': {'POSTGRES_USER': 'pms_admin', 'POSTGRES_DB': 'pms', 'POSTGRES_PASSWORD_FILE': '/run/pms-site/postgres-password'}, 'volumes': [str(site)+':/run/pms-site:ro', 'pms-data:/var/lib/postgresql/data'], 'healthcheck': {'test': ['CMD', 'pg_isready', '-U', 'pms_admin', '-d', 'pms'], 'interval': '2s', 'timeout': '3s', 'retries': 30}},
    'pms-api': {**shared, 'image': a.api_image, 'environment': {'PMS_API_HOST': '0.0.0.0', 'PMS_API_PORT': '8090', 'PMS_API_MANAGEMENT_AUTH_MODE': 'anonymous_intranet', 'ALLOW_INSECURE_INTERNAL_TRANSPORT': 'true', 'PMS_DATABASE_URL_FILE': '/run/pms-site/database-url', 'PMS_RUNTIME_CREDENTIAL_FILE': '/run/pms-site/runtime.json'}, 'ports': ['127.0.0.1:19090:8090'], 'depends_on': {'pms-postgres': {'condition': 'service_healthy'}}},
    'pms-worker': {**shared, 'image': a.worker_image, 'environment': {
        'PMS_DATABASE_URL_FILE': '/run/pms-site/database-url', 'ALLOW_INSECURE_INTERNAL_TRANSPORT': 'true', 'PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE': 'anonymous_intranet', 'PMS_WORKSPACE_ROOT': '/app', 'PMS_WORKER_ID': 'sdar-site-registry-worker', 'PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE': '/run/pms-site/provisioning.json',
        'PMS_RUNTIME_RELEASE_ROOT': '/app/runtime-releases', 'PMS_RUNTIME_SECRET_ROOT': '/var/lib/sdar/runtime-secrets', 'PMS_RUNTIME_CONFIG_CACHE_ROOT': '/var/lib/sdar/runtime-cache', 'PMS_RUNTIME_CONTROL_PLANE_URL': 'http://pms-api:8090', 'PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT': '/var/lib/sdar/control-plane', 'PMS_PM2_HOME': '/var/lib/sdar/pm2', 'PMS_RUNTIME_RECONCILE_INTERVAL_MS': '5000', 'PMS_RUNTIME_RECONCILE_TIMEOUT_MS': '30000', 'PMS_RUNTIME_HEALTH_TIMEOUT_MS': '3000',
    }, 'volumes': shared['volumes'] + [str(site / 'worker-state')+':/var/lib/sdar'], 'depends_on': {'pms-postgres': {'condition': 'service_healthy'}}},
}
for name in ['runtime-secrets', 'runtime-cache', 'control-plane', 'pm2']:
    (site/'worker-state'/name).mkdir(exist_ok=True, mode=0o700)
compose = {'name': 'sdar-site-pms', 'services': services, 'networks': networks, 'volumes': {'pms-data': {}}}
config = site/'compose.json'
if config.exists() and json.loads(config.read_text()) != compose:
    raise ValueError('PMS_COMPOSE_CHANGE_REQUIRES_REVIEW')
config.write_text(json.dumps(compose, indent=2)+'\n'); config.chmod(0o600)
identity = {'providerId': env['PROVIDER_ID'], 'deploymentId': env['RUNTIME_DEPLOYMENT_ID'], 'instanceId': env['RUNTIME_INSTANCE_ID'], 'environment': env.get('RUNTIME_ENV', 'development'), 'adapterEndpoint': env['ADAPTER_ENDPOINT'], 'controlEndpoint': 'http://smpp-gowm-runtime-1:8080', 'advertisedEndpoint': 'http://smpp-gowm-runtime-1:8080', 'resourceId': 'vehicle:ugv'}
if json.loads(private('identity.json', json.dumps(identity))) != identity:
    raise ValueError('PMS_RUNTIME_IDENTITY_DRIFT')
print(json.dumps({'status': 'PMS_CONFIGURATION_PREPARED', 'identity': identity, 'deviceCalls': 0}))
