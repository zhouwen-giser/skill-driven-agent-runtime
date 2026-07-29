import { ArtifactDomainError, type ArtifactDomainErrorCode } from './errors.js';

/** P06 frozen interface set. No P07 routing or execution contract belongs here. */
export const ARTIFACT_SHADOW_GOVERNANCE_CONTRACT_VERSION = '1.1' as const;

export const ARTIFACT_SHADOW_GOVERNANCE_SCHEMA_HASHES = Object.freeze({
  ArtifactShadowRun: '57b1f4a99385c94d967ac2eb84ed90dc74ab196c25e42fc67de488d963ec369d',
  ArtifactShadowResult: '69f51efc62cb86f2b0df4e5a95cf3bce00580869a0b6fb891498cdc260c1ec69',
  ArtifactPromotionPackage: '4889edac5db4fe3251d9b29c4aaddb05341bb1d9adb257398a556859a517bf52',
  ArtifactApprovalRecord: 'a041ba372f0e123ba7ba4d5fb451ba889e0f46ae727a4714aabb5c70c119394d',
  ArtifactActivationRecord: 'd45959a850c3433df4be744f77e758209e317ceb88c5dc816d448878b2e3a7ef',
  ArtifactRevalidationTrigger: 'cd9b13e443b5fa7aa80a004bbb99b3e988a44247eed92997efa8682ea774745a',
} as const);

export const ARTIFACT_SHADOW_RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'completed',
  'discarded_stale',
  'failed',
  'cancelled',
] as const);
export type ArtifactShadowRunStatus = (typeof ARTIFACT_SHADOW_RUN_STATUSES)[number];

export const ARTIFACT_SHADOW_MODES = Object.freeze([
  'decision_only',
  'plan_only',
  'decision_and_plan',
] as const);
export type ArtifactShadowMode = (typeof ARTIFACT_SHADOW_MODES)[number];

