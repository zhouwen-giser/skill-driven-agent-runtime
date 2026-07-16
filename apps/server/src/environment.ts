import process from 'node:process';
import { isIP } from 'node:net';

import { z } from 'zod';

const EnvironmentSchema = z
  .object({
    SDAR_POSTGRES_URL: z
      .string()
      .min(1)
      .default('postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar'),
    SDAR_REDIS_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_REDIS_PORT: z.coerce.number().int().positive().default(56379),
    SDAR_A2A_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_A2A_PORT: z.coerce.number().int().positive().default(9999),
    SDAR_MANAGEMENT_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9998),
    SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: z.enum(['true', 'false']).default('false'),
    SDAR_MASTER_KEY_BASE64: z.string().min(1),
  })
  .superRefine((environment, context) => {
    const exposedHosts = [environment.SDAR_A2A_HOST, environment.SDAR_MANAGEMENT_HOST].filter(
      (host) => !isLoopbackHost(host),
    );
    if (
      exposedHosts.length > 0 &&
      environment.SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE !== 'true'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE'],
        message: `Unauthenticated A2A/management binding to non-loopback host(s) ${exposedHosts.join(', ')} requires explicit trusted-network acknowledgement.`,
      });
    }
  });

export type ServerEnvironment = z.infer<typeof EnvironmentSchema>;

export function loadServerEnvironment(envFilePath = '.env'): ServerEnvironment {
  loadEnvironmentFileIfPresent(envFilePath);
  return parseServerEnvironment(process.env);
}

export function parseServerEnvironment(environment: NodeJS.ProcessEnv): ServerEnvironment {
  return EnvironmentSchema.parse(environment);
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

function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, '$1');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.'))
  );
}
