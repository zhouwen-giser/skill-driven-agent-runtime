import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';

import { type AgentSkill } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import { DefaultRequestHandler, type AgentExecutor, type TaskStore } from '@a2a-js/sdk/server';
import { UserBuilder, agentCardHandler, restHandler } from '@a2a-js/sdk/server/express';
import express from 'express';

import type { EnabledSkillCapabilityProvider } from '../../application/src/index.js';
import { buildAgentCard } from './compatibility.js';

export interface A2AHttpEndpointOptions {
  readonly executor: AgentExecutor;
  readonly taskStore: TaskStore;
  readonly skills?: readonly Readonly<Pick<AgentSkill, 'id' | 'name' | 'description' | 'tags'>>[];
  readonly skillProvider?: EnabledSkillCapabilityProvider;
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
  const card = buildAgentCard(await loadSkills(), `${baseUrl}/a2a`);
  const handler = new DefaultRequestHandler(card, options.taskStore, options.executor);
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: async () => buildAgentCard(await loadSkills(), `${baseUrl}/a2a`),
      cache: { maxAge: 0 },
    }),
  );
  app.use('/a2a', (request, response, next) => {
    const contentType = request.headers['content-type']?.toLowerCase() ?? '';
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
        name.toLowerCase() === 'content-type' && String(value).startsWith('application/a2a+json')
          ? 'application/json; charset=utf-8'
          : value,
      );
    next();
  });
  app.use(
    '/a2a',
    restHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
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
