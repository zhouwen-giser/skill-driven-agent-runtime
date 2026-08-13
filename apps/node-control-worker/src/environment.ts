import process from 'node:process';

import { z } from 'zod';

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    SDAR_CONTROL_DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://sdar_control:sdar_control_local_only@127.0.0.1:55433/sdar_control'),
    SDAR_CONTROL_ENVIRONMENT: z.string().trim().min(1).max(128).default('development'),
    SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: z.enum(['safe', 'unsafe_test_open']).default('safe'),
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: z.string().min(1).default('127.0.0.1,localhost'),
    SDAR_CONTROL_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    SDAR_CONTROL_WORKER_ONCE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((environment, context) => {
    if (
      environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY === 'unsafe_test_open' &&
      (!['development', 'test'].includes(environment.NODE_ENV ?? '') ||
        !['development', 'test', 'integration'].includes(environment.SDAR_CONTROL_ENVIRONMENT))
    )
      context.addIssue({
        code: 'custom',
        path: ['SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY'],
        message: 'unsafe_test_open is forbidden outside an explicit non-production environment.',
      });
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

export function parseNodeControlWorkerEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeControlWorkerEnvironment {
  return EnvironmentSchema.parse(environment);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
