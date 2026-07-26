import type { ActiveKnowledgeDefinition } from '../../../domain/src/index.js';

export class KnowledgeApplicabilityEvaluator {
  applies(
    definition: ActiveKnowledgeDefinition,
    input: Readonly<{ query: string; applicabilityTerms: readonly string[] }>,
  ): boolean {
    const query = normalize(input.query);
    const terms = new Set([
      ...tokens(query),
      ...input.applicabilityTerms.flatMap((item) => tokens(normalize(item))),
    ]);
    const negativeExamples = nestedStrings(definition.definition, [
      ['recognition', 'negativeExamples'],
      ['negativeExamples'],
    ]);
    if (
      negativeExamples.some((example) => {
        const normalized = normalize(example);
        return normalized.length >= 4 && query.includes(normalized);
      })
    ) {
      return false;
    }
    const incompatible = strings(definition.definition['incompatibleConstraints']);
    if (incompatible.some((constraint) => overlaps(tokens(normalize(constraint)), terms))) {
      return false;
    }
    const conditions = strings(definition.definition['applicableConditions']);
    return (
      conditions.length === 0 ||
      conditions.some((condition) => overlaps(tokens(normalize(condition)), terms))
    );
  }
}

function nestedStrings(
  value: Readonly<Record<string, unknown>>,
  paths: readonly (readonly string[])[],
): readonly string[] {
  return paths.flatMap((path) => {
    let current: unknown = value;
    for (const segment of path) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) return [];
      current = (current as Readonly<Record<string, unknown>>)[segment];
    }
    return strings(current);
  });
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function tokens(value: string): readonly string[] {
  return value.split(/[^\p{L}\p{N}_.:-]+/u).filter((item) => item.length >= 2);
}

function overlaps(values: readonly string[], terms: ReadonlySet<string>): boolean {
  return values.some((value) => terms.has(value));
}
