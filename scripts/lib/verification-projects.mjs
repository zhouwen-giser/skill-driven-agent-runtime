export function verificationProjects(runId) {
  if (!/^sdar-verify-[a-z0-9-]+$/u.test(runId))
    throw new Error('VERIFICATION_PROJECT_ROOT_INVALID');
  return [
    { name: runId, file: 'compose.yaml' },
    { name: `${runId}-control-smoke`, file: 'compose.node-control.yaml' },
    { name: `${runId}-runtime-smoke`, file: 'compose.yaml' },
  ];
}
