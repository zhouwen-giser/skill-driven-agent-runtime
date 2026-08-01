import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Pool } from 'pg';

import { NodeControlFoundationService } from '../../../packages/node-control-application/src/index.js';
import { PostgresNodeControlFoundationRepository } from '../../../packages/node-control-persistence-postgres/src/index.js';
import type { NodeControlApiEnvironment } from './environment.js';
import { createNodeControlHttpApp } from './http-endpoint.js';

export interface NodeControlApiRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startNodeControlApi(
  environment: NodeControlApiEnvironment,
): Promise<NodeControlApiRuntime> {
  const pool = new Pool({ connectionString: environment.SDAR_CONTROL_DATABASE_URL, max: 10 });
  const repository = new PostgresNodeControlFoundationRepository(pool);
  const service = new NodeControlFoundationService({
    repository,
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  try {
    await service.migrate();
    await service.bootstrapNodeProfile({
      nodeId: environment.SDAR_CONTROL_NODE_ID,
      nodeType: environment.SDAR_CONTROL_NODE_TYPE,
      displayName: environment.SDAR_CONTROL_NODE_DISPLAY_NAME,
      environment: environment.SDAR_CONTROL_ENVIRONMENT,
      runtimeEndpointRef: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
    });
    const app = createNodeControlHttpApp(service, {
      bearerToken: environment.SDAR_CONTROL_API_TOKEN,
      nodeControlApiUrl: environment.SDAR_CONTROL_PUBLIC_URL,
      nodeEventsUrl: environment.SDAR_CONTROL_NODE_EVENTS_URL,
      a2aAgentCardUrl: environment.SDAR_CONTROL_A2A_AGENT_CARD_URL,
    });
    const server = await listen(
      app,
      environment.SDAR_CONTROL_API_HOST,
      environment.SDAR_CONTROL_API_PORT,
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('NODE_CONTROL_ADDRESS_INVALID');
    const baseUrl = `http://${normalizeHost(environment.SDAR_CONTROL_API_HOST)}:${String(address.port)}`;
    return {
      baseUrl,
      async close() {
        await closeServer(server);
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

function listen(
  app: ReturnType<typeof createNodeControlHttpApp>,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
    server.once('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function normalizeHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
