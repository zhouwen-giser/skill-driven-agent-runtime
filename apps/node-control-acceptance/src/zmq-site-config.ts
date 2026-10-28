import { z } from 'zod';
export const ZmqSiteConfiguration = z
  .object({
    nodeControlBaseUrl: z.url(),
    nodeControlBearerToken: z.string().min(16),
    runtimeManagementBaseUrl: z.url(),
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    catalogProfile: z.enum(['zmq_v1_1_0_readonly_13', 'zmq_v1_2_0_site_control_13']),
    providerId: z.string().min(1),
    resourceId: z.string().min(1),
    localServerId: z.string().min(1),
    bindingId: z.string().min(1),
    endpointAllowlist: z.array(z.url()).min(1).max(32),
    packageWorkspaceRoot: z.string().min(1),
    source: z.discriminatedUnion('originType', [
      z.object({ originType: z.literal('direct'), endpoint: z.url() }).strict(),
      z
        .object({
          originType: z.literal('smpp_registry'),
          smppSourceId: z.string().min(1),
          externalServerId: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();
