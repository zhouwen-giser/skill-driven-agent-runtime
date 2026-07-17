import type { SkillVersion } from './skill.js';
import type {
  SkillAdaptiveGuidance,
  SkillCompositionSpecification,
  SkillContextRequirement,
  SkillEvidencePolicy,
  SkillModeSpecification,
  SkillNormativePolicy,
  SkillObservedProfile,
  SkillTaskBinding,
  SkillVisibility,
} from './skill-usage.js';

export const SKILL_PACKAGE_API_VERSION = 'sdar.io/v1alpha1' as const;
export const MAX_SKILL_PACKAGE_FILE_BYTES = 262_144;
export const MAX_SKILL_PACKAGE_TOTAL_BYTES = 1_048_576;

export type SkillPackageUsageFileKind =
  'normative' | 'adaptive' | 'modes' | 'composition' | 'evidence';

export interface SkillPackageFileDeclaration {
  readonly path: string;
  readonly sha256: string;
}

export interface SkillPackageManifest {
  readonly apiVersion: typeof SKILL_PACKAGE_API_VERSION;
  readonly kind: 'SkillPackage';
  readonly skill: Omit<SkillVersion, 'usageSpecification'>;
  readonly skillMarkdownSha256: string;
  readonly files: Readonly<
    Record<Exclude<SkillPackageUsageFileKind, 'composition'>, SkillPackageFileDeclaration> &
      Partial<Pick<Record<SkillPackageUsageFileKind, SkillPackageFileDeclaration>, 'composition'>>
  >;
}

export interface SkillPackageNormativeDocument {
  readonly visibility: SkillVisibility;
  readonly normative: SkillNormativePolicy;
  readonly contextRequirements: readonly SkillContextRequirement[];
  readonly taskBindings: readonly SkillTaskBinding[];
}

export interface SkillPackageAdaptiveDocument {
  readonly adaptive: SkillAdaptiveGuidance;
  readonly observedProfile?: SkillObservedProfile;
}

export interface SkillPackageDocument {
  readonly manifest: SkillPackageManifest;
  readonly skillMarkdown: string;
  readonly normative: SkillPackageNormativeDocument;
  readonly adaptive: SkillPackageAdaptiveDocument;
  readonly modes: SkillModeSpecification;
  readonly composition?: SkillCompositionSpecification;
  readonly evidence: SkillEvidencePolicy;
}

export interface SkillPackageReadResult {
  readonly packageRoot: string;
  readonly document: SkillPackageDocument;
  readonly packageChecksum: string;
  readonly fileChecksums: Readonly<Record<string, string>>;
  readonly totalBytes: number;
}

export interface SkillPackageImportCandidate {
  readonly skillVersion: SkillVersion;
  readonly packageChecksum: string;
  readonly packageRoot: string;
  readonly fileChecksums: Readonly<Record<string, string>>;
  readonly skillMarkdown: string;
  readonly validatedAt: string;
}
