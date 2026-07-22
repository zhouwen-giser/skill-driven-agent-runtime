import type { AgentCard } from '@a2a-js/sdk';

import type { PublicCapabilityCardSnapshot } from '../../domain/src/index.js';

import { buildAgentCard } from './compatibility.js';

export const SDAR_CAPABILITY_PROFILE_EXTENSION_URI = 'io.sdar/capabilityProfile' as const;

export class A2AAgentCardBuilder {
  buildFromSnapshot(
    snapshot: PublicCapabilityCardSnapshot,
    endpoint = 'http://127.0.0.1:3000/a2a',
  ): AgentCard {
    const base = buildAgentCard(snapshot.publicSkills, endpoint);
    return {
      ...base,
      description: snapshot.description,
      capabilities: {
        ...base.capabilities,
        extensions: [
          {
            uri: SDAR_CAPABILITY_PROFILE_EXTENSION_URI,
            description: 'Versioned public SDAR capability profile.',
            required: false,
            params: snapshot.profile,
          },
        ],
      },
    };
  }
}
