import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
  MAX_SKILL_PACKAGE_FILE_BYTES,
  MAX_SKILL_PACKAGE_TOTAL_BYTES,
  type SkillPackageDocument,
  type SkillPackageFileDeclaration,
  type SkillPackageManifest,
  type SkillPackageReadResult,
  type SkillPackageUsageFileKind,
} from '../../domain/src/index.js';
import { SkillPackageError, type SkillPackageSourceReader } from '../../application/src/index.js';

const REQUIRED_USAGE_FILES = ['normative', 'adaptive', 'modes', 'evidence'] as const;
const OPTIONAL_USAGE_FILES = ['composition'] as const;
const decoder = new TextDecoder('utf-8', { fatal: true });

export class NodeSkillPackageReader implements SkillPackageSourceReader {
  async read(packageRoot: string): Promise<SkillPackageReadResult> {
    const root = await this.#requireRoot(packageRoot);
    const manifestFile = await this.#readBoundedFile(root, 'manifest.json');
    const manifest = parseJson(manifestFile.text, 'manifest.json') as SkillPackageManifest;
    const declarations = declarationsFrom(manifest);
    const markdown = await this.#readBoundedFile(root, 'SKILL.md');
    verifyChecksum(markdown.checksum, manifest.skillMarkdownSha256, 'SKILL.md');

    const parts = new Map<SkillPackageUsageFileKind, unknown>();
    const fileChecksums: Record<string, string> = {
      'manifest.json': manifestFile.checksum,
      'SKILL.md': markdown.checksum,
    };
    let totalBytes = manifestFile.bytes + markdown.bytes;
    for (const [kind, declaration] of declarations) {
      const file = await this.#readBoundedFile(root, declaration.path);
      totalBytes += file.bytes;
      if (totalBytes > MAX_SKILL_PACKAGE_TOTAL_BYTES)
        throw new SkillPackageError(
          'SKILL_PACKAGE_TOTAL_TOO_LARGE',
          `Skill Package exceeds ${String(MAX_SKILL_PACKAGE_TOTAL_BYTES)} bytes.`,
        );
      verifyChecksum(file.checksum, declaration.sha256, declaration.path);
      fileChecksums[declaration.path] = file.checksum;
      parts.set(kind, parseJson(file.text, declaration.path));
    }
    const document = Object.freeze({
      manifest,
      skillMarkdown: markdown.text,
      normative: requiredPart(parts, 'normative'),
      adaptive: requiredPart(parts, 'adaptive'),
      modes: requiredPart(parts, 'modes'),
      ...(parts.has('composition') ? { composition: requiredPart(parts, 'composition') } : {}),
      evidence: requiredPart(parts, 'evidence'),
    }) as SkillPackageDocument;
    const sortedChecksums = Object.fromEntries(
      Object.entries(fileChecksums).sort(([left], [right]) => left.localeCompare(right)),
    );
    return Object.freeze({
      packageRoot: root,
      document,
      packageChecksum: digest(
        Object.entries(sortedChecksums)
          .map(([name, checksum]) => `${name}\u0000${checksum}`)
          .join('\n'),
      ),
      fileChecksums: Object.freeze(sortedChecksums),
      totalBytes,
    });
  }

