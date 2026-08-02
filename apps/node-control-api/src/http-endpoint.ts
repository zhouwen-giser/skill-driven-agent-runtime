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
  type NodeControlA2aExposureService,
  type A2aAgentCardValidator,
  type RuntimeAgentCardDeployment,
  type NodeControlConfigurationService,
  type NodeControlFoundationService,
  type NodeControlLlmGovernanceService,
  type NodeControlMcpProviderBindingService,
  type NodeControlCapabilityService,
  type NodeControlSmppRegistryService,
  type NodeControlRuntimeGovernanceService,
  type NodeControlTelemetryExportService,
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
  type TelemetryExportConfiguration,
} from '../../../packages/node-control-domain/src/index.js';
import type {
  RuntimeCapabilityReadinessInput,
  RuntimeCapabilityReadinessService,
} from '../../../packages/runtime-control-application/src/index.js';
import { RevisionHintBroker } from './revision-hint-broker.js';
import type { NodeControlCapabilityReadinessCoordinator } from './capability-readiness-coordinator.js';

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
  readonly capabilityReadiness?: NodeControlCapabilityReadinessCoordinator;
  readonly runtimeCapabilityReadiness?: RuntimeCapabilityReadinessService;
  readonly a2aExposure?: NodeControlA2aExposureService;
  readonly runtimeAgentCards?: RuntimeAgentCardDeployment;
  readonly agentCardValidator?: A2aAgentCardValidator;
  readonly taskCapabilities?: Readonly<{
    findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  }>;
  readonly runtimeGovernance?: NodeControlRuntimeGovernanceService;
  readonly telemetryExport?: NodeControlTelemetryExportService;
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

  app.get('/api/v1/telemetry-export', async (_request, response, next) => {
    try {
      const current = await requiredTelemetryExport(configuration).current();
      response.status(200).set('etag', current.etag).json(current.configuration);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/telemetry-export/revisions', async (request, response, next) => {
    try {
      const created = await requiredTelemetryExport(configuration).create(
        TelemetryExportConfigurationSchema.parse(request.body) as TelemetryExportConfiguration,
        requiredHeader(request, 'idempotency-key'),
      );
      response.status(201).set('etag', created.etag).json(created.configuration);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/v1/telemetry-export/revisions/:revision/validate',
    async (request, response, next) => {
      try {
        const validated = await requiredTelemetryExport(configuration).validate(
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
    '/api/v1/telemetry-export/revisions/:revision/publish',
    async (request, response, next) => {
      try {
        response
          .status(202)
          .json(
            await requiredTelemetryExport(configuration).publish(
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

  app.get('/api/v1/telemetry-export/status', async (_request, response, next) => {
    try {
      response.status(200).json(await requiredTelemetryExport(configuration).status());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/telemetry-export/test', async (request, response, next) => {
    try {
      response
        .status(202)
        .json(
          await requiredTelemetryExport(configuration).test(
            requiredHeader(request, 'idempotency-key'),
            parseCommand(request.body),
          ),
        );
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

  app.use('/internal/v1', bearerAuthentication(configuration.runtimeServiceToken));

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
        retryable: error.status >= 500,
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
        retryable: error.status >= 500,
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
const TelemetryExportConfigurationSchema = z
  .object({
    exportId: z.string().trim().min(1).max(256),
    endpointRef: z.url(),
    sourceId: z.string().trim().min(1).max(256),
    nodeId: z.string().trim().min(1).max(256).optional(),
    credentialRef: z.string().trim().min(1).max(2_048),
    recordFamilies: z.array(z.string().trim().min(1).max(256)).min(1),
    batchPolicy: JsonObjectSchema.optional(),
    retryPolicy: JsonObjectSchema.optional(),
    outboxPolicy: JsonObjectSchema.optional(),
    tlsPolicyRef: z.string().trim().min(1).max(2_048).optional(),
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

function requiredTelemetryExport(
  configuration: NodeControlHttpConfiguration,
): NodeControlTelemetryExportService {
  if (configuration.telemetryExport === undefined)
    throw Object.assign(new Error('Telemetry Export is unavailable.'), {
      code: 'TELEMETRY_EXPORT_UNAVAILABLE',
      status: 503,
    });
  return configuration.telemetryExport;
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
