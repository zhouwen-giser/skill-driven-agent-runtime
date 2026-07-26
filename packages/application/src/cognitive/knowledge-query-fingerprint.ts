import { createHash } from 'node:crypto';

import type { KnowledgeUsageScope } from '../../../domain/src/index.js';

export class KnowledgeQueryFingerprintBuilder {
  build(
    input: Readonly<{
      query: string;
      applicabilityTerms: readonly string[];
      scope: KnowledgeUsageScope;
      catalogHash: string;
      promotionPolicyVersion: string;
    }>,
  ): string {
    const value = {
      query: normalize(input.query),
      applicabilityTerms: [
        ...new Set(input.applicabilityTerms.map(normalize).filter(Boolean)),
      ].sort(),
      scope: {
        ...(input.scope.taskId === undefined ? {} : { taskId: input.scope.taskId }),
        ...(input.scope.tenantId === undefined ? {} : { tenantId: input.scope.tenantId }),
        ...(input.scope.userId === undefined ? {} : { userId: input.scope.userId }),
      },
      catalogHash: input.catalogHash,
      promotionPolicyVersion: input.promotionPolicyVersion,
    };
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}
