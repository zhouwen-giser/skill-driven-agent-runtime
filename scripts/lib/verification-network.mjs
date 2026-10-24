import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { verificationProjects } from './verification-projects.mjs';

/** Opt-in local fixture routing. Published ports, project ownership and host readiness still apply. */
export async function writeDefaultBridgeOverrides(directory) {
  const paths = [];
  for (const [name, services] of [
    ['runtime', ['postgres', 'redis']],
    ['control', ['control-postgres']],
  ]) {
    const path = join(directory, `${name}.compose.yaml`);
    const content =
      'services:\n' +
      services
        .map((service) => `  ${service}:\n    networks: !reset []\n    network_mode: bridge\n`)
        .join('');
    await writeFile(path, content, { mode: 0o600 });
    paths.push({ path, content });
  }
  return paths;
}

export function withVerificationNetwork(args, environment = process.env) {
  const directory = environment.SDAR_VERIFY_DEFAULT_BRIDGE_DIRECTORY;
  if (!directory || args[0] !== 'compose') return args;
  if (environment.SDAR_VERIFY_ISOLATED !== 'true' || !isAbsolute(directory))
    throw new Error('VERIFICATION_NETWORK_ISOLATION_REQUIRED');
  const projectIndex = args.findIndex((arg) => arg === '--project-name' || arg === '-p');
  const fileIndex = args.indexOf('-f');
  const project = verificationProjects(environment.SDAR_VERIFY_COMPOSE_PROJECT).find(
    (entry) => entry.name === args[projectIndex + 1] && entry.file === args[fileIndex + 1],
  );
  if (projectIndex < 0 || fileIndex < 0 || !project)
    throw new Error('VERIFICATION_NETWORK_PROJECT_REQUIRED');
  const overlay = join(
    directory,
    project.file === 'compose.node-control.yaml' ? 'control.compose.yaml' : 'runtime.compose.yaml',
  );
  if (args.includes(overlay)) return args;
  return [...args.slice(0, fileIndex + 2), '-f', overlay, ...args.slice(fileIndex + 2)];
}
