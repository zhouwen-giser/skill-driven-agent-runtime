import { useState } from 'react';

type Field = Readonly<{
  key: string;
  label: string;
  format: 'text' | 'number' | 'json';
  optional?: boolean;
}>;
export const workflowNodeFields = {
  llm: [
    { key: 'instruction', label: 'Instruction', format: 'text' },
    { key: 'context', label: 'Context bindings', format: 'json', optional: true },
    { key: 'responseSchema', label: 'Response JSON Schema', format: 'json' },
  ],
  mcp_tool: [
    { key: 'tool', label: 'Tool (serverId / toolName)', format: 'json' },
    { key: 'arguments', label: 'Tool arguments', format: 'json' },
    { key: 'taskExecution', label: 'Task timing and availability', format: 'json', optional: true },
  ],
  result: [{ key: 'value', label: 'Result expression', format: 'json' }],
  condition: [{ key: 'expression', label: 'Condition expression', format: 'json' }],
  parallel: [
    { key: 'branchEntryNodeIds', label: 'Branch entry node IDs', format: 'json' },
    { key: 'joinNodeId', label: 'Join node ID', format: 'text', optional: true },
    { key: 'mergeStrategy', label: 'Merge strategy', format: 'text', optional: true },
  ],
  loop: [
    { key: 'condition', label: 'Loop condition', format: 'json' },
    { key: 'bodyEntryNodeId', label: 'Body entry node ID', format: 'text' },
    { key: 'maxIterations', label: 'Maximum iterations', format: 'number' },
  ],
  subworkflow: [
    { key: 'workflowDefinitionId', label: 'Child Workflow ID', format: 'text' },
    { key: 'workflowVersion', label: 'Child Workflow version', format: 'number' },
    { key: 'input', label: 'Child input bindings', format: 'json' },
  ],
  human_confirmation: [{ key: 'prompt', label: 'Confirmation prompt', format: 'text' }],
  error_handler: [
    { key: 'handledNodeId', label: 'Handled node ID', format: 'text' },
    { key: 'strategy', label: 'Strategy (terminate / continue / goto)', format: 'text' },
    { key: 'gotoNodeId', label: 'Recovery node ID', format: 'text', optional: true },
    { key: 'skillFailurePolicy', label: 'Skill failure policy', format: 'json', optional: true },
    { key: 'recoveryOptions', label: 'Recovery options', format: 'json', optional: true },
  ],
  skill_call: [
    { key: 'skillId', label: 'Skill ID', format: 'text' },
    { key: 'input', label: 'Skill input bindings', format: 'json' },
    { key: 'outputMappings', label: 'Output mappings', format: 'json', optional: true },
  ],
} as const satisfies Readonly<Record<string, readonly Field[]>>;

export type EditableNodeType = keyof typeof workflowNodeFields;
export function isEditableNodeType(value: string): value is EditableNodeType {
  return Object.hasOwn(workflowNodeFields, value);
}

export function parseNodeParameters(
  type: string,
  fields: Readonly<Record<string, string>>,
): Record<string, unknown> {
  if (!isEditableNodeType(type)) throw new Error('Unknown Workflow node type');
  const result: Record<string, unknown> = {};
  for (const field of workflowNodeFields[type] as readonly Field[]) {
    const text = fields[field.key] ?? '';
    if (field.optional && text.trim() === '') continue;
    if (text.trim() === '') throw new Error(`${field.label} is required`);
    if (field.format === 'number') {
      const value = Number(text);
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`${field.label} must be a positive integer`);
      result[field.key] = value;
    } else if (field.format === 'json') {
      try {
        result[field.key] = JSON.parse(text) as unknown;
      } catch {
        throw new Error(`${field.label} must be valid JSON`);
      }
    } else result[field.key] = text;
  }
  return result;
}

/** Edits a single node as restricted data; formal validation remains on the server. */
export function WorkflowNodeParameters({
  node,
  disabled,
  onApply,
  onPending,
}: {
  readonly node: Readonly<Record<string, unknown>> & {
    readonly nodeId: string;
    readonly type: string;
  };
  readonly disabled: boolean;
  readonly onApply: (parameters: Record<string, unknown>) => void;
  readonly onPending: (pending: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  if (!isEditableNodeType(node.type))
    return <p>Unknown node type. Use the DSL editor to inspect this node.</p>;
  return (
    <details>
      <summary>Node parameters</summary>
      <form
        onChange={() => {
          onPending(true);
        }}
        onReset={() => {
          onPending(false);
          setError(undefined);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(
            [...new FormData(event.currentTarget)].map(([key, value]) => [
              key,
              typeof value === 'string' ? value : '',
            ]),
          );
          try {
            onApply(parseNodeParameters(node.type, values));
            onPending(false);
            setError(undefined);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid node parameters');
          }
        }}
      >
        <fieldset disabled={disabled}>
          {(workflowNodeFields[node.type] as readonly Field[]).map((field) => (
            <label key={field.key}>
              {field.label}
              {field.optional ? ' (optional)' : ''}
              {field.format === 'json' ? (
                <textarea
                  name={field.key}
                  aria-label={`${node.nodeId} ${field.label}`}
                  rows={4}
                  spellCheck={false}
                  defaultValue={
                    node[field.key] === undefined ? '' : JSON.stringify(node[field.key], null, 2)
                  }
                />
              ) : (
                <input
                  name={field.key}
                  aria-label={`${node.nodeId} ${field.label}`}
                  type={field.format === 'number' ? 'number' : 'text'}
                  {...(field.format === 'number' ? { min: 1, step: 1 } : {})}
                  defaultValue={
                    typeof node[field.key] === 'string' || typeof node[field.key] === 'number'
                      ? String(node[field.key] as string | number)
                      : ''
                  }
                />
              )}
            </label>
          ))}
          <button type="submit">Apply node parameters</button>
          <button type="reset">Discard parameter edits</button>
          {error === undefined ? null : <p role="alert">{error}</p>}
        </fieldset>
      </form>
    </details>
  );
}
