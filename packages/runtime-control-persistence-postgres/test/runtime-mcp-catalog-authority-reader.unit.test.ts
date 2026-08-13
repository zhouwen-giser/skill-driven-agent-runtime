import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRuntimeMcpCatalogAuthorityReader } from '../src/index.js';

describe('PostgresRuntimeMcpCatalogAuthorityReader', () => {
  it('loads one narrow authority through three reads in one read-only transaction', async () => {
    const query = vi.fn((statement: string) => {
      if (statement.startsWith('BEGIN')) return Promise.resolve({ rows: [] });
      if (statement.includes('SELECT endpoint,status,tool_revision,updated_at'))
        return Promise.resolve({
          rows: [
            {
              endpoint: 'https://provider.example.test/mcp',
              status: 'enabled',
              tool_revision: 11,
              updated_at: new Date('2026-08-10T11:59:30.000Z'),
            },
          ],
        });
      if (statement.includes('JOIN mcp_protocol_snapshot snapshot'))
        return Promise.resolve({
          rows: [
            {
              protocol_mode: 'frozen_v1',
              protocol_version: '2026-07-28',
              server_info_json: { name: 'Home Lab Light', version: '2.0.0' },
              tool_revision: 11,
              valid_until: new Date('2026-08-10T12:05:00.000Z'),
            },
          ],
        });
      if (statement.includes('FROM mcp_tool tool'))
        return Promise.resolve({
          rows: [
            {
              server_id: 'home-lab-light-mcp',
              tool_name: 'light_get_state',
              title: 'Read light state',
              description: 'Read the current light state.',
              input_schema_json: { type: 'object' },
              output_schema_json: { type: 'object' },
              protocol_mode: 'frozen_v1',
              execution_semantics_json: {
                effect: 'read_only',
                execution: 'synchronous',
                cancellation: 'unsupported',
                idempotency: 'server_managed',
                replay: 'allowed',
                source: 'admin_override',
              },
              declared_execution_semantics_json: null,
              task_execution_json: {
                profileVersion: '1.0',
                taskBehavior: 'synchronous_only',
                availability: 'not_supported',
                supportsScheduling: false,
                supportsMaxElapsed: false,
                supportsObservations: false,
                supportsInputRequired: false,
                idempotency: 'none',
              },
              discovered_at: new Date('2026-08-10T11:59:30.000Z'),
            },
          ],
        });
      if (statement === 'COMMIT') return Promise.resolve({ rows: [] });
      return Promise.reject(new Error(`UNEXPECTED_SQL:${statement}`));
    });
    const release = vi.fn();
    const poolQuery = vi.fn();
    const pool = {
      connect: vi.fn(() => Promise.resolve({ query, release })),
      query: poolQuery,
    } as unknown as Pool;
    const reader = new PostgresRuntimeMcpCatalogAuthorityReader(pool);

    const authority = await reader.loadCurrentAuthority('home-lab-light-mcp');
    expect(authority).toMatchObject({
      endpoint: 'https://provider.example.test/mcp',
      status: 'enabled',
      serverUpdatedAt: '2026-08-10T11:59:30.000Z',
      snapshotValidUntil: '2026-08-10T12:05:00.000Z',
      toolRevision: 11,
      protocolMode: 'frozen_v1',
      snapshotToolRevision: 11,
      catalogRevision: '2.0.0:11',
      catalogChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      discoveredCatalogChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      operationCount: 1,
      toolNames: ['light_get_state'],
    });
    expect(authority?.catalogChecksum).not.toBe(authority?.discoveredCatalogChecksum);

    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(
      statements.slice(1, 4).every((statement) => statement.trimStart().startsWith('SELECT')),
    ).toBe(true);
    expect(statements[3]).toContain('ORDER BY tool.tool_name');
    expect(statements[4]).toBe('COMMIT');
    expect(poolQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the same client when a snapshot read fails', async () => {
    const query = vi.fn((statement: string) => {
      if (statement.startsWith('BEGIN')) return Promise.resolve({ rows: [] });
      if (statement.includes('SELECT endpoint,status,tool_revision,updated_at'))
        return Promise.resolve({ rows: [] });
      if (statement.includes('JOIN mcp_protocol_snapshot snapshot'))
        return Promise.reject(new Error('SNAPSHOT_READ_FAILED'));
      if (statement === 'ROLLBACK') return Promise.resolve({ rows: [] });
      return Promise.reject(new Error(`UNEXPECTED_SQL:${statement}`));
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(() => Promise.resolve({ query, release })),
    } as unknown as Pool;
    const reader = new PostgresRuntimeMcpCatalogAuthorityReader(pool);

    await expect(reader.loadCurrentAuthority('home-lab-light-mcp')).rejects.toThrow(
      'SNAPSHOT_READ_FAILED',
    );

    expect(query.mock.calls.map(([statement]) => statement).at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('contains no credential query, Runtime writer dependency, or mutation surface', async () => {
    const source = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../src/runtime-mcp-catalog-authority-reader.ts',
      ),
      'utf8',
    );
    const writerPackage = ['persistence', 'postgres'].join('-');
    const writerClass = ['Postgres', 'McpRegistry', 'Repository'].join('');
    const credentialColumn = ['encrypted', 'credential'].join('_');

    expect(source).not.toContain(writerPackage);
    expect(source).not.toContain(writerClass);
    expect(source).not.toContain(credentialColumn);
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);

    const reader = new PostgresRuntimeMcpCatalogAuthorityReader({} as Pool);
    for (const mutation of [
      'saveServerAndReplaceTools',
      'deleteServer',
      'saveInvocation',
      'saveManagementOperation',
      'updateToolEnhancement',
      'updateToolExecutionSemantics',
      'saveProtocolSnapshot',
    ]) {
      expect(reader).not.toHaveProperty(mutation);
    }
  });
});
