import { URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';

export const root = resolve(import.meta.dirname, '../..');
export const defaults = Object.freeze({
  SDAR_DEPLOY_PROJECT: 'sdar-development',
  SDAR_DEPLOY_PUBLIC_HOST: 'localhost',
  SDAR_DEPLOY_BIND_HOST: '0.0.0.0',
  SDAR_DEPLOY_IMAGE: 'sdar-development:local',
  SDAR_DEPLOY_STATE_DIR: '.state',
  SDAR_DEPLOY_NODE_IMAGE:
    'node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3',
  SDAR_DEPLOY_POSTGRES_IMAGE: '',
  NODE_ENV: 'development',
  SDAR_CONTROL_ENVIRONMENT: 'development',
  SDAR_DEVELOPMENT_PUBLIC_ACCESS: 'open',
  SDAR_DEVELOPMENT_CONFIRMATION_POLICY: 'auto_non_weapon',
  SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: 'true',
  SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: 'trusted_intranet',
  SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:development-deployment-owner',
  SDAR_GOVERNED_CONTROL_PERMISSIONS:
    'physical_control.confirm,physical_control.revoke,physical_control.emergency_stop',
  SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'development-administrator',
  SDAR_ARTIFACT_MANAGEMENT_KIND: 'human',
  SDAR_ARTIFACT_MANAGEMENT_ROLES: 'administrator',
  SDAR_TASK_UNDERSTANDING_PROFILE: 'ugv-agent-profile',
  ALLOW_UGV_LIVE_SIDE_EFFECTS: 'YES',
  ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'YES',
  SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
  SDAR_A2A_HOST: '0.0.0.0',
  SDAR_A2A_PORT: '10999',
  SDAR_MANAGEMENT_HOST: '0.0.0.0',
  SDAR_MANAGEMENT_PORT: '10998',
  SDAR_CONTROL_API_HOST: '0.0.0.0',
  SDAR_CONTROL_API_PORT: '10091',
  SDAR_POSTGRES_DB: 'sdar',
  SDAR_POSTGRES_USER: 'sdar',
  SDAR_POSTGRES_PORT: '55462',
  SDAR_CONTROL_POSTGRES_DB: 'sdar_control',
  SDAR_CONTROL_POSTGRES_USER: 'sdar_control',
  SDAR_CONTROL_POSTGRES_PORT: '55463',
  SDAR_REDIS_PORT: '56391',
  SDAR_REDIS_DB: '0',
  SDAR_CONTROL_NODE_ID: 'development-sdar-node',
  SDAR_CONTROL_NODE_DISPLAY_NAME: 'Development SDAR',
  SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
  SDAR_CONTROL_WORKER_POLL_MS: '1000',
  SDAR_CONTROL_WORKER_ONCE: 'false',
  SDAR_UGV_REAL_MODEL_ENABLED: 'NO',
  BUSINESS_EVENTS_ENABLED: 'false',
  BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: 'false',
  SDAR_UGV_EXECUTION_MODE: 'live',
  SDAR_UGV_BOOTSTRAP_ENABLED: 'YES',
  SDAR_UGV_CATALOG_PROFILE: 'ugv-v1-11',
  SDAR_UGV_BINDING_ID: 'development-ugv-binding',
  SDAR_UGV_SERVER_ID: 'development-ugv',
  SDAR_UGV_RESOURCE_ID: 'vehicle:ugv1',
});
const secretNames = [
  'SDAR_POSTGRES_PASSWORD',
  'SDAR_CONTROL_POSTGRES_PASSWORD',
  'SDAR_REDIS_PASSWORD',
  'SDAR_CONTROL_API_TOKEN',
  'SDAR_CONTROL_VIEWER_API_TOKEN',
  'SDAR_CONTROL_OPERATOR_API_TOKEN',
  'SDAR_CONTROL_SECURITY_API_TOKEN',
  'SDAR_CONTROL_ORGANIZATION_API_TOKEN',
  'SDAR_CONTROL_RUNTIME_SERVICE_TOKEN',
  'SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN',
];

export function readConfiguration(envPath, overrides = {}, inherited = process.env) {
  const file = parseEnv(readFileSync(envPath, 'utf8'));
  const configuration = { ...defaults, ...file };
  for (const [key, value] of Object.entries(inherited)) {
    if (
      value !== undefined &&
      (/^(SDAR_|ALLOW_UGV_|UGV_|BUSINESS_EVENTS_|NODE_ENV$)/u.test(key) ||
        Object.hasOwn(configuration, key))
    )
      configuration[key] = value;
  }
  return { ...configuration, ...overrides };
}

export function writeConfiguration(envPath, configuration) {
  const content =
    Object.entries(configuration)
      .map(([key, value]) => {
        if (
          !/^[A-Z][A-Z0-9_]*$/u.test(key) ||
          typeof value !== 'string' ||
          value.includes("'") ||
          /[\r\n\0]/u.test(value)
        )
          throw new Error('DEVELOPMENT_DOTENV_VALUE_UNSUPPORTED');
        return `${key}='${value}'`;
      })
      .join('\n') + '\n';
  writeFileSync(envPath, content, { mode: 0o600 });
  chmodSync(envPath, 0o600);
}

export function initialize(envPath) {
  if (existsSync(envPath)) return { status: 'preserved', envPath };
  mkdirSync(dirname(envPath), { recursive: true, mode: 0o700 });
  const initial = { ...defaults };
  for (const key of secretNames) initial[key] = randomBytes(32).toString('hex');
  initial.SDAR_MASTER_KEY_BASE64 = randomBytes(32).toString('base64');
  // Values generated here are single-line and do not require dotenv escaping.
  const content =
    '# Private deployment settings. Full reference: repository .env.example\n' +
    Object.entries(initial)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') +
    '\n';
  writeFileSync(envPath, content, { flag: 'wx', mode: 0o600 });
  return { status: 'initialized', envPath, model: 'not_configured', provider: 'not_configured' };
}

export function validateConfiguration(c) {
  if (c.SDAR_STORAGE_MODE === 'gowm-shared') {
    for (const key of [
      'GOWM_DATABASE_URL',
      'SDAR_CONTROL_DATABASE_URL',
      'SDAR_DEPLOY_EXTERNAL_NETWORK',
    ])
      if (!c[key]) throw new Error(`DEVELOPMENT_SHARED_CONFIGURATION_MISSING:${key}`);
    for (const key of ['GOWM_DATABASE_URL', 'SDAR_CONTROL_DATABASE_URL']) {
      const url = new URL(c[key]);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.has('options'))
        throw new Error(`DEVELOPMENT_SHARED_DATABASE_INVALID:${key}`);
    }
    if (new URL(c.GOWM_DATABASE_URL).pathname === new URL(c.SDAR_CONTROL_DATABASE_URL).pathname)
      throw new Error('DEVELOPMENT_CONTROL_DATABASE_MUST_BE_SEPARATE');
  }
  const required = [...secretNames, 'SDAR_MASTER_KEY_BASE64'];
  const missing = required.filter((key) => !c[key] || c[key].startsWith('replace_'));
  if (missing.length) throw new Error(`DEVELOPMENT_CONFIGURATION_MISSING:${missing.join(',')}`);
  if (c.NODE_ENV !== 'development' || c.SDAR_CONTROL_ENVIRONMENT !== 'development')
    throw new Error('DEVELOPMENT_PACKAGE_ENVIRONMENT_REQUIRED');
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(c.SDAR_DEPLOY_PROJECT))
    throw new Error('DEVELOPMENT_PROJECT_INVALID');
  if (!/^[a-zA-Z0-9.-]+$/u.test(c.SDAR_DEPLOY_PUBLIC_HOST))
    throw new Error('DEVELOPMENT_PUBLIC_HOST_INVALID');
  for (const key of [
    'SDAR_POSTGRES_DB',
    'SDAR_POSTGRES_USER',
    'SDAR_CONTROL_POSTGRES_DB',
    'SDAR_CONTROL_POSTGRES_USER',
  ]) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(c[key]))
      throw new Error(`DEVELOPMENT_IDENTIFIER_INVALID:${key}`);
  }
  const ports = [
    'SDAR_MANAGEMENT_PORT',
    'SDAR_A2A_PORT',
    'SDAR_CONTROL_API_PORT',
    'SDAR_POSTGRES_PORT',
    'SDAR_CONTROL_POSTGRES_PORT',
    'SDAR_REDIS_PORT',
  ].map((key) => {
    const value = Number(c[key]);
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error(`DEVELOPMENT_PORT_INVALID:${key}`);
    return value;
  });
  if (new Set(ports).size !== ports.length) throw new Error('DEVELOPMENT_PORT_COLLISION');
  if (Buffer.from(c.SDAR_MASTER_KEY_BASE64, 'base64').length !== 32)
    throw new Error('DEVELOPMENT_MASTER_KEY_INVALID');
  for (const [key, choices] of Object.entries({
    SDAR_UGV_BOOTSTRAP_ENABLED: ['YES', 'NO'],
    SDAR_UGV_CATALOG_PROFILE: ['ugv-v1-10', 'ugv-v1-11'],
    SDAR_UGV_EXECUTION_MODE: ['live', 'simulation'],
    SDAR_DEVELOPMENT_CONFIRMATION_POLICY: ['manual', 'auto_non_weapon'],
    SDAR_DEVELOPMENT_PUBLIC_ACCESS: ['open', 'off'],
    ALLOW_UGV_LIVE_SIDE_EFFECTS: ['YES', 'NO'],
    ALLOW_UGV_SIMULATION_SIDE_EFFECTS: ['YES', 'NO'],
  })) {
    if (!choices.includes(c[key])) throw new Error(`DEVELOPMENT_ENUM_INVALID:${key}`);
  }
  if (
    c.SDAR_UGV_BOOTSTRAP_ENABLED === 'YES' &&
    c.SDAR_UGV_EXECUTION_MODE === 'simulation' &&
    !c.UGV_SIMULATION_RUN_ID
  )
    throw new Error('DEVELOPMENT_SIMULATION_ID_REQUIRED');
}

