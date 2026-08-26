import { AgentCard } from '@a2a-js/sdk';

import type { A2aAgentCardValidator } from '../../node-control-application/src/index.js';
import type { JsonObject } from '../../node-control-domain/src/index.js';

export class OfficialA2aAgentCardValidator implements A2aAgentCardValidator {
  validate(card: JsonObject): void {
    if (
      typeof card['name'] !== 'string' ||
      typeof card['description'] !== 'string' ||
      typeof card['version'] !== 'string' ||
      !Array.isArray(card['supportedInterfaces']) ||
      card['supportedInterfaces'].length === 0 ||
      !Array.isArray(card['skills'])
    )
      throw new Error('AGENT_CARD_SCHEMA_INVALID');
    try {
      const parsed = AgentCard.fromJSON(card);
      const wire = AgentCard.toJSON(parsed);
      if (
        typeof wire !== 'object' ||
        wire === null ||
        (!Array.isArray((wire as Readonly<{ skills?: unknown }>).skills) &&
          // The official SDK omits a protobuf-default empty repeated field in JSON.
          !(
            (wire as Readonly<{ skills?: unknown }>).skills === undefined &&
            parsed.skills.length === 0
          ))
      )
        throw new Error('AGENT_CARD_SCHEMA_INVALID');
    } catch {
      throw new Error('AGENT_CARD_SCHEMA_INVALID');
    }
  }
}

export function parseOfficialAgentCard(card: JsonObject): AgentCard {
  return AgentCard.fromJSON(card);
}
