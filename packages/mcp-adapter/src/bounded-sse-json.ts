const DEFAULT_MAX_PENDING_BYTES = 1_048_576;

export async function* parseBoundedSseJson(
  stream: ReadableStream<Uint8Array>,
  maxPendingBytes = DEFAULT_MAX_PENDING_BYTES,
): AsyncIterable<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(pending, 'utf8') > maxPendingBytes)
        throw new BoundedSseJsonError(
          'POST_SSE_BUFFER_OVERFLOW',
          'POST SSE event exceeded the bounded receive buffer.',
        );
      const events = pending.split(/\r?\n\r?\n/u);
      pending = events.pop() ?? '';
      for (const event of events) {
        const parsed = parseSseJsonEvent(event);
        if (parsed !== undefined) yield parsed;
      }
    }
    pending += decoder.decode();
    if (pending.trim() !== '') {
      const parsed = parseSseJsonEvent(pending);
      if (parsed !== undefined) yield parsed;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseFirstSseJson(value: string): unknown {
  for (const event of value.split(/\r?\n\r?\n/u)) {
    const parsed = parseSseJsonEvent(event);
    if (parsed !== undefined) return parsed;
  }
  throw new BoundedSseJsonError(
    'POST_SSE_MESSAGE_INVALID',
    'POST SSE response contains no JSON data message.',
  );
}

function parseSseJsonEvent(event: string): unknown {
  const data = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data === '') return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch (error: unknown) {
    throw new BoundedSseJsonError('POST_SSE_MESSAGE_INVALID', 'POST SSE data is not valid JSON.', {
      cause: error,
    });
  }
}

export type BoundedSseJsonErrorCode = 'POST_SSE_BUFFER_OVERFLOW' | 'POST_SSE_MESSAGE_INVALID';

export class BoundedSseJsonError extends Error {
  readonly code: BoundedSseJsonErrorCode;

  constructor(code: BoundedSseJsonErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BoundedSseJsonError';
    this.code = code;
  }
}
