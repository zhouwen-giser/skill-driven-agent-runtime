import { AgentCard } from '@a2a-js/sdk';
import { describe, expect, it } from 'vitest';

import { SDAR_CAPABILITY_EXPOSURE_CATALOG_EXTENSION_URI } from '../../node-control-application/src/index.js';
import type { JsonObject } from '../../node-control-domain/src/index.js';
import {
  OfficialA2aAgentCardValidator,
  parseOfficialAgentCard,
} from '../src/node-control-agent-card.js';

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

  it('preserves the optional current Exposure catalog through the official SDK boundary', () => {
    const baseCard = card([
      {
        id: 'registered.inspect',
        name: 'Inspect',
        description: 'Inspect a registered device.',
        tags: ['inspection'],
      },
    ]);
    const managedCard: JsonObject = {
      ...baseCard,
      capabilities: {
        streaming: true,
        pushNotifications: false,
        extensions: [
          {
            uri: SDAR_CAPABILITY_EXPOSURE_CATALOG_EXTENSION_URI,
            description: 'Current published SDAR Capability Exposure contracts.',
            required: false,
            params: {
              version: '1.0',
              entries: [
                {
                  agentSkillId: 'registered.inspect',
                  exposureId: 'a2a.device.inspect',
                  exposureVersion: 2,
                  capabilityId: 'device.inspect',
                  capabilityVersion: 3,
                  requestSchema: { type: 'object' },
                  resultSchema: { type: 'object' },
                  requesterPolicy: { allowAnonymous: true },
                  exposureHash: 'a'.repeat(64),
                },
              ],
            },
          },
        ],
      },
    };

    expect(() => {
      validator.validate(managedCard);
    }).not.toThrow();
    expect(AgentCard.toJSON(parseOfficialAgentCard(managedCard))).toMatchObject({
      capabilities: {
        extensions: [
          {
            uri: SDAR_CAPABILITY_EXPOSURE_CATALOG_EXTENSION_URI,
            params: {
              version: '1.0',
              entries: [
                {
                  exposureId: 'a2a.device.inspect',
                  exposureVersion: 2,
                  capabilityId: 'device.inspect',
                  capabilityVersion: 3,
                },
              ],
            },
          },
        ],
      },
    });
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
