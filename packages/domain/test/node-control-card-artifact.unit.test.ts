import { describe, it, expect } from 'vitest';
import {
  buildNodeControlCardArtifact,
  nodeControlCardArtifactAddress,
  verifyNodeControlCardArtifact,
} from '../src/index.js';

describe('immutable large Node Control card artifacts', () => {
  it('retains exact large bytes and checks content, size, node and revision', () => {
    const card = {
      skills: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        description: 'x'.repeat(1000),
      })),
    };
    const built = buildNodeControlCardArtifact('node:one', 2, card);
    expect(built.canonicalBytes.length).toBeGreaterThan(65536);
    expect(
      verifyNodeControlCardArtifact(built.artifactRef, 'node:one', 2, card).canonicalBytes,
    ).toEqual(built.canonicalBytes);
    for (const ref of [
      { ...built.artifactRef, byteSize: 1 },
      { ...built.artifactRef, sha256: `sha256:${'0'.repeat(64)}` as const },
      { ...built.artifactRef, uri: built.artifactRef.uri + '/extra' },
      { ...built.artifactRef, version: 3 },
    ])
      expect(() => verifyNodeControlCardArtifact(ref, 'node:one', 2, card)).toThrow();
    expect(() => verifyNodeControlCardArtifact(built.artifactRef, 'other-node', 2, card)).toThrow();
    expect(() =>
      verifyNodeControlCardArtifact(built.artifactRef, 'node:one', 2, { ...card, changed: true }),
    ).toThrow();
  });
  it('rejects unknown authorities, ambiguous encoding and invalid revisions', () => {
    const ref = buildNodeControlCardArtifact('node-a', 1, {}).artifactRef;
    for (const uri of [
      'artifact://runtime/v1/agent-card/node-a/1/card',
      'artifact://node-control/v1/agent-card/node-a/01/card',
      'artifact://node-control/v1/agent-card/%6Eode-a/1/card',
    ])
      expect(() => nodeControlCardArtifactAddress({ ...ref, uri })).toThrow();
    expect(() => buildNodeControlCardArtifact('node-a', 0, {})).toThrow();
  });
});
