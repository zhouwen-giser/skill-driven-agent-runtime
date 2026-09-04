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

const OptionalNonBlankStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const OptionalSecretSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).regex(/^\S+$/u, 'Model API key must not contain whitespace.').optional(),
);

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

const GovernedControlPermissionsSchema = z.preprocess(
  (value) =>
    typeof value === 'string' ? value.split(',').map((permission) => permission.trim()) : value,
  z
    .array(
      z.enum([
        'physical_control.confirm',
        'physical_control.revoke',
        'physical_control.emergency_stop',
        'weapon_control.confirm',
        'weapon_control.revoke',
      ]),
    )
    .min(1)
    .superRefine((permissions, context) => {
      if (new Set(permissions).size !== permissions.length)
        context.addIssue({
          code: 'custom',
          message: 'Governed control permissions must not contain duplicates.',
        });
    })
    .transform((permissions) => Object.freeze([...permissions])),
);

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SDAR_POSTGRES_URL: z
      .string()
      .min(1)
      .default('postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar'),
    SDAR_REDIS_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_REDIS_PORT: z.coerce.number().int().positive().default(56379),
    SDAR_A2A_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_A2A_PUBLIC_BASE_URL: z.url().optional(),
    SDAR_DEVELOPMENT_PUBLIC_ACCESS: z.enum(['open', 'off']).default('off'),
    SDAR_EVIDENCE_OBSERVATION_SCOPE: z
      .string()
      .transform((value, context) => {
        try {
          return z
            .object({ tenantId: z.string().min(1).max(256), projectId: z.string().min(1).max(256) })
            .strict()
            .parse(JSON.parse(value));
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'Evidence observation scope must contain tenantId and projectId.',
          });
          return z.NEVER;
        }
      })
      .optional(),
    SDAR_A2A_PORT: z.coerce.number().int().positive().default(9999),
    SDAR_A2A_WAIT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(30_000),
    SDAR_MANAGEMENT_HOST: z.string().min(1).default('127.0.0.1'),
    SDAR_MANAGEMENT_PORT: z.coerce.number().int().positive().default(9998),
    SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_NODE_CONTROL_BASE_URL: z.url().optional(),
    SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: z.string().min(32).regex(/^\S+$/u).optional(),
    SDAR_CONTROL_ENVIRONMENT: z.string().trim().min(1).max(128).default('development'),
    SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: z.enum(['safe', 'unsafe_test_open']).default('safe'),
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: z.string().min(1).default('127.0.0.1,localhost'),
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: z.string().min(1).default('127.0.0.1,localhost'),
    SDAR_MCP_LIVE_EXECUTION_MODE_HEADER: z.enum(['emit', 'omit']).default('emit'),
    SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: z
      .string()
      .min(32)
      .max(4_096)
      .regex(/^\S+$/u, 'Cognitive management bearer token must not contain whitespace.')
      .optional(),
    SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: z
      .string()
      .min(32)
      .regex(/^\S+$/u, 'Artifact management bearer token must not contain whitespace.')
      .optional(),
    SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: z.string().trim().min(1).optional(),
    SDAR_ARTIFACT_MANAGEMENT_TENANT_ID: z.string().trim().min(1).optional(),
    SDAR_ARTIFACT_MANAGEMENT_KIND: z.enum(['human', 'service']).default('human'),
    SDAR_ARTIFACT_MANAGEMENT_ROLES: ArtifactManagementRolesSchema.optional(),
    SDAR_GOVERNED_CONTROL_BEARER_TOKEN: z
      .string()
      .min(32)
      .max(4_096)
      .regex(/^\S+$/u, 'Governed control bearer token must not contain whitespace.')
      .optional(),
    SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: z
      .enum(['bearer', 'trusted_intranet'])
      .default('bearer'),
    SDAR_GOVERNED_CONTROL_ACTOR_ID: z.string().trim().min(1).optional(),
    SDAR_GOVERNED_CONTROL_PERMISSIONS: GovernedControlPermissionsSchema.optional(),
    SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: z.enum(['true', 'false']).default('false'),
    SDAR_MASTER_KEY_BASE64: z.string().min(1),
    BUSINESS_EVENTS_ENABLED: z.enum(['true', 'false']).default('false'),
    BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: z.enum(['true', 'false']).default('false'),
    BUSINESS_EVENTS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    BUSINESS_EVENTS_MAX_SUBSCRIPTIONS: z.coerce.number().int().min(1).max(10_000).default(256),
    SDAR_UGV_REAL_MODEL_ENABLED: z.enum(['YES', 'NO']).default('NO'),
    SDAR_UGV_MODEL_PROVIDER_ID: OptionalNonBlankStringSchema,
    SDAR_UGV_MODEL_BASE_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.url().optional(),
    ),
    SDAR_UGV_MODEL_NAME: OptionalNonBlankStringSchema,
    SDAR_UGV_MODEL_EMBEDDING_NAME: OptionalNonBlankStringSchema,
    SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID: OptionalNonBlankStringSchema,
    SDAR_UGV_MODEL_EMBEDDING_BASE_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.url().optional(),
    ),
    SDAR_UGV_MODEL_API_STYLE: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.enum(['openai_chat_completions', 'anthropic_messages']).optional(),
    ),
    SDAR_UGV_MODEL_API_KEY: OptionalSecretSchema,
    SDAR_UGV_MODEL_API_KEY_FILE: OptionalNonBlankStringSchema,
    SDAR_UGV_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
    UGV_TEST_TOLERANCE_M: z.coerce.number().positive().max(2).default(2),
    UGV_TEST_MINIMUM_DISPLACEMENT_M: z.coerce.number().positive().max(2).default(0.5),
    UGV_TEST_MAX_FINAL_STATE_AGE_MS: z.coerce.number().int().min(1).max(3_000).default(3_000),
    SDAR_TASK_UNDERSTANDING_PROFILE: z
      .enum([
        'off',
        'home_lab_read_only',
        'home_lab_governed_light_control',
        'managed_capability',
        'ugv-agent-profile',
      ])
      .default('off'),
  })
  .superRefine((environment, context) => {
    if (
      environment.SDAR_DEVELOPMENT_PUBLIC_ACCESS === 'open' &&
      (!['development', 'test'].includes(environment.NODE_ENV) ||
        !['development', 'test', 'integration'].includes(environment.SDAR_CONTROL_ENVIRONMENT))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_DEVELOPMENT_PUBLIC_ACCESS'],
        message: 'Open public access is restricted to explicit development environments.',
      });
    }
    if (environment.SDAR_A2A_PUBLIC_BASE_URL !== undefined) {
      const url = new URL(environment.SDAR_A2A_PUBLIC_BASE_URL);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        ['0.0.0.0', '[::]'].includes(url.hostname)
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_A2A_PUBLIC_BASE_URL'],
          message: 'A2A public base URL must be a credential-free reachable HTTP(S) origin.',
        });
    }
    if (
      environment.SDAR_MCP_LIVE_EXECUTION_MODE_HEADER === 'omit' &&
      (environment.NODE_ENV === 'production' ||
        environment.SDAR_CONTROL_ENVIRONMENT === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_MCP_LIVE_EXECUTION_MODE_HEADER'],
        message:
          'Omitting the live MCP execution-mode header requires an explicit non-production NODE_ENV and control environment.',
      });
    }
    if (environment.SDAR_UGV_REAL_MODEL_ENABLED === 'YES') {
      for (const [key, value] of [
        ['SDAR_UGV_MODEL_PROVIDER_ID', environment.SDAR_UGV_MODEL_PROVIDER_ID],
        ['SDAR_UGV_MODEL_BASE_URL', environment.SDAR_UGV_MODEL_BASE_URL],
        ['SDAR_UGV_MODEL_NAME', environment.SDAR_UGV_MODEL_NAME],
        ['SDAR_UGV_MODEL_API_STYLE', environment.SDAR_UGV_MODEL_API_STYLE],
      ] as const) {
        if (value === undefined)
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when real-model bootstrap is enabled.`,
          });
      }
      if (
        (environment.SDAR_UGV_MODEL_API_KEY === undefined) ===
        (environment.SDAR_UGV_MODEL_API_KEY_FILE === undefined)
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_UGV_MODEL_API_KEY'],
          message:
            'Exactly one of SDAR_UGV_MODEL_API_KEY or SDAR_UGV_MODEL_API_KEY_FILE is required.',
        });
      if (
        (environment.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID !== undefined ||
          environment.SDAR_UGV_MODEL_EMBEDDING_BASE_URL !== undefined) &&
        environment.SDAR_UGV_MODEL_EMBEDDING_NAME === undefined
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_UGV_MODEL_EMBEDDING_NAME'],
          message:
            'SDAR_UGV_MODEL_EMBEDDING_NAME is required when an embedding Provider ID is configured.',
        });
      if (
        environment.SDAR_UGV_MODEL_EMBEDDING_NAME !== undefined &&
        environment.SDAR_UGV_MODEL_API_STYLE !== 'openai_chat_completions'
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_UGV_MODEL_EMBEDDING_NAME'],
          message: 'Embedding bootstrap requires an OpenAI-compatible Provider.',
        });
      if (
        environment.SDAR_UGV_MODEL_EMBEDDING_NAME !== undefined &&
        environment.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID === environment.SDAR_UGV_MODEL_PROVIDER_ID
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID'],
          message: 'Embedding and structured-generation Provider IDs must be different.',
        });
    }
    for (const [key, value] of [
      ['SDAR_UGV_MODEL_BASE_URL', environment.SDAR_UGV_MODEL_BASE_URL],
      ['SDAR_UGV_MODEL_EMBEDDING_BASE_URL', environment.SDAR_UGV_MODEL_EMBEDDING_BASE_URL],
    ] as const) {
      if (value === undefined) continue;
      const endpoint = new URL(value);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username !== '' ||
        endpoint.password !== ''
      )
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Model base URL must be a credential-free HTTP(S) URL.',
        });
    }
    const artifactManagementConfigured =
      environment.SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID !== undefined ||
      environment.SDAR_ARTIFACT_MANAGEMENT_TENANT_ID !== undefined ||
      environment.SDAR_ARTIFACT_MANAGEMENT_ROLES !== undefined;
    const governedControlConfigured =
      environment.SDAR_GOVERNED_CONTROL_BEARER_TOKEN !== undefined ||
      environment.SDAR_GOVERNED_CONTROL_ACTOR_ID !== undefined ||
      environment.SDAR_GOVERNED_CONTROL_PERMISSIONS !== undefined;
    if (
      (environment.SDAR_NODE_CONTROL_BASE_URL === undefined) !==
      (environment.SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_NODE_CONTROL_BASE_URL'],
        message: 'Node Control Capability Evidence requires both base URL and service token.',
      });
    }
    if (environment.SDAR_NODE_CONTROL_BASE_URL !== undefined) {
      const endpoint = new URL(environment.SDAR_NODE_CONTROL_BASE_URL);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username !== '' ||
        endpoint.password !== ''
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_NODE_CONTROL_BASE_URL'],
          message: 'Node Control base URL must be a credential-free HTTP(S) URL.',
        });
      else if (
        environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY !== 'unsafe_test_open' &&
        endpoint.protocol !== 'https:' &&
        !isLoopbackHost(endpoint.hostname)
      )
        context.addIssue({
          code: 'custom',
          path: ['SDAR_NODE_CONTROL_BASE_URL'],
          message: 'Non-loopback Node Control endpoints must use HTTPS.',
        });
    }
    if (
      environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY === 'unsafe_test_open' &&
      (!['development', 'test'].includes(environment.NODE_ENV) ||
        !['development', 'test', 'integration'].includes(environment.SDAR_CONTROL_ENVIRONMENT))
    )
      context.addIssue({
        code: 'custom',
        path: ['SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY'],
        message: 'unsafe_test_open is forbidden outside an explicit non-production environment.',
      });
    if (
      (environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'home_lab_read_only' ||
        environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'home_lab_governed_light_control' ||
        environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'managed_capability' ||
        environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'ugv-agent-profile') &&
      environment.SDAR_NODE_CONTROL_BASE_URL === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SDAR_NODE_CONTROL_BASE_URL'],
        message:
          'The selected Task Understanding profile requires authenticated Node Control Capability and current Binding authority.',
      });
    }
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
    if (
      environment.SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE === 'bearer' &&
      environment.SDAR_GOVERNED_CONTROL_BEARER_TOKEN === undefined &&
      governedControlConfigured
    )
      context.addIssue({
        code: 'custom',
        path: ['SDAR_GOVERNED_CONTROL_BEARER_TOKEN'],
        message: 'Governed control identity configuration requires a bearer token.',
      });
    if (governedControlConfigured && environment.SDAR_GOVERNED_CONTROL_ACTOR_ID === undefined)
      context.addIssue({
        code: 'custom',
        path: ['SDAR_GOVERNED_CONTROL_ACTOR_ID'],
        message: 'Governed control bearer authentication requires a human actor ID.',
      });
    if (governedControlConfigured && environment.SDAR_GOVERNED_CONTROL_PERMISSIONS === undefined)
      context.addIssue({
        code: 'custom',
        path: ['SDAR_GOVERNED_CONTROL_PERMISSIONS'],
        message: 'Governed control bearer authentication requires explicit permissions.',
      });
    if (
      (environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'home_lab_governed_light_control' ||
        environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'ugv-agent-profile') &&
      ((environment.SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE === 'bearer' &&
        environment.SDAR_GOVERNED_CONTROL_BEARER_TOKEN === undefined) ||
        environment.SDAR_GOVERNED_CONTROL_ACTOR_ID === undefined ||
        !environment.SDAR_GOVERNED_CONTROL_PERMISSIONS?.includes('physical_control.confirm'))
    )
      context.addIssue({
        code: 'custom',
        path: ['SDAR_GOVERNED_CONTROL_BEARER_TOKEN'],
        message:
          'The selected physical-control profile requires an authenticated human physical_control.confirm identity.',
      });
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

/**
 * The observation path is a trusted-network development capability. Production
 * in either deployment dimension disables it; no authentication claim is implied.
 */
export function remoteTaskAdmissionObservationProfile(
  environment: Pick<ServerEnvironment, 'NODE_ENV' | 'SDAR_CONTROL_ENVIRONMENT'>,
): 'development' | 'off' {
  return environment.NODE_ENV === 'production' ||
    environment.SDAR_CONTROL_ENVIRONMENT === 'production'
    ? 'off'
    : 'development';
}

/**
 * Missing deployment markers intentionally resolve to the current development phase. Qualification
 * and production therefore require an explicit environment change instead of being inferred.
 */
export function isDevelopmentDeploymentEnvironment(
  environment: Readonly<Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'SDAR_CONTROL_ENVIRONMENT'>>>,
): boolean {
  const rawNodeEnvironment = environment.NODE_ENV?.trim();
  const rawControlEnvironment = environment.SDAR_CONTROL_ENVIRONMENT?.trim();
  const nodeEnvironment =
    rawNodeEnvironment === undefined || rawNodeEnvironment.length === 0
      ? 'development'
      : rawNodeEnvironment;
  const controlEnvironment =
    rawControlEnvironment === undefined || rawControlEnvironment.length === 0
      ? 'development'
      : rawControlEnvironment;
  return nodeEnvironment === 'development' && controlEnvironment === 'development';
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
