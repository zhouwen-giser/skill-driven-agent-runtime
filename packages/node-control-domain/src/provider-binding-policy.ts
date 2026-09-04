export interface ExactMcpProviderBindingPolicy {
  readonly selection: 'required';
  readonly mcpProviderBindingId: string;
  readonly localServerId: string;
  readonly mcpToolName: string;
  readonly requireActive: true;
  readonly requireAvailable: true;
  readonly requireUnexpiredFreshness: true;
  readonly denyFallback: true;
}

export type ParsedMcpProviderBindingPolicyOverride =
  | Readonly<{ mode: 'absent'; requirements: readonly [] }>
  | Readonly<{ mode: 'invalid'; requirements: readonly [] }>
  | Readonly<{
      mode: 'single';
      requirements: readonly [ExactMcpProviderBindingPolicy];
    }>
  | Readonly<{
      mode: 'required_all';
      requirements: readonly [ExactMcpProviderBindingPolicy, ExactMcpProviderBindingPolicy];
    }>;

const EMPTY_REQUIREMENTS: readonly [] = Object.freeze([]);
const ABSENT: Extract<ParsedMcpProviderBindingPolicyOverride, { mode: 'absent' }> = Object.freeze({
  mode: 'absent',
  requirements: EMPTY_REQUIREMENTS,
});
const INVALID: Extract<ParsedMcpProviderBindingPolicyOverride, { mode: 'invalid' }> = Object.freeze(
  { mode: 'invalid', requirements: EMPTY_REQUIREMENTS },
);
/**
 * Projects the Provider Binding authority fields understood by readiness and Task Capability
 * admission. Additive Provider-owned fields are deliberately ignored by this projection and remain
 * preserved in the persisted policy document; only missing or malformed fields consumed by the
 * runtime make the declared policy invalid.
 */
export function parseMcpProviderBindingPolicyOverride(
  value: unknown,
): ParsedMcpProviderBindingPolicyOverride {
  if (value === undefined) return ABSENT;
  if (!isRecord(value)) return INVALID;
  if (value['selection'] !== 'required_all') {
    const requirement = exactRequirement(value);
    if (requirement === undefined) return INVALID;
    const requirements: readonly [ExactMcpProviderBindingPolicy] = Object.freeze([requirement]);
    return Object.freeze({ mode: 'single', requirements });
  }
  const declared = value['requirements'];
  if (!Array.isArray(declared) || declared.length !== 2) return INVALID;
  const first = exactRequirement(declared[0]);
  const second = exactRequirement(declared[1]);
  if (
    first === undefined ||
    second === undefined ||
    first.mcpProviderBindingId === second.mcpProviderBindingId ||
    first.localServerId === second.localServerId ||
    `${first.localServerId}\u0000${first.mcpToolName}` ===
      `${second.localServerId}\u0000${second.mcpToolName}`
  )
    return INVALID;
  const requirements: readonly [ExactMcpProviderBindingPolicy, ExactMcpProviderBindingPolicy] =
    Object.freeze([first, second]);
  return Object.freeze({ mode: 'required_all', requirements });
}

function exactRequirement(value: unknown): ExactMcpProviderBindingPolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !allowedResourceIdsValid(value) ||
    value['selection'] !== 'required' ||
    !nonEmpty(value['mcpProviderBindingId']) ||
    !nonEmpty(value['localServerId']) ||
    !nonEmpty(value['mcpToolName']) ||
    value['requireActive'] !== true ||
    value['requireAvailable'] !== true ||
    value['requireUnexpiredFreshness'] !== true ||
    value['denyFallback'] !== true
  )
    return undefined;
  return Object.freeze({
    selection: 'required',
    mcpProviderBindingId: value['mcpProviderBindingId'],
    localServerId: value['localServerId'],
    mcpToolName: value['mcpToolName'],
    requireActive: true,
    requireAvailable: true,
    requireUnexpiredFreshness: true,
    denyFallback: true,
  });
}

function allowedResourceIdsValid(value: Readonly<Record<string, unknown>>): boolean {
  if (!Object.hasOwn(value, 'allowedResourceIds')) return true;
  const declared = value['allowedResourceIds'];
  if (!Array.isArray(declared) || declared.length === 0) return false;
  const seen = new Set<string>();
  for (const item of declared) {
    if (typeof item !== 'string' || item.trim() === '' || item !== item.trim() || seen.has(item))
      return false;
    seen.add(item);
  }
  return true;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
