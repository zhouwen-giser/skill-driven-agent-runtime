import { DomainError } from './errors.js';

export interface MemoryRetentionPolicy {
  readonly reviewAfterDays: number;
  readonly archiveAfterDays: number | null;
  readonly deleteAfterDays: number | null;
  readonly automaticArchiveEnabled: boolean;
  readonly automaticDeleteEnabled: boolean;
  readonly updatedAt: string;
}

export function createMemoryRetentionPolicy(
  input: Omit<MemoryRetentionPolicy, 'updatedAt'>,
  updatedAt: string,
): MemoryRetentionPolicy {
  if (!Number.isInteger(input.reviewAfterDays) || input.reviewAfterDays < 1)
    throw new DomainError(
      'MEMORY_RETENTION_REVIEW_INVALID',
      'Memory review period must be a positive number of days.',
    );
  validateOptionalDays(input.archiveAfterDays, 'MEMORY_RETENTION_ARCHIVE_INVALID');
  validateOptionalDays(input.deleteAfterDays, 'MEMORY_RETENTION_DELETE_INVALID');
  if (input.automaticArchiveEnabled || input.automaticDeleteEnabled)
    throw new DomainError(
      'MEMORY_AUTOMATIC_CLEANUP_FORBIDDEN',
      'Automatic Memory archive and deletion are disabled in V1.',
    );
  if (
    input.archiveAfterDays !== null &&
    input.deleteAfterDays !== null &&
    input.deleteAfterDays <= input.archiveAfterDays
  )
    throw new DomainError(
      'MEMORY_RETENTION_ORDER_INVALID',
      'Deletion review must occur after archival review.',
    );
  return { ...input, updatedAt };
}

function validateOptionalDays(
  value: number | null,
  code: 'MEMORY_RETENTION_ARCHIVE_INVALID' | 'MEMORY_RETENTION_DELETE_INVALID',
): void {
  if (value !== null && (!Number.isInteger(value) || value < 1))
    throw new DomainError(code, 'Optional Memory retention days must be positive integers.');
}
