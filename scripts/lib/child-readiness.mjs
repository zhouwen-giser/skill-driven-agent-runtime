import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

/** Observe the process we started before allowing any client request to its endpoints. */
export function waitForChildReady(child, event, timeoutMs = 30_000) {
  return new Promise((accept, reject) => {
    let buffered = '';
    const timer = setTimeout(
      () => finish(new Error(`CHILD_READINESS_TIMEOUT:${event}`)),
      timeoutMs,
    );
    function finish(error, value) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else accept(value);
    }
    function onExit(code, signal) {
      finish(new Error(`CHILD_EXITED_BEFORE_READY:${event}:${code}:${signal}`));
    }
    function onError(error) {
      finish(error);
    }
    function onData(chunk) {
      process.stdout.write(chunk);
      buffered += chunk.toString('utf8');
      if (buffered.length > 1_048_576) {
        finish(new Error('CHILD_READINESS_LOG_TOO_LARGE'));
        return;
      }
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let value;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        } // Other startup log lines need not be JSON.
        if (value !== null && typeof value === 'object' && value.event === event) {
          finish(undefined, value);
          // Keep draining logs after readiness so a running child cannot block on its stdout pipe.
          child.stdout.on('data', (data) => process.stdout.write(data));
          return;
        }
      }
    }
    if (child.stdout === null) {
      clearTimeout(timer);
      reject(new Error('CHILD_STDOUT_REQUIRED'));
      return;
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
    if (child.exitCode !== null || child.signalCode !== null)
      onExit(child.exitCode, child.signalCode);
  });
}

export function localChildEndpoint(value) {
  if (typeof value !== 'string') throw new Error('CHILD_ENDPOINT_MISSING');
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('CHILD_ENDPOINT_NOT_LOCAL');
  return url.origin;
}

/** Finish the owned service before removing its database; an exit failure fails verification. */
export async function stopVerificationChild(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0 && child.signalCode !== 'SIGTERM')
      throw new Error(`CHILD_SHUTDOWN_FAILED:${child.exitCode}:${child.signalCode}`);
    return;
  }
  let timedOut = false;
  const result = await new Promise((accept) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      accept({ code, signal });
    });
    child.kill('SIGTERM');
  });
  if (timedOut) throw new Error('CHILD_SHUTDOWN_TIMEOUT');
  if (result.code !== 0 && result.signal !== 'SIGTERM')
    throw new Error(`CHILD_SHUTDOWN_FAILED:${result.code}:${result.signal}`);
}
