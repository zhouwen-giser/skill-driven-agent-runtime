export interface ExactSkillPackageAuthority {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly packageChecksum: string;
  readonly validatedAt: string;
  readonly importedAt: string;
}

/** Application port for the immutable package audit committed with an exact Skill import. */
export interface ExactSkillPackageAuthorityReader {
  loadExactSkillPackageAuthority(
    skillId: string,
    skillVersion: number,
  ): Promise<ExactSkillPackageAuthority>;
}
