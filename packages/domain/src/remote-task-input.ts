import { DomainError } from './errors.js';

export const MAX_REMOTE_TASK_INPUT_JSON_BYTES = 1_048_576;
export const MAX_REMOTE_TASK_INPUT_KEYS = 128;
export const MAX_REMOTE_TASK_INPUT_JSON_DEPTH = 32;
export const MAX_REMOTE_TASK_INPUT_JSON_ENTRIES = 1_024;
export const MAX_REMOTE_TASK_INPUT_STRING_LENGTH = 131_072;

export type RemoteTaskInputLinkStatus =
  'waiting' | 'answered' | 'update_acknowledged' | 'update_uncertain' | 'provider_advanced';

export interface RemoteTaskInputLink {
  readonly inputRequestId: string;
  readonly controlEventId: string;
  readonly bindingId: string;
  readonly remoteTaskId: string;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly remoteRevision: string;
  readonly resultHash: string;
  readonly inputRequests: Readonly<Record<string, unknown>>;
  readonly status: RemoteTaskInputLinkStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createRemoteTaskInputLink(
  input: Omit<RemoteTaskInputLink, 'status' | 'updatedAt'>,
): RemoteTaskInputLink {
  const createdAt = requireTimestamp(input.createdAt);
  const inputRequests = snapshotInputRecord(input.inputRequests, 'requests');
  assertSupportedRemoteTaskInputRequests(inputRequests);
  return Object.freeze({
    inputRequestId: requireIdentifier(input.inputRequestId, 'input request'),
    controlEventId: requireIdentifier(input.controlEventId, 'control event'),
    bindingId: requireIdentifier(input.bindingId, 'binding'),
    remoteTaskId: requireRemoteTaskId(input.remoteTaskId),
    workflowInstanceId: requireIdentifier(input.workflowInstanceId, 'Workflow instance'),
    workflowNodeId: requireIdentifier(input.workflowNodeId, 'Workflow node'),
    workflowNodeRunId: requireIdentifier(input.workflowNodeRunId, 'Workflow node run'),
    remoteRevision: requireIdentifier(input.remoteRevision, 'remote revision'),
    resultHash: requireHash(input.resultHash),
    inputRequests,
    status: 'waiting',
    createdAt,
    updatedAt: createdAt,
  });
}

/** V1 intentionally supports only form elicitation that can be answered through A2A data. */
export function assertSupportedRemoteTaskInputRequests(
  inputRequests: Readonly<Record<string, unknown>>,
): void {
  for (const request of Object.values(inputRequests)) {
    if (!isPlainRecord(request) || request['method'] !== 'elicitation/create')
      throw new DomainError(
        'REMOTE_TASK_INPUT_REQUEST_UNSUPPORTED',
        'Remote Task V1 supports only elicitation/create form requests.',
      );
    const params = request['params'];
    if (
      !isPlainRecord(params) ||
      params['mode'] === 'url' ||
      typeof params['message'] !== 'string' ||
      params['message'].trim() === '' ||
      !isPlainRecord(params['requestedSchema'])
    )
      throw new DomainError(
        'REMOTE_TASK_INPUT_REQUEST_UNSUPPORTED',
        'Remote Task V1 requires a bounded form elicitation message and requestedSchema.',
      );
  }
}

export function transitionRemoteTaskInputLink(
  link: RemoteTaskInputLink,
  status: RemoteTaskInputLinkStatus,
  updatedAt: string,
): RemoteTaskInputLink {
  if (link.status === status) return link;
  if (!allowedTransitions[link.status].includes(status))
    throw new DomainError(
      'REMOTE_TASK_INPUT_STATUS_TRANSITION_INVALID',
      `Remote Task input link cannot transition from ${link.status} to ${status}.`,
    );
  const timestamp = requireTimestamp(updatedAt);
  if (Date.parse(timestamp) < Date.parse(link.updatedAt))
    throw new DomainError(
      'REMOTE_TASK_INPUT_STATUS_TRANSITION_INVALID',
      'Remote Task input link timestamps must be monotonic.',
    );
  return Object.freeze({ ...link, status, updatedAt: timestamp });
}

/**
 * Converts protocol-neutral A2A input into the key-addressed shape expected by a remote Task.
 * MCP request/result-shape validation remains an adapter responsibility.
 */
export function normalizeRemoteTaskInputResponses(
  inputRequests: Readonly<Record<string, unknown>>,
  inputContent: unknown,
): Readonly<Record<string, unknown>> {
  const requests = snapshotInputRecord(inputRequests, 'requests');
  const requestKeys = Object.keys(requests).sort();
  if (typeof inputContent === 'string') {
    const onlyKey = requestKeys[0];
    if (requestKeys.length !== 1 || onlyKey === undefined)
      throw new DomainError(
        'REMOTE_TASK_INPUT_RESPONSE_INVALID',
        'Text input is allowed only when the Provider has exactly one outstanding input key.',
      );
    return Object.freeze({ [onlyKey]: inputContent });
  }
  const responses = snapshotInputRecord(inputContent, 'responses');
  const responseKeys = Object.keys(responses).sort();
  if (
    requestKeys.length !== responseKeys.length ||
    requestKeys.some((key, index) => key !== responseKeys[index])
  )
    throw new DomainError(
      'REMOTE_TASK_INPUT_RESPONSE_INVALID',
      'Remote Task input response keys must exactly match the outstanding request keys.',
    );
  return responses;
}

/** Creates an immutable, bounded JSON snapshot for an adapter-supplied input value. */
export function snapshotRemoteTaskInputValue(value: unknown): unknown {
  const budget = { entries: 0 };
  const snapshot = snapshotJsonValue(value, new Set<object>(), budget, 0);
  assertEncodedSize(snapshot);
  return snapshot;
}

const allowedTransitions: Readonly<
  Record<RemoteTaskInputLinkStatus, readonly RemoteTaskInputLinkStatus[]>
> = Object.freeze({
  waiting: ['answered'],
  answered: ['update_acknowledged', 'update_uncertain', 'provider_advanced'],
  update_acknowledged: ['provider_advanced'],
  update_uncertain: ['update_acknowledged', 'provider_advanced'],
  provider_advanced: [],
});

function snapshotInputRecord(value: unknown, label: 'requests' | 'responses') {
  if (!isPlainRecord(value))
    throw new DomainError(
      'REMOTE_TASK_INPUT_JSON_INVALID',
      `Remote Task input ${label} must be a plain JSON object.`,
    );
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > MAX_REMOTE_TASK_INPUT_KEYS)
    throw new DomainError(
      'REMOTE_TASK_INPUT_KEYS_INVALID',
      `Remote Task input ${label} must contain between 1 and ${String(MAX_REMOTE_TASK_INPUT_KEYS)} keys.`,
    );
  for (const key of keys) {
    if (key.length < 1 || key.length > 256)
      throw new DomainError(
        'REMOTE_TASK_INPUT_KEYS_INVALID',
        'Remote Task input keys must contain between 1 and 256 characters.',
      );
  }
  const snapshot = snapshotRemoteTaskInputValue(value);
  if (!isPlainRecord(snapshot)) throw new Error('REMOTE_TASK_INPUT_SNAPSHOT_RECORD_REQUIRED');
  return snapshot;
}

