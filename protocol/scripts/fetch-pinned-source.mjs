/* global fetch */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const sourceCommit = '26897cc322f356487da89113451bd16b520b9288';
const expectedBlob = 'cc44564e33305dbc07e820cdd0a97648f3852019';
const expectedSha256 = '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708';
const expectedBytes = 180_695;
const url = `https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/${sourceCommit}/schema/draft/schema.json`;
const response = await fetch(url, { redirect: 'error' });

if (!response.ok) {
  throw new Error(`FROZEN_MCP_SOURCE_FETCH_FAILED: HTTP ${String(response.status)}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
const gitBlob = createHash('sha1')
  .update(Buffer.from(`blob ${String(bytes.length)}\0`))
  .update(bytes)
  .digest('hex');

if (bytes.length !== expectedBytes || sha256 !== expectedSha256 || gitBlob !== expectedBlob) {
  throw new Error(
    `FROZEN_MCP_SOURCE_MISMATCH: bytes=${String(bytes.length)} sha256=${sha256} blob=${gitBlob}`,
  );
}

const target = resolve(process.cwd(), 'protocol', 'source', 'mcp-2026-07-28.schema.json');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
process.stdout.write(`${target}\n${sha256}\n`);
