import type {
  InternalToolResult,
  ProviderEvidenceItem,
  SkillEvidenceMatch,
  SkillEvidenceRequirement,
} from '../../domain/src/index.js';

export interface SkillEvidenceMatchResult {
  readonly matches: readonly SkillEvidenceMatch[];
  readonly validatedEvidence: Readonly<Record<string, boolean>>;
  readonly result: InternalToolResult;
}

/** Maps provider-owned objective evidence types to SDAR-local requirement IDs. */
export function matchSkillEvidence(
  input: Readonly<{
    requirements: readonly SkillEvidenceRequirement[];
    result: InternalToolResult;
    runtimeRevision?: string;
  }>,
): SkillEvidenceMatchResult {
  const evidence = [...(input.result.evidence ?? [])].sort(compareEvidence);
  const matches = input.requirements.map((requirement) => {
    const item = evidence.find(
      (candidate) =>
        candidate.evidenceType === requirement.evidenceType &&
        (!requirement.hardGate ||
          candidate.payloadRef.kind !== 'uri' ||
          candidate.payloadRef.sha256 !== undefined),
    );
    return Object.freeze({
      requirementId: requirement.requirementId,
      evidenceType: requirement.evidenceType,
      required: requirement.required,
      hardGate: requirement.hardGate,
      satisfied: item !== undefined,
      ...(item === undefined ? {} : evidenceFields(item, input.result.structuredContent)),
      ...(input.runtimeRevision === undefined ? {} : { runtimeRevision: input.runtimeRevision }),
    }) satisfies SkillEvidenceMatch;
  });
  const validatedEvidence = Object.freeze(
    Object.fromEntries(matches.map((match) => [match.requirementId, match.satisfied])),
  );
  return Object.freeze({
    matches: Object.freeze(matches),
    validatedEvidence,
    result: Object.freeze({ ...input.result, validatedEvidence }),
  });
}

function evidenceFields(
  item: ProviderEvidenceItem,
  structuredContent: unknown,
): Pick<SkillEvidenceMatch, 'evidenceId' | 'observedAt' | 'payloadRef' | 'resolvedValue'> {
  return {
    evidenceId: item.evidenceId,
    observedAt: item.observedAt,
    payloadRef: item.payloadRef,
    resolvedValue:
      item.payloadRef.kind === 'structured_content'
        ? resolveJsonPointer(structuredContent, item.payloadRef.jsonPointer)
        : item.payloadRef.uri,
  };
}

function compareEvidence(left: ProviderEvidenceItem, right: ProviderEvidenceItem): number {
  const observed = right.observedAt.localeCompare(left.observedAt);
  return observed === 0 ? left.evidenceId.localeCompare(right.evidenceId) : observed;
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  let current = document;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
