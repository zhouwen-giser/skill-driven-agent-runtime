import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import process from 'node:process';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';

// Each command owns a new POSIX process group. Never signal the caller's group.
export async function runVerificationProcess({
  command,
  args = [],
  cwd,
  env,
  logPath,
  timeoutMs,
  signal,
  stdout = process.stdout,
  stderr = process.stderr,
  graceMs = 2_000,
}) {
  const started = Date.now();
  const log = createWriteStream(logPath);
  const logFinished = finished(log);
  // Observe I/O errors immediately, including while the command is still running.
  let logError;
  void logFinished.catch((error) => {
    logError = error.message;
  });
  const cleanupErrors = [];
  const resources = {
    source: 'linux-proc-process-group-sampling',
    samples: 0,
    peakRssBytes: 0,
    peakProcesses: 0,
  };
  let reason;
  let spawnError;
  let forceTimer;
  let child;
  function killGroup(kind) {
    if (child?.pid === undefined) return;
    try {
      process.kill(-child.pid, kind);
    } catch (error) {
      if (error.code !== 'ESRCH') cleanupErrors.push(`${kind}:${error.message}`);
    }
  }
  function stop(value) {
    if (reason !== undefined) return;
    reason = value;
    killGroup('SIGTERM');
    forceTimer = setTimeout(() => killGroup('SIGKILL'), graceMs);
  }
  const onAbort = () => stop('canceled');
  if (signal?.aborted) {
    log.end();
    await logFinished;
    return {
      exitCode: null,
      signal: null,
      reason: 'canceled',
      durationMs: Date.now() - started,
      resources,
      cleanupErrors,
    };
  }
  child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => {
    log.write(chunk);
    stdout?.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log.write(chunk);
    stderr?.write(chunk);
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => stop('timeout'), timeoutMs);
  let sampling = false;
  async function sample() {
    if (sampling || child.pid === undefined || process.platform !== 'linux') return;
    sampling = true;
    try {
      const entries = await readdir('/proc');
      let rss = 0;
      let count = 0;
      for (const pid of entries.filter((name) => /^\d+$/u.test(name))) {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
        if (stat === undefined) continue;
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (Number(fields[2]) !== child.pid || fields[0] === 'Z') continue;
        const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
        rss += Number(status.match(/^VmRSS:\s+(\d+)/mu)?.[1] ?? 0) * 1024;
        count += 1;
      }
      resources.samples += 1;
      resources.peakRssBytes = Math.max(resources.peakRssBytes, rss);
      resources.peakProcesses = Math.max(resources.peakProcesses, count);
    } catch (error) {
      resources.error = error.message;
    } finally {
      sampling = false;
    }
  }
  const sampleTimer = setInterval(() => {
    void sample();
  }, 1_000);
  void sample();
  // Even a successful leader must not leave background descendants holding pipes open.
  child.once('exit', () => killGroup('SIGKILL'));
  const result = await new Promise((accept) => {
    child.once('error', (error) => {
      spawnError = error.message;
    });
    child.once('close', (exitCode, exitSignal) => accept({ exitCode, signal: exitSignal }));
  });
  clearTimeout(timeout);
  clearTimeout(forceTimer);
  clearInterval(sampleTimer);
  signal?.removeEventListener('abort', onAbort);
  killGroup('SIGKILL');
  log.end();
  await logFinished.catch(() => undefined);
  return {
    ...result,
    durationMs: Date.now() - started,
    resources,
    cleanupErrors,
    ...(reason === undefined ? {} : { reason }),
    ...(spawnError === undefined ? {} : { error: spawnError }),
    ...(logError === undefined ? {} : { logError }),
  };
}

export function verificationProcessPassed(result) {
  return (
    result.exitCode === 0 &&
    result.reason === undefined &&
    result.error === undefined &&
    result.logError === undefined &&
    result.cleanupErrors.length === 0
  );
}
