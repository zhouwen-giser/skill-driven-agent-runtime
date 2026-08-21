#!/usr/bin/env node

import { createServer } from 'node:net';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const UAP_FIXED_LOOPBACK_PORTS = Object.freeze([
  17_031, 19_131, 18_092, 55_462, 55_463, 56_391, 10_998, 10_999, 10_091,
]);
const SDAR_AND_HOST_PORTS = Object.freeze([55_462, 55_463, 56_391, 10_998, 10_999, 10_091]);

export class UapPortError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UapPortError';
    this.code = code;
  }
}

export async function assertFixedPortsAvailable(ports = UAP_FIXED_LOOPBACK_PORTS) {
  if (
    !Array.isArray(ports) ||
    ports.length !== new Set(ports).size ||
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)
  )
    throw new UapPortError('UAP_PORT_SET_INVALID');
  for (const port of ports) await assertPortAvailable(port);
  return Object.freeze({ checkedPortCount: ports.length, allAvailable: true });
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => {
      reject(
        error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
          ? new UapPortError('UAP_FIXED_PORT_ALREADY_BOUND')
          : new UapPortError('UAP_FIXED_PORT_INSPECTION_FAILED'),
      );
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => {
        if (error !== undefined) reject(new UapPortError('UAP_FIXED_PORT_INSPECTION_FAILED'));
        else resolve();
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length > 3 ||
      (process.argv.length === 3 && process.argv[2] !== '--sdar-and-host')
    )
      throw new UapPortError('UAP_ARGUMENT_INVALID');
    const result = await assertFixedPortsAvailable(
      process.argv[2] === '--sdar-and-host' ? SDAR_AND_HOST_PORTS : UAP_FIXED_LOOPBACK_PORTS,
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, portValuesIncluded: false })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof UapPortError ? error.code : 'UAP_PORT_CHECK_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