function snapshotJsonValue(
  value: unknown,
  active: Set<object>,
  budget: { entries: number },
  depth: number,
): unknown {
  if (depth > MAX_REMOTE_TASK_INPUT_JSON_DEPTH) return invalidJson('exceeds the depth bound');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    if (typeof value === 'string' && value.length > MAX_REMOTE_TASK_INPUT_STRING_LENGTH)
      return invalidJson('contains an overlong string');
    return value;
  }
  if (typeof value !== 'object') return invalidJson('contains a non-JSON value');
  if (active.has(value)) return invalidJson('contains a cycle');
  if (!Array.isArray(value) && !isPlainRecord(value))
    return invalidJson('contains a non-plain object');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      consumeEntries(value.length, budget);
      return Object.freeze(value.map((item) => snapshotJsonValue(item, active, budget, depth + 1)));
    }
    const keys = Object.keys(value).sort();
    consumeEntries(keys.length, budget);
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === '') return invalidJson('contains an empty object key');
      snapshot[key] = snapshotJsonValue(value[key], active, budget, depth + 1);
    }
    return Object.freeze(snapshot);
  } finally {
    active.delete(value);
  }
}

function consumeEntries(count: number, budget: { entries: number }): void {
  budget.entries += count;
  if (budget.entries > MAX_REMOTE_TASK_INPUT_JSON_ENTRIES) invalidJson('exceeds the entry bound');
}

function assertEncodedSize(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_REMOTE_TASK_INPUT_JSON_BYTES)
    throw new DomainError(
      'REMOTE_TASK_INPUT_JSON_TOO_LARGE',
      'Remote Task input JSON exceeds the one MiB bound.',
    );
}

function invalidJson(reason: string): never {
  throw new DomainError('REMOTE_TASK_INPUT_JSON_INVALID', `Remote Task input JSON ${reason}.`);
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1_024)
    throw new DomainError(
      'REMOTE_TASK_INPUT_IDENTITY_INVALID',
      `Remote Task input ${label} identity must be non-empty and bounded.`,
    );
  return value;
}

function requireRemoteTaskId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !/^[!-~]+$/u.test(value)
  )
    throw new DomainError(
      'REMOTE_TASK_INPUT_IDENTITY_INVALID',
      'Remote Task input remote Task identity must be a bounded visible-ASCII value.',
    );
  return value;
}

function requireHash(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value))
    throw new DomainError(
      'REMOTE_TASK_INPUT_IDENTITY_INVALID',
      'Remote Task input result hash must be a lowercase SHA-256 value.',
    );
  return value;
}

function requireTimestamp(value: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new DomainError(
      'REMOTE_TASK_INPUT_IDENTITY_INVALID',
      'Remote Task input timestamp must be valid.',
    );
  return value;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
