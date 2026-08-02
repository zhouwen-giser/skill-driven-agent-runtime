import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import {
  NodeControlApplicationError,
  NodeControlConfigurationError,
  NodeControlLlmGovernanceError,
  NodeControlMcpBindingError,
  NodeControlCapabilityError,
  NodeControlSmppRegistryError,
  type NodeControlConfigurationService,
  type NodeControlFoundationService,
  type NodeControlLlmGovernanceService,
  type NodeControlMcpProviderBindingService,
  type NodeControlCapabilityService,
  type NodeControlSmppRegistryService,
} from '../../../packages/node-control-application/src/index.js';
import {
  NodeControlDomainError,
  smppSourceEtag,
} from '../../../packages/node-control-domain/src/index.js';
import { RevisionHintBroker } from './revision-hint-broker.js';

export interface NodeControlHttpConfiguration {
  readonly bearerToken: string;
  readonly runtimeServiceToken: string;
  readonly nodeControlApiUrl: string;
  readonly nodeEventsUrl: string;
  readonly a2aAgentCardUrl: string;
  readonly llmGovernance?: NodeControlLlmGovernanceService;
  readonly smppRegistry?: NodeControlSmppRegistryService;
  readonly mcpBindings?: NodeControlMcpProviderBindingService;
  readonly capabilities?: NodeControlCapabilityService;
}

export function createNodeControlHttpApp(
  service: NodeControlFoundationService,
  configurations: NodeControlConfigurationService,
  configuration: NodeControlHttpConfiguration,
): Express {
  const app = express();
  const hints = new RevisionHintBroker();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb', strict: true }));

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
          telemetryExport: '1.0.0',
        },
        features: ['node-profile', 'health', 'management-operation', 'audit'],
      });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v1', bearerAuthentication(configuration.bearerToken));

  app.get('/api/v1/node', async (_request, response, next) => {
    try {
      response.status(200).json(await service.getNodeProfile());
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
              ? await bindings.refresh(
                  request.params.bindingId,
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
        await requiredCapabilities(configuration).createDraft({
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
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/api/v1/node-capabilities/:capabilityId/versions/:version',
    async (request, response, next) => {
      try {
        response
          .status(200)
          .json(
            await requiredCapabilities(configuration).get(
              request.params.capabilityId,
              positiveRevision(request.params.version),
            ),
          );
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
          await requiredCapabilities(configuration).addImplementation({
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
          }),
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

  app.use('/internal/v1', bearerAuthentication(configuration.runtimeServiceToken));

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
const JsonObjectSchema = z.record(z.string(), z.json());
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

function etag(revision: {
  readonly configurationId: string;
  readonly revision: number;
  readonly status: string;
  readonly checksum: string;
}): string {
  return `"configuration:${revision.configurationId}:${String(revision.revision)}:${revision.status}:${revision.checksum}"`;
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

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 100;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 100;
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
