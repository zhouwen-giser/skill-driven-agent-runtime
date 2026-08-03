import process from 'node:process';

import { z } from 'zod';

const EnvironmentSchema = z.object({
  SDAR_CONTROL_DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://sdar_control:sdar_control_local_only@127.0.0.1:55433/sdar_control'),
  SDAR_CONTROL_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  SDAR_CONTROL_WORKER_ONCE: z.enum(['true', 'false']).default('false'),
});

export type NodeControlWorkerEnvironment = z.infer<typeof EnvironmentSchema>;

export function loadNodeControlWorkerEnvironment(
  envFilePath = '.env',
): NodeControlWorkerEnvironment {
  try {
    process.loadEnvFile(envFilePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
  return EnvironmentSchema.parse(process.env);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
