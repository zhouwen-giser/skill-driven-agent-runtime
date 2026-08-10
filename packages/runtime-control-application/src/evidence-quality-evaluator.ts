import {
  hashCanonicalEvidenceJson,
  type EvidenceIssueCode,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
} from '../../domain/src/index.js';

export const EVIDENCE_QUALITY_RULES = Object.freeze([
  'sequence_gap',
  'payload_conflict',
  'orphan_reference',
  'version_gap',
  'missing_verification',
  'remote_task_unclosed',
  'skill_tree_incomplete',
  'experience_missing_fact',
  'node_revision_regression',
  'export_ack_gap',
] as const);

export type EvidenceQualityRule = (typeof EVIDENCE_QUALITY_RULES)[number];

export interface EvidenceQualityFinding {
  readonly ruleId: EvidenceQualityRule;
  readonly identity: string;
  readonly sourceSystem: 'runtime' | 'node_control';
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly recordType?: string;
  readonly recordId?: string;
  readonly episodeId?: string;
  readonly detail: Readonly<Record<string, EvidenceJsonValue>>;
}

export interface EvidenceQualityAuthoritySource {
  findings(ruleId: EvidenceQualityRule): Promise<readonly EvidenceQualityFinding[]>;
}

/**
 * `resolveQualityRuleIssues` is deliberately rule-scoped. The older episode/prefix resolvers are
 * not sufficient because they can close a still-open finding owned by another quality rule.
 */
export interface EvidenceQualityIssueWriter {
  recordQualityIssue(issue: EvidenceQualityIssue, ruleId: EvidenceQualityRule): Promise<void>;
  resolveQualityRuleIssues(input: {
    readonly ruleId: EvidenceQualityRule;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void>;
}

export interface EvidenceQualityEvaluationResult {
  readonly evaluatedRules: number;
  readonly openIssues: number;
  readonly issueIds: readonly string[];
  readonly byRule: Readonly<Record<EvidenceQualityRule, number>>;
}

export class EvidenceQualityEvaluator {
  readonly #source: EvidenceQualityAuthoritySource;
  readonly #writer: EvidenceQualityIssueWriter;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly source: EvidenceQualityAuthoritySource;
    readonly writer: EvidenceQualityIssueWriter;
    readonly clock?: Readonly<{ now(): string }>;
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async evaluate(): Promise<EvidenceQualityEvaluationResult> {
    const observedAt = timestamp(this.#clock.now());
    const issueIds: string[] = [];
    const byRule = Object.fromEntries(
      EVIDENCE_QUALITY_RULES.map((ruleId) => [ruleId, 0]),
    ) as Record<EvidenceQualityRule, number>;

    for (const ruleId of EVIDENCE_QUALITY_RULES) {
      const findings = await this.#source.findings(ruleId);
      const retained: string[] = [];
      const identities = new Set<string>();
      for (const finding of findings) {
        assertFinding(ruleId, finding);
        if (identities.has(finding.identity)) {
          throw new Error(`EVIDENCE_QUALITY_DUPLICATE_FINDING:${ruleId}:${finding.identity}`);
        }
        identities.add(finding.identity);
        // Canonicalization is also the sensitive-field/depth/size gate for adapter-produced detail.
        hashCanonicalEvidenceJson(finding.detail);
        const issueId = qualityIssueId(ruleId, finding.identity);
        const policy = rulePolicy[ruleId];
        const issue: EvidenceQualityIssue = Object.freeze({
          issueId,
          issueCode: policy.issueCode,
          severity: policy.severity,
          ...(finding.recordType === undefined ? {} : { recordType: finding.recordType }),
          ...(finding.recordId === undefined ? {} : { recordId: finding.recordId }),
          ...(finding.episodeId === undefined ? {} : { episodeId: finding.episodeId }),
          sourceSystem: finding.sourceSystem,
          sourceTable: finding.sourceTable,
          sourceRecordId: finding.sourceRecordId,
          detail: Object.freeze({ ...finding.detail, ruleId, identity: finding.identity }),
          createdAt: observedAt,
        });
        await this.#writer.recordQualityIssue(issue, ruleId);
        retained.push(issueId);
        issueIds.push(issueId);
      }
      await this.#writer.resolveQualityRuleIssues({
        ruleId,
        retainedIssueIds: Object.freeze(retained.sort()),
        resolvedAt: observedAt,
      });
      byRule[ruleId] = retained.length;
    }

    return Object.freeze({
      evaluatedRules: EVIDENCE_QUALITY_RULES.length,
      openIssues: issueIds.length,
      issueIds: Object.freeze(issueIds.sort()),
      byRule: Object.freeze(byRule),
    });
  }
}

const rulePolicy: Readonly<
  Record<
    EvidenceQualityRule,
    Readonly<{ issueCode: EvidenceIssueCode; severity: EvidenceQualityIssue['severity'] }>
  >
> = Object.freeze({
  sequence_gap: { issueCode: 'source_identity_missing', severity: 'blocking' },
  payload_conflict: { issueCode: 'payload_hash_conflict', severity: 'blocking' },
  orphan_reference: { issueCode: 'reference_unresolved', severity: 'blocking' },
  version_gap: { issueCode: 'source_revision_missing', severity: 'blocking' },
  missing_verification: { issueCode: 'source_identity_missing', severity: 'blocking' },
  remote_task_unclosed: { issueCode: 'source_identity_missing', severity: 'blocking' },
  skill_tree_incomplete: { issueCode: 'reference_unresolved', severity: 'blocking' },
  experience_missing_fact: { issueCode: 'source_identity_missing', severity: 'degraded' },
  node_revision_regression: { issueCode: 'source_revision_missing', severity: 'blocking' },
  export_ack_gap: { issueCode: 'ack_invalid', severity: 'blocking' },
});

function qualityIssueId(ruleId: EvidenceQualityRule, identity: string): string {
  return `quality_${hashCanonicalEvidenceJson({ ruleId, identity }).slice('sha256:'.length)}`;
}

function assertFinding(ruleId: EvidenceQualityRule, finding: EvidenceQualityFinding): void {
  if (
    finding.ruleId !== ruleId ||
    finding.identity.trim() === '' ||
    finding.identity !== finding.identity.trim() ||
    finding.sourceTable.trim() === '' ||
    finding.sourceRecordId.trim() === ''
  ) {
    throw new Error(`EVIDENCE_QUALITY_FINDING_INVALID:${ruleId}`);
  }
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('EVIDENCE_QUALITY_CLOCK_INVALID');
  return parsed.toISOString();
}
