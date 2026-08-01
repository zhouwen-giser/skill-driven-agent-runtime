import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import {
  NodeControlApplicationError,
  type NodeControlFoundationService,
} from '../../../packages/node-control-application/src/index.js';
import { NodeControlDomainError } from '../../../packages/node-control-domain/src/index.js';

export interface NodeControlHttpConfiguration {
  readonly bearerToken: string;
  readonly nodeControlApiUrl: string;
  readonly nodeEventsUrl: string;
  readonly a2aAgentCardUrl: string;
}

export function createNodeControlHttpApp(
  service: NodeControlFoundationService,
  configuration: NodeControlHttpConfiguration,
): Express {
  const app = express();
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
