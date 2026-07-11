import process from 'node:process';

import { z } from 'zod';

import { startServerRuntime } from './runtime.js';

const EnvironmentSchema = z.object({
  SDAR_POSTGRES_URL: z
    .string()
    .min(1)
    .default('postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar'),
  SDAR_REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  SDAR_REDIS_PORT: z.coerce.number().int().positive().default(56379),
  SDAR_A2A_HOST: z.string().min(1).default('127.0.0.1'),
  SDAR_A2A_PORT: z.coerce.number().int().positive().default(9999),
  SDAR_MANAGEMENT_HOST: z.string().min(1).default('127.0.0.1'),
  SDAR_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9998),
  SDAR_MCP_MASTER_KEY_BASE64: z.string().min(1),
});

const environment = EnvironmentSchema.parse(process.env);
const runtime = await startServerRuntime({
  postgresUrl: environment.SDAR_POSTGRES_URL,
  redis: { host: environment.SDAR_REDIS_HOST, port: environment.SDAR_REDIS_PORT },
  mcpMasterKeyBase64: environment.SDAR_MCP_MASTER_KEY_BASE64,
  applyMigrations: true,
  a2aHost: environment.SDAR_A2A_HOST,
  a2aPort: environment.SDAR_A2A_PORT,
  managementHost: environment.SDAR_MANAGEMENT_HOST,
  managementPort: environment.SDAR_MANAGEMENT_PORT,
});

process.stdout.write(
  `${JSON.stringify({ event: 'server.ready', a2aUrl: runtime.a2a.baseUrl, managementUrl: runtime.management.baseUrl })}\n`,
);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await runtime.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
