import process from 'node:process';

import { z } from 'zod';

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
  SDAR_MASTER_KEY_BASE64: z.string().min(1),
});

export type ServerEnvironment = z.infer<typeof EnvironmentSchema>;

export function loadServerEnvironment(envFilePath = '.env'): ServerEnvironment {
  loadEnvironmentFileIfPresent(envFilePath);
  return EnvironmentSchema.parse(process.env);
}

function loadEnvironmentFileIfPresent(envFilePath: string): void {
  try {
    process.loadEnvFile(envFilePath);
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
