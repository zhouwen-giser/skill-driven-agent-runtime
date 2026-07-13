export function TaskReferenceLinks({
  value,
  onOpenTask,
}: {
  readonly value: unknown;
  readonly onOpenTask: ((taskId: string) => void) | undefined;
}) {
  if (onOpenTask === undefined) return null;
  const taskIds = collectTaskIds(value);
  return (
    <div className="action-row" aria-label="Related Tasks">
      {taskIds.map((taskId) => (
        <button
          type="button"
          key={taskId}
          onClick={() => {
            onOpenTask(taskId);
          }}
        >
          Open related Task · {taskId}
        </button>
      ))}
    </div>
  );
}

function collectTaskIds(value: unknown): readonly string[] {
  const records: unknown[] = [];
  if (Array.isArray(value)) for (const item of value as unknown[]) records.push(item);
  else records.push(value);
  if (typeof value === 'object' && value !== null && 'items' in value && Array.isArray(value.items))
    for (const item of value.items as unknown[]) records.push(item);
  const taskIds = new Set<string>();
  for (const record of records) {
    if (typeof record !== 'object' || record === null || !('taskId' in record)) continue;
    if (typeof record.taskId === 'string' && record.taskId !== '') taskIds.add(record.taskId);
  }
  return [...taskIds].sort();
}
