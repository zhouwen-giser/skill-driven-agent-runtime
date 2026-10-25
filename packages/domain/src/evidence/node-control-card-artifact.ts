import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { ArtifactRef, EvidenceJsonValue } from './canonical-evidence.js';
import { canonicalizeSourceArtifactJson, SourceArtifactRefError } from './source-artifact-ref.js';

const prefix = 'artifact://node-control/v1/agent-card/';
const invalid = () =>
  new SourceArtifactRefError(
    'SOURCE_ARTIFACT_ADDRESS_INVALID',
    'Invalid immutable Node Control card ArtifactRef.',
  );

/** Full card bytes remain at the existing authenticated Agent Card revision API and owner table. */
export function buildNodeControlCardArtifact(
  nodeId: string,
  revision: number,
  card: EvidenceJsonValue,
) {
  if (
    !nodeId.trim() ||
    nodeId.length > 512 ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    card === null ||
    typeof card !== 'object' ||
    Array.isArray(card)
  )
    throw invalid();
  const canonicalJson = canonicalizeSourceArtifactJson(card);
  const canonicalBytes = Buffer.from(canonicalJson, 'utf8');
  const artifactRef: ArtifactRef = Object.freeze({
    artifactId: `${nodeId}:${String(revision)}`,
    version: revision,
    uri: `${prefix}${encodeURIComponent(nodeId)}/${String(revision)}/card`,
    sha256: `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}` as const,
    mediaType: 'application/json',
    byteSize: canonicalBytes.byteLength,
  });
  return { artifactRef, canonicalJson, canonicalBytes } as const;
}

export function nodeControlCardArtifactAddress(ref: ArtifactRef) {
  if (typeof ref.uri !== 'string' || ref.uri.length > 4096 || !ref.uri.startsWith(prefix))
    throw invalid();
  const parts = ref.uri.slice(prefix.length).split('/');
  if (
    parts.length !== 3 ||
    parts[2] !== 'card' ||
    !parts[0] ||
    !/^[1-9][0-9]*$/u.test(parts[1] ?? '')
  )
    throw invalid();
  let nodeId: string;
  try {
    nodeId = decodeURIComponent(parts[0]);
  } catch {
    throw invalid();
  }
  const revision = Number(parts[1]);
  if (
    encodeURIComponent(nodeId) !== parts[0] ||
    !nodeId.trim() ||
    nodeId.length > 512 ||
    !Number.isSafeInteger(revision) ||
    ref.version !== revision ||
    ref.artifactId !== `${nodeId}:${String(revision)}` ||
    ref.mediaType !== 'application/json' ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) ||
    !Number.isSafeInteger(ref.byteSize) ||
    ref.byteSize < 2
  )
    throw invalid();
  return { nodeId, revision } as const;
}

export function verifyNodeControlCardArtifact(
  ref: ArtifactRef,
  nodeId: string,
  revision: number,
  card: EvidenceJsonValue,
) {
  const address = nodeControlCardArtifactAddress(ref);
  const built = buildNodeControlCardArtifact(nodeId, revision, card);
  if (
    address.nodeId !== nodeId ||
    address.revision !== revision ||
    ref.sha256 !== built.artifactRef.sha256 ||
    ref.byteSize !== built.artifactRef.byteSize
  )
    throw new SourceArtifactRefError(
      'SOURCE_ARTIFACT_INTEGRITY_MISMATCH',
      'Immutable Agent Card artifact bytes or identity differ.',
    );
  return built;
}