export interface ArtifactShadowRun {
  readonly shadowRunId: string;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly formalRequestRef: string;
  readonly formalGoalRef?: string;
  readonly formalPlanRef?: string;
  readonly formalGoalVersion?: number;
  readonly formalPlanVersion?: number;
  readonly status: ArtifactShadowRunStatus;
  readonly shadowMode: ArtifactShadowMode;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface ArtifactShadowResult {
  readonly shadowRunRef: string;
  readonly artifactRef: string;
  readonly shadowDecisionRef?: string;
  readonly shadowPlanRef?: string;
  readonly formalPlanRef?: string;
  readonly formalOutcomeRef?: string;
  readonly comparison: Readonly<Record<string, number | undefined>>;
  readonly policyViolation: boolean;
  readonly unsafeAttempt: boolean;
  readonly stale: boolean;
  readonly resultHash: string;
  readonly evaluatorVersion: string;
  readonly completedAt: string;
}

export const ARTIFACT_PROMOTION_ELIGIBILITIES = Object.freeze([
  'eligible_for_review',
  'needs_more_data',
  'ineligible',
  'unsafe',
] as const);
export type ArtifactPromotionEligibility = (typeof ARTIFACT_PROMOTION_ELIGIBILITIES)[number];

export interface ArtifactPromotionPackage {
  readonly promotionPackageId: string;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly validationSummaryRef: string;
  readonly validationSummaryHash: string;
  readonly shadowSummaryRef: string;
  readonly shadowSummaryHash: string;
  readonly counterexampleSummaryRef: string;
  readonly counterexampleSummaryHash: string;
  readonly riskReviewRef: string;
  readonly riskReviewHash: string;
  readonly dependencySnapshotRef: string;
  readonly dependencySnapshotHash: string;
  readonly promotionPolicyVersion: string;
  readonly eligibility: ArtifactPromotionEligibility;
  readonly contentHash: string;
  readonly createdAt: string;
}

export type ArtifactApprovalDecision = 'approved' | 'rejected';

export interface ArtifactApprovalRecord {
  readonly approvalId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly approverId: string;
  readonly decision: ArtifactApprovalDecision;
  readonly reason: string;
  readonly validationSummaryHash: string;
  readonly promotionPackageHash: string;
  readonly createdAt: string;
}

export interface ArtifactActivationRecord {
  readonly activationId: string;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly approvalRef: string;
  readonly approvalHash: string;
  readonly previousActiveArtifactRef?: string;
  readonly activePointerVersion: number;
  readonly activatedBy: string;
  readonly activatedAt: string;
}

export const ARTIFACT_REVALIDATION_TRIGGER_TYPES = Object.freeze([
  'capability_catalog_changed',
  'skill_changed',
  'policy_changed',
  'task_type_changed',
  'schema_changed',
  'compiler_changed',
  'validator_changed',
  'provider_profile_changed',
  'performance_drift',
  'correction_received',
  'fallback_drift',
  'new_counterexample',
  'safety_incident',
  'long_inactivity',
  'operator_request',
] as const);
export type ArtifactRevalidationTriggerType = (typeof ARTIFACT_REVALIDATION_TRIGGER_TYPES)[number];

export type ArtifactRevalidationSeverity = 'normal' | 'urgent' | 'critical';

export interface ArtifactRevalidationTrigger {
  readonly triggerId: string;
  readonly artifactRef: string;
  readonly triggerType: ArtifactRevalidationTriggerType;
  readonly sourceRefs: readonly string[];
  readonly severity: ArtifactRevalidationSeverity;
  readonly createdAt: string;
}

export function createArtifactShadowRun(input: ArtifactShadowRun): ArtifactShadowRun {
  const code = 'ARTIFACT_SHADOW_RUN_INVALID' as const;
  assertExactKeys(
    input,
    [
      'shadowRunId',
      'artifactRef',
      'artifactHash',
      'formalRequestRef',
      'formalGoalRef',
      'formalPlanRef',
      'formalGoalVersion',
      'formalPlanVersion',
      'status',
      'shadowMode',
      'startedAt',
      'completedAt',
    ],
    code,
  );
  for (const field of ['shadowRunId', 'artifactRef', 'formalRequestRef'] as const) {
    assertIdentifier(input[field], field, code);
  }
  for (const field of ['formalGoalRef', 'formalPlanRef'] as const) {
    if (input[field] !== undefined) assertIdentifier(input[field], field, code);
  }
  assertHash(input.artifactHash, 'artifactHash', code);
  assertVersion(input.formalGoalVersion, 'formalGoalVersion', code);
  assertVersion(input.formalPlanVersion, 'formalPlanVersion', code);
  if (!ARTIFACT_SHADOW_RUN_STATUSES.includes(input.status)) invalid(code, 'status is unsupported.');
  if (!ARTIFACT_SHADOW_MODES.includes(input.shadowMode))
    invalid(code, 'shadowMode is unsupported.');
  assertTimestamp(input.startedAt, 'startedAt', code);
  if (input.completedAt !== undefined) {
    assertTimestamp(input.completedAt, 'completedAt', code);
    if (Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
      invalid(code, 'completedAt precedes startedAt.');
    }
  }
  const terminal = ['completed', 'discarded_stale', 'failed', 'cancelled'].includes(input.status);
  if (terminal !== (input.completedAt !== undefined)) {
    invalid(code, 'terminal status requires completedAt only.');
  }
  return Object.freeze({ ...input });
}

export function createArtifactShadowResult(input: ArtifactShadowResult): ArtifactShadowResult {
  const code = 'ARTIFACT_SHADOW_RESULT_INVALID' as const;
  assertExactKeys(
    input,
    [
      'shadowRunRef',
      'artifactRef',
      'shadowDecisionRef',
      'shadowPlanRef',
      'formalPlanRef',
      'formalOutcomeRef',
      'comparison',
      'policyViolation',
      'unsafeAttempt',
      'stale',
      'resultHash',
      'evaluatorVersion',
      'completedAt',
    ],
    code,
  );
  for (const field of ['shadowRunRef', 'artifactRef', 'evaluatorVersion'] as const) {
    assertIdentifier(input[field], field, code);
  }
  for (const field of [
    'shadowDecisionRef',
    'shadowPlanRef',
    'formalPlanRef',
    'formalOutcomeRef',
  ] as const) {
    if (input[field] !== undefined) assertIdentifier(input[field], field, code);
  }
  const comparison = freezeComparison(input.comparison, code);
  for (const field of ['policyViolation', 'unsafeAttempt', 'stale'] as const) {
    if (typeof input[field] !== 'boolean') invalid(code, `${field} must be boolean.`);
  }
  assertHash(input.resultHash, 'resultHash', code);
  assertTimestamp(input.completedAt, 'completedAt', code);
  return Object.freeze({ ...input, comparison });
}

export function createArtifactPromotionPackage(
  input: ArtifactPromotionPackage,
): ArtifactPromotionPackage {
  const code = 'ARTIFACT_PROMOTION_PACKAGE_INVALID' as const;
  assertExactKeys(
    input,
    [
      'promotionPackageId',
      'artifactRef',
      'artifactHash',
      'validationSummaryRef',
      'validationSummaryHash',
      'shadowSummaryRef',
      'shadowSummaryHash',
      'counterexampleSummaryRef',
      'counterexampleSummaryHash',
      'riskReviewRef',
      'riskReviewHash',
      'dependencySnapshotRef',
      'dependencySnapshotHash',
      'promotionPolicyVersion',
      'eligibility',
      'contentHash',
      'createdAt',
    ],
    code,
  );
  for (const field of [
    'promotionPackageId',
    'artifactRef',
    'validationSummaryRef',
    'shadowSummaryRef',
    'counterexampleSummaryRef',
    'riskReviewRef',
    'dependencySnapshotRef',
    'promotionPolicyVersion',
  ] as const) {
    assertIdentifier(input[field], field, code);
  }
  for (const field of [
    'artifactHash',
    'validationSummaryHash',
    'shadowSummaryHash',
    'counterexampleSummaryHash',
    'riskReviewHash',
    'dependencySnapshotHash',
    'contentHash',
  ] as const) {
    assertHash(input[field], field, code);
  }
  if (!ARTIFACT_PROMOTION_ELIGIBILITIES.includes(input.eligibility)) {
    invalid(code, 'eligibility is unsupported.');
  }
  assertTimestamp(input.createdAt, 'createdAt', code);
  return Object.freeze({ ...input });
}

export function createArtifactApprovalRecord(
  input: ArtifactApprovalRecord,
): ArtifactApprovalRecord {
  const code = 'ARTIFACT_APPROVAL_RECORD_INVALID' as const;
  assertExactKeys(
    input,
    [
      'approvalId',
      'artifactId',
      'artifactVersion',
      'approverId',
      'decision',
      'reason',
      'validationSummaryHash',
      'promotionPackageHash',
      'createdAt',
    ],
    code,
  );
  for (const field of ['approvalId', 'artifactId', 'approverId'] as const) {
    assertIdentifier(input[field], field, code);
  }
  assertVersion(input.artifactVersion, 'artifactVersion', code, true);
  if (!['approved', 'rejected'].includes(input.decision)) invalid(code, 'decision is unsupported.');
  assertText(input.reason, 'reason', code);
  assertHash(input.validationSummaryHash, 'validationSummaryHash', code);
  assertHash(input.promotionPackageHash, 'promotionPackageHash', code);
  assertTimestamp(input.createdAt, 'createdAt', code);
  return Object.freeze({ ...input });
}

export function createArtifactActivationRecord(
  input: ArtifactActivationRecord,
): ArtifactActivationRecord {
  const code = 'ARTIFACT_ACTIVATION_RECORD_INVALID' as const;
  assertExactKeys(
    input,
    [
      'activationId',
      'artifactRef',
      'artifactHash',
      'approvalRef',
      'approvalHash',
      'previousActiveArtifactRef',
      'activePointerVersion',
      'activatedBy',
      'activatedAt',
    ],
    code,
  );
  for (const field of ['activationId', 'artifactRef', 'approvalRef', 'activatedBy'] as const) {
    assertIdentifier(input[field], field, code);
  }
  if (input.previousActiveArtifactRef !== undefined) {
    assertIdentifier(input.previousActiveArtifactRef, 'previousActiveArtifactRef', code);
  }
  assertHash(input.artifactHash, 'artifactHash', code);
  assertHash(input.approvalHash, 'approvalHash', code);
  assertVersion(input.activePointerVersion, 'activePointerVersion', code, true);
  assertTimestamp(input.activatedAt, 'activatedAt', code);
  return Object.freeze({ ...input });
}

export function createArtifactRevalidationTrigger(
  input: ArtifactRevalidationTrigger,
): ArtifactRevalidationTrigger {
  const code = 'ARTIFACT_REVALIDATION_TRIGGER_INVALID' as const;
  assertExactKeys(
    input,
    ['triggerId', 'artifactRef', 'triggerType', 'sourceRefs', 'severity', 'createdAt'],
    code,
  );
  assertIdentifier(input.triggerId, 'triggerId', code);
  assertIdentifier(input.artifactRef, 'artifactRef', code);
  if (!ARTIFACT_REVALIDATION_TRIGGER_TYPES.includes(input.triggerType)) {
    invalid(code, 'triggerType is unsupported.');
  }
  const sourceRefs = freezeRefs(input.sourceRefs, 'sourceRefs', code, true);
  if (!['normal', 'urgent', 'critical'].includes(input.severity)) {
    invalid(code, 'severity is unsupported.');
  }
  assertTimestamp(input.createdAt, 'createdAt', code);
  return Object.freeze({ ...input, sourceRefs });
}

export function hashArtifactApprovalRecord(record: ArtifactApprovalRecord): string {
  return hashCanonical(record);
}

export function hashArtifactPromotionPackage(record: ArtifactPromotionPackage): string {
  return hashCanonical(record);
}

export function hashArtifactShadowResult(record: ArtifactShadowResult): string {
  return hashCanonical(record);
}

export function hashCanonical(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/**
 * The compiler domain deliberately has no Node/runtime imports.  Hashing is
 * therefore implemented as a small, synchronous SHA-256 primitive over the
 * canonical UTF-8 representation rather than pulling a platform adapter into
 * a frozen domain contract.
 */
function sha256Hex(value: string): string {
  const source = new TextEncoder().encode(value);
  const bitLength = source.length * 8;
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  for (let offset = 0; offset < 8; offset += 1) {
    padded[padded.length - 1 - offset] = Math.floor(bitLength / 2 ** (offset * 8)) & 0xff;
  }

  let a = 0x6a09e667;
  let b = 0xbb67ae85;
  let c = 0x3c6ef372;
  let d = 0xa54ff53a;
  let e = 0x510e527f;
  let f = 0x9b05688c;
  let g = 0x1f83d9ab;
  let h = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = block + index * 4;
      words[index] =
        ((padded[offset] ?? 0) << 24) |
        ((padded[offset + 1] ?? 0) << 16) |
        ((padded[offset + 2] ?? 0) << 8) |
        (padded[offset + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15] ?? 0;
      const second = words[index - 2] ?? 0;
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] =
        (((((words[index - 16] ?? 0) + sigma0) | 0) + ((words[index - 7] ?? 0) + sigma1)) | 0) >>>
        0;
    }
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    let ee = e;
    let ff = f;
    let gg = g;
    let hh = h;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(ee, 6) ^ rotateRight(ee, 11) ^ rotateRight(ee, 25);
      const choose = (ee & ff) ^ (~ee & gg);
      const temp1 =
        (((((hh + sum1) | 0) + choose) | 0) +
          (SHA256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) |
        0;
      const sum0 = rotateRight(aa, 2) ^ rotateRight(aa, 13) ^ rotateRight(aa, 22);
      const majority = (aa & bb) ^ (aa & cc) ^ (bb & cc);
      const temp2 = (sum0 + majority) | 0;
      hh = gg;
      gg = ff;
      ff = ee;
      ee = (dd + temp1) | 0;
      dd = cc;
      cc = bb;
      bb = aa;
      aa = (temp1 + temp2) | 0;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
    e = (e + ee) | 0;
    f = (f + ff) | 0;
    g = (g + gg) | 0;
    h = (h + hh) | 0;
  }
  return [a, b, c, d, e, f, g, h]
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function assertExactKeys(
  input: object,
  allowed: readonly string[],
  code: ArtifactDomainErrorCode,
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !known.has(key));
  if (unknown.length > 0) invalid(code, `Unknown fields: ${unknown.sort().join(',')}.`);
}

function assertIdentifier(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
  ) {
    invalid(code, `${field} is not a bounded identifier.`);
  }
}

