import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../../node-control-domain/src/index.js';
import { OfficialA2aAgentCardValidator } from '../src/node-control-agent-card.js';

describe('managed Agent Card official SDK validation', () => {
  const validator = new OfficialA2aAgentCardValidator();

  it('accepts an explicit empty registration after the last exposed Skill is disabled', () => {
    expect(() => {
      validator.validate(card([]));
    }).not.toThrow();
  });

  it('accepts a declared Skill through the same official SDK boundary', () => {
    expect(() => {
      validator.validate(
        card([
          {
            id: 'registered.inspect',
            name: 'Inspect',
            description: 'Inspect a registered device.',
            tags: ['inspection'],
          },
        ]),
      );
    }).not.toThrow();
  });

  it('still rejects a missing Skill list instead of treating malformed input as empty', () => {
    const malformed = { ...card([]) };
    delete malformed['skills'];

    expect(() => {
      validator.validate(malformed);
    }).toThrow('AGENT_CARD_SCHEMA_INVALID');
  });
});

function card(skills: readonly JsonObject[]): JsonObject {
  return {
    name: 'Registered Skill Runtime',
    description: 'Public registered Skill declarations.',
    version: '1.0',
    supportedInterfaces: [
      { url: 'http://127.0.0.1:9999/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ],
    skills: [...skills],
  };
}
