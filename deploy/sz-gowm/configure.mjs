import { URL } from 'node:url';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  initialize,
  readConfiguration,
  render,
  writeConfiguration,
} from '../development/config.mjs';
// Run on the deployment host. Never print or package the generated private file.
const [envPath, connectionsPath, network, publicHost, image] = process.argv.slice(2);
if (!envPath || !connectionsPath || !network || !publicHost || !image)
  throw new Error('SITE_CONFIGURATION_ARGUMENTS_REQUIRED');
initialize(envPath);
const c = readConfiguration(envPath, {}, {});
const managed = parseEnv(readFileSync(connectionsPath, 'utf8'));
const url = new URL(managed.SDAR_DATABASE_URL);
if (url.username !== 'ugv_sdar_app' || url.pathname !== '/gowm' || !url.password)
  throw new Error('SITE_MANAGED_DATABASE_IDENTITY_MISMATCH');
const control = new URL(url);
control.username = c.SDAR_CONTROL_POSTGRES_USER;
control.password = c.SDAR_CONTROL_POSTGRES_PASSWORD;
control.pathname = '/sdar_control';
Object.assign(c, {
  SDAR_DEPLOY_PROJECT: 'sdar-sz-gowm',
  SDAR_DEPLOY_PUBLIC_HOST: publicHost,
  SDAR_DEPLOY_IMAGE: image,
  SDAR_DEPLOY_EXTERNAL_NETWORK: network,
  SDAR_STORAGE_MODE: 'gowm-shared',
  GOWM_DATABASE_URL: url.href,
  SDAR_CONTROL_DATABASE_URL: control.href,
  SDAR_SERVICE_KEY: 'sdar-sz-gowm',
  SDAR_DEVICE_ID: 'ugv:ugv',
  SDAR_ALLOWED_DEVICE_IDS: '["ugv:ugv"]',
  SDAR_DATA_SCOPE_KEY: 'default',
  SDAR_INCLUDE_NON_DEVICE_TASKS: 'true',
});
writeConfiguration(envPath, c);
render(c, envPath);
process.stdout.write('SITE_CONFIGURATION_READY\n');
