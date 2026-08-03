import process from 'node:process';
import { isIP } from 'node:net';

import { z } from 'zod';

const EnvironmentSchema = z
  .object({
    SDAR_CONTROL_DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://sdar_control:sdar_control_local_only@127.0.0.1:55433/sdar_control'),
    SDAR_CONTROL_RUNTIME_DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://sdar:sdar_local_only@127.0.0.1:5432/sdar'),
    SDAR_CONTROL_API_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_CONTROL_API_PORT: z.coerce.number().int().positive().max(65_535).default(10_080),
    SDAR_CONTROL_API_TOKEN: z.string().min(32).regex(/^\S+$/u),
    SDAR_CONTROL_OPERATOR_API_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_CONTROL_VIEWER_API_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_CONTROL_SECURITY_API_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_CONTROL_ORGANIZATION_API_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_CONTROL_ORGANIZATION_TENANT_ID: z.string().trim().min(1).max(256).optional(),
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: z.string().min(32).regex(/^\S+$/u),
    SDAR_CONTROL_NODE_ID: z.string().trim().min(1).max(128),
    SDAR_CONTROL_NODE_TYPE: z.string().trim().min(1).max(128).default('sdar-runtime'),
    SDAR_CONTROL_NODE_DISPLAY_NAME: z.string().trim().min(1).max(256),
    SDAR_CONTROL_ENVIRONMENT: z.string().trim().min(1).max(128).default('development'),
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: z.url().default('http://127.0.0.1:9998'),
    SDAR_CONTROL_PUBLIC_URL: z.url().default('http://127.0.0.1:10080'),
    SDAR_CONTROL_NODE_EVENTS_URL: z.url().default('http://127.0.0.1:10080/api/v1/events'),
    SDAR_CONTROL_A2A_AGENT_CARD_URL: z
      .url()
      .default('http://127.0.0.1:9999/.well-known/agent-card.json'),
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: z.string().min(1).default('127.0.0.1,localhost'),
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: z.string().min(1).default('127.0.0.1,localhost'),
    SDAR_CONTROL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(1_200),
    SDAR_CONTROL_REQUEST_BODY_LIMIT_KB: z.coerce.number().int().min(1).max(1_024).default(64),
  })
  .superRefine((environment, context) => {
    const publicCredentials = [
      environment.SDAR_CONTROL_API_TOKEN,
      environment.SDAR_CONTROL_OPERATOR_API_TOKEN,
      environment.SDAR_CONTROL_VIEWER_API_TOKEN,
      environment.SDAR_CONTROL_SECURITY_API_TOKEN,
      environment.SDAR_CONTROL_ORGANIZATION_API_TOKEN,
    ].filter((value) => value !== undefined);
    if (new Set(publicCredentials).size !== publicCredentials.length)
      context.addIssue({
        code: 'custom',
        path: ['SDAR_CONTROL_API_TOKEN'],
        message: 'Every public API role must use a distinct service credential.',
      });
    for (const field of [
      'SDAR_CONTROL_RUNTIME_ENDPOINT_REF',
      'SDAR_CONTROL_PUBLIC_URL',
      'SDAR_CONTROL_NODE_EVENTS_URL',
      'SDAR_CONTROL_A2A_AGENT_CARD_URL',
    ] as const) {
      const endpoint = new URL(environment[field]);
      if (endpoint.protocol !== 'https:' && !isLoopback(endpoint.hostname))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Non-loopback control endpoints must use HTTPS.',
        });
    }
    if (
      environment.SDAR_CONTROL_ORGANIZATION_TENANT_ID !== undefined &&
      environment.SDAR_CONTROL_ORGANIZATION_API_TOKEN === undefined
    )
      context.addIssue({
        code: 'custom',
        path: ['SDAR_CONTROL_ORGANIZATION_TENANT_ID'],
        message: 'Organization tenant identity requires an organization service credential.',
      });
  });

type ParsedNodeControlApiEnvironment = z.infer<typeof EnvironmentSchema>;
export type NodeControlApiEnvironment = Omit<
  ParsedNodeControlApiEnvironment,
  | 'SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST'
  | 'SDAR_CONTROL_RUNTIME_DATABASE_URL'
  | 'SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST'
  | 'SDAR_CONTROL_RATE_LIMIT_PER_MINUTE'
  | 'SDAR_CONTROL_REQUEST_BODY_LIMIT_KB'
> &
  Readonly<{
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST?: string;
    SDAR_CONTROL_RUNTIME_DATABASE_URL?: string;
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST?: string;
    SDAR_CONTROL_RATE_LIMIT_PER_MINUTE?: number;
    SDAR_CONTROL_REQUEST_BODY_LIMIT_KB?: number;
  }>;

export function loadNodeControlApiEnvironment(envFilePath = '.env'): NodeControlApiEnvironment {
  try {
    process.loadEnvFile(envFilePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
  return parseNodeControlApiEnvironment(process.env);
}

export function parseNodeControlApiEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeControlApiEnvironment {
  return EnvironmentSchema.parse(environment);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.'))
  );
}