  async #requireRoot(packageRoot: string): Promise<string> {
    if (typeof packageRoot !== 'string' || packageRoot.trim() === '')
      throw new SkillPackageError('SKILL_PACKAGE_PATH_INVALID', 'Package root is required.');
    let root: string;
    try {
      root = await realpath(packageRoot);
      const metadata = await lstat(root);
      if (!metadata.isDirectory()) throw new Error('not-directory');
    } catch {
      throw new SkillPackageError(
        'SKILL_PACKAGE_PATH_INVALID',
        'Package root must be a readable directory.',
      );
    }
    return root;
  }

  async #readBoundedFile(
    root: string,
    relativePath: string,
  ): Promise<Readonly<{ text: string; checksum: string; bytes: number }>> {
    const normalized = requireRelativeJsonOrMarkdownPath(relativePath);
    const candidate = path.resolve(root, normalized);
    if (!withinRoot(root, candidate))
      throw new SkillPackageError('SKILL_PACKAGE_PATH_INVALID', 'Package file escapes its root.');
    let resolved: string;
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new SkillPackageError(
          'SKILL_PACKAGE_FILE_INVALID',
          'Package entries must be regular non-symlink files.',
        );
      if (metadata.size > MAX_SKILL_PACKAGE_FILE_BYTES)
        throw new SkillPackageError(
          'SKILL_PACKAGE_FILE_TOO_LARGE',
          `Package file ${normalized} exceeds ${String(MAX_SKILL_PACKAGE_FILE_BYTES)} bytes.`,
        );
      resolved = await realpath(candidate);
      if (!withinRoot(root, resolved))
        throw new SkillPackageError('SKILL_PACKAGE_PATH_INVALID', 'Package file escapes its root.');
    } catch (error: unknown) {
      if (error instanceof SkillPackageError) throw error;
      throw new SkillPackageError(
        'SKILL_PACKAGE_FILE_INVALID',
        `Package file ${normalized} is missing or unreadable.`,
      );
    }
    const content = await readFile(resolved);
    if (content.byteLength > MAX_SKILL_PACKAGE_FILE_BYTES)
      throw new SkillPackageError(
        'SKILL_PACKAGE_FILE_TOO_LARGE',
        `Package file ${normalized} exceeds ${String(MAX_SKILL_PACKAGE_FILE_BYTES)} bytes.`,
      );
    let text: string;
    try {
      text = decoder.decode(content);
    } catch {
      throw new SkillPackageError(
        'SKILL_PACKAGE_UTF8_INVALID',
        `Package file ${normalized} is not valid UTF-8.`,
      );
    }
    return Object.freeze({ text, checksum: digest(content), bytes: content.byteLength });
  }
}

function declarationsFrom(
  manifest: SkillPackageManifest,
): readonly (readonly [SkillPackageUsageFileKind, SkillPackageFileDeclaration])[] {
  if (!isRecord(manifest) || !isRecord(manifest.files))
    throw new SkillPackageError(
      'SKILL_PACKAGE_JSON_INVALID',
      'manifest.json must declare a files object.',
    );
  const allowed = new Set<string>([...REQUIRED_USAGE_FILES, ...OPTIONAL_USAGE_FILES]);
  if (Object.keys(manifest.files).some((key) => !allowed.has(key)))
    throw new SkillPackageError(
      'SKILL_PACKAGE_JSON_INVALID',
      'manifest.json declares an unsupported package file kind.',
    );
  const result: (readonly [SkillPackageUsageFileKind, SkillPackageFileDeclaration])[] = [];
  for (const kind of REQUIRED_USAGE_FILES)
    result.push([kind, requireDeclaration(manifest.files[kind], kind)]);
  const composition = manifest.files.composition;
  if (composition !== undefined)
    result.push(['composition', requireDeclaration(composition, 'composition')]);
  const paths = result.map(([, declaration]) => declaration.path);
  if (new Set(paths).size !== paths.length)
    throw new SkillPackageError(
      'SKILL_PACKAGE_PATH_INVALID',
      'Package file declarations must use unique paths.',
    );
  return result;
}

function requireDeclaration(value: unknown, kind: string): SkillPackageFileDeclaration {
  if (
    !isRecord(value) ||
    typeof value['path'] !== 'string' ||
    typeof value['sha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value['sha256'])
  )
    throw new SkillPackageError(
      'SKILL_PACKAGE_JSON_INVALID',
      `manifest.json ${kind} declaration is invalid.`,
    );
  return { path: value['path'], sha256: value['sha256'] };
}

function requireRelativeJsonOrMarkdownPath(value: string): string {
  if (
    value === '' ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    !/\.(?:json|md)$/iu.test(value)
  )
    throw new SkillPackageError(
      'SKILL_PACKAGE_PATH_INVALID',
      'Package paths must be normalized relative JSON or Markdown paths.',
    );
  return value;
}

function withinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SkillPackageError(
      'SKILL_PACKAGE_JSON_INVALID',
      `Package file ${file} is not valid JSON.`,
    );
  }
}

function verifyChecksum(actual: string, expected: unknown, file: string): void {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected) || actual !== expected)
    throw new SkillPackageError(
      'SKILL_PACKAGE_CHECKSUM_MISMATCH',
      `Package file ${file} checksum does not match its manifest declaration.`,
    );
}

function requiredPart(
  parts: ReadonlyMap<SkillPackageUsageFileKind, unknown>,
  kind: SkillPackageUsageFileKind,
): unknown {
  const value = parts.get(kind);
  if (value === undefined)
    throw new SkillPackageError('SKILL_PACKAGE_JSON_INVALID', `Package part ${kind} is missing.`);
  return value;
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
