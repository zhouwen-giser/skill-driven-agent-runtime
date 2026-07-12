export interface GoalCancellationRecord {
  readonly cancellationId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly reason: string;
  readonly canceledTaskIds: readonly string[];
  readonly invalidatedPlanIds: readonly string[];
  readonly canceledInstanceIds: readonly string[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
}