export function redactedConfiguration(c) {
  const publicKeys = new Set([
    'NODE_ENV',
    'SDAR_CONTROL_ENVIRONMENT',
    'SDAR_DEPLOY_PROJECT',
    'SDAR_DEPLOY_PUBLIC_HOST',
    'SDAR_DEPLOY_BIND_HOST',
    'SDAR_DEVELOPMENT_PUBLIC_ACCESS',
    'SDAR_DEVELOPMENT_CONFIRMATION_POLICY',
    'SDAR_TASK_UNDERSTANDING_PROFILE',
    'SDAR_MANAGEMENT_PORT',
    'SDAR_A2A_PORT',
    'SDAR_CONTROL_API_PORT',
    'SDAR_POSTGRES_PORT',
    'SDAR_CONTROL_POSTGRES_PORT',
    'SDAR_REDIS_PORT',
    'SDAR_REDIS_DB',
    'ALLOW_UGV_LIVE_SIDE_EFFECTS',
    'ALLOW_UGV_SIMULATION_SIDE_EFFECTS',
  ]);
  return Object.fromEntries(
    Object.entries(c).map(([key, value]) => [
      key,
      publicKeys.has(key) ? value : value ? '<configured>' : '<unset>',
    ]),
  );
}

export function serviceEnvironment(c) {
  const pub = (port) => `http://${c.SDAR_DEPLOY_PUBLIC_HOST}:${port}`;
  return {
    ...c,
    SDAR_POSTGRES_URL:
      c.SDAR_STORAGE_MODE === 'gowm-shared'
        ? c.GOWM_DATABASE_URL
        : `postgresql://${c.SDAR_POSTGRES_USER}:${encodeURIComponent(c.SDAR_POSTGRES_PASSWORD)}@postgres:5432/${c.SDAR_POSTGRES_DB}`,
    SDAR_CONTROL_DATABASE_URL:
      c.SDAR_STORAGE_MODE === 'gowm-shared'
        ? c.SDAR_CONTROL_DATABASE_URL
        : `postgresql://${c.SDAR_CONTROL_POSTGRES_USER}:${encodeURIComponent(c.SDAR_CONTROL_POSTGRES_PASSWORD)}@control-postgres:5432/${c.SDAR_CONTROL_POSTGRES_DB}`,
    SDAR_CONTROL_RUNTIME_DATABASE_URL:
      c.SDAR_STORAGE_MODE === 'gowm-shared'
        ? c.GOWM_DATABASE_URL
        : `postgresql://${c.SDAR_POSTGRES_USER}:${encodeURIComponent(c.SDAR_POSTGRES_PASSWORD)}@postgres:5432/${c.SDAR_POSTGRES_DB}`,
    SDAR_REDIS_HOST: 'redis',
    SDAR_REDIS_PORT: '6379',
    SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: c.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
    SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: c.SDAR_CONTROL_VIEWER_API_TOKEN,
    SDAR_NODE_CONTROL_BASE_URL: 'http://control-api:10091',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://runtime:10998',
    SDAR_CONTROL_PUBLIC_URL: c.SDAR_CONTROL_PUBLIC_URL || pub(c.SDAR_CONTROL_API_PORT),
    SDAR_CONTROL_NODE_EVENTS_URL:
      c.SDAR_CONTROL_NODE_EVENTS_URL || `${pub(c.SDAR_CONTROL_API_PORT)}/api/v1/events`,
    SDAR_CONTROL_A2A_AGENT_CARD_URL: `${c.SDAR_A2A_PUBLIC_BASE_URL || pub(c.SDAR_A2A_PORT)}/.well-known/agent-card.json`,
    SDAR_A2A_PUBLIC_BASE_URL: c.SDAR_A2A_PUBLIC_BASE_URL || pub(c.SDAR_A2A_PORT),
    SDAR_MANAGEMENT_PORT: '10998',
    SDAR_A2A_PORT: '10999',
    SDAR_CONTROL_API_PORT: '10091',
  };
}

