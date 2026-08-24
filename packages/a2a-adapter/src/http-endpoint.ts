import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';

import { AgentCard, type AgentSkill } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import {
  DefaultRequestHandler,
  type AgentExecutor,
  type ExecutionEventBusManager,
  type TaskStore,
} from '@a2a-js/sdk/server';
import { UserBuilder, agentCardHandler, restHandler } from '@a2a-js/sdk/server/express';
import express from 'express';

import type {
  EnabledSkillCapabilityProvider,
  GovernedControlPrincipalResolver,
} from '../../application/src/index.js';
import type { PublicCapabilityCardSnapshot } from '../../domain/src/index.js';
import type { A2AArtifactProjection } from '../../domain/src/index.js';
import { createGovernedControlA2AAuthentication } from './authenticated-confirm-user.js';
import { A2AAgentCardBuilder } from './capability-card-projection.js';
import { buildAgentCard } from './compatibility.js';
import { ReplaySafeExecutionEventBusManager } from './replay-safe-event-bus-manager.js';

export interface A2AHttpEndpointOptions {
  readonly executor: AgentExecutor;
  readonly taskStore: TaskStore;
  readonly eventBusManager?: ExecutionEventBusManager;
  readonly skills?: readonly Readonly<Pick<AgentSkill, 'id' | 'name' | 'description' | 'tags'>>[];
  readonly skillProvider?: EnabledSkillCapabilityProvider;
  readonly capabilityCardProvider?: Readonly<{
    findActive(): Promise<PublicCapabilityCardSnapshot | undefined>;
  }>;
  readonly agentCardProvider?: Readonly<{
    findActive(): Promise<AgentCard | undefined>;
  }>;
  readonly artifactProjectionProvider?: Readonly<{
    projectPublic(): Promise<A2AArtifactProjection>;
  }>;
  readonly confirmationPrincipalResolver?: GovernedControlPrincipalResolver;
  readonly host?: string;
  readonly port?: number;
}

export interface A2AHttpEndpointHandle {
  readonly baseUrl: string;
  readonly client: Client;
  close(): Promise<void>;
}

export async function startA2AHttpEndpoint(
  options: A2AHttpEndpointOptions,
): Promise<A2AHttpEndpointHandle> {
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  const host = options.host ?? '127.0.0.1';
  server.listen(options.port ?? 0, host);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('A2A_ENDPOINT_ADDRESS_UNAVAILABLE');
  }
  const baseUrl = `http://${host}:${String(address.port)}`;
  const loadSkills = async () => options.skillProvider?.listEnabled() ?? options.skills ?? [];
  const cardBuilder = new A2AAgentCardBuilder();
  const loadCard = async () => {
    const managedCard = await options.agentCardProvider?.findActive();
    if (managedCard !== undefined) return managedCard;
    const capabilityProvider = options.capabilityCardProvider;
    const base =
      capabilityProvider === undefined
        ? buildAgentCard(await loadSkills(), `${baseUrl}/a2a`)
        : await (async () => {
            const snapshot = await capabilityProvider.findActive();
            if (snapshot === undefined)
              throw new Error('A2A_CAPABILITY_CARD_SNAPSHOT_NOT_AVAILABLE');
            return cardBuilder.buildFromSnapshot(snapshot, `${baseUrl}/a2a`);
          })();
    if (options.artifactProjectionProvider === undefined) return base;
    const projection = await options.artifactProjectionProvider.projectPublic();
    const json = AgentCard.toJSON(base) as Record<string, unknown>;
    const capabilities =
      typeof json['capabilities'] === 'object' && json['capabilities'] !== null
        ? (json['capabilities'] as Record<string, unknown>)
        : {};
    const rawExtensions: unknown = capabilities['extensions'];
    const extensions: readonly unknown[] = Array.isArray(rawExtensions)
      ? (rawExtensions as unknown[])
      : [];
    return AgentCard.fromJSON({
      ...json,
      capabilities: {
        ...capabilities,
        extensions: [
          ...extensions,
          {
            uri: 'urn:sdar:artifact-evidence:v1.1',
            description:
              'Safe evidence that planning may use validated, policy-governed experience.',
            required: false,
            params: projection,
          },
        ],
      },
    });
  };
  const card = await loadCard();
  const handler = new DefaultRequestHandler(
    card,
    options.taskStore,
    options.executor,
    options.eventBusManager ?? new ReplaySafeExecutionEventBusManager(),
  );
  const confirmationAuthentication =
    options.confirmationPrincipalResolver === undefined
      ? undefined
      : createGovernedControlA2AAuthentication(options.confirmationPrincipalResolver);
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: loadCard,
      cache: { maxAge: 0 },
    }),
  );
  app.use('/a2a', (request, response, next) => {
    const contentType = request.headers['content-type']?.toLowerCase() ?? '';
    const prefersA2aJson = contentType.startsWith('application/a2a+json');
    if (
      (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') &&
      !contentType.startsWith('application/json') &&
      !contentType.startsWith('application/a2a+json')
    ) {
      response.status(415).json({
        error: {
          code: 415,
          status: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type is not supported.',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'ContentTypeNotSupportedError',
              domain: 'a2a-protocol.org',
              metadata: {},
            },
          ],
        },
      });
      return;
    }
    const setHeader = response.setHeader.bind(response);
    response.setHeader = (name, value) =>
      setHeader(
        name,
        name.toLowerCase() === 'content-type' &&
          String(value).startsWith('application/a2a+json') &&
          !prefersA2aJson
          ? 'application/json; charset=utf-8'
          : value,
      );
    next();
  });
  if (confirmationAuthentication !== undefined)
    app.use('/a2a', confirmationAuthentication.authenticateBeforeProtocol);
  app.use(
    '/a2a',
    restHandler({
      requestHandler: handler,
      userBuilder: confirmationAuthentication?.userBuilder ?? UserBuilder.noAuthentication,
    }),
  );
  const client = await new ClientFactory().createFromUrl(baseUrl);
  return { baseUrl, client, close: () => closeServer(server) };
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}
