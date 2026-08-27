import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import {
  NodeControlApplicationError,
  NodeControlFoundationError,
  NodeControlConfigurationError,
  NodeControlLlmGovernanceError,
  NodeControlMcpBindingError,
  NodeControlCapabilityError,
  NodeControlSmppRegistryError,
  type NodeControlA2aExposureService,
  type A2aAgentCardValidator,
  type RuntimeAgentCardDeployment,
  type NodeControlConfigurationService,
  type NodeControlFoundationService,
  type NodeControlEventService,
  type NodeControlLlmGovernanceService,
  type NodeControlMcpProviderBindingService,
  type NodeControlCapabilityService,
  type NodeControlSmppRegistryService,
  type NodeControlRuntimeGovernanceService,
  type NodeControlEvidenceExportService,
  type NodeControlEvidenceOperationsService,
  type NodeControlTaskControlService,
  type EvidenceOperationsPrincipal,
  NodeControlTaskControlError,
  NodeControlRuntimeGovernanceError,
} from '../../../packages/node-control-application/src/index.js';
import type { TaskCapabilityBinding } from '../../../packages/domain/src/index.js';
import {
  createManagementOperation,
  createA2aExposureVersion,
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
  NodeControlDomainError,
  nodeCapabilityEtag,
  a2aExposureEtag,
  smppSourceEtag,
  transitionManagementOperation,
  type RuntimeAgentCardCandidate,
  type ManagedEvidenceExportConfiguration,
} from '../../../packages/node-control-domain/src/index.js';
import type {
  RuntimeCapabilityReadinessInput,
  RuntimeCapabilityReadinessService,
} from '../../../packages/runtime-control-application/src/index.js';
import { RevisionHintBroker } from './revision-hint-broker.js';
import type { NodeControlCapabilityReadinessCoordinator } from './capability-readiness-coordinator.js';
import { assertOutboundEndpoint } from './outbound-endpoint-policy.js';

export interface NodeControlHttpConfiguration {
  readonly trustedIntranetPublicAccess?: boolean;
  readonly bearerToken: string;
  readonly operatorBearerToken?: string;
  readonly viewerBearerToken?: string;
  readonly securityBearerToken?: string;
  readonly organizationBearerToken?: string;
  readonly organizationTenantId?: string;
  readonly rateLimitPerMinute?: number;
  readonly requestBodyLimitKb?: number;
  readonly providerEndpointAllowlist?: readonly string[];
  readonly privateHttpEndpointAllowlist?: readonly string[];
  readonly unsafeTestOpenOutbound?: boolean;
  readonly runtimeServiceToken: string;
  readonly nodeControlApiUrl: string;
  readonly nodeEventsUrl: string;
  readonly a2aAgentCardUrl: string;
  readonly llmGovernance?: NodeControlLlmGovernanceService;
  readonly smppRegistry?: NodeControlSmppRegistryService;
  readonly mcpBindings?: NodeControlMcpProviderBindingService;
  readonly capabilities?: NodeControlCapabilityService;
  readonly capabilityReadiness?: NodeControlCapabilityReadinessCoordinator;
  readonly runtimeCapabilityReadiness?: RuntimeCapabilityReadinessService;
  readonly a2aExposure?: NodeControlA2aExposureService;
  readonly runtimeAgentCards?: RuntimeAgentCardDeployment;
  readonly agentCardValidator?: A2aAgentCardValidator;
  readonly taskCapabilities?: Readonly<{
    findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  }>;
  readonly taskSummaries?: Readonly<{
    list(
      filter: Readonly<{ phase?: string; goalId?: string; limit: number }>,
    ): Promise<readonly NodeControlTaskSummary[]>;
    get(taskId: string): Promise<NodeControlTaskSummary | undefined>;
    getWithRevision(
      taskId: string,
    ): Promise<Readonly<{ summary: NodeControlTaskSummary; revision: number }> | undefined>;
  }>;
  readonly taskControl?: NodeControlTaskControlService;
  readonly runtimeGovernance?: NodeControlRuntimeGovernanceService;
  readonly evidenceExport?: NodeControlEvidenceExportService;
  readonly evidenceOperations?: NodeControlEvidenceOperationsService;
  readonly nodeEvents?: NodeControlEventService;
}

interface NodeControlTaskSummary {
  readonly taskId: string;
  readonly goalId?: string;
  readonly planId?: string;
  readonly contextId?: string;
  readonly phase: string;
  readonly selectedSkillId?: string;
  readonly capabilityBindingId?: string;
  readonly createdAt?: string;
  readonly updatedAt: string;
  readonly controlledActions: Readonly<Record<string, boolean>>;
}

