import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PoolClient, PoolConfig } from 'pg';
import { z } from 'zod';

const InstallContractSchema = z.object({
  schema: z.literal('ugv_sdar'),
  entries: z
    .array(
      z.object({
        family: z.string(),
        file: z.string(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .min(1),
});

const ColumnSchema = z.object({
  schema: z.string(),
  name: z.string(),
  column: z.string(),
  type: z.string(),
  required: z.boolean(),
});
const StructureSchema = z.object({
  columns: z.array(ColumnSchema).min(1),
  constraints: z.array(
    z.object({ schema: z.string(), name: z.string(), conname: z.string(), definition: z.string() }),
  ),
  indexes: z.array(
    z.object({ schema: z.string(), name: z.string(), indexname: z.string(), indexdef: z.string() }),
  ),
  triggers: z.array(
    z.object({ schema: z.string(), name: z.string(), tgname: z.string(), definition: z.string() }),
  ),
  functions: z.array(
    z.object({ schema: z.string(), name: z.string(), args: z.string(), definition: z.string() }),
  ),
  views: z.array(z.object({ schema: z.string(), name: z.string(), definition: z.string() })),
});

export class GowmStorageContractError extends Error {
  readonly code = 'GOWM_STORAGE_CONTRACT_MISMATCH';
  constructor(readonly mismatches: readonly string[]) {
    super('GOWM_STORAGE_CONTRACT_MISMATCH');
    this.name = 'GowmStorageContractError';
  }
}

/** pg sends options when establishing every physical connection, including replacements. */
export function gowmSharedPoolConfiguration(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.has('options'))
    throw new GowmStorageContractError(['connection options']);
  return {
    connectionString: databaseUrl,
    max: 10,
    options: '-c search_path=ugv_sdar,public,pg_catalog',
  };
}

/** A single read-only transaction; no migration, extension creation, or repair. */
export async function verifyGowmStorageContract(
  client: PoolClient,
  directory: string,
): Promise<void> {
  const install = InstallContractSchema.parse(
    JSON.parse(await readFile(join(directory, 'install-contract.json'), 'utf8')) as unknown,
  );
  const expected = StructureSchema.parse(
    JSON.parse(await readFile(join(directory, 'expected-consumption.json'), 'utf8')) as unknown,
  );
  await client.query('BEGIN READ ONLY');
  try {
    const marker = await client.query<{ installed: string | null }>(
      "SELECT to_regclass('ugv_sdar.gowm_install_history')::text AS installed",
    );
    if (marker.rows[0]?.installed == null)
      throw new GowmStorageContractError(['ugv_sdar.gowm_install_history']);
    const history = await client.query<{ family: string; file: string; checksum: string }>(
      'SELECT family,file,checksum FROM ugv_sdar.gowm_install_history',
    );
    const checksums = new Map(history.rows.map((r) => [`${r.family}/${r.file}`, r.checksum]));
    const mismatches = install.entries
      .filter((e) => checksums.get(`${e.family}/${e.file}`) !== e.checksum)
      .map((e) => `history:${e.family}/${e.file}`);
    // Match GOWM's catalog deparser context. This is transaction-local: the
    // pooled connection resumes its fixed business search_path on COMMIT/ROLLBACK.
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const columns = await client.query<z.infer<typeof ColumnSchema>>(
      `SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,
              format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
      [['ugv_sdar', 'ugv_smpp', 'gowm_device', 'gowm_task', 'gowm_business_v1']],
    );
    const actualColumns = new Map(
      columns.rows.map((c) => [`${c.schema}.${c.name}.${c.column}`, c]),
    );
    for (const column of expected.columns) {
      const key = `${column.schema}.${column.name}.${column.column}`;
      const actual = actualColumns.get(key);
      if (actual?.type !== column.type || actual.required !== column.required)
        mismatches.push(`column:${key}`);
    }
    const constraints = await client.query<{
      schema: string;
      name: string;
      conname: string;
      definition: string;
    }>(
      `SELECT n.nspname AS schema,c.relname AS name,k.conname,pg_get_constraintdef(k.oid) AS definition
         FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY($1::text[])`,
      [['ugv_sdar', 'ugv_smpp', 'gowm_device', 'gowm_task']],
    );
    const indexes = await client.query<{
      schema: string;
      name: string;
      indexname: string;
      indexdef: string;
    }>(
      'SELECT schemaname AS schema,tablename AS name,indexname,indexdef FROM pg_indexes WHERE schemaname=ANY($1::text[])',
      [['ugv_sdar', 'ugv_smpp', 'gowm_device', 'gowm_task']],
    );
    const triggers = await client.query<{
      schema: string;
      name: string;
      tgname: string;
      definition: string;
      enabled: string;
    }>(
      `SELECT n.nspname AS schema,c.relname AS name,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled
         FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY($1::text[]) AND NOT t.tgisinternal`,
      [['ugv_sdar', 'ugv_smpp', 'gowm_device', 'gowm_task']],
    );
    for (const e of expected.constraints) {
      if (
        !constraints.rows.some(
          (a) =>
            a.schema === e.schema &&
            a.name === e.name &&
            a.conname === e.conname &&
            a.definition === e.definition,
        )
      )
        mismatches.push(`constraint:${e.schema}.${e.name}.${e.conname}`);
    }
    for (const e of expected.indexes) {
      if (
        !indexes.rows.some(
          (a) =>
            a.schema === e.schema &&
            a.name === e.name &&
            a.indexname === e.indexname &&
            a.indexdef === e.indexdef,
        )
      )
        mismatches.push(`index:${e.schema}.${e.indexname}`);
    }
    for (const e of expected.triggers) {
      if (
        !triggers.rows.some(
          (a) =>
            a.schema === e.schema &&
            a.name === e.name &&
            a.tgname === e.tgname &&
            a.definition === e.definition &&
            ['O', 'A'].includes(a.enabled),
        )
      )
        mismatches.push(`trigger:${e.schema}.${e.name}.${e.tgname}`);
    }
    const functions = await client.query<{
      schema: string;
      name: string;
      args: string;
      definition: string;
    }>(
      `SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=ANY($1::text[])`,
      [['ugv_sdar', 'gowm_device', 'gowm_task']],
    );
    for (const expectedFunction of expected.functions) {
      if (
        !functions.rows.some(
          (actual) =>
            actual.schema === expectedFunction.schema &&
            actual.name === expectedFunction.name &&
            actual.args === expectedFunction.args &&
            actual.definition === expectedFunction.definition,
        )
      )
        mismatches.push(`function:${expectedFunction.schema}.${expectedFunction.name}`);
    }
    const views = await client.query<{ schema: string; name: string; definition: string }>(
      "SELECT schemaname AS schema,viewname AS name,definition FROM pg_views WHERE schemaname='gowm_business_v1'",
    );
    for (const expectedView of expected.views) {
      if (
        !views.rows.some(
          (actual) =>
            actual.schema === expectedView.schema &&
            actual.name === expectedView.name &&
            actual.definition === expectedView.definition,
        )
      )
        mismatches.push(`view:${expectedView.schema}.${expectedView.name}`);
    }
    if (mismatches.length > 0) throw new GowmStorageContractError(mismatches);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}