function assertHash(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid(code, `${field} must be a SHA-256 value.`);
  }
}

function assertVersion(
  value: unknown,
  field: string,
  code: ArtifactDomainErrorCode,
  required = false,
): void {
  if (value === undefined && !required) return;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(code, `${field} must be a positive integer.`);
  }
}

function assertTimestamp(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalid(code, `${field} must be a canonical timestamp.`);
  }
}

function assertText(value: unknown, field: string, code: ArtifactDomainErrorCode): void {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 4096) {
    invalid(code, `${field} must be bounded text.`);
  }
}

function freezeComparison(
  value: unknown,
  code: ArtifactDomainErrorCode,
): Readonly<Record<string, number | undefined>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(code, 'comparison must be a plain object.');
  }
  const entries = Object.entries(value);
  if (entries.length > 256) invalid(code, 'comparison exceeds bounds.');
  const comparison: Record<string, number | undefined> = {};
  for (const [key, item] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    assertIdentifier(key, 'comparison key', code);
    if (item !== undefined && (typeof item !== 'number' || !Number.isFinite(item))) {
      invalid(code, `comparison ${key} is not finite.`);
    }
    comparison[key] = item as number | undefined;
  }
  return Object.freeze(comparison);
}

function freezeRefs(
  value: unknown,
  field: string,
  code: ArtifactDomainErrorCode,
  required: boolean,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 4096 || (required && value.length === 0)) {
    invalid(code, `${field} is not a bounded reference list.`);
  }
  const refs = (value as readonly unknown[]).map((item) => {
    if (typeof item !== 'string') invalid(code, `${field} contains a non-string reference.`);
    assertIdentifier(item, field, code);
    return item;
  });
  if (new Set(refs).size !== refs.length) invalid(code, `${field} contains duplicates.`);
  return Object.freeze(refs);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${(value as readonly unknown[]).map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function invalid(code: ArtifactDomainErrorCode, message: string): never {
  throw new ArtifactDomainError(code, message);
}