export function render(c, envPath, revision = 'unknown') {
  validateConfiguration(c);
  const state = resolve(dirname(envPath), c.SDAR_DEPLOY_STATE_DIR);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  const write = (name, value) => {
    const path = resolve(state, name);
    writeFileSync(path, value, { mode: 0o600 });
    chmodSync(path, 0o600);
    return path;
  };
  const effective = serviceEnvironment(c);
  const previousFile = resolve(state, 'environment.json');
  if (existsSync(previousFile)) {
    const previous = JSON.parse(readFileSync(previousFile, 'utf8'));
    if (previous.SDAR_MASTER_KEY_BASE64 !== effective.SDAR_MASTER_KEY_BASE64)
      throw new Error('DEVELOPMENT_MASTER_KEY_ROTATION_REQUIRES_MIGRATION');
    for (const key of [
      'SDAR_STORAGE_MODE',
      'GOWM_DATABASE_URL',
      'SDAR_CONTROL_DATABASE_URL',
      'SDAR_POSTGRES_PASSWORD',
      'SDAR_CONTROL_POSTGRES_PASSWORD',
      'SDAR_POSTGRES_USER',
      'SDAR_CONTROL_POSTGRES_USER',
      'SDAR_POSTGRES_DB',
      'SDAR_CONTROL_POSTGRES_DB',
      'SDAR_REDIS_PASSWORD',
    ]) {
      if (previous[key] !== effective[key])
        throw new Error(`DEVELOPMENT_DATABASE_IDENTITY_CHANGE_REQUIRES_MIGRATION:${key}`);
    }
  }
  const mounts = [];
  if (c.SDAR_UGV_MODEL_API_KEY_FILE) {
    const keyPath = resolve(dirname(envPath), c.SDAR_UGV_MODEL_API_KEY_FILE);
    if (!existsSync(keyPath)) throw new Error('DEVELOPMENT_MODEL_KEY_FILE_MISSING');
    effective.SDAR_UGV_MODEL_API_KEY_FILE = '/run/sdar/model-api-key';
    mounts.push({
      type: 'bind',
      source: keyPath,
      target: '/run/sdar/model-api-key',
      read_only: true,
    });
  }
  const configFile = write('environment.json', JSON.stringify(effective));
  const configurationFingerprint = createHash('sha256')
    .update(JSON.stringify(effective))
    .digest('hex');
  const bind = (source, target) => ({ type: 'bind', source, target, read_only: true });
  const pgSecret = write('postgres-password', c.SDAR_POSTGRES_PASSWORD);
  const controlSecret = write('control-postgres-password', c.SDAR_CONTROL_POSTGRES_PASSWORD);
  const redisFile = write(
    'redis.conf',
    `bind 0.0.0.0\nport 6379\ndir /data\nappendonly yes\nappendfsync everysec\nrequirepass ${JSON.stringify(c.SDAR_REDIS_PASSWORD)}\n`,
  );
  // Host access is restricted by the parent directory (0700). Non-root image users
  // must be able to read the individual read-only bind mounts inside the container.
  for (const path of [pgSecret, controlSecret, redisFile]) chmodSync(path, 0o644);
  const port = (hostPort, containerPort) =>
    `${c.SDAR_DEPLOY_BIND_HOST}:${hostPort}:${containerPort}`;
  const pg = (name, db, user, passwordFile, hostPort) => ({
    ...(c.SDAR_DEPLOY_POSTGRES_IMAGE
      ? {}
      : { build: { context: root, dockerfile: 'deploy/development/Dockerfile.postgres' } }),
    image: c.SDAR_DEPLOY_POSTGRES_IMAGE || `${c.SDAR_DEPLOY_PROJECT}-postgres:17`,
    restart: 'unless-stopped',
    environment: {
      POSTGRES_DB: db,
      POSTGRES_USER: user,
      POSTGRES_PASSWORD_FILE: '/run/secrets/password',
    },
    volumes: [`${name}:/var/lib/postgresql/data`, bind(passwordFile, '/run/secrets/password')],
    ports: [port(hostPort, 5432)],
    healthcheck: {
      test: ['CMD', 'pg_isready', '-U', user, '-d', db],
      interval: '3s',
      timeout: '3s',
      retries: 40,
    },
  });
  const app = (role) => ({
    ...(role === 'runtime'
      ? {
          build: {
            context: root,
            dockerfile: 'deploy/development/Dockerfile',
            args: { NODE_IMAGE: c.SDAR_DEPLOY_NODE_IMAGE, SDAR_SOURCE_REVISION: revision },
          },
        }
      : {}),
    image: c.SDAR_DEPLOY_IMAGE,
    restart: 'unless-stopped',
    init: true,
    stop_grace_period: '20s',
    command: ['node', 'deploy/development/entrypoint.mjs', role],
    environment: { SDAR_DEPLOY_CONFIG_FINGERPRINT: configurationFingerprint },
    volumes: [
      bind(configFile, '/run/sdar/environment.json'),
      ...mounts,
      'governance-packages:/app/development-packages',
    ],
  });
  const health = (url) => ({
    test: [
      'CMD',
      'node',
      '-e',
      `fetch('${url}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
    interval: '5s',
    timeout: '5s',
    retries: 60,
    start_period: '30s',
  });
  const services = {
    postgres: pg(
      'runtime-data',
      c.SDAR_POSTGRES_DB,
      c.SDAR_POSTGRES_USER,
      pgSecret,
      c.SDAR_POSTGRES_PORT,
    ),
    'control-postgres': pg(
      'control-data',
      c.SDAR_CONTROL_POSTGRES_DB,
      c.SDAR_CONTROL_POSTGRES_USER,
      controlSecret,
      c.SDAR_CONTROL_POSTGRES_PORT,
    ),
    redis: {
      image: 'redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
      restart: 'unless-stopped',
      command: ['redis-server', '/usr/local/etc/redis/redis.conf'],
      environment: { SDAR_DEPLOY_CONFIG_FINGERPRINT: configurationFingerprint },
      volumes: ['redis-data:/data', bind(redisFile, '/usr/local/etc/redis/redis.conf')],
      ports: [port(c.SDAR_REDIS_PORT, 6379)],
    },
    'control-api': {
      ...app('api'),
      ports: [port(c.SDAR_CONTROL_API_PORT, 10091)],
      depends_on: {
        'control-postgres': { condition: 'service_healthy' },
        postgres: { condition: 'service_healthy' },
      },
      healthcheck: health('http://localhost:10091/health/ready'),
    },
    'control-worker': {
      ...app('worker'),
      depends_on: { 'control-api': { condition: 'service_healthy' } },
    },
    runtime: {
      ...app('runtime'),
      ports: [port(c.SDAR_MANAGEMENT_PORT, 10998), port(c.SDAR_A2A_PORT, 10999)],
      depends_on: {
        postgres: { condition: 'service_healthy' },
        redis: { condition: 'service_started' },
        'control-api': { condition: 'service_healthy' },
      },
      healthcheck: health('http://localhost:10998/api/v1/health'),
    },
  };
  if (c.SDAR_STORAGE_MODE === 'gowm-shared') {
    delete services.postgres;
    delete services['control-postgres'];
    delete services['control-api'].depends_on.postgres;
    delete services['control-api'].depends_on['control-postgres'];
    delete services.runtime.depends_on.postgres;
    for (const name of ['runtime', 'control-api', 'control-worker'])
      services[name].networks = ['default', 'gowm'];
  }
  const compose = {
    name: c.SDAR_DEPLOY_PROJECT,
    services,
    ...(c.SDAR_STORAGE_MODE === 'gowm-shared'
      ? {
          networks: { default: {}, gowm: { external: true, name: c.SDAR_DEPLOY_EXTERNAL_NETWORK } },
        }
      : {}),
    volumes: Object.fromEntries(
      (c.SDAR_STORAGE_MODE === 'gowm-shared'
        ? ['redis-data', 'governance-packages']
        : ['runtime-data', 'control-data', 'redis-data', 'governance-packages']
      ).map((k) => [k, {}]),
    ),
  };
  // Compose interpolates dollars even in JSON strings; these are literal resolved values.
  const composePath = write(
    'compose.json',
    JSON.stringify(compose, null, 2).replaceAll('$', () => '$$'),
  );
  return { state, composePath, services: Object.keys(services) };
}