export function createNodeControlHttpApp(
  service: NodeControlFoundationService,
  configurations: NodeControlConfigurationService,
  configuration: NodeControlHttpConfiguration,
): Express {
  const app = express();
  const hints = new RevisionHintBroker();
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: `${String(configuration.requestBodyLimitKb ?? 64)}kb`,
      strict: true,
    }),
  );

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'live', observedAt: new Date().toISOString() });
  });

  app.get('/health/ready', async (_request, response, next) => {
    try {
      const readiness = await service.getReadiness();
      response.status(readiness.status === 'ready' ? 200 : 503).json(readiness);
    } catch (error) {
      next(error);
    }
  });

  app.get('/.well-known/sdar-node', async (_request, response, next) => {
    try {
      const profile = await service.getNodeProfile();
      response.status(200).json({
        schemaVersion: '1.0',
        nodeId: profile.nodeId,
        nodeType: profile.nodeType,
        displayName: profile.displayName,
        environment: profile.environment,
        nodeControlApi: configuration.nodeControlApiUrl,
        nodeEvents: configuration.nodeEventsUrl,
        a2aAgentCard: configuration.a2aAgentCardUrl,
        contractVersions: {
          nodeControlApi: '1.0.0',
          runtimeControl: '1.0.0',
          nodeEvents: '1.0.0',
          evidenceExport: 'sdar.evidence/v1',
        },
        features: [
          'node-profile',
          'health',
          'capability-catalog',
          'capability-readiness',
          'a2a-exposure',
          'configuration-summary',
          'management-operation',
          'evidence-operations',
          'node-events',
        ],
      });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v1', publicApiAccessControl(configuration));

  app.get('/api/v1/node', async (_request, response, next) => {
    try {
      const profile = await service.getNodeProfile();
      response.status(200).set('etag', nodeProfileEtag(profile)).json(profile);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/v1/node/draft', async (request, response, next) => {
    try {
      const input = NodeProfileDraftSchema.parse(request.body);
      const profile = await service.updateNodeProfileDraft(
        input,
        requiredHeader(request, 'if-match'),
        requiredHeader(request, 'idempotency-key'),
      );
      response.status(200).set('etag', nodeProfileEtag(profile)).json(profile);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/node/draft/validate', async (request, response, next) => {
    try {
      const profile = await service.validateNodeProfileDraft(
        requiredHeader(request, 'if-match'),
        requiredHeader(request, 'idempotency-key'),
        parseCommand(request.body),
      );
      response.status(200).set('etag', nodeProfileEtag(profile)).json(profile);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/node/draft/publish', async (request, response, next) => {
    try {
      response
        .status(202)
        .json(
          await service.publishNodeProfileDraft(
            requiredHeader(request, 'if-match'),
            requiredHeader(request, 'idempotency-key'),
            parseCommand(request.body),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/node/health', async (_request, response, next) => {
    try {
      response.status(200).json(await service.getNodeHealth());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/configuration-revisions', async (request, response, next) => {
    try {
      const items = await configurations.list({
        ...(typeof request.query['targetType'] === 'string'
          ? { targetType: request.query['targetType'] }
          : {}),
        ...(typeof request.query['targetId'] === 'string'
          ? { targetId: request.query['targetId'] }
          : {}),
        limit: parseLimit(request.query['pageSize']),
      });
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/configuration-revisions', async (request, response, next) => {
    try {
      const input = ConfigurationDraftSchema.parse(request.body);
      const revision = await configurations.createDraft(
        {
          configurationId: input.configurationId,
          targetType: input.targetType,
          targetId: input.targetId,
          requestedRevision: input.revision,
          applyMode: input.applyMode,
          content: input.content,
          requestedChecksum: input.checksum,
          createdBy: input.createdBy,
          createdAt: input.createdAt,
        },
        requiredHeader(request, 'idempotency-key'),
      );
      response.status(201).set('etag', etag(revision)).json(revision);
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/configuration-revisions/:configurationId/:revision',
    async (request, response, next) => {
      try {
        const revision = await configurations.get(
          request.params.configurationId,
          positiveRevision(request.params.revision),
        );
        response.status(200).set('etag', etag(revision)).json(revision);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/configuration-revisions/:configurationId/:revision/validate',
    async (request, response, next) => {
      try {
        const revisionNumber = positiveRevision(request.params.revision);
        const revision = await configurations.validate(
          request.params.configurationId,
          revisionNumber,
          requiredHeader(request, 'if-match'),
          requiredHeader(request, 'idempotency-key'),
          parseCommand(request.body),
        );
        response.status(200).set('etag', etag(revision)).json(revision);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/v1/evidence-export', async (_request, response, next) => {
    try {
      const current = await requiredEvidenceExport(configuration).current();
      response.status(200).set('etag', current.etag).json(current.configuration);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/evidence-export/revisions', async (request, response, next) => {
    try {
      const created = await requiredEvidenceExport(configuration).create(
        ManagedEvidenceExportConfigurationSchema.parse(
          request.body,
        ) as ManagedEvidenceExportConfiguration,
        requiredHeader(request, 'idempotency-key'),
      );
      response.status(201).set('etag', created.etag).json(created.configuration);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/v1/evidence-export/revisions/:revision/validate',
    async (request, response, next) => {
      try {
        const validated = await requiredEvidenceExport(configuration).validate(
          positiveRevision(request.params.revision),
          requiredHeader(request, 'if-match'),
          requiredHeader(request, 'idempotency-key'),
          parseCommand(request.body),
        );
        response.status(200).set('etag', validated.etag).json(validated.configuration);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/evidence-export/revisions/:revision/publish',
    async (request, response, next) => {
      try {
        response
          .status(202)
          .json(
            await requiredEvidenceExport(configuration).publish(
              positiveRevision(request.params.revision),
              requiredHeader(request, 'if-match'),
              requiredHeader(request, 'idempotency-key'),
              parseCommand(request.body),
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/v1/evidence-export/status', async (_request, response, next) => {
    try {
      response.status(200).json(await requiredEvidenceExport(configuration).status());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/evidence-export/test', async (request, response, next) => {
    try {
      response
        .status(202)
        .json(
          await requiredEvidenceExport(configuration).test(
            requiredHeader(request, 'idempotency-key'),
            parseCommand(request.body),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/evidence-export/outbox', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredEvidenceOperations(configuration).outbox(
            parseEvidenceOperationsQuery(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/evidence-export/source-checkpoints', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredEvidenceOperations(configuration).checkpoints(
            parseEvidenceOperationsQuery(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/evidence-export/projection-issues', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredEvidenceOperations(configuration).projectionIssues(
            parseEvidenceOperationsQuery(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/evidence-export/quality-issues', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredEvidenceOperations(configuration).qualityIssues(
            parseEvidenceOperationsQuery(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/evidence-export/episode-manifests/:episodeId',
    async (request, response, next) => {
      try {
        const manifest = await requiredEvidenceOperations(configuration).manifest(
          boundedEvidenceIdentifier(request.params.episodeId),
        );
        if (manifest === undefined)
          throw Object.assign(new Error('Evidence Episode Manifest was not found.'), {
            code: 'EVIDENCE_MANIFEST_NOT_FOUND',
            status: 404,
          });
        response.status(200).json(manifest);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/v1/evidence-export/dead-letters', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredEvidenceOperations(configuration).deadLetters(
            parseEvidenceOperationsQuery(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/evidence-export/replays', async (request, response, next) => {
    try {
      const body = EvidenceReplayCommandSchema.parse(request.body);
      const operation = await requiredEvidenceOperations(configuration).recover(
        evidenceReplayIntent(body),
        controlPrincipal(response),
        requiredHeader(request, 'idempotency-key'),
        body.reason,
      );
      response.status(operation.status === 'succeeded' ? 200 : 202).json(operation);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/v1/evidence-export/dead-letters/:deadLetterId/retry',
    async (request, response, next) => {
      try {
        const body = EvidenceRecoveryReasonSchema.parse(request.body);
        const operation = await requiredEvidenceOperations(configuration).recover(
          {
            operation: 'retry_dead_letter',
            deadLetterId: boundedEvidenceIdentifier(request.params.deadLetterId),
          },
          controlPrincipal(response),
          requiredHeader(request, 'idempotency-key'),
          body.reason,
        );
        response.status(operation.status === 'succeeded' ? 200 : 202).json(operation);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/api/v1/evidence-export/reconcile', async (request, response, next) => {
    try {
      const body = EvidenceReconcileCommandSchema.parse(request.body);
      const operation = await requiredEvidenceOperations(configuration).recover(
        {
          operation: 'reconcile_coverage',
          ...(body.episodeId === undefined ? {} : { episodeId: body.episodeId }),
        },
        controlPrincipal(response),
        requiredHeader(request, 'idempotency-key'),
        body.reason,
      );
      response.status(operation.status === 'succeeded' ? 200 : 202).json(operation);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/llm-providers', async (request, response, next) => {
    try {
      const llm = requiredLlmGovernance(configuration);
      const items = await llm.listProviders(parseLimit(request.query['pageSize']));
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/llm-providers', async (request, response, next) => {
    try {
      const input = LlmProviderSchema.parse(request.body);
      assertOutboundEndpoint(input.baseUrl, {
        allowedAuthorities: configuration.providerEndpointAllowlist,
        privateHttpAuthorities: configuration.privateHttpEndpointAllowlist,
        unsafeTestOpen: configuration.unsafeTestOpenOutbound,
      });
      response.status(201).json(
        await requiredLlmGovernance(configuration).createProvider(
          {
            ...input,
            healthPolicy: input.healthPolicy,
            rateLimitPolicy: input.rateLimitPolicy,
            secretStatus: input.secretStatus,
          },
          requiredHeader(request, 'idempotency-key'),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/llm-providers/:providerId', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(await requiredLlmGovernance(configuration).getProvider(request.params.providerId));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/llm-providers/:providerId/validate', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      response
        .status(202)
        .json(
          await requiredLlmGovernance(configuration).validateProvider(
            request.params.providerId,
            requiredHeader(request, 'idempotency-key'),
            command.reason,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/model-routes', async (request, response, next) => {
    try {
      const items = await requiredLlmGovernance(configuration).listRoutes(
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/model-routes', async (request, response, next) => {
    try {
      const input = ModelRouteSchema.parse(request.body);
      response.status(201).json(
        await requiredLlmGovernance(configuration).createRoute(
          {
            ...input,
            primary: input.primary,
            fallbacks: input.fallbacks,
            budgetPolicy: {
              ...input.budgetPolicy,
              selector: {
                scope: input.budgetPolicy.selector.scope,
                ...(input.budgetPolicy.selector.key === undefined
                  ? {}
                  : { key: input.budgetPolicy.selector.key }),
              },
            },
          },
          requiredHeader(request, 'idempotency-key'),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/model-routes/:routeId', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(await requiredLlmGovernance(configuration).getRoute(request.params.routeId));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/smpp-sources', async (request, response, next) => {
    try {
      const items = await requiredSmppRegistry(configuration).listSources(
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/smpp-sources', async (request, response, next) => {
    try {
      const input = SmppSourceSchema.parse(request.body);
      assertOutboundEndpoint(input.registryEndpoint, {
        allowedAuthorities: configuration.providerEndpointAllowlist,
        privateHttpAuthorities: configuration.privateHttpEndpointAllowlist,
        unsafeTestOpen: configuration.unsafeTestOpenOutbound,
      });
      const source = await requiredSmppRegistry(configuration).createSource(
        {
          smppSourceId: input.smppSourceId,
          ...(input.name === undefined ? {} : { name: input.name }),
          registryEndpoint: input.registryEndpoint,
          credentialRef: input.credentialRef,
          ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          environment: input.environment,
          syncMode: input.syncMode,
          snapshotTtlSeconds: input.snapshotTtlSeconds,
          lkgPolicy: input.lkgPolicy,
          status: input.status,
          revision: input.revision,
        },
        requiredHeader(request, 'idempotency-key'),
      );
      response.status(201).set('etag', smppSourceEtag(source)).json(source);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/smpp-sources/:smppSourceId', async (request, response, next) => {
    try {
      const source = await requiredSmppRegistry(configuration).getSource(
        request.params.smppSourceId,
      );
      response.status(200).set('etag', smppSourceEtag(source)).json(source);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/smpp-sources/:smppSourceId/sync', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      response
        .status(202)
        .json(
          await requiredSmppRegistry(configuration).synchronize(
            request.params.smppSourceId,
            requiredHeader(request, 'idempotency-key'),
            command.reason,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/mcp-provider-candidates', async (request, response, next) => {
    try {
      const items = await requiredSmppRegistry(configuration).listCandidates(
        typeof request.query['smppSourceId'] === 'string'
          ? request.query['smppSourceId']
          : undefined,
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/mcp-provider-bindings', async (request, response, next) => {
    try {
      const items = await requiredMcpBindings(configuration).listBindings(
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/mcp-provider-bindings', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      const input = McpBindingImportSchema.parse(command.payload);
      response.status(202).json(
        await requiredMcpBindings(configuration).importBinding(
          {
            bindingId: input.bindingId,
            localServerId: input.localServerId,
            originType: input.originType,
            credentialRef: input.credentialRef,
            ...(input.endpointRef === undefined ? {} : { endpointRef: input.endpointRef }),
            ...(input.smppSourceId === undefined ? {} : { smppSourceId: input.smppSourceId }),
            ...(input.externalProviderId === undefined
              ? {}
              : { externalProviderId: input.externalProviderId }),
            ...(input.externalServerId === undefined
              ? {}
              : { externalServerId: input.externalServerId }),
            ...(input.registryRevision === undefined
              ? {}
              : { registryRevision: input.registryRevision }),
            ...(input.registryChecksum === undefined
              ? {}
              : { registryChecksum: input.registryChecksum }),
          },
          requiredHeader(request, 'idempotency-key'),
          command.reason,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/mcp-provider-bindings/:bindingId', async (request, response, next) => {
    try {
      const requestedRevision = request.query['revision'];
      response
        .status(200)
        .json(
          await requiredMcpBindings(configuration).getBinding(
            request.params.bindingId,
            typeof requestedRevision === 'string' ? positiveRevision(requestedRevision) : undefined,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  for (const action of ['refresh', 'suspend', 'remove'] as const) {
    app.post(
      `/api/v1/mcp-provider-bindings/:bindingId/${action}`,
      async (request, response, next) => {
        try {
          const command = parseCommand(request.body);
          const bindings = requiredMcpBindings(configuration);
          const operation =
            action === 'refresh'
              ? command.payload === undefined
                ? await bindings.refresh(
                    request.params.bindingId,
                    requiredHeader(request, 'idempotency-key'),
                    command.reason,
                  )
                : catalogApprovalPayload(command.payload)
                  ? await bindings.refresh(
                      request.params.bindingId,
                      requiredHeader(request, 'idempotency-key'),
                      command.reason,
                      {
                        expectedRevision: z
                          .number()
                          .int()
                          .positive()
                          .parse(command.expectedRevision),
                        expectedCatalogChecksum: McpBindingCatalogApprovalSchema.parse(
                          command.payload,
                        ).catalogChecksum,
                      },
                    )
                  : await bindings.rebind(
                      request.params.bindingId,
                      {
                        expectedRevision: z
                          .number()
                          .int()
                          .positive()
                          .parse(command.expectedRevision),
                        ...McpBindingRebindSchema.parse(command.payload),
                      },
                      requiredHeader(request, 'idempotency-key'),
                      command.reason,
                    )
              : action === 'suspend'
                ? await bindings.suspend(
                    request.params.bindingId,
                    requiredHeader(request, 'idempotency-key'),
                    command.reason,
                  )
                : await bindings.remove(
                    request.params.bindingId,
                    requiredHeader(request, 'idempotency-key'),
                    command.reason,
                  );
          response.status(202).json(operation);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.get('/api/v1/node-capabilities', async (request, response, next) => {
    try {
      const items = await requiredCapabilities(configuration).list(
        typeof request.query['status'] === 'string' ? request.query['status'] : undefined,
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/node-capabilities', async (request, response, next) => {
    try {
      const input = NodeCapabilitySchema.parse(request.body);
      response.status(201).json(
        await requiredCapabilities(configuration).createDraft(
          {
            capabilityId: input.capabilityId,
            version: input.version,
            domain: input.domain,
            name: input.name,
            description: input.description,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            successCriteria: input.successCriteria,
            requiredEvidence: input.requiredEvidence,
            ...(input.effects === undefined ? {} : { effects: input.effects }),
            ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
            ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
            ...(input.supportedModes === undefined ? {} : { supportedModes: input.supportedModes }),
            riskLevel: input.riskLevel,
            status: input.status,
            definitionHash: input.definitionHash,
            ...(input.previousVersion === undefined
              ? {}
              : { previousVersion: input.previousVersion }),
            ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
            ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
          },
          requiredHeader(request, 'idempotency-key'),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/node-capabilities/:capabilityId/versions/:version',
    async (request, response, next) => {
      try {
        const capability = await requiredCapabilities(configuration).get(
          request.params.capabilityId,
          positiveRevision(request.params.version),
        );
        response.status(200).set('etag', nodeCapabilityEtag(capability)).json(capability);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/v1/node-capabilities/:capabilityId/versions/:version/implementations',
    async (request, response, next) => {
      try {
        const items = await requiredCapabilities(configuration).listImplementations(
          request.params.capabilityId,
          positiveRevision(request.params.version),
          parseLimit(request.query['pageSize']),
        );
        response
          .status(200)
          .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/node-capabilities/:capabilityId/versions/:version/implementations',
    async (request, response, next) => {
      try {
        const input = CapabilityImplementationSchema.parse(request.body);
        const capabilityId = request.params.capabilityId;
        const capabilityVersion = positiveRevision(request.params.version);
        if (input.capabilityId !== capabilityId || input.capabilityVersion !== capabilityVersion)
          throw new NodeControlCapabilityError(
            'NODE_CAPABILITY_CONFLICT',
            'Capability Implementation path and body identities must match.',
          );
        response.status(201).json(
          await requiredCapabilities(configuration).addImplementation(
            {
              bindingId: input.bindingId,
              capabilityId: input.capabilityId,
              capabilityVersion: input.capabilityVersion,
              implementationType: input.implementationType,
              implementationId: input.implementationId,
              implementationVersion: input.implementationVersion,
              role: input.role,
              priority: input.priority,
              ...(input.activationCondition === undefined
                ? {}
                : { activationCondition: input.activationCondition }),
              ...(input.providerPolicyOverride === undefined
                ? {}
                : { providerPolicyOverride: input.providerPolicyOverride }),
              status: input.status,
              revision: input.revision,
            },
            requiredHeader(request, 'idempotency-key'),
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ['validate', 'publish', 'suspend', 'deprecate', 'retire'] as const) {
    app.post(
      `/api/v1/node-capabilities/:capabilityId/versions/:version/${action}`,
      async (request, response, next) => {
        try {
          const command = parseCommand(request.body);
          const capabilities = requiredCapabilities(configuration);
          const args = [
            request.params.capabilityId,
            positiveRevision(request.params.version),
            requiredHeader(request, 'if-match'),
            requiredHeader(request, 'idempotency-key'),
            command.reason,
          ] as const;
          const result =
            action === 'validate'
              ? await capabilities.validate(...args)
              : action === 'publish'
                ? await capabilities.publish(...args)
                : action === 'suspend'
                  ? await capabilities.suspend(...args)
                  : action === 'deprecate'
                    ? await capabilities.deprecate(...args)
                    : await capabilities.retire(...args);
          response.status(action === 'validate' ? 200 : 202).json(result);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.get('/api/v1/a2a-exposures', async (request, response, next) => {
    try {
      const items = await requiredA2aExposure(configuration).list(
        typeof request.query['status'] === 'string' ? request.query['status'] : undefined,
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/a2a-exposures', async (request, response, next) => {
    try {
      const input = normalizeA2aExposure(A2aExposureSchema.parse(request.body));
      response
        .status(201)
        .json(
          await requiredA2aExposure(configuration).create(
            input,
            requiredHeader(request, 'idempotency-key'),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/a2a-exposures/:exposureId/versions/:version',
    async (request, response, next) => {
      try {
        const exposure = await requiredA2aExposure(configuration).get(
          request.params.exposureId,
          positiveRevision(request.params.version),
        );
        response.status(200).set('etag', a2aExposureEtag(exposure)).json(exposure);
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ['publish', 'suspend', 'retire'] as const) {
    app.post(
      `/api/v1/a2a-exposures/:exposureId/versions/:version/${action}`,
      async (request, response, next) => {
        try {
          const command = parseCommand(request.body);
          response
            .status(202)
            .json(
              await requiredA2aExposure(configuration).transition(
                request.params.exposureId,
                positiveRevision(request.params.version),
                action === 'publish' ? 'published' : action === 'suspend' ? 'suspended' : 'retired',
                requiredHeader(request, 'idempotency-key'),
                requiredHeader(request, 'if-match'),
                command.reason,
              ),
            );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.get('/api/v1/a2a-agent-card-revisions', async (request, response, next) => {
    try {
      const items = await requiredA2aExposure(configuration).listAgentCards(
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/a2a-agent-card-revisions/:revision', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredA2aExposure(configuration).getAgentCard(
            positiveRevision(request.params.revision),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/a2a-agent-card-revisions/rebuild', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      response
        .status(202)
        .json(
          await requiredA2aExposure(configuration).rebuild(
            requiredHeader(request, 'idempotency-key'),
            command.reason,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/capability-readiness', async (request, response, next) => {
    try {
      const items = await requiredCapabilityReadiness(configuration).list(
        typeof request.query['status'] === 'string' ? request.query['status'] : undefined,
        parseLimit(request.query['pageSize']),
      );
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/capability-readiness/:capabilityId/:version',
    async (request, response, next) => {
      try {
        const record = await requiredCapabilityReadiness(configuration).get(
          request.params.capabilityId,
          positiveRevision(request.params.version),
        );
        if (record === undefined) {
          sendProblem(response, {
            status: 404,
            code: 'CAPABILITY_READINESS_NOT_FOUND',
            title: 'Capability readiness snapshot not found',
            detail:
              'No Runtime-authoritative snapshot exists for the requested Capability Version.',
            instance: request.originalUrl,
            correlationId: correlationId(request),
            retryable: false,
          });
          return;
        }
        response.status(200).set('etag', `"${record.snapshotHash}"`).json(record.snapshot);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/capability-readiness/:capabilityId/:version/evaluate',
    async (request, response, next) => {
      try {
        const command = parseCommand(request.body);
        response
          .status(202)
          .json(
            await requiredCapabilityReadiness(configuration).evaluate(
              request.params.capabilityId,
              positiveRevision(request.params.version),
              requiredHeader(request, 'idempotency-key'),
              command.reason,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/configuration-revisions/:configurationId/:revision/publish',
    async (request, response, next) => {
      try {
        const revisionNumber = positiveRevision(request.params.revision);
        const operation = await configurations.publish(
          request.params.configurationId,
          revisionNumber,
          requiredHeader(request, 'if-match'),
          requiredHeader(request, 'idempotency-key'),
          parseCommand(request.body),
        );
        hints.publish(await configurations.get(request.params.configurationId, revisionNumber));
        response.status(202).json(operation);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/v1/configuration-revisions/:configurationId/:revision/rollback',
    async (request, response, next) => {
      try {
        const operation = await configurations.rollback(
          request.params.configurationId,
          positiveRevision(request.params.revision),
          requiredHeader(request, 'if-match'),
          requiredHeader(request, 'idempotency-key'),
          parseCommand(request.body),
        );
        response.status(202).json(operation);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/v1/management-operations', async (request, response, next) => {
    try {
      const items = await service.listManagementOperations(parseLimit(request.query['pageSize']));
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/management-operations/:operationId', async (request, response, next) => {
    try {
      response.status(200).json(await service.getManagementOperation(request.params.operationId));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/management-operations/:operationId/cancel', async (request, response, next) => {
    try {
      response
        .status(202)
        .json(
          await service.cancelManagementOperation(
            request.params.operationId,
            requiredHeader(request, 'idempotency-key'),
            parseCommand(request.body),
            controlPrincipal(response).actorId,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/events', async (request, response, next) => {
    try {
      const events = requiredNodeEvents(configuration);
      let cursor = request.header('last-event-id');
      const first = await events.listAfter(cursor, 100);
      response.status(200);
      response.set({
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      response.flushHeaders();
      const initialWrite = writeNodeEvents(response, first.items, cursor);
      cursor = initialWrite.cursor;
      let backpressured = initialWrite.backpressured;
      let closed = false;
      let running = false;
      const resume = () => {
        backpressured = false;
      };
      response.on('drain', resume);
      const timer = setInterval(() => {
        if (closed || running || backpressured) return;
        running = true;
        void events
          .listAfter(cursor, 100)
          .then((page) => {
            if (closed) return;
            const written = writeNodeEvents(response, page.items, cursor);
            cursor = written.cursor;
            backpressured = written.backpressured;
          })
          .catch(() => {
            if (!closed) backpressured = !response.write(': refetch-required\n\n');
          })
          .finally(() => {
            running = false;
          });
      }, 250);
      timer.unref();
      request.once('close', () => {
        closed = true;
        clearInterval(timer);
        response.off('drain', resume);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/audit-events', async (request, response, next) => {
    try {
      const items = await service.listAuditEvents(parseLimit(request.query['pageSize']));
      response
        .status(200)
        .json({ items, totalEstimate: items.length, asOf: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/skills', async (request, response, next) => {
    try {
      const items = await requiredRuntimeGovernance(configuration).listSkills(
        typeof request.query['status'] === 'string' ? request.query['status'] : undefined,
      );
      response
        .status(200)
        .json(
          page(
            items,
            request.query['pageSize'],
            request.query['pageToken'],
            `skills:${typeof request.query['status'] === 'string' ? request.query['status'] : ''}`,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/skills/import', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      response.status(202).json(
        await requiredRuntimeGovernance(configuration).importSkill({
          ...command,
          idempotencyKey: requiredHeader(request, 'idempotency-key'),
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/skills/:skillId/versions', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          page(
            await requiredRuntimeGovernance(configuration).listSkillVersions(
              request.params.skillId,
            ),
            request.query['pageSize'],
            request.query['pageToken'],
            `skill-versions:${request.params.skillId}`,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/skills/:skillId/versions/:version', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          await requiredRuntimeGovernance(configuration).getSkillVersion(
            request.params.skillId,
            request.params.version,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  for (const operation of ['publish', 'suspend', 'deprecate'] as const) {
    app.post(
      `/api/v1/skills/:skillId/versions/:version/${operation}`,
      async (request, response, next) => {
        try {
          const command = parseCommand(request.body);
          response.status(202).json(
            await requiredRuntimeGovernance(configuration).governSkill(
              operation,
              request.params.skillId,
              request.params.version,
              {
                ...command,
                idempotencyKey: requiredHeader(request, 'idempotency-key'),
              },
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.get('/api/v1/plan-templates', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          page(
            await requiredRuntimeGovernance(configuration).listPlanTemplates(),
            request.query['pageSize'],
            request.query['pageToken'],
            'plan-templates',
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/plan-templates/:artifactId/versions', async (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          page(
            await requiredRuntimeGovernance(configuration).listPlanTemplateVersions(
              request.params.artifactId,
            ),
            request.query['pageSize'],
            request.query['pageToken'],
            `plan-template-versions:${request.params.artifactId}`,
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/plan-templates/:artifactId/versions/:version',
    async (request, response, next) => {
      try {
        response
          .status(200)
          .json(
            await requiredRuntimeGovernance(configuration).getPlanTemplateVersion(
              request.params.artifactId,
              request.params.version,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  for (const operation of ['publish', 'revalidate', 'suspend'] as const) {
    app.post(
      `/api/v1/plan-templates/:artifactId/versions/:version/${operation}`,
      async (request, response, next) => {
        try {
          const command = parseCommand(request.body);
          response.status(202).json(
            await requiredRuntimeGovernance(configuration).governPlanTemplate(
              operation,
              request.params.artifactId,
              request.params.version,
              {
                ...command,
                idempotencyKey: requiredHeader(request, 'idempotency-key'),
              },
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.get('/api/v1/tasks', async (request, response, next) => {
    try {
      const items = await requiredTaskSummaries(configuration).list({
        ...(typeof request.query['phase'] === 'string' ? { phase: request.query['phase'] } : {}),
        ...(typeof request.query['goalId'] === 'string' ? { goalId: request.query['goalId'] } : {}),
        limit: 1_000,
      });
      response
        .status(200)
        .json(page(items, request.query['pageSize'], request.query['pageToken'], 'tasks'));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/tasks/:taskId', async (request, response, next) => {
    try {
      const projection = await requiredTaskSummaries(configuration).getWithRevision(
        request.params.taskId,
      );
      if (projection === undefined) {
        sendProblem(response, {
          title: 'Task not found',
          status: 404,
          code: 'TASK_NOT_FOUND',
          detail: 'The Runtime Task projection was not found.',
          instance: request.originalUrl,
          correlationId: correlationId(request),
          retryable: false,
        });
        return;
      }
      response
        .set('etag', `"task-revision-${String(projection.revision)}"`)
        .set('x-sdar-task-revision', String(projection.revision))
        .status(200)
        .json(projection.summary);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/tasks/:taskId/capability-binding', async (request, response, next) => {
    try {
      const binding = await requiredTaskCapabilities(configuration).findBinding(
        request.params.taskId,
      );
      if (binding === undefined) {
        response.status(404).type('application/problem+json').json({
          type: 'https://errors.sdar.io/task-capability-binding-not-found',
          title: 'Task capability binding not found',
          status: 404,
          code: 'TASK_CAPABILITY_BINDING_NOT_FOUND',
          detail: 'The Task has no immutable Capability binding.',
        });
        return;
      }
      response.status(200).json(binding);
    } catch (error) {
      next(error);
    }
  });

  for (const [path, action] of [
    ['pause', 'pause'],
    ['resume', 'resume'],
    ['cancel', 'cancel'],
    ['goal-patches', 'goal_patch'],
  ] as const) {
    app.post(`/api/v1/tasks/:taskId/${path}`, async (request, response, next) => {
      try {
        const command = TaskControlCommandSchema.parse(request.body);
        const idempotencyKey = TaskControlIdempotencyKeySchema.parse(
          request.header('idempotency-key'),
        );
        const requestCorrelationId = correlationId(request);
        const operation = await requiredTaskControl(configuration).execute(
          action,
          request.params.taskId,
          {
            reason: command.reason,
            idempotencyKey,
            correlationId: requestCorrelationId,
            ...(command.payload === undefined ? {} : { payload: command.payload }),
            ...(command.expectedRevision === undefined
              ? {}
              : { expectedRevision: command.expectedRevision }),
          },
          controlPrincipal(response),
        );
        response.set('x-correlation-id', requestCorrelationId).status(202).json(operation);
      } catch (error) {
        next(error);
      }
    });
  }

  app.use('/internal/v1', bearerAuthentication(configuration.runtimeServiceToken));

  app.get('/internal/v1/mcp-provider-bindings/current', async (request, response, next) => {
    try {
      const localServerId = z.string().trim().min(1).max(256).parse(request.query['localServerId']);
      const bindingIdValue = request.query['bindingId'];
      const bindingId =
        bindingIdValue === undefined
          ? undefined
          : z.string().trim().min(1).max(256).parse(bindingIdValue);
      response.status(200).json(
        await requiredMcpBindings(configuration).getCurrentAuthority({
          ...(bindingId === undefined ? {} : { bindingId }),
          localServerId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/internal/v1/node-capabilities/:capabilityId/versions/:version/authority',
    async (request, response, next) => {
      try {
        const capabilityId = request.params.capabilityId;
        const version = positiveRevision(request.params.version);
        const [definition, implementationBindings] = await Promise.all([
          requiredCapabilities(configuration).get(capabilityId, version),
          requiredCapabilities(configuration).listImplementations(capabilityId, version, 200),
        ]);
        response.status(200).json({
          observedAt: new Date().toISOString(),
          definition,
          implementationBindings,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/internal/v1/tasks/:taskId/capability-binding', async (request, response, next) => {
    try {
      const binding = await requiredTaskCapabilities(configuration).findBinding(
        request.params.taskId,
      );
      if (binding === undefined) {
        response.status(404).type('application/problem+json').json({
          type: 'https://errors.sdar.io/task-capability-binding-not-found',
          title: 'Task capability binding not found',
          status: 404,
          code: 'TASK_CAPABILITY_BINDING_NOT_FOUND',
          detail: 'The Task has no immutable Capability binding.',
        });
        return;
      }
      response.status(200).json(binding);
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/agent-card-revisions/stage', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      const candidate = normalizeRuntimeAgentCardCandidate(
        RuntimeAgentCardCandidateSchema.parse(command.payload),
      );
      requiredAgentCardValidator(configuration).validate(candidate.card);
      const context = runtimeAgentCardCommand(
        'agent-card:runtime-stage',
        requiredHeader(request, 'idempotency-key'),
        { candidate, reason: command.reason },
      );
      await requiredRuntimeAgentCards(configuration).stage(candidate, context);
      response
        .status(202)
        .json(
          completedInternalOperation(
            'agent_card.stage',
            candidate.revision.revision,
            command.reason,
            context,
            { revision: candidate.revision.revision, status: 'staged' },
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/internal/v1/agent-card-revisions/:revision/activate',
    async (request, response, next) => {
      try {
        const command = parseCommand(request.body);
        const revision = positiveRevision(request.params.revision);
        const context = runtimeAgentCardCommand(
          'agent-card:runtime-activate',
          requiredHeader(request, 'idempotency-key'),
          { revision, reason: command.reason },
        );
        await requiredRuntimeAgentCards(configuration).activate(revision, context);
        response.status(202).json(
          completedInternalOperation('agent_card.activate', revision, command.reason, context, {
            revision,
            status: 'active',
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/internal/v1/capability-readiness/evaluations', async (request, response, next) => {
    try {
      const command = parseCommand(request.body);
      const input = normalizeRuntimeReadinessInput(
        RuntimeReadinessInputSchema.parse(command.payload),
      );
      const idempotencyKey = requiredHeader(request, 'idempotency-key');
      const inputHash = createHash('sha256')
        .update(JSON.stringify({ input, reason: command.reason }))
        .digest('hex');
      const record = await requiredRuntimeCapabilityReadiness(configuration).evaluate(input, {
        idempotencyKey,
        requestHash: `sha256:${inputHash}`,
      });
      const operation = createManagementOperation(
        {
          operationId: `readiness-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`,
          operationType: 'capability.readiness.evaluate',
          target: {
            type: 'capability_readiness',
            id: input.definition.capabilityId,
            version: String(input.definition.version),
          },
          actorId: 'sdar-runtime',
          reason: command.reason,
          idempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
          inputHash,
        },
        record.snapshot.evaluatedAt,
      );
      response
        .status(202)
        .json(
          transitionManagementOperation(
            transitionManagementOperation(operation, 'running', record.snapshot.evaluatedAt),
            'succeeded',
            record.snapshot.evaluatedAt,
            { result: record.snapshot },
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.get('/internal/v1/bootstrap', async (_request, response, next) => {
    try {
      response.status(200).json(await configurations.bootstrap());
    } catch (error) {
      next(error);
    }
  });

  app.get('/internal/v1/revisions/latest', async (request, response, next) => {
    try {
      const query = LatestRevisionQuerySchema.parse(request.query);
      const revision = await configurations.latest(
        query.targetType,
        query.targetId,
        query.currentRevision,
      );
      if (revision === undefined) {
        response.status(query.currentRevision === undefined ? 404 : 304).end();
        return;
      }
      response.status(200).set('etag', etag(revision)).json(revision);
    } catch (error) {
      next(error);
    }
  });

  app.get('/internal/v1/revisions/watch', (request, response) => {
    response.status(200);
    response.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    response.flushHeaders();
    response.write(': revision hints only; recover through latest\n\n');
    const unsubscribe = hints.subscribe(response);
    request.once('close', unsubscribe);
  });

  app.post('/internal/v1/acks', async (request, response, next) => {
    try {
      await configurations.acknowledge(parseRuntimeAck(request.body));
      response.status(202).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((request, response) => {
    sendProblem(response, {
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      title: 'Resource not found',
      detail: 'The requested Node Control resource does not exist.',
      instance: request.originalUrl,
      correlationId: correlationId(request),
      retryable: false,
    });
  });

  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    void next;
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
      sendProblem(response, {
        status: 413,
        code: 'REQUEST_BODY_TOO_LARGE',
        title: 'Request body is too large',
        detail: 'The request exceeds the configured Node Control request-size limit.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlDomainError && error.code === 'NODE_PROFILE_NOT_FOUND') {
      sendProblem(response, {
        status: 404,
        code: error.code,
        title: 'Node Profile not found',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlApplicationError) {
      sendProblem(response, {
        status: 404,
        code: error.code,
        title: 'Management Operation not found',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlFoundationError) {
      sendProblem(response, {
        status: error.status,
        code: error.code,
        title: 'Node Profile command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlConfigurationError) {
      const status =
        error.code === 'CONFIGURATION_NOT_FOUND'
          ? 404
          : error.code === 'PRECONDITION_FAILED'
            ? 412
            : 409;
      sendProblem(response, {
        status,
        code: error.code,
        title: 'Configuration command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlLlmGovernanceError) {
      const status =
        error.code === 'LLM_PROVIDER_NOT_FOUND' || error.code === 'MODEL_ROUTE_NOT_FOUND'
          ? 404
          : error.code === 'MODEL_ROUTE_PROVIDER_UNAVAILABLE'
            ? 422
            : 409;
      sendProblem(response, {
        status,
        code: error.code,
        title: 'LLM governance command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlSmppRegistryError) {
      sendProblem(response, {
        status: error.code === 'SMPP_SOURCE_NOT_FOUND' ? 404 : 409,
        code: error.code,
        title: 'SMPP Registry command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlMcpBindingError) {
      sendProblem(response, {
        status: error.code === 'MCP_PROVIDER_BINDING_NOT_FOUND' ? 404 : 409,
        code: error.code,
        title: 'MCP Provider Binding command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: error.code === 'MCP_PROVIDER_BINDING_STALE',
      });
      return;
    }
    if (error instanceof NodeControlCapabilityError) {
      sendProblem(response, {
        status:
          error.code === 'NODE_CAPABILITY_NOT_FOUND'
            ? 404
            : error.code === 'PRECONDITION_FAILED'
              ? 412
              : error.code === 'CAPABILITY_IMPLEMENTATION_NOT_FOUND' ||
                  error.code === 'NODE_CAPABILITY_SCHEMA_INVALID'
                ? 422
                : 409,
        code: error.code,
        title: 'Node Capability command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlRuntimeGovernanceError) {
      sendProblem(response, {
        status: error.status,
        code: error.code,
        title: 'Runtime governance command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: error.code === 'REVISION_CONFLICT' || error.status >= 500,
      });
      return;
    }
    if (error instanceof NodeControlTaskControlError) {
      sendProblem(response, {
        status: error.status,
        code: error.code,
        title: 'Task control command rejected',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable:
          error.code === 'REVISION_CONFLICT' ||
          taskControlReconciliationCodes.has(error.code) ||
          error.status >= 500,
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number' &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      sendProblem(response, {
        status: error.status,
        code: error.code,
        title: 'Runtime adapter request rejected',
        detail:
          error instanceof Error ? error.message : 'The Runtime adapter rejected the request.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: error.code === 'REVISION_CONFLICT' || error.status >= 500,
      });
      return;
    }
    if (
      error instanceof Error &&
      (error.message === 'CAPABILITY_READINESS_IDEMPOTENCY_KEY_REUSED' ||
        error.message === 'CAPABILITY_READINESS_CONCURRENT_EVALUATION')
    ) {
      sendProblem(response, {
        status: 409,
        code: error.message,
        title: 'Capability readiness evaluation conflict',
        detail: 'The readiness evaluation conflicts with a prior or concurrent command.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: error.message === 'CAPABILITY_READINESS_CONCURRENT_EVALUATION',
      });
      return;
    }
    if (
      error instanceof Error &&
      /^(?:A2A_|AGENT_CARD_|PRECONDITION_FAILED|IDEMPOTENCY_KEY_REUSED|IDEMPOTENCY_KEY_INVALID)/u.test(
        error.message,
      )
    ) {
      const status = error.message.endsWith('_NOT_FOUND')
        ? 404
        : error.message === 'PRECONDITION_FAILED'
          ? 412
          : error.message.includes('SCHEMA_') ||
              error.message.includes('NOT_PUBLISHED') ||
              error.message.includes('CONTENT_HASH')
            ? 422
            : 409;
      sendProblem(response, {
        status,
        code: error.message,
        title: 'A2A exposure or Agent Card command rejected',
        detail: 'The A2A governance command failed a frozen authority or safety precondition.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof ZodError) {
      sendProblem(response, {
        status: 400,
        code: 'REQUEST_INVALID',
        title: 'Request is invalid',
        detail: error.issues.map((issue) => issue.message).join('; '),
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (error instanceof NodeControlDomainError) {
      sendProblem(response, {
        status: 422,
        code: error.code,
        title: 'Configuration is invalid',
        detail: error.message,
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    process.stderr.write(
      `${JSON.stringify({ event: 'node_control.request_failed', error: error instanceof Error ? error.message : 'UNKNOWN' })}\n`,
    );
    sendProblem(response, {
      status: 500,
      code: 'NODE_CONTROL_INTERNAL_ERROR',
      title: 'Node Control request failed',
      detail: 'The Node Control Backend could not complete the request.',
      instance: request.originalUrl,
      correlationId: correlationId(request),
      retryable: true,
    });
  });
  return app;
}

const taskControlReconciliationCodes = new Set([
  'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
  'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
  'RUNTIME_TASK_COMMAND_RECOVERY_INDETERMINATE',
]);

const TargetTypeSchema = z.enum([
  'node',
  'llm_provider',
  'model_route',
  'smpp_source',
  'mcp_provider_binding',
  'telemetry_link',
  'runtime_policy',
]);
const ConfigurationDraftSchema = z
  .object({
    configurationId: z.string().trim().min(1).max(256),
    targetType: TargetTypeSchema,
    targetId: z.string().trim().min(1).max(256),
    revision: z.number().int().positive(),
    status: z.literal('draft'),
    applyMode: z.enum([
      'hot_reload',
      'new_task_only',
      'reconnect_required',
      'restart_required',
      'immutable',
    ]),
    content: z.json(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    createdBy: z.string().trim().min(1).max(256),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const CommandSchema = z
  .object({
    reason: z.string().trim().min(1).max(1024),
    payload: z.json().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
const TaskControlCommandSchema = CommandSchema;
const TaskControlIdempotencyKeySchema = z.string().trim().min(8).max(128);
const EvidenceIdentifierSchema = z.string().trim().min(1).max(512);
const EvidenceRecoveryReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(2_048) })
  .strict();
const EvidenceReplayCommandSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('record'),
      recordId: EvidenceIdentifierSchema,
      reason: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      scope: z.literal('source_partition'),
      sourceFamily: EvidenceIdentifierSchema,
      sourcePartition: EvidenceIdentifierSchema,
      reason: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      scope: z.literal('episode'),
      episodeId: EvidenceIdentifierSchema,
      reason: z.string().trim().min(1).max(2_048),
    })
    .strict(),
]);
const EvidenceReconcileCommandSchema = z
  .object({
    episodeId: EvidenceIdentifierSchema.optional(),
    reason: z.string().trim().min(1).max(2_048),
  })
  .strict();
const EvidenceOperationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(200).default(100),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    episodeId: EvidenceIdentifierSchema.optional(),
    sourcePartition: EvidenceIdentifierSchema.optional(),
    openOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();
const NodeProfileDraftSchema = z
  .object({
    nodeId: z.string().trim().min(1).max(128),
    nodeType: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(256),
    description: z.string().max(4096).optional(),
    environment: z.string().trim().min(1).max(128),
    labels: z.record(z.string(), z.string()).optional(),
    authorityScopes: z.array(z.string().trim().min(1).max(256)).max(64).optional(),
    runtimeEndpointRef: z.string().trim().min(1).max(2048),
    telemetrySourceId: z.string().trim().min(1).max(256).optional(),
    status: z.literal('draft'),
    revision: z.number().int().positive(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .transform((input) => ({
    nodeId: input.nodeId,
    nodeType: input.nodeType,
    displayName: input.displayName,
    ...(input.description === undefined ? {} : { description: input.description }),
    environment: input.environment,
    ...(input.labels === undefined ? {} : { labels: input.labels }),
    ...(input.authorityScopes === undefined ? {} : { authorityScopes: input.authorityScopes }),
    runtimeEndpointRef: input.runtimeEndpointRef,
    ...(input.telemetrySourceId === undefined
      ? {}
      : { telemetrySourceId: input.telemetrySourceId }),
    status: input.status,
    revision: input.revision,
  }));
const LatestRevisionQuerySchema = z.object({
  targetType: TargetTypeSchema,
  targetId: z.string().trim().min(1).max(256),
  currentRevision: z.coerce.number().int().nonnegative().optional(),
});
const RuntimeAckSchema = z
  .object({
    runtimeInstanceId: z.string().trim().min(1).max(256),
    targetType: TargetTypeSchema,
    targetId: z.string().trim().min(1).max(256),
    revision: z.number().int().positive(),
    status: z.enum([
      'applied',
      'partially_applied',
      'rejected',
      'restart_required',
      'stale',
      'unavailable',
    ]),
    observedRuntimeVersion: z.string().trim().min(1).max(128),
    activeChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    reasonCode: z.string().trim().min(1).max(256).optional(),
    detail: z.record(z.string(), z.json()).optional(),
    acknowledgedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ModelCapabilitySchema = z.enum(['structured_output', 'tool_calling', 'embedding', 'vision']);
const LlmProviderSchema = z
  .object({
    providerId: z.string().trim().min(1).max(256),
    providerType: z.enum(['openai_compatible', 'anthropic', 'local']),
    baseUrl: z.url(),
    credentialRef: z.string().trim().min(1).max(256),
    models: z
      .array(
        z
          .object({
            modelId: z.string().trim().min(1).max(256),
            capabilities: z.array(ModelCapabilitySchema).min(1),
            contextWindow: z.number().int().positive(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    healthPolicy: z
      .object({
        timeoutMs: z.number().int().min(100).max(300_000),
        retryAttempts: z.number().int().min(0).max(5),
        failureThreshold: z.number().int().min(1).max(100),
        recoverySeconds: z.number().int().min(1).max(86_400),
      })
      .strict(),
    rateLimitPolicy: z
      .object({
        requestsPerMinute: z.number().int().positive(),
        tokensPerMinute: z.number().int().positive(),
        maxConcurrent: z.number().int().positive(),
      })
      .strict(),
    status: z.literal('draft'),
    secretStatus: z.literal('unknown').default('unknown'),
    revision: z.number().int().positive(),
  })
  .strict();
const RouteCandidateSchema = z
  .object({
    providerId: z.string().trim().min(1).max(256),
    modelId: z.string().trim().min(1).max(256),
  })
  .strict();
const ModelRouteSchema = z
  .object({
    routeId: z.string().trim().min(1).max(256),
    stage: z.enum(['understanding', 'planning', 'execution', 'evaluation', 'summary', 'embedding']),
    primary: RouteCandidateSchema,
    fallbacks: z.array(RouteCandidateSchema).max(15),
    budgetPolicy: z
      .object({
        selector: z
          .object({
            scope: z.enum(['stage', 'task', 'case']),
            key: z.string().trim().min(1).max(256).optional(),
          })
          .strict(),
        timeoutMs: z.number().int().min(100).max(300_000),
        maxAttempts: z.number().int().min(1).max(16),
        maxInputTokens: z.number().int().positive(),
        maxOutputTokens: z.number().int().positive(),
        maxCostUsd: z.number().nonnegative(),
        fallbackOn: z
          .array(z.enum(['unavailable', 'timeout', 'rate_limited', 'upstream_error']))
          .min(1),
      })
      .strict(),
    status: z.literal('draft'),
    revision: z.number().int().positive(),
  })
  .strict();
const SmppSourceSchema = z
  .object({
    smppSourceId: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(256).optional(),
    registryEndpoint: z.url(),
    credentialRef: z.string().trim().min(1).max(256),
    tenantId: z.string().trim().min(1).max(256).optional(),
    projectId: z.string().trim().min(1).max(256).optional(),
    environment: z.string().trim().min(1).max(256),
    syncMode: z.enum(['manual', 'poll', 'watch']),
    snapshotTtlSeconds: z.number().int().positive().max(2_592_000),
    lkgPolicy: z.enum(['allow_unexpired', 'deny_when_unavailable']),
    status: z.literal('draft'),
    revision: z.number().int().positive(),
  })
  .strict();
const McpBindingImportSchema = z
  .object({
    bindingId: z.string().trim().min(1).max(256),
    localServerId: z.string().trim().min(1).max(256),
    originType: z.enum(['direct', 'smpp_registry']),
    endpointRef: z.url().optional(),
    credentialRef: z.string().trim().min(1).max(512),
    smppSourceId: z.string().trim().min(1).max(256).optional(),
    externalProviderId: z.string().trim().min(1).max(256).optional(),
    externalServerId: z.string().trim().min(1).max(256).optional(),
    registryRevision: z.number().int().positive().optional(),
    registryChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict();
const McpBindingRebindSchema = z
  .object({
    smppSourceId: z.string().trim().min(1).max(256),
    externalProviderId: z.string().trim().min(1).max(256),
    externalServerId: z.string().trim().min(1).max(256),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    endpointRef: z.url().refine((value) => {
      const endpoint = new URL(value);
      return (
        ['http:', 'https:'].includes(endpoint.protocol) &&
        endpoint.username === '' &&
        endpoint.password === ''
      );
    }, 'endpointRef must be a credential-free HTTP(S) URL.'),
  })
  .strict();
const McpBindingCatalogApprovalSchema = z
  .object({
    approval: z.literal('catalog_checksum'),
    catalogChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const JsonObjectSchema = z.record(z.string(), z.json());
const ManagedEvidenceExportConfigurationSchema = z
  .object({
    exportId: z.string().trim().min(1).max(256),
    deliveryStart: z.enum(['retained', 'from_activation']).optional(),
    endpointRef: z.url(),
    sourceId: z.string().trim().min(1).max(256),
    nodeId: z.string().trim().min(1).max(256).optional(),
    credentialRef: z
      .string()
      .trim()
      .regex(/^(?:env|secret):[A-Za-z0-9_.:/-]{1,256}$/u),
    includedFamilies: z
      .array(
        z.enum([
          'runtime',
          'skill',
          'mcp_task',
          'capability',
          'experience',
          'replay',
          'artifact',
          'node_control',
          'evidence',
        ]),
      )
      .min(1),
    excludedDiagnosticTypes: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
    batchPolicy: z
      .object({
        maxRecords: z.number().int().min(1).max(1_000),
        maxBytes: z.number().int().min(1_024).max(262_144),
        flushIntervalMs: z.number().int().min(10).max(3_600_000),
      })
      .strict(),
    retryPolicy: z
      .object({
        baseDelayMs: z.number().int().min(10).max(300_000),
        maxDelayMs: z.number().int().min(10).max(86_400_000),
        maxAttempts: z.number().int().min(1).max(1_000).optional(),
      })
      .strict(),
    outboxPolicy: z
      .object({
        maxPendingRecords: z.number().int().min(1).max(1_000_000),
        retentionDays: z.number().int().min(1).max(3_650),
      })
      .strict(),
    redactionProfile: z.string().trim().min(1).max(256),
    artifactMode: z.enum(['inline', 'reference']),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    revision: z.number().int().positive(),
    applyMode: z.enum(['hot_reload', 'reconnect_required', 'restart_required']).optional(),
  })
  .strict();
const NodeCapabilitySchema = z
  .object({
    capabilityId: z.string().trim().min(1).max(512),
    version: z.number().int().positive(),
    domain: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(512),
    description: z.string().trim().min(1).max(512),
    inputSchema: JsonObjectSchema,
    outputSchema: JsonObjectSchema,
    successCriteria: z.array(JsonObjectSchema).min(1),
    requiredEvidence: z.array(JsonObjectSchema),
    effects: z.array(z.string().trim().min(1).max(512)).optional(),
    artifacts: z.array(z.string().trim().min(1).max(512)).optional(),
    constraints: z.array(JsonObjectSchema).optional(),
    supportedModes: z.array(z.string().trim().min(1).max(512)).optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
    previousVersion: z.number().int().positive().optional(),
    createdBy: z.string().trim().min(1).max(512).optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const CapabilityImplementationSchema = z
  .object({
    bindingId: z.string().trim().min(1).max(512),
    capabilityId: z.string().trim().min(1).max(512),
    capabilityVersion: z.number().int().positive(),
    implementationType: z.enum(['skill', 'plan_template']),
    implementationId: z.string().trim().min(1).max(512),
    implementationVersion: z.string().trim().min(1).max(512),
    role: z.enum(['primary', 'alternative', 'supporting', 'validation', 'recovery']),
    priority: z.number().int().nonnegative(),
    activationCondition: z.json().optional(),
    providerPolicyOverride: z.json().optional(),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    revision: z.number().int().positive(),
  })
  .strict();
const RuntimeReadinessInputSchema = z
  .object({
    definition: NodeCapabilitySchema,
    implementations: z.array(CapabilityImplementationSchema).max(1_000),
    maintenanceMode: z.boolean(),
    killSwitch: z.boolean(),
    ttlMs: z.number().int().min(1_000).max(86_400_000),
    minimumStableWindowMs: z.number().int().nonnegative(),
    trigger: z.string().trim().min(1).max(1_024),
  })
  .strict();
const A2aExposureSchema = z
  .object({
    exposureId: z.string().trim().min(1).max(512),
    version: z.number().int().positive(),
    capabilityId: z.string().trim().min(1).max(512),
    capabilityVersion: z.number().int().positive(),
    agentSkillId: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(2_048),
    tags: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    examples: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    inputModes: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    outputModes: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    requestSchema: JsonObjectSchema,
    resultSchema: JsonObjectSchema,
    visibility: z.enum(['organization', 'public']),
    requesterPolicy: JsonObjectSchema.optional(),
    readinessPublicationPolicy: z
      .enum(['publish_when_available', 'publish_degraded', 'always_publish_with_status'])
      .optional(),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const AgentCardRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    nodeId: z.string().trim().min(1).max(512),
    exposureRefs: z.array(z.string().trim().min(1).max(1_024)).max(1_000).optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    capabilityCatalogHash: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(['candidate', 'staged', 'active', 'rejected', 'superseded']),
    generatedAt: z.iso.datetime({ offset: true }),
    activatedAt: z.iso.datetime({ offset: true }).optional(),
    rejectionCode: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
const RuntimeAgentCardCandidateSchema = z
  .object({
    revision: AgentCardRevisionSchema,
    card: JsonObjectSchema,
    exposureSnapshots: z.array(A2aExposureSchema).max(1_000).optional(),
  })
  .strict();

function normalizeA2aExposure(input: z.infer<typeof A2aExposureSchema>) {
  return createA2aExposureVersion({
    exposureId: input.exposureId,
    version: input.version,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    agentSkillId: input.agentSkillId,
    name: input.name,
    description: input.description,
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.examples === undefined ? {} : { examples: input.examples }),
    ...(input.inputModes === undefined ? {} : { inputModes: input.inputModes }),
    ...(input.outputModes === undefined ? {} : { outputModes: input.outputModes }),
    requestSchema: input.requestSchema,
    resultSchema: input.resultSchema,
    visibility: input.visibility,
    ...(input.requesterPolicy === undefined ? {} : { requesterPolicy: input.requesterPolicy }),
    ...(input.readinessPublicationPolicy === undefined
      ? {}
      : { readinessPublicationPolicy: input.readinessPublicationPolicy }),
    status: input.status,
    exposureHash: input.exposureHash,
  });
}

function normalizeRuntimeAgentCardCandidate(
  input: z.infer<typeof RuntimeAgentCardCandidateSchema>,
): RuntimeAgentCardCandidate {
  return Object.freeze({
    revision: Object.freeze({
      revision: input.revision.revision,
      nodeId: input.revision.nodeId,
      ...(input.revision.exposureRefs === undefined
        ? {}
        : { exposureRefs: Object.freeze(input.revision.exposureRefs) }),
      contentHash: input.revision.contentHash,
      capabilityCatalogHash: input.revision.capabilityCatalogHash,
      status: input.revision.status,
      generatedAt: input.revision.generatedAt,
      ...(input.revision.activatedAt === undefined
        ? {}
        : { activatedAt: input.revision.activatedAt }),
      ...(input.revision.rejectionCode === undefined
        ? {}
        : { rejectionCode: input.revision.rejectionCode }),
    }),
    card: Object.freeze(structuredClone(input.card)),
    ...(input.exposureSnapshots === undefined
      ? {}
      : { exposureSnapshots: Object.freeze(input.exposureSnapshots.map(normalizeA2aExposure)) }),
  });
}

function runtimeAgentCardCommand(scope: string, idempotencyKey: string, input: unknown) {
  if (idempotencyKey.trim().length < 8 || idempotencyKey.length > 256)
    throw new Error('IDEMPOTENCY_KEY_INVALID');
  return Object.freeze({
    scope,
    idempotencyKey,
    requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    occurredAt: new Date().toISOString(),
  });
}

function completedInternalOperation(
  operationType: string,
  revision: number,
  reason: string,
  context: ReturnType<typeof runtimeAgentCardCommand>,
  result: Readonly<Record<string, unknown>>,
) {
  const operation = createManagementOperation(
    {
      operationId: `runtime-card-${createHash('sha256').update(`${context.scope}:${context.idempotencyKey}`).digest('hex').slice(0, 32)}`,
      operationType,
      target: { type: 'agent_card_revision', id: String(revision), revision },
      actorId: 'sdar-runtime',
      reason,
      idempotencyKeyHash: createHash('sha256').update(context.idempotencyKey).digest('hex'),
      inputHash: context.requestHash,
    },
    context.occurredAt,
  );
  return transitionManagementOperation(
    transitionManagementOperation(operation, 'running', context.occurredAt),
    'succeeded',
    context.occurredAt,
    { result },
  );
}

function positiveRevision(value: string): number {
  return z.coerce.number().int().positive().parse(value);
}

function requiredHeader(request: Request, name: string): string {
  return request.header(name) ?? '';
}

function parseCommand(value: unknown) {
  const parsed = CommandSchema.parse(value);
  return Object.freeze({
    reason: parsed.reason,
    ...(parsed.payload === undefined ? {} : { payload: parsed.payload }),
    ...(parsed.expectedRevision === undefined ? {} : { expectedRevision: parsed.expectedRevision }),
  });
}

function catalogApprovalPayload(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'approval' in value;
}

function parseEvidenceOperationsQuery(request: Request) {
  const parsed = EvidenceOperationsQuerySchema.parse({
    limit: request.query['limit'] ?? request.query['pageSize'],
    cursor: request.query['cursor'] ?? request.query['pageToken'],
    episodeId: request.query['episodeId'],
    sourcePartition: request.query['sourcePartition'],
    openOnly: request.query['openOnly'],
  });
  return Object.freeze({
    limit: parsed.limit,
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    ...(parsed.episodeId === undefined ? {} : { episodeId: parsed.episodeId }),
    ...(parsed.sourcePartition === undefined ? {} : { sourcePartition: parsed.sourcePartition }),
    ...(parsed.openOnly === undefined ? {} : { openOnly: parsed.openOnly }),
  });
}

function evidenceReplayIntent(input: z.infer<typeof EvidenceReplayCommandSchema>) {
  switch (input.scope) {
    case 'record':
      return Object.freeze({ operation: 'replay_record' as const, recordId: input.recordId });
    case 'source_partition':
      return Object.freeze({
        operation: 'replay_source_partition' as const,
        sourceFamily: input.sourceFamily,
        sourcePartition: input.sourcePartition,
      });
    case 'episode':
      return Object.freeze({ operation: 'replay_episode' as const, episodeId: input.episodeId });
  }
}

function boundedEvidenceIdentifier(value: string): string {
  return EvidenceIdentifierSchema.parse(value);
}

function controlPrincipal(response: Response): EvidenceOperationsPrincipal {
  const value: unknown = response.locals['controlPrincipal'];
  if (
    typeof value !== 'object' ||
    value === null ||
    !('actorId' in value) ||
    typeof value.actorId !== 'string' ||
    !('role' in value) ||
    ![
      'node_admin',
      'security_admin',
      'node_operator',
      'node_viewer',
      'organization_service',
    ].includes(String(value.role))
  )
    throw Object.assign(new Error('Evidence operations principal is unavailable.'), {
      code: 'EVIDENCE_OPERATIONS_PRINCIPAL_UNAVAILABLE',
      status: 401,
    });
  return Object.freeze({
    actorId: value.actorId,
    role: value.role as EvidenceOperationsPrincipal['role'],
  });
}

function parseRuntimeAck(value: unknown) {
  const parsed = RuntimeAckSchema.parse(value);
  return Object.freeze({
    runtimeInstanceId: parsed.runtimeInstanceId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    revision: parsed.revision,
    status: parsed.status,
    observedRuntimeVersion: parsed.observedRuntimeVersion,
    ...(parsed.activeChecksum === undefined ? {} : { activeChecksum: parsed.activeChecksum }),
    ...(parsed.reasonCode === undefined ? {} : { reasonCode: parsed.reasonCode }),
    ...(parsed.detail === undefined ? {} : { detail: parsed.detail }),
    acknowledgedAt: parsed.acknowledgedAt,
  });
}

function normalizeRuntimeReadinessInput(
  input: z.infer<typeof RuntimeReadinessInputSchema>,
): RuntimeCapabilityReadinessInput {
  return Object.freeze({
    definition: createNodeCapabilityDefinition({
      capabilityId: input.definition.capabilityId,
      version: input.definition.version,
      domain: input.definition.domain,
      name: input.definition.name,
      description: input.definition.description,
      inputSchema: input.definition.inputSchema,
      outputSchema: input.definition.outputSchema,
      successCriteria: input.definition.successCriteria,
      requiredEvidence: input.definition.requiredEvidence,
      ...(input.definition.effects === undefined ? {} : { effects: input.definition.effects }),
      ...(input.definition.artifacts === undefined
        ? {}
        : { artifacts: input.definition.artifacts }),
      ...(input.definition.constraints === undefined
        ? {}
        : { constraints: input.definition.constraints }),
      ...(input.definition.supportedModes === undefined
        ? {}
        : { supportedModes: input.definition.supportedModes }),
      riskLevel: input.definition.riskLevel,
      status: input.definition.status,
      definitionHash: input.definition.definitionHash,
      ...(input.definition.previousVersion === undefined
        ? {}
        : { previousVersion: input.definition.previousVersion }),
      ...(input.definition.createdBy === undefined
        ? {}
        : { createdBy: input.definition.createdBy }),
      ...(input.definition.createdAt === undefined
        ? {}
        : { createdAt: input.definition.createdAt }),
    }),
    implementations: Object.freeze(
      input.implementations.map((binding) =>
        createCapabilityImplementationBinding({
          bindingId: binding.bindingId,
          capabilityId: binding.capabilityId,
          capabilityVersion: binding.capabilityVersion,
          implementationType: binding.implementationType,
          implementationId: binding.implementationId,
          implementationVersion: binding.implementationVersion,
          role: binding.role,
          priority: binding.priority,
          ...(binding.activationCondition === undefined
            ? {}
            : { activationCondition: binding.activationCondition }),
          ...(binding.providerPolicyOverride === undefined
            ? {}
            : { providerPolicyOverride: binding.providerPolicyOverride }),
          status: binding.status,
          revision: binding.revision,
        }),
      ),
    ),
    maintenanceMode: input.maintenanceMode,
    killSwitch: input.killSwitch,
    ttlMs: input.ttlMs,
    minimumStableWindowMs: input.minimumStableWindowMs,
    trigger: input.trigger,
  });
}

function etag(revision: {
  readonly configurationId: string;
  readonly revision: number;
  readonly status: string;
  readonly checksum: string;
}): string {
  return `"configuration:${revision.configurationId}:${String(revision.revision)}:${revision.status}:${revision.checksum}"`;
}

function nodeProfileEtag(
  profile: Readonly<{
    nodeId: string;
    revision: number;
    status: string;
  }>,
): string {
  const identityHash = createHash('sha256').update(profile.nodeId).digest('hex');
  return `"node:${String(profile.revision)}:${profile.status}:${identityHash}"`;
}

function bearerAuthentication(expectedToken: string) {
  const expectedDigest = createHash('sha256').update(expectedToken).digest();
  return (request: Request, response: Response, next: NextFunction): void => {
    const authorization = request.header('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
    const suppliedDigest = createHash('sha256')
      .update(token ?? '')
      .digest();
    if (token === undefined || !timingSafeEqual(expectedDigest, suppliedDigest)) {
      sendProblem(response, {
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid deployment bearer identity is required.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    next();
  };
}

type PublicApiRole =
  'node_admin' | 'node_operator' | 'node_viewer' | 'security_admin' | 'organization_service';

function publicApiAccessControl(configuration: NodeControlHttpConfiguration) {
  const credentials = Object.freeze(
    [
      credential('node_admin', configuration.bearerToken),
      credential('node_operator', configuration.operatorBearerToken),
      credential('node_viewer', configuration.viewerBearerToken),
      credential('security_admin', configuration.securityBearerToken),
      credential('organization_service', configuration.organizationBearerToken),
    ].filter((value) => value !== undefined),
  );
  const windows = new Map<string, { readonly startedAt: number; readonly count: number }>();
  const limit = configuration.rateLimitPerMinute ?? 1_200;
  return (request: Request, response: Response, next: NextFunction): void => {
    if (configuration.trustedIntranetPublicAccess === true) {
      response.locals['controlPrincipal'] = Object.freeze({
        actorId: 'ugv-debug:trusted-intranet',
        role: 'node_admin',
      });
      next();
      return;
    }
    const authorization = request.header('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
    const supplied = createHash('sha256')
      .update(token ?? '')
      .digest();
    let principal: (typeof credentials)[number] | undefined;
    for (const candidate of credentials)
      if (token !== undefined && timingSafeEqual(candidate.digest, supplied))
        principal ??= candidate;
    if (principal === undefined) {
      sendProblem(response, {
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid deployment bearer identity is required.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    const now = Date.now();
    const current = windows.get(principal.key);
    const window =
      current === undefined || now - current.startedAt >= 60_000
        ? { startedAt: now, count: 1 }
        : { startedAt: current.startedAt, count: current.count + 1 };
    windows.set(principal.key, window);
    response.set('x-ratelimit-limit', String(limit));
    response.set('x-ratelimit-remaining', String(Math.max(0, limit - window.count)));
    if (window.count > limit) {
      response.set(
        'retry-after',
        String(Math.max(1, Math.ceil((window.startedAt + 60_000 - now) / 1_000))),
      );
      sendProblem(response, {
        status: 429,
        code: 'CONTROL_RATE_LIMIT_EXCEEDED',
        title: 'Node Control rate limit exceeded',
        detail: 'Retry after the current fixed rate-limit window.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: true,
      });
      return;
    }
    if (
      principal.role === 'organization_service' &&
      configuration.organizationTenantId !== undefined &&
      request.header('x-sdar-tenant-id') !== undefined &&
      request.header('x-sdar-tenant-id') !== configuration.organizationTenantId
    ) {
      sendProblem(response, {
        status: 403,
        code: 'CONTROL_TENANT_FORBIDDEN',
        title: 'Tenant is outside the authenticated organization identity',
        detail: 'Tenant identity is derived from the organization service credential.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    if (
      !roleOperationAllowed(
        principal.role,
        request.method,
        request.originalUrl,
        configuration.taskControl !== undefined,
      )
    ) {
      sendProblem(response, {
        status: 403,
        code: 'CONTROL_SCOPE_FORBIDDEN',
        title: 'Operation is outside the authenticated role',
        detail: 'The service principal may use only its frozen Node Control role profile.',
        instance: request.originalUrl,
        correlationId: correlationId(request),
        retryable: false,
      });
      return;
    }
    response.locals['controlPrincipal'] = Object.freeze({
      actorId: `node-control:${principal.role}`,
      role: principal.role,
      ...(principal.role === 'organization_service' &&
      configuration.organizationTenantId !== undefined
        ? { tenantId: configuration.organizationTenantId }
        : {}),
    });
    next();
  };
}

function credential(role: PublicApiRole, token: string | undefined) {
  if (token === undefined) return undefined;
  const digest = createHash('sha256').update(token).digest();
  return Object.freeze({ role, digest, key: `${role}:${digest.toString('hex')}` });
}

function roleOperationAllowed(
  role: PublicApiRole,
  method: string,
  originalUrl: string,
  organizationTaskControlEnabled: boolean,
): boolean {
  if (role === 'node_admin') return true;
  if (role === 'organization_service')
    return organizationOperationAllowed(method, originalUrl, organizationTaskControlEnabled);
  if (organizationOperationAllowed(method, originalUrl, false)) return true;
  const path = new URL(originalUrl, 'http://node-control.invalid').pathname;
  const evidenceRecovery = [
    /^\/api\/v1\/evidence-export\/replays$/u,
    /^\/api\/v1\/evidence-export\/dead-letters\/[^/]+\/retry$/u,
    /^\/api\/v1\/evidence-export\/reconcile$/u,
  ].some((pattern) => pattern.test(path));
  if (method === 'POST' && role === 'security_admin' && evidenceRecovery) return true;
  if (method !== 'GET') return false;
  const evidenceRead = [
    /^\/api\/v1\/evidence-export(?:\/status)?$/u,
    /^\/api\/v1\/evidence-export\/(?:outbox|source-checkpoints|projection-issues|quality-issues|dead-letters)$/u,
    /^\/api\/v1\/evidence-export\/episode-manifests\/[^/]+$/u,
  ].some((pattern) => pattern.test(path));
  if (role === 'node_viewer') return evidenceRead;
  return evidenceRead || /^\/api\/v1\/audit-events$/u.test(path);
}

function organizationOperationAllowed(
  method: string,
  originalUrl: string,
  taskControlEnabled: boolean,
): boolean {
  const path = new URL(originalUrl, 'http://node-control.invalid').pathname;
  if (
    taskControlEnabled &&
    method === 'POST' &&
    /^\/api\/v1\/tasks\/[^/]+\/(?:pause|resume|cancel|goal-patches)$/u.test(path)
  )
    return true;
  if (method !== 'GET') return false;
  return [
    /^\/api\/v1\/node(?:\/health)?$/u,
    /^\/api\/v1\/node-capabilities(?:\/[^/]+\/versions\/\d+)?$/u,
    /^\/api\/v1\/capability-readiness(?:\/[^/]+\/\d+)?$/u,
    /^\/api\/v1\/a2a-exposures(?:\/[^/]+\/versions\/\d+)?$/u,
    /^\/api\/v1\/a2a-agent-card-revisions\/\d+$/u,
    /^\/api\/v1\/tasks(?:\/[^/]+(?:\/capability-binding)?)?$/u,
    /^\/api\/v1\/management-operations\/[^/]+$/u,
    /^\/api\/v1\/events$/u,
  ].some((pattern) => pattern.test(path));
}

function writeNodeEvents(
  response: Response,
  events: readonly Readonly<{ eventId: string; eventType: string }>[],
  cursor: string | undefined,
): Readonly<{ cursor: string | undefined; backpressured: boolean }> {
  let latest = cursor;
  for (const event of events) {
    const writable = response.write(
      `id: ${event.eventId}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    latest = event.eventId;
    if (!writable) return Object.freeze({ cursor: latest, backpressured: true });
  }
  return Object.freeze({ cursor: latest, backpressured: false });
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 100;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100;
}

function page<T>(items: readonly T[], pageSize: unknown, pageToken: unknown, scope: string) {
  const limit = parsePageSize(pageSize);
  const offset = decodePageToken(pageToken, scope);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  return Object.freeze({
    items: Object.freeze(selected),
    ...(nextOffset < items.length ? { nextPageToken: encodePageToken(nextOffset, scope) } : {}),
    totalEstimate: items.length,
    asOf: new Date().toISOString(),
  });
}

function parsePageSize(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== 'string') throw invalidPage('pageSize must be a query string value.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200)
    throw invalidPage('pageSize must be an integer between 1 and 200.');
  return parsed;
}

function encodePageToken(offset: number, scope: string): string {
  return Buffer.from(JSON.stringify({ offset, scope }), 'utf8').toString('base64url');
}

function decodePageToken(value: unknown, scope: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || value.length > 2_048) throw invalidPage('pageToken is invalid.');
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('offset' in decoded) ||
      !Number.isSafeInteger(decoded.offset) ||
      Number(decoded.offset) < 0 ||
      !('scope' in decoded) ||
      decoded.scope !== scope
    )
      throw invalidPage('pageToken is invalid for this collection.');
    return Number(decoded.offset);
  } catch (error) {
    if (error instanceof NodeControlRuntimeGovernanceError) throw error;
    throw invalidPage('pageToken is invalid.');
  }
}

function invalidPage(message: string): NodeControlRuntimeGovernanceError {
  return new NodeControlRuntimeGovernanceError('PAGE_TOKEN_INVALID', message, 400);
}

function requiredLlmGovernance(
  configuration: NodeControlHttpConfiguration,
): NodeControlLlmGovernanceService {
  if (configuration.llmGovernance === undefined) throw new Error('LLM_GOVERNANCE_NOT_COMPOSED');
  return configuration.llmGovernance;
}

function requiredSmppRegistry(
  configuration: NodeControlHttpConfiguration,
): NodeControlSmppRegistryService {
  if (configuration.smppRegistry === undefined) throw new Error('SMPP_REGISTRY_NOT_COMPOSED');
  return configuration.smppRegistry;
}

function requiredMcpBindings(
  configuration: NodeControlHttpConfiguration,
): NodeControlMcpProviderBindingService {
  if (configuration.mcpBindings === undefined) throw new Error('MCP_BINDINGS_NOT_COMPOSED');
  return configuration.mcpBindings;
}

function requiredCapabilities(
  configuration: NodeControlHttpConfiguration,
): NodeControlCapabilityService {
  if (configuration.capabilities === undefined) throw new Error('CAPABILITIES_NOT_COMPOSED');
  return configuration.capabilities;
}

function requiredCapabilityReadiness(
  configuration: NodeControlHttpConfiguration,
): NodeControlCapabilityReadinessCoordinator {
  if (configuration.capabilityReadiness === undefined)
    throw new Error('CAPABILITY_READINESS_NOT_COMPOSED');
  return configuration.capabilityReadiness;
}

function requiredRuntimeCapabilityReadiness(
  configuration: NodeControlHttpConfiguration,
): RuntimeCapabilityReadinessService {
  if (configuration.runtimeCapabilityReadiness === undefined)
    throw new Error('RUNTIME_CAPABILITY_READINESS_NOT_COMPOSED');
  return configuration.runtimeCapabilityReadiness;
}

function requiredA2aExposure(
  configuration: NodeControlHttpConfiguration,
): NodeControlA2aExposureService {
  if (configuration.a2aExposure === undefined) throw new Error('A2A_EXPOSURE_NOT_COMPOSED');
  return configuration.a2aExposure;
}

function requiredRuntimeAgentCards(
  configuration: NodeControlHttpConfiguration,
): RuntimeAgentCardDeployment {
  if (configuration.runtimeAgentCards === undefined)
    throw new Error('RUNTIME_AGENT_CARD_NOT_COMPOSED');
  return configuration.runtimeAgentCards;
}

function requiredAgentCardValidator(
  configuration: NodeControlHttpConfiguration,
): A2aAgentCardValidator {
  if (configuration.agentCardValidator === undefined)
    throw new Error('AGENT_CARD_VALIDATOR_NOT_COMPOSED');
  return configuration.agentCardValidator;
}

function requiredTaskCapabilities(configuration: NodeControlHttpConfiguration): Readonly<{
  findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
}> {
  if (configuration.taskCapabilities === undefined)
    throw new Error('TASK_CAPABILITY_BINDING_NOT_COMPOSED');
  return configuration.taskCapabilities;
}

function requiredTaskSummaries(
  configuration: NodeControlHttpConfiguration,
): NonNullable<NodeControlHttpConfiguration['taskSummaries']> {
  if (configuration.taskSummaries === undefined)
    throw Object.assign(new Error('Runtime Task projection is unavailable.'), {
      code: 'TASK_PROJECTION_UNAVAILABLE',
      status: 503,
    });
  return configuration.taskSummaries;
}

function requiredTaskControl(
  configuration: NodeControlHttpConfiguration,
): NodeControlTaskControlService {
  if (configuration.taskControl === undefined)
    throw new NodeControlTaskControlError(
      'TASK_CONTROL_NOT_COMPOSED',
      'Task control is unavailable for this Node.',
      503,
    );
  return configuration.taskControl;
}

function requiredRuntimeGovernance(
  configuration: NodeControlHttpConfiguration,
): NodeControlRuntimeGovernanceService {
  if (configuration.runtimeGovernance === undefined)
    throw new NodeControlRuntimeGovernanceError(
      'RUNTIME_GOVERNANCE_NOT_COMPOSED',
      'Runtime governance is not composed.',
      503,
    );
  return configuration.runtimeGovernance;
}

function requiredEvidenceExport(
  configuration: NodeControlHttpConfiguration,
): NodeControlEvidenceExportService {
  if (configuration.evidenceExport === undefined)
    throw Object.assign(new Error('Evidence Export is unavailable.'), {
      code: 'EVIDENCE_EXPORT_UNAVAILABLE',
      status: 503,
    });
  return configuration.evidenceExport;
}

function requiredEvidenceOperations(
  configuration: NodeControlHttpConfiguration,
): NodeControlEvidenceOperationsService {
  if (configuration.evidenceOperations === undefined)
    throw Object.assign(new Error('Evidence operations are unavailable.'), {
      code: 'EVIDENCE_OPERATIONS_UNAVAILABLE',
      status: 503,
    });
  return configuration.evidenceOperations;
}

function requiredNodeEvents(configuration: NodeControlHttpConfiguration): NodeControlEventService {
  if (configuration.nodeEvents === undefined)
    throw Object.assign(new Error('Node Events are unavailable.'), {
      code: 'NODE_EVENTS_UNAVAILABLE',
      status: 503,
    });
  return configuration.nodeEvents;
}

interface ProblemInput {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly instance: string;
  readonly correlationId: string;
  readonly retryable: boolean;
}

function sendProblem(response: Response, problem: ProblemInput): void {
  response
    .status(problem.status)
    .type('application/problem+json')
    .json({
      type: `https://errors.sdar.io/node-control/${problem.code.toLowerCase()}`,
      ...problem,
    });
}

function correlationId(request: Request): string {
  const supplied = request.header('x-correlation-id')?.trim();
  return supplied === undefined || supplied === '' ? randomUUID() : supplied.slice(0, 128);
}
