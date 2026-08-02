import process from 'node:process';
import { isIP } from 'node:net';

import { z } from 'zod';

const ManagementRoleSchema = z.enum([
  'viewer',
  'operator',
  'reviewer',
  'approver',
  'administrator',
  'security_operator',
]);

const ArtifactManagementRolesSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(',').map((role) => role.trim()) : value),
  z
    .array(ManagementRoleSchema)
    .min(1)
    .superRefine((roles, context) => {
      if (new Set(roles).size !== roles.length) {
        context.addIssue({
          code: 'custom',
          message: 'Artifact management roles must not contain duplicates.',
        });
      }
    })
    .transform((roles) => Object.freeze([...roles])),
);

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
    SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: z.string().min(32).optional(),
    SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: z
      .string()
      .min(32)
      .regex(/^\S+$/u, 'Artifact management bearer token must not contain whitespace.')
      .optional(),
    SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: z.string().trim().min(1).optional(),
    SDAR_ARTIFACT_MANAGEMENT_TENANT_ID: z.string().trim().min(1).optional(),
    SDAR_ARTIFACT_MANAGEMENT_KIND: z.enum(['human', 'service']).default('human'),
    SDAR_ARTIFACT_MANAGEMENT_ROLES: ArtifactManagementRolesSchema.optional(),
    SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: z.enum(['true', 'false']).default('false'),
    SDAR_MASTER_KEY_BASE64: z.string().min(1),
    BUSINESS_EVENTS_ENABLED: z.enum(['true', 'false']).default('false'),
    BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: z.enum(['true', 'false']).default('false'),
    BUSINESS_EVENTS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    BUSINESS_EVENTS_MAX_SUBSCRIPTIONS: z.coerce.number().int().min(1).max(10_000).default(256),
  })
  .superRefine((environment, context) => {
    const artifactManagementConfigured =
      environment.SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID !== undefined ||
      environment.SDAR_ARTIFACT_MANAGEMENT_TENANT_ID !== undefined ||
      environment.SDAR_ARTIFACT_MANAGEMENT_ROLES !== undefined;
    if (
      environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN === undefined &&
      artifactManagementConfigured
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN'],
        message: 'Artifact management identity configuration requires a bearer token.',
      });
    }
    if (
      environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN !== undefined &&
      environment.SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID'],
        message: 'Artifact management bearer authentication requires an actor ID.',
      });
    }
    if (
      environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN !== undefined &&
      environment.SDAR_ARTIFACT_MANAGEMENT_ROLES === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_ARTIFACT_MANAGEMENT_ROLES'],
        message: 'Artifact management bearer authentication requires at least one role.',
      });
    }
    if (
      environment.SDAR_RUNTIME_CONTROL_SERVICE_TOKEN !== undefined &&
      environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN'],
        message:
          'Runtime Control Plan Template governance requires the existing Artifact management identity.',
      });
    }
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
