export interface CorrectionDiff {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export class CorrectionDiffRecorder {
  diff(before: unknown, after: unknown): readonly CorrectionDiff[] {
    const changes: CorrectionDiff[] = [];
    visitDiff(before, after, '', changes);
    return Object.freeze(changes);
  }
}

function visitDiff(before: unknown, after: unknown, path: string, changes: CorrectionDiff[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      visitDiff(before[key], after[key], `${path}/${escapePointer(key)}`, changes);
    }
    return;
  }
  changes.push(Object.freeze({ path: path || '/', before: before ?? null, after: after ?? null }));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
